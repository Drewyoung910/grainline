import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";
import { HTTP_STATUS } from "@/lib/httpStatus";
import {
  labelClawbackErrorMessage,
  labelClawbackIdempotencyKey,
} from "@/lib/labelClawbackState";
import { finalizeSellerLabelProviderResult } from "@/lib/orderLabelFinalization";
import {
  claimSellerLabelPurchase,
  finalizeLabelClawback,
  isValidProviderLabelUrl,
  replaceSellerLabelQuote,
  sellerLabelDownload,
  sellerLabelPreflight,
  type FixedLabelRate,
  type OrderLabelConflictReason,
} from "@/lib/orderLabelAuthority";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import {
  labelPurchaseRatelimit,
  rateLimitResponse,
  safeRateLimit,
} from "@/lib/ratelimit";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readOptionalBoundedJson,
} from "@/lib/requestBody";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";
import { logServerError } from "@/lib/serverErrorLogger";
import { sanitizeShippoProviderErrorBody } from "@/lib/shippoErrorSanitize";
import {
  normalizeShippoRateCurrency,
  shippoRequest,
  shippoRatesMultiPiece,
} from "@/lib/shippo";
import {
  isPickupRateObjectId,
  isQuoteOnlyRateObjectId,
  MAX_PROVIDER_SHIPPING_CENTS,
  safeProviderShippingCents,
} from "@/lib/shippingQuoteState";
import { stripe } from "@/lib/stripe";

const LabelSchema = z.object({
  rateObjectId: z.string().min(1).max(255).optional().nullable(),
});

export const runtime = "nodejs";
export const maxDuration = 60;

type ShippoRateEvidence = {
  object_id?: string | null;
  amount?: number | string | null;
  currency?: string | null;
  provider?: string | null;
};

type ShippoTransaction = {
  status?: string | null;
  messages?: { text?: string | null }[];
  object_id?: string | null;
  label_url?: string | null;
  tracking_number?: string | null;
  rate?: string | ShippoRateEvidence | null;
};

const LABEL_PURCHASE_BODY_MAX_BYTES = 16 * 1024;

function isPurchasableRateObjectId(value: string | null | undefined): value is string {
  return Boolean(
    value && value !== "fallback" && !isPickupRateObjectId(value) && !isQuoteOnlyRateObjectId(value),
  );
}

function prioritizeAndTrim(rates: FixedLabelRate[], max = 4): FixedLabelRate[] {
  const scored = rates.map((rate) => {
    const isUps = (rate.carrier || "").toLowerCase().includes("ups");
    const isGround = (rate.service || "").toLowerCase().includes("ground")
      || rate.label.toLowerCase().includes("ground");
    return { ...rate, boost: isUps && isGround ? 1 : 0 };
  });
  scored.sort((left, right) =>
    right.boost - left.boost
    || left.amountCents - right.amountCents
    || (left.estDays ?? 999) - (right.estDays ?? 999));
  const seen = new Set<string>();
  const selected: FixedLabelRate[] = [];
  for (const { boost: _boost, ...rate } of scored) {
    const key = `${(rate.carrier || "").toLowerCase()}|${(rate.service || rate.label).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(rate);
    if (selected.length >= max) break;
  }
  return selected;
}

function conflictResponse(reason: OrderLabelConflictReason) {
  switch (reason) {
    case "unpaid":
    case "refunded":
    case "state_changed":
    case "label_purchased":
      return privateJson({ error: "Order state changed. Refresh and try again." }, { status: HTTP_STATUS.CONFLICT });
    case "open_dispute":
      return privateJson({ error: "Resolve the open payment dispute before purchasing a label." }, { status: HTTP_STATUS.CONFLICT });
    case "active_case":
      return privateJson({ error: "Resolve the active case before purchasing a label." }, { status: HTTP_STATUS.CONFLICT });
    case "seller_deauthorized":
      return privateJson({ error: "Restore this shop's payout authorization before purchasing a label." }, { status: HTTP_STATUS.CONFLICT });
    case "label_claim_active":
      return privateJson({ error: "This label purchase is already being reconciled. Contact support before retrying." }, { status: HTTP_STATUS.CONFLICT });
    case "address_missing":
      return privateJson({ error: "The shipping or ship-from address is incomplete." }, { status: HTTP_STATUS.CONFLICT });
    case "package_missing":
      return privateJson({ error: "Package dimensions and weight are required before purchasing a label." }, { status: HTTP_STATUS.CONFLICT });
    case "rate_required":
    case "rate_expired":
      return privateJson({ error: "Shipping rate expired. Request a current quote." }, { status: HTTP_STATUS.CONFLICT });
    case "stale_claim":
      return privateJson({ error: "The label purchase changed. Refresh and try again." }, { status: HTTP_STATUS.CONFLICT });
    case "label_unavailable":
      return privateJson({ error: "The label is unavailable." }, { status: HTTP_STATUS.NOT_FOUND });
  }
}

async function currentShippoRate(rateObjectId: string, transactionRate: ShippoTransaction["rate"]) {
  if (transactionRate && typeof transactionRate === "object"
    && transactionRate.object_id === rateObjectId
    && transactionRate.amount != null && transactionRate.currency) {
    return transactionRate;
  }
  if (typeof transactionRate === "string") {
    const normalized = transactionRate.replace(/\/+$/, "");
    if (normalized !== rateObjectId && !normalized.endsWith(`/${rateObjectId}`)) {
      throw new TypeError("Shippo transaction changed the fixed rate identity");
    }
  }
  const evidence = await shippoRequest<ShippoRateEvidence>(
    `/rates/${encodeURIComponent(rateObjectId)}`,
  );
  if (evidence.object_id !== rateObjectId) {
    throw new TypeError("Shippo rate evidence changed the fixed rate identity");
  }
  return evidence;
}

async function loadActorByClerkId(clerkId: string) {
  try {
    return await ensureUserByClerkId(clerkId);
  } catch (error) {
    if (isAccountAccessError(error)) return error;
    throw error;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
    if (crossOriginRejection) return privateJson({ error: "Forbidden" }, { status: HTTP_STATUS.FORBIDDEN });

    const { userId: clerkId } = await auth();
    if (!clerkId) return privateJson({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });
    const actor = await loadActorByClerkId(clerkId);
    if (isAccountAccessError(actor)) {
      return privateJson({ error: actor.message, code: actor.code }, { status: actor.status });
    }
    const { success, reset } = await safeRateLimit(labelPurchaseRatelimit, actor.id);
    if (!success) return privateResponse(rateLimitResponse(reset, "Too many label purchase attempts."));

    const { id: orderId } = await params;
    let payload: z.infer<typeof LabelSchema>;
    try {
      payload = LabelSchema.parse(
        await readOptionalBoundedJson(req, LABEL_PURCHASE_BODY_MAX_BYTES, {}),
      );
    } catch (error) {
      if (isRequestBodyTooLargeError(error)) {
        return privateJson({ error: "Request body too large" }, { status: HTTP_STATUS.PAYLOAD_TOO_LARGE });
      }
      if (isInvalidJsonBodyError(error)) {
        return privateJson({ error: "Invalid JSON" }, { status: HTTP_STATUS.BAD_REQUEST });
      }
      if (error instanceof z.ZodError) {
        return privateJson({ error: "Invalid input", details: error.issues }, { status: HTTP_STATUS.BAD_REQUEST });
      }
      throw error;
    }

    const preflight = await sellerLabelPreflight({ actorUserId: actor.id, orderId });
    if (preflight.outcome === "unauthorized") {
      return privateJson({ error: "Forbidden" }, { status: HTTP_STATUS.FORBIDDEN });
    }
    if (preflight.outcome === "conflict") return conflictResponse(preflight.reason);

    const selectedRateId = payload.rateObjectId ?? null;
    if (!selectedRateId && !preflight.storedRateUsable) {
      const { rates, shipmentId } = await shippoRatesMultiPiece({
        from: {
          ...preflight.shipFrom,
          name: preflight.shipFrom.name ?? undefined,
          street2: preflight.shipFrom.street2 ?? undefined,
        },
        to: {
          ...preflight.shipTo,
          name: preflight.shipTo.name ?? undefined,
          street2: preflight.shipTo.street2 ?? undefined,
        },
        parcels: [{
          weight: { value: preflight.packageWeightGrams, unit: "g" },
          length: String(preflight.packageLengthCm),
          width: String(preflight.packageWidthCm),
          height: String(preflight.packageHeightCm),
        }],
      });
      const fixedRates = prioritizeAndTrim(rates.flatMap((rate) => {
        const normalizedCurrency = normalizeShippoRateCurrency(rate.currency);
        if (!isPurchasableRateObjectId(rate.objectId)
          || normalizedCurrency !== preflight.currency
          || !Number.isSafeInteger(rate.amount)
          || rate.amount < 0 || rate.amount > MAX_PROVIDER_SHIPPING_CENTS) return [];
        return [{
          objectId: rate.objectId,
          amountCents: rate.amount,
          currency: normalizedCurrency,
          label: `${rate.provider ?? "Carrier"} ${rate.servicelevel_name ?? "service"}`.trim(),
          carrier: rate.provider ?? null,
          service: rate.servicelevel_name ?? null,
          estDays: rate.est_days ?? null,
        } satisfies FixedLabelRate];
      }));
      if (!shipmentId || fixedRates.length === 0) {
        return privateJson({ error: "No current shipping label rates are available." }, { status: HTTP_STATUS.BAD_GATEWAY });
      }
      const stored = await replaceSellerLabelQuote({
        actorUserId: actor.id, orderId, shipmentId, rates: fixedRates,
      });
      if (stored.outcome === "unauthorized") return privateJson({ error: "Forbidden" }, { status: HTTP_STATUS.FORBIDDEN });
      if (stored.outcome === "conflict") return conflictResponse(stored.reason);
      return privateJson({ requiresRateSelection: true, rates: fixedRates }, { status: 202 });
    }

    const claim = await claimSellerLabelPurchase({
      actorUserId: actor.id, orderId, rateObjectId: selectedRateId,
    });
    if (claim.outcome === "unauthorized") return privateJson({ error: "Forbidden" }, { status: HTTP_STATUS.FORBIDDEN });
    if (claim.outcome === "conflict") return conflictResponse(claim.reason);

    let transaction: ShippoTransaction;
    try {
      transaction = await shippoRequest<ShippoTransaction>("/transactions/", {
        method: "POST",
        body: JSON.stringify({
          rate: claim.rateObjectId,
          label_file_type: "PDF",
          async: false,
          metadata: claim.claimId,
        }),
      });
    } catch (error) {
      await finalizeSellerLabelProviderResult({
        actorUserId: actor.id, orderId, claimId: claim.claimId,
        claimGeneration: claim.claimGeneration, outcome: "AMBIGUOUS",
        errorSummary: labelClawbackErrorMessage(error),
      });
      Sentry.captureException(error, {
        level: "warning", tags: { source: "shippo_label_purchase_ambiguous" },
        extra: { orderId, claimId: claim.claimId },
      });
      return privateJson({ error: "Shippo label status is unclear. Support must reconcile it before retrying." }, { status: HTTP_STATUS.BAD_GATEWAY });
    }

    if (transaction.status !== "SUCCESS") {
      const providerMessage = (transaction.messages ?? [])
        .map((message) => message.text).filter(Boolean).join("; ");
      await finalizeSellerLabelProviderResult({
        actorUserId: actor.id, orderId, claimId: claim.claimId,
        claimGeneration: claim.claimGeneration, outcome: "REJECTED",
        errorSummary: providerMessage.slice(0, 500),
      });
      const detail = sanitizeShippoProviderErrorBody(
        providerMessage || transaction.status || "provider rejected the transaction",
      );
      return privateJson({ error: `Shippo label purchase failed: ${detail}` }, { status: HTTP_STATUS.BAD_GATEWAY });
    }

    try {
      const rate = await currentShippoRate(claim.rateObjectId, transaction.rate);
      const amountCents = safeProviderShippingCents(rate.amount);
      const normalizedCurrency = rate.currency == null
        ? null
        : normalizeShippoRateCurrency(rate.currency);
      const transactionId = transaction.object_id?.trim() || null;
      const labelUrl = transaction.label_url?.trim() || null;
      const carrier = rate.provider?.trim() || null;
      if (!transactionId || !isValidProviderLabelUrl(labelUrl)
        || !carrier || amountCents !== claim.amountCents
        || normalizedCurrency !== claim.currency) {
        throw new TypeError("Shippo label result did not match the fixed claim");
      }
      const recorded = await finalizeSellerLabelProviderResult({
        actorUserId: actor.id, orderId, claimId: claim.claimId,
        claimGeneration: claim.claimGeneration, outcome: "SUCCESS",
        transactionId, labelUrl, rateObjectId: claim.rateObjectId,
        amountCents, currency: normalizedCurrency,
        carrier,
        trackingNumber: transaction.tracking_number?.trim() || null,
      });
      if (recorded.outcome !== "recorded") {
        throw new TypeError("Recorded Order label changed state unexpectedly");
      }

      if (recorded.clawbackStatus === "RETRYING" && recorded.stripeTransferId) {
        try {
          const reversal = await stripe.transfers.createReversal(
            recorded.stripeTransferId,
            { amount: recorded.amountCents, metadata: { orderId, reason: "label_cost_deduction" } },
            { idempotencyKey: labelClawbackIdempotencyKey({
              orderId, shippoTransactionId: recorded.transactionId,
              shippoRateObjectId: recorded.rateObjectId, amountCents: recorded.amountCents,
            }) },
          );
          await finalizeLabelClawback({
            orderId, claimId: recorded.claimId,
            claimGeneration: recorded.claimGeneration,
            clawbackGeneration: recorded.clawbackGeneration,
            outcome: "SUCCESS", reversalId: reversal.id,
          });
        } catch (error) {
          await finalizeLabelClawback({
            orderId, claimId: recorded.claimId,
            claimGeneration: recorded.claimGeneration,
            clawbackGeneration: recorded.clawbackGeneration,
            outcome: "FAILED", errorSummary: labelClawbackErrorMessage(error),
          });
          Sentry.captureException(error, {
            tags: { source: "label_cost_clawback" }, extra: { orderId, claimId: recorded.claimId },
          });
        }
      }

      return privateJson({ ok: true, order: {
        id: recorded.orderId, labelStatus: "PURCHASED",
        labelCarrier: recorded.carrier, labelTrackingNumber: recorded.trackingNumber,
        labelPurchasedAt: recorded.labelPurchasedAt, fulfillmentStatus: "SHIPPED",
      } });
    } catch (error) {
      await finalizeSellerLabelProviderResult({
        actorUserId: actor.id, orderId, claimId: claim.claimId,
        claimGeneration: claim.claimGeneration, outcome: "AMBIGUOUS",
        errorSummary: labelClawbackErrorMessage(error),
      }).catch((recordError) => Sentry.captureException(recordError, {
        tags: { source: "shippo_label_ambiguous_record_failed" }, extra: { orderId, claimId: claim.claimId },
      }));
      Sentry.captureException(error, {
        tags: { source: "shippo_label_success_validation" }, extra: { orderId, claimId: claim.claimId },
      });
      return privateJson({ error: "Shippo returned a label that could not be verified. Support must reconcile it." }, { status: HTTP_STATUS.BAD_GATEWAY });
    }
  } catch (error) {
    logServerError(error, { source: "label_purchase_route" });
    return privateJson({ error: "Server error" }, { status: HTTP_STATUS.INTERNAL_SERVER_ERROR });
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) return privateJson({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });
    const actor = await loadActorByClerkId(clerkId);
    if (isAccountAccessError(actor)) {
      return privateJson({ error: actor.message, code: actor.code }, { status: actor.status });
    }
    const { id: orderId } = await params;
    const proof = await sellerLabelDownload({ actorUserId: actor.id, orderId });
    if (proof.outcome === "unauthorized") return privateJson({ error: "Forbidden" }, { status: HTTP_STATUS.FORBIDDEN });
    if (proof.outcome === "conflict") return conflictResponse(proof.reason);

    const transaction = await shippoRequest<ShippoTransaction>(
      `/transactions/${encodeURIComponent(proof.transactionId)}`,
    );
    const rate = await currentShippoRate(proof.rateObjectId, transaction.rate);
    const normalizedCurrency = rate.currency == null
      ? null
      : normalizeShippoRateCurrency(rate.currency);
    if (transaction.status !== "SUCCESS" || transaction.object_id !== proof.transactionId
      || !isValidProviderLabelUrl(transaction.label_url)
      || safeProviderShippingCents(rate.amount) !== proof.amountCents
      || normalizedCurrency !== proof.currency) {
      return privateJson({ error: "The label could not be verified with Shippo." }, { status: HTTP_STATUS.BAD_GATEWAY });
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: transaction.label_url,
        "Cache-Control": "private, no-store, max-age=0",
        Pragma: "no-cache",
      },
    });
  } catch (error) {
    logServerError(error, { source: "label_download_route" });
    return privateJson({ error: "Server error" }, { status: HTTP_STATUS.INTERNAL_SERVER_ERROR });
  }
}
