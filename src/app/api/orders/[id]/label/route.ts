// src/app/api/orders/[id]/label/route.ts
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import {
  normalizeShippoRateCurrency,
  shippoRequest,
  shippoRatesMultiPiece,
} from "@/lib/shippo";
import {
  labelPurchaseRatelimit,
  rateLimitResponse,
  safeRateLimit,
} from "@/lib/ratelimit";
import {
  blockingRefundLedgerWhere,
  NON_BLOCKING_REFUND_LEDGER_STATUSES,
  orderHasRefundLedger,
} from "@/lib/refundRouteState";
import { latestOpenDisputeLedgerExistsSql } from "@/lib/refundLedgerSql";
import { releaseStaleRefundLocks } from "@/lib/refundLocks";
import {
  appendLabelClawbackReviewNote,
  labelClawbackErrorMessage,
  labelClawbackIdempotencyKey,
} from "@/lib/labelClawbackState";
import {
  labelClawbackOrderSelect,
  markLabelClawbackForReview,
  recordSuccessfulLabelClawback,
  type LabelClawbackOrder,
} from "@/lib/labelClawbackRetry";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readOptionalBoundedJson,
} from "@/lib/requestBody";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";
import { logServerError } from "@/lib/serverErrorLogger";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { HTTP_STATUS } from "@/lib/httpStatus";
import { Prisma, type FulfillmentStatus, type LabelStatus } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import {
  DEAUTHORIZED_SELLER_FULFILLMENT_HOLD_MESSAGE,
  DEAUTHORIZED_SELLER_REVIEW_NOTE_SQL_PATTERN,
  orderHasDeauthorizedSellerReviewHold,
} from "@/lib/orderReviewHolds";
import { sanitizeShippoProviderErrorBody } from "@/lib/shippoErrorSanitize";
import {
  isPickupRateObjectId,
  isQuoteOnlyRateObjectId,
  MAX_PROVIDER_SHIPPING_CENTS,
  safeProviderShippingCents,
} from "@/lib/shippingQuoteState";
import { normalizeCurrencyCode } from "@/lib/money";

const LabelSchema = z.object({
  rateObjectId: z.string().min(1).optional().nullable(),
});

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "iad1";

type LiveRate = {
  label: string;
  amountCents: number;
  currency: string;
  objectId: string;
  carrier?: string;
  service?: string;
  estDays?: number | null;
};

const ACTIVE_CASE_STATUSES = new Set([
  "OPEN",
  "IN_DISCUSSION",
  "PENDING_CLOSE",
  "UNDER_REVIEW",
]);
const LABEL_RATE_QUOTE_TTL_MS = 30 * 60 * 1000;
const LABEL_PURCHASE_BODY_MAX_BYTES = 16 * 1024;

function labelPurchaseOrderResponse(order: LabelClawbackOrder) {
  return {
    id: order.id,
    labelStatus: order.labelStatus,
    labelUrl: order.labelUrl,
    labelCarrier: order.labelCarrier,
    labelTrackingNumber: order.labelTrackingNumber,
    labelCostCents: order.labelCostCents,
    labelPurchasedAt: order.labelPurchasedAt?.toISOString() ?? null,
    fulfillmentStatus: order.fulfillmentStatus,
    shippedAt: order.shippedAt?.toISOString() ?? null,
    trackingNumber: order.trackingNumber,
    trackingCarrier: order.trackingCarrier,
  };
}

function isPurchasableRateObjectId(
  rateObjectId: string | null | undefined,
): rateObjectId is string {
  return (
    !!rateObjectId &&
    rateObjectId !== "fallback" &&
    !isPickupRateObjectId(rateObjectId) &&
    !isQuoteOnlyRateObjectId(rateObjectId)
  );
}

function rateSetIncludes(
  rates: Prisma.JsonValue,
  rateObjectId: string,
  expectedCurrency: string,
): boolean {
  const expected = normalizeCurrencyCode(expectedCurrency).toLowerCase();
  if (!Array.isArray(rates)) return false;
  return rates.some((rate) => {
    if (!rate || typeof rate !== "object" || Array.isArray(rate)) return false;
    const candidate = rate as Record<string, unknown>;
    const objectId = typeof candidate.objectId === "string" ? candidate.objectId : "";
    const amountCents = typeof candidate.amountCents === "number" ? candidate.amountCents : null;
    const currency = normalizeShippoRateCurrency(candidate.currency);
    return (
      objectId === rateObjectId &&
      currency === expected &&
      amountCents !== null &&
      Number.isSafeInteger(amountCents) &&
      amountCents >= 0 &&
      amountCents <= MAX_PROVIDER_SHIPPING_CENTS
    );
  });
}

function prioritizeAndTrim(rates: LiveRate[], max = 4): LiveRate[] {
  if (!Array.isArray(rates) || rates.length === 0) return [];
  const scored = rates.map((r) => {
    const isUps = (r.carrier || "").toLowerCase().includes("ups");
    const isGround =
      (r.service || "").toLowerCase().includes("ground") ||
      r.label.toLowerCase().includes("ground");
    return { ...r, __boost: isUps && isGround ? 1 : 0 };
  });
  scored.sort((a, b) => {
    if (b.__boost !== a.__boost) return b.__boost - a.__boost;
    if (a.amountCents !== b.amountCents) return a.amountCents - b.amountCents;
    return (a.estDays ?? 999) - (b.estDays ?? 999);
  });
  const seen = new Set<string>();
  const out: (LiveRate & { __boost: number })[] = [];
  for (const r of scored) {
    const key = `${(r.carrier || "").toLowerCase()}|${(r.service || r.label).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= max) break;
  }
  return out.map(({ __boost, ...rest }) => rest);
}

async function ensureSellerOwnsOrder(clerkUserId: string, orderId: string) {
  const me = await prisma.user.findUnique({
    where: { clerkId: clerkUserId },
    select: { id: true, banned: true, deletedAt: true },
  });
  if (!me || me.banned || me.deletedAt) return null;

  const seller = await prisma.sellerProfile.findUnique({
    where: { userId: me.id },
    select: {
      id: true,
      stripeAccountId: true,
      shipFromName: true,
      shipFromLine1: true,
      shipFromLine2: true,
      shipFromCity: true,
      shipFromState: true,
      shipFromPostal: true,
      shipFromCountry: true,
      defaultPkgWeightGrams: true,
      defaultPkgLengthCm: true,
      defaultPkgWidthCm: true,
      defaultPkgHeightCm: true,
    },
  });
  if (!seller) return null;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      case: { select: { status: true } },
      paymentEvents: {
        where: blockingRefundLedgerWhere(),
        take: 1,
        select: { eventType: true, status: true },
      },
      items: {
        include: {
          listing: {
            select: {
              sellerId: true,
              packagedWeightGrams: true,
              packagedLengthCm: true,
              packagedWidthCm: true,
              packagedHeightCm: true,
            },
          },
        },
      },
    },
  });
  if (!order) return null;

  const ownsEntireOrder =
    order.items.length > 0 &&
    order.items.every((it) => it.listing.sellerId === seller.id);
  return ownsEntireOrder ? { order, seller } : null;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
    if (crossOriginRejection) {
      return privateJson({ error: "Forbidden" }, { status: HTTP_STATUS.FORBIDDEN });
    }

    const { id } = await params;

    const { userId } = await auth();
    if (!userId) return privateJson({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });

    const { success, reset } = await safeRateLimit(
      labelPurchaseRatelimit,
      userId,
    );
    if (!success)
      return privateResponse(
        rateLimitResponse(reset, "Too many label purchase attempts."),
      );

    const authz = await ensureSellerOwnsOrder(userId, id);
    if (!authz) return privateJson({ error: "Forbidden" }, { status: HTTP_STATUS.FORBIDDEN });

    let { order, seller } = authz;

    const staleLocksReleased = await releaseStaleRefundLocks(id);
    if (staleLocksReleased.count > 0) {
      const refreshedAuthz = await ensureSellerOwnsOrder(userId, id);
      if (!refreshedAuthz) return privateJson({ error: "Forbidden" }, { status: HTTP_STATUS.FORBIDDEN });
      ({ order, seller } = refreshedAuthz);
    }

    // Parse optional body — frontend may supply rateObjectId after a re-quote
    let labelParsed: { rateObjectId?: string | null | undefined } = {};
    try {
      labelParsed = LabelSchema.parse(
        await readOptionalBoundedJson(req, LABEL_PURCHASE_BODY_MAX_BYTES, {}),
      );
    } catch (e) {
      if (isRequestBodyTooLargeError(e)) {
        return privateJson(
          { error: "Request body too large" },
          { status: HTTP_STATUS.PAYLOAD_TOO_LARGE },
        );
      }
      if (isInvalidJsonBodyError(e)) {
        return privateJson({ error: "Invalid JSON" }, { status: HTTP_STATUS.BAD_REQUEST });
      }
      if (e instanceof z.ZodError) {
        return privateJson(
          { error: "Invalid input", details: e.issues },
          { status: HTTP_STATUS.BAD_REQUEST },
        );
      }
      // empty body is fine — treat as no rateObjectId
      throw e;
    }
    const bodyRateObjectId: string | null = labelParsed?.rateObjectId ?? null;

    // Guard rails
    if (order.labelStatus === ("PURCHASED" as LabelStatus)) {
      return privateJson(
        { error: "Label already purchased for this order." },
        { status: HTTP_STATUS.BAD_REQUEST },
      );
    }
    // Block label purchase if order has been refunded or has an open case
    if (orderHasRefundLedger(order)) {
      return privateJson(
        { error: "Cannot purchase label - order has been refunded." },
        { status: HTTP_STATUS.BAD_REQUEST },
      );
    }
    if (order.sellerRefundLockedAt) {
      return privateJson(
        { error: "Cannot purchase label while a refund is being processed." },
        { status: HTTP_STATUS.CONFLICT },
      );
    }
    if (order.fulfillmentMethod === "PICKUP") {
      return privateJson(
        { error: "Cannot purchase a shipping label for a pickup order." },
        { status: HTTP_STATUS.BAD_REQUEST },
      );
    }
    if (order.case && ACTIVE_CASE_STATUSES.has(order.case.status)) {
      return privateJson(
        {
          error: "Cannot purchase a label while this order has an active case.",
        },
        { status: HTTP_STATUS.BAD_REQUEST },
      );
    }
    if (orderHasDeauthorizedSellerReviewHold(order)) {
      return privateJson(
        { error: DEAUTHORIZED_SELLER_FULFILLMENT_HOLD_MESSAGE },
        { status: HTTP_STATUS.CONFLICT },
      );
    }
    const terminalStatuses: FulfillmentStatus[] = [
      "SHIPPED",
      "DELIVERED",
      "PICKED_UP",
    ];
    if (terminalStatuses.includes(order.fulfillmentStatus)) {
      return privateJson(
        { error: `Order is already in ${order.fulfillmentStatus} status.` },
        { status: HTTP_STATUS.BAD_REQUEST },
      );
    }

    // Determine which rate objectId to use:
    //   1. Caller supplied one explicitly and it belongs to the order's
    //      unexpired persisted quote set
    //   2. Stored rate is still valid (order under 5 days old)
    //   3. Neither → trigger re-quote
    const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
    const orderAge = Date.now() - order.createdAt.getTime();
    const expectedLabelCurrency = normalizeCurrencyCode(order.currency).toLowerCase();
    const storedRateUsable =
      isPurchasableRateObjectId(order.shippoRateObjectId) &&
      orderAge < FIVE_DAYS_MS;
    let effectiveRateObjectId: string | null = null;

    if (bodyRateObjectId) {
      if (!isPurchasableRateObjectId(bodyRateObjectId)) {
        return privateJson(
          { error: "Invalid shipping rate selected." },
          { status: HTTP_STATUS.BAD_REQUEST },
        );
      }
      if (storedRateUsable && bodyRateObjectId === order.shippoRateObjectId) {
        effectiveRateObjectId = bodyRateObjectId;
      } else {
        const quoteSet = await prisma.orderShippingRateQuote.findFirst({
          where: { orderId: order.id, expiresAt: { gt: new Date() } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { rates: true },
        });
        if (!quoteSet || !rateSetIncludes(quoteSet.rates, bodyRateObjectId, expectedLabelCurrency)) {
          return privateJson(
            {
              error:
                "Shipping rate expired. Re-quote before purchasing a label.",
            },
            { status: HTTP_STATUS.BAD_REQUEST },
          );
        }
        effectiveRateObjectId = bodyRateObjectId;
      }
    } else if (storedRateUsable) {
      effectiveRateObjectId = order.shippoRateObjectId;
    }

    if (!effectiveRateObjectId) {
      if (
        !order.shipToLine1 ||
        !order.shipToCity ||
        !order.shipToState ||
        !order.shipToPostalCode
      ) {
        return privateJson(
          {
            error:
              "Order is missing shipping address fields required for re-quoting.",
          },
          { status: HTTP_STATUS.BAD_REQUEST },
        );
      }
      if (
        !seller.shipFromLine1 ||
        !seller.shipFromCity ||
        !seller.shipFromState ||
        !seller.shipFromPostal
      ) {
        return privateJson(
          {
            error:
              "Seller ship-from address is incomplete. Update it in seller settings.",
          },
          { status: HTTP_STATUS.BAD_REQUEST },
        );
      }

      let totalWeightGrams = 0;
      let lengthCm = 0;
      let widthCm = 0;
      let heightCm = 0;
      for (const it of order.items) {
        const L = it.listing;
        totalWeightGrams +=
          Number(L.packagedWeightGrams ?? seller.defaultPkgWeightGrams ?? 0) *
          it.quantity;
        lengthCm = Math.max(
          lengthCm,
          Number(L.packagedLengthCm ?? seller.defaultPkgLengthCm ?? 0),
        );
        widthCm = Math.max(
          widthCm,
          Number(L.packagedWidthCm ?? seller.defaultPkgWidthCm ?? 0),
        );
        heightCm = Math.max(
          heightCm,
          Number(L.packagedHeightCm ?? seller.defaultPkgHeightCm ?? 0),
        );
      }

      const { rates: rawRates, shipmentId } = await shippoRatesMultiPiece({
        from: {
          name: seller.shipFromName ?? undefined,
          street1: seller.shipFromLine1,
          street2: seller.shipFromLine2 ?? undefined,
          city: seller.shipFromCity,
          state: seller.shipFromState,
          zip: seller.shipFromPostal,
          country: seller.shipFromCountry ?? "US",
        },
        to: {
          name: order.buyerName ?? order.quotedToName ?? undefined,
          street1: order.shipToLine1,
          street2: order.shipToLine2 ?? undefined,
          city: order.shipToCity,
          state: order.shipToState,
          zip: order.shipToPostalCode,
          country: order.shipToCountry ?? "US",
        },
        parcels: [
          {
            weight: { value: totalWeightGrams, unit: "g" },
            length: lengthCm ? String(lengthCm) : undefined,
            width: widthCm ? String(widthCm) : undefined,
            height: heightCm ? String(heightCm) : undefined,
          },
        ],
      });

      type RawRate = {
        provider?: string;
        servicelevel_name?: string;
        est_days?: number | null;
        amount: number;
        currency?: string | null;
        objectId?: string;
      };
      const liveRates: LiveRate[] = (rawRates as RawRate[]).flatMap((r) => {
        const rateCurrency = normalizeShippoRateCurrency(r.currency);
        if (
          rateCurrency !== expectedLabelCurrency ||
          !isPurchasableRateObjectId(r.objectId) ||
          !Number.isSafeInteger(r.amount) ||
          r.amount < 0 ||
          r.amount > MAX_PROVIDER_SHIPPING_CENTS
        ) {
          return [];
        }

        return [{
          label: `${r.provider} ${r.servicelevel_name} (${r.est_days ? `${r.est_days}d` : "—"})`,
          amountCents: r.amount,
          currency: rateCurrency,
          objectId: r.objectId,
          carrier: r.provider,
          service: r.servicelevel_name,
          estDays: r.est_days ?? null,
        }];
      });

      const prioritized = prioritizeAndTrim(liveRates, 4);
      if (prioritized.length === 0) {
        return privateJson(
          {
            error:
              "No current shipping label rates are available for this order.",
          },
          { status: HTTP_STATUS.BAD_GATEWAY },
        );
      }

      await prisma.$transaction([
        prisma.order.update({
          where: { id },
          data: { shippoShipmentId: shipmentId },
        }),
        prisma.orderShippingRateQuote.create({
          data: {
            orderId: id,
            shipmentId,
            rates: prioritized,
            expiresAt: new Date(Date.now() + LABEL_RATE_QUOTE_TTL_MS),
          },
        }),
        prisma.orderShippingRateQuote.deleteMany({
          where: { orderId: id, expiresAt: { lt: new Date() } },
        }),
      ]);

      return privateJson(
        { requiresRateSelection: true, shipmentId, rates: prioritized },
        { status: HTTP_STATUS.ACCEPTED },
      );
    }

    // Atomic double-check to prevent concurrent label purchases. We set the
    // terminal label status before Shippo purchase so retries cannot buy a
    // second label if Shippo succeeds but a later DB write fails.
    const labelLockResult: number = await prisma.$executeRaw`
      UPDATE "Order" SET "labelStatus" = 'PURCHASED'::"LabelStatus"
      WHERE id = ${order.id} AND ("labelStatus" IS NULL OR "labelStatus" != 'PURCHASED'::"LabelStatus")
        AND "fulfillmentStatus" = 'PENDING'::"FulfillmentStatus"
        AND "sellerRefundId" IS NULL
        AND "sellerRefundLockedAt" IS NULL
        AND NOT ("reviewNeeded" = true AND COALESCE("reviewNote", '') LIKE ${DEAUTHORIZED_SELLER_REVIEW_NOTE_SQL_PATTERN})
        AND NOT EXISTS (
          SELECT 1 FROM "Case" c
          WHERE c."orderId" = "Order".id
            AND c."status"::text IN (${Prisma.join([...ACTIVE_CASE_STATUSES])})
        )
        AND NOT EXISTS (
          SELECT 1 FROM "OrderPaymentEvent" ope
          WHERE ope."orderId" = "Order".id
            AND ope."eventType" = 'REFUND'
            AND (
              ope."status" IS NULL
              OR lower(ope."status") NOT IN (${Prisma.join(NON_BLOCKING_REFUND_LEDGER_STATUSES)})
            )
        )
        AND NOT (${latestOpenDisputeLedgerExistsSql(Prisma.sql`"Order".id`)})
    `;
    if (labelLockResult === 0) {
      return privateJson(
        { error: "Label already purchased or order status changed." },
        { status: HTTP_STATUS.BAD_REQUEST },
      );
    }

    const revertLabelLock = async () => {
      await prisma.$executeRaw`
        UPDATE "Order" SET "labelStatus" = NULL
        WHERE id = ${order.id}
      `.catch((error) => {
        Sentry.captureException(error, {
          level: "warning",
          tags: { source: "label_lock_revert_failed" },
          extra: { orderId: order.id },
        });
      });
    };

    let shippoPurchaseSucceeded = false;
    let purchasedLabelDetails: {
      transactionId?: string;
      labelUrl?: string;
      trackingNumber?: string;
      carrier?: string;
      labelCostCents?: number | null;
    } | null = null;
    let labelClawbackReversalAccepted = false;
    let acceptedLabelClawbackReversalId: string | null = null;

    try {
      type ShippoTransaction = {
        status: string;
        messages?: { text: string }[];
        object_id?: string;
        label_url?: string;
        tracking_number?: string;
        rate?: { amount?: number | string | null; currency?: string | null; provider?: string };
      };
      // Purchase the label using the resolved rate objectId
      const txn = await shippoRequest<ShippoTransaction>("/transactions/", {
        method: "POST",
        body: JSON.stringify({
          rate: effectiveRateObjectId,
          label_file_type: "PDF",
          async: false,
        }),
      });

      if (txn.status !== "SUCCESS") {
        // Revert lock — label purchase did not succeed
        await revertLabelLock();
        const messageText = (txn.messages || []).map((m) => m.text).filter(Boolean).join("; ");
        const detail = sanitizeShippoProviderErrorBody(messageText || txn.status);
        return privateJson(
          { error: `Shippo label purchase failed: ${detail || "provider rejected the transaction"}` },
          { status: HTTP_STATUS.BAD_GATEWAY },
        );
      }
      shippoPurchaseSucceeded = true;

      const txnRateCurrency = normalizeShippoRateCurrency(txn.rate?.currency, order.currency);
      const txnRateAmountCents = safeProviderShippingCents(txn.rate?.amount);
      const labelCostCents =
        txnRateAmountCents !== null && txnRateCurrency === expectedLabelCurrency
          ? txnRateAmountCents
          : null;
      const invalidLabelCost = labelCostCents === null;
      const invalidLabelCostNote = invalidLabelCost
        ? appendLabelClawbackReviewNote(
            order.reviewNote,
            `Shippo label ${txn.object_id ?? "unknown"} was purchased, but Shippo returned an invalid or non-${expectedLabelCurrency.toUpperCase()} label cost. Staff must manually reconcile the label-cost deduction before clearing this review hold.`,
          )
        : undefined;
      if (invalidLabelCost) {
        Sentry.captureMessage("Shippo label purchase returned invalid label cost", {
          level: "warning",
          tags: { source: "shippo_label_cost_validation" },
          extra: {
            orderId: id,
            shippoTransactionId: txn.object_id ?? null,
            expectedCurrency: expectedLabelCurrency,
            actualCurrency: txn.rate?.currency ?? null,
            hasAmount: txn.rate?.amount != null,
          },
        });
      }
      purchasedLabelDetails = {
        transactionId: txn.object_id,
        labelUrl: txn.label_url,
        trackingNumber: txn.tracking_number,
        carrier: txn.rate?.provider,
        labelCostCents,
      };
      const now = new Date();

      let updated = await prisma.order.update({
        where: { id },
        data: {
          shippoTransactionId: txn.object_id,
          labelUrl: txn.label_url,
          labelCarrier: txn.rate?.provider ?? null,
          labelTrackingNumber: txn.tracking_number ?? null,
          labelCostCents,
          labelStatus: "PURCHASED",
          reviewNeeded: invalidLabelCost ? true : undefined,
          reviewNote: invalidLabelCostNote,
          labelClawbackStatus: invalidLabelCost ? "MANUAL_REVIEW" : undefined,
          labelClawbackRetryCount: invalidLabelCost ? 0 : undefined,
          labelClawbackLastAttemptAt: invalidLabelCost ? null : undefined,
          labelClawbackNextAttemptAt: invalidLabelCost ? null : undefined,
          labelClawbackResolvedAt: invalidLabelCost ? null : undefined,
          labelClawbackReversalId: invalidLabelCost ? null : undefined,
          labelPurchasedAt: now,
          fulfillmentStatus: "SHIPPED",
          shippedAt: now,
          trackingNumber: txn.tracking_number ?? null,
          trackingCarrier: txn.rate?.provider ?? null,
        },
        select: labelClawbackOrderSelect,
      });

      // Best-effort: claw back label cost by reversing part of the seller's transfer
      if (labelCostCents != null && labelCostCents > 0) {
        if (!order.stripeTransferId) {
          console.warn(
            `Order ${id} has no stripeTransferId — label cost clawback of ${labelCostCents} cents must be handled manually.`,
          );
          Sentry.captureMessage(
            "Stripe label cost clawback needs manual reconciliation",
            {
              level: "warning",
              tags: {
                source: "label_cost_clawback",
                reason: "missing_transfer",
              },
              extra: {
                orderId: id,
                shippoTransactionId: txn.object_id,
                labelCostCents,
              },
            },
          );
          updated = await markLabelClawbackForReview({
            orderId: id,
            existingReviewNote: updated.reviewNote,
            amountCents: labelCostCents,
            currency: order.currency,
            reason: "missing_transfer",
            shippoTransactionId: txn.object_id,
          });
        } else {
          try {
            const reversal = await stripe.transfers.createReversal(
              order.stripeTransferId,
              {
                amount: labelCostCents,
                metadata: { orderId: id, reason: "label_cost_deduction" },
              },
              {
                idempotencyKey: labelClawbackIdempotencyKey({
                  orderId: id,
                  shippoTransactionId: txn.object_id,
                  shippoRateObjectId: effectiveRateObjectId,
                  amountCents: labelCostCents,
                }),
              },
            );
            labelClawbackReversalAccepted = true;
            acceptedLabelClawbackReversalId = reversal.id ?? null;
          } catch (stripeErr) {
            console.warn(
              `Stripe label cost clawback failed for order ${id}:`,
              labelClawbackErrorMessage(stripeErr),
            );
            Sentry.captureException(stripeErr, {
              tags: { source: "label_cost_clawback" },
              extra: {
                orderId: id,
                stripeTransferId: order.stripeTransferId,
                labelCostCents,
              },
            });
            updated = await markLabelClawbackForReview({
              orderId: id,
              existingReviewNote: updated.reviewNote,
              amountCents: labelCostCents,
              currency: order.currency,
              reason: "stripe_reversal_failed",
              shippoTransactionId: txn.object_id,
              stripeTransferId: order.stripeTransferId,
              errorMessage: labelClawbackErrorMessage(stripeErr),
            });
          }
          if (labelClawbackReversalAccepted) {
            try {
              updated = await recordSuccessfulLabelClawback({
                orderId: id,
                reversalId: acceptedLabelClawbackReversalId,
              });
            } catch (recordErr) {
              Sentry.captureException(recordErr, {
                tags: { source: "label_cost_clawback_record_failed" },
                extra: {
                  orderId: id,
                  labelClawbackReversalAccepted,
                  hasReversalId: Boolean(acceptedLabelClawbackReversalId),
                  labelCostCents,
                },
              });
              throw recordErr;
            }
          }
        }
      }

      return privateJson({
        ok: true,
        labelUrl: updated.labelUrl,
        order: labelPurchaseOrderResponse(updated),
      });
    } catch (labelErr) {
      if (!shippoPurchaseSucceeded) {
        Sentry.captureException(labelErr, {
          level: "warning",
          tags: { source: "shippo_label_purchase_ambiguous" },
          extra: { orderId: id, shippoRateObjectId: effectiveRateObjectId },
        });
        await prisma.order
          .updateMany({
            where: { id, labelStatus: "PURCHASED" },
            data: {
              reviewNeeded: true,
              reviewNote:
                "AMBIGUOUS LABEL: Shippo label purchase response was unavailable after Grainline reserved the label slot. Staff must reconcile Shippo before retrying or clearing label status.",
            },
          })
          .catch((updateError) => {
            Sentry.captureException(updateError, {
              tags: { source: "shippo_label_ambiguous_record_failed" },
              extra: { orderId: id, shippoRateObjectId: effectiveRateObjectId },
            });
          });
        return privateJson(
          { error: "Shippo label purchase status is unclear. Staff must reconcile before retrying." },
          { status: HTTP_STATUS.BAD_GATEWAY },
        );
      }

      Sentry.captureException(labelErr, {
        tags: { source: "shippo_label_post_purchase_db_update" },
        extra: {
          orderId: id,
          shippoTransactionId: purchasedLabelDetails?.transactionId ?? null,
          labelCostCents: purchasedLabelDetails?.labelCostCents ?? null,
          carrier: purchasedLabelDetails?.carrier ?? null,
          hasLabelUrl: Boolean(purchasedLabelDetails?.labelUrl),
          hasTrackingNumber: Boolean(purchasedLabelDetails?.trackingNumber),
        },
      });
      const orphanRecordedAt = new Date();
      const orphanedLabelReviewNote = labelClawbackReversalAccepted
        ? `ORPHANED LABEL: Shippo label ${purchasedLabelDetails?.transactionId ?? "unknown"} was purchased and Stripe label-cost reversal ${acceptedLabelClawbackReversalId ?? "unknown"} was accepted, but follow-up DB work failed. Manual reconciliation required.`
        : `ORPHANED LABEL: Shippo label ${purchasedLabelDetails?.transactionId ?? "unknown"} may have been purchased, but follow-up DB work failed. Manual reconciliation required.`;
      const labelClawbackOrphanData =
        typeof purchasedLabelDetails?.labelCostCents === "number" &&
        purchasedLabelDetails.labelCostCents > 0
          ? labelClawbackReversalAccepted
            ? {
                labelClawbackStatus: "REVERSED" as const,
                labelClawbackLastAttemptAt: orphanRecordedAt,
                labelClawbackNextAttemptAt: null,
                labelClawbackResolvedAt: orphanRecordedAt,
                labelClawbackReversalId: acceptedLabelClawbackReversalId,
              }
            : order.stripeTransferId
              ? {
                  labelClawbackStatus: "RETRY_PENDING" as const,
                  labelClawbackRetryCount: 0,
                  labelClawbackLastAttemptAt: null,
                  labelClawbackNextAttemptAt: orphanRecordedAt,
                  labelClawbackResolvedAt: null,
                  labelClawbackReversalId: null,
                }
              : {
                  labelClawbackStatus: "MANUAL_REVIEW" as const,
                  labelClawbackRetryCount: 0,
                  labelClawbackLastAttemptAt: null,
                  labelClawbackNextAttemptAt: null,
                  labelClawbackResolvedAt: null,
                  labelClawbackReversalId: null,
                }
          : {};
      await prisma.order
        .updateMany({
          where: { id, labelStatus: "PURCHASED" },
          data: {
            reviewNeeded: true,
            reviewNote: orphanedLabelReviewNote,
            labelStatus: "PURCHASED",
            labelPurchasedAt: orphanRecordedAt,
            fulfillmentStatus: "SHIPPED",
            shippedAt: orphanRecordedAt,
            ...(purchasedLabelDetails?.transactionId
              ? { shippoTransactionId: purchasedLabelDetails.transactionId }
              : {}),
            ...(purchasedLabelDetails?.labelUrl
              ? { labelUrl: purchasedLabelDetails.labelUrl }
              : {}),
            ...(purchasedLabelDetails?.trackingNumber
              ? {
                  labelTrackingNumber: purchasedLabelDetails.trackingNumber,
                  trackingNumber: purchasedLabelDetails.trackingNumber,
                }
              : {}),
            ...(purchasedLabelDetails?.carrier
              ? {
                  labelCarrier: purchasedLabelDetails.carrier,
                  trackingCarrier: purchasedLabelDetails.carrier,
                }
              : {}),
            ...(typeof purchasedLabelDetails?.labelCostCents === "number"
              ? { labelCostCents: purchasedLabelDetails.labelCostCents }
              : {}),
            ...labelClawbackOrphanData,
          },
        })
        .catch((updateError) => {
          Sentry.captureException(updateError, {
            tags: { source: "shippo_label_orphan_record_failed" },
            extra: {
              orderId: id,
              shippoTransactionId:
                purchasedLabelDetails?.transactionId ?? null,
              labelCostCents: purchasedLabelDetails?.labelCostCents ?? null,
              carrier: purchasedLabelDetails?.carrier ?? null,
              hasLabelUrl: Boolean(purchasedLabelDetails?.labelUrl),
              hasTrackingNumber: Boolean(
                purchasedLabelDetails?.trackingNumber,
              ),
            },
          });
        });
      throw labelErr;
    }
  } catch (err) {
    logServerError(err, { source: "label_purchase_route" });
    return privateJson({ error: "Server error" }, { status: HTTP_STATUS.INTERNAL_SERVER_ERROR });
  }
}
