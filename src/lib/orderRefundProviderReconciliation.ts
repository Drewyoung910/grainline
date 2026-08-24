import { createHash } from "node:crypto";
import type Stripe from "stripe";
import {
  createMarketplaceRefund,
  type OrderRefundClaimProviderMetadata,
} from "./marketplaceRefunds.ts";
import type { OrderRefundClaim } from "./orderRefundClaimAuthority.ts";

const SAFE_IDEMPOTENCY_RETRY_MS = 23 * 60 * 60 * 1000;
const MAX_REFUND_SCAN_PAGES = 20;

type RefundListPage = {
  data: Stripe.Refund[];
  has_more: boolean;
};

type RefundProviderClient = {
  list(params: Stripe.RefundListParams): Promise<RefundListPage>;
  retrieve(
    id: string,
    params: Stripe.RefundRetrieveParams,
  ): Promise<Stripe.Refund>;
};

export type OrderRefundProviderDisposition =
  | "ABSENT"
  | "USABLE_REFUND"
  | "TERMINAL_NO_EFFECT";

export type OrderRefundProviderInspection = {
  disposition: OrderRefundProviderDisposition;
  inspectedAtSeconds: number;
  providerEvidenceSha256: string;
  providerResult: {
    primaryRefundId: string;
    refundIds: string[];
    refundStatuses: Array<string | null>;
    accountingEvidence: {
      transferReversalId: string | null;
      transferReversalAmountCents: number | null;
    };
  } | null;
};

function claimMetadata(claim: OrderRefundClaim) {
  return {
    claimId: claim.claimId,
    claimGeneration: claim.claimGeneration,
    source: claim.source,
  } satisfies OrderRefundClaimProviderMetadata;
}

function metadataMatchesClaim(
  metadata: Stripe.Metadata | null,
  claim: OrderRefundClaim,
) {
  return Boolean(
    metadata
      && metadata.grainline_refund_claim_id === claim.claimId
      && metadata.grainline_refund_claim_generation
        === claim.claimGeneration.toString()
      && metadata.grainline_refund_claim_source === claim.source
      && metadata.grainline_refund_idempotency_scope
        === claim.idempotencyScope,
  );
}

function providerEvidenceSha256(input: {
  claim: OrderRefundClaim;
  inspectedAtSeconds: number;
  scannedPageCount: number;
  scannedObjectCount: number;
  scannedRefunds: Stripe.Refund[];
  retrievedMatch: Stripe.Refund | null;
}) {
  const canonicalRefund = (refund: Stripe.Refund) => ({
    id: refund.id,
    created: refund.created,
    amount: refund.amount,
    currency: refund.currency,
    paymentIntent: refundPaymentIntentId(refund),
    status: refund.status ?? null,
    metadata: {
      claimId: refund.metadata?.grainline_refund_claim_id ?? null,
      claimGeneration:
        refund.metadata?.grainline_refund_claim_generation ?? null,
      claimSource: refund.metadata?.grainline_refund_claim_source ?? null,
      idempotencyScope:
        refund.metadata?.grainline_refund_idempotency_scope ?? null,
      component: refund.metadata?.grainline_refund_component ?? null,
    },
    transferReversal: typeof refund.transfer_reversal === "string"
      ? { id: refund.transfer_reversal, amount: null }
      : {
          id: refund.transfer_reversal?.id ?? null,
          amount: refund.transfer_reversal?.amount ?? null,
        },
    sourceTransferReversal: typeof refund.source_transfer_reversal === "string"
      ? { id: refund.source_transfer_reversal, amount: null }
      : {
          id: refund.source_transfer_reversal?.id ?? null,
          amount: refund.source_transfer_reversal?.amount ?? null,
        },
  });
  const canonical = {
    claimId: input.claim.claimId,
    claimGeneration: input.claim.claimGeneration.toString(),
    idempotencyScope: input.claim.idempotencyScope,
    inspectedAtSeconds: input.inspectedAtSeconds,
    scanComplete: true,
    scannedPageCount: input.scannedPageCount,
    scannedObjectCount: input.scannedObjectCount,
    scannedRefunds: input.scannedRefunds
      .map(canonicalRefund)
      .sort((a, b) => a.id.localeCompare(b.id)),
    retrievedMatch: input.retrievedMatch
      ? canonicalRefund(input.retrievedMatch)
      : null,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function refundPaymentIntentId(refund: Stripe.Refund) {
  return typeof refund.payment_intent === "string"
    ? refund.payment_intent
    : refund.payment_intent?.id ?? null;
}

function validateMatchedRefund(
  refund: Stripe.Refund,
  claim: OrderRefundClaim,
  providerAuthorizedAtSeconds: number,
) {
  if (
    refundPaymentIntentId(refund) !== claim.paymentIntentId
    || refund.amount !== claim.refundAmountCents
    || refund.currency.toLowerCase() !== claim.currency
    || !metadataMatchesClaim(refund.metadata, claim)
    || !["full", "platform", "tax-only"].includes(
      refund.metadata?.grainline_refund_component ?? "",
    )
    || refund.created < providerAuthorizedAtSeconds - 5 * 60
  ) {
    throw new Error("Stripe refund claim evidence drifted from PostgreSQL authority");
  }
}

function providerResult(refund: Stripe.Refund) {
  const reversal = refund.transfer_reversal;
  return {
    primaryRefundId: refund.id,
    refundIds: [refund.id],
    refundStatuses: [refund.status ?? null],
    accountingEvidence: {
      transferReversalId:
        typeof reversal === "string" ? reversal : reversal?.id ?? null,
      transferReversalAmountCents:
        typeof reversal === "object" && reversal ? reversal.amount : null,
    },
  };
}

export async function inspectOrderRefundProviderEffect(
  claim: OrderRefundClaim,
  options: {
    client?: RefundProviderClient;
    now?: Date;
    providerAuthorizedAtSeconds: number;
  },
): Promise<OrderRefundProviderInspection> {
  if (
    !Number.isSafeInteger(options.providerAuthorizedAtSeconds)
    || options.providerAuthorizedAtSeconds < 1
  ) {
    throw new TypeError("Order refund provider inspection requires the database provider clock");
  }
  const client = options.client ?? (await import("@/lib/stripe")).stripe.refunds;
  const inspectedAtSeconds = Math.floor(
    (options.now ?? new Date()).getTime() / 1000,
  );
  const matches: Stripe.Refund[] = [];
  const plausibleUntagged: Stripe.Refund[] = [];
  const scannedRefunds: Stripe.Refund[] = [];
  let startingAfter: string | undefined;
  let scannedPageCount = 0;
  let scannedObjectCount = 0;

  for (let pageNumber = 0; pageNumber < MAX_REFUND_SCAN_PAGES; pageNumber += 1) {
    const page = await client.list({
      payment_intent: claim.paymentIntentId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    scannedPageCount += 1;
    scannedObjectCount += page.data.length;
    scannedRefunds.push(...page.data);
    for (const refund of page.data) {
      if (metadataMatchesClaim(refund.metadata, claim)) {
        matches.push(refund);
      } else if (
        refundPaymentIntentId(refund) === claim.paymentIntentId
        && refund.amount === claim.refundAmountCents
        && refund.currency.toLowerCase() === claim.currency
        && refund.created >= options.providerAuthorizedAtSeconds - 5 * 60
      ) {
        plausibleUntagged.push(refund);
      }
    }
    if (!page.has_more) break;
    const last = page.data.at(-1);
    if (!last || pageNumber === MAX_REFUND_SCAN_PAGES - 1) {
      throw new Error("Stripe refund claim inspection exceeded its bounded scan");
    }
    startingAfter = last.id;
  }

  if (matches.length > 1) {
    throw new Error("Stripe returned multiple refunds for one Grainline claim");
  }
  if (plausibleUntagged.length > 0) {
    throw new Error(
      "Stripe returned a plausible untagged refund in the claim window; manual reconciliation is required",
    );
  }
  if (matches.length === 0) {
    const digest = providerEvidenceSha256({
      claim,
      inspectedAtSeconds,
      scannedPageCount,
      scannedObjectCount,
      scannedRefunds,
      retrievedMatch: null,
    });
    return {
      disposition: "ABSENT",
      inspectedAtSeconds,
      providerEvidenceSha256: digest,
      providerResult: null,
    };
  }

  const retrieved = await client.retrieve(matches[0]!.id, {
    expand: ["transfer_reversal"],
  });
  validateMatchedRefund(
    retrieved,
    claim,
    options.providerAuthorizedAtSeconds,
  );
  const digest = providerEvidenceSha256({
    claim,
    inspectedAtSeconds,
    scannedPageCount,
    scannedObjectCount,
    scannedRefunds,
    retrievedMatch: retrieved,
  });
  if (retrieved.status === "failed" || retrieved.status === "canceled") {
    if (retrieved.transfer_reversal || retrieved.source_transfer_reversal) {
      throw new Error(
        "Stripe terminal refund retains transfer-reversal evidence; manual accounting reconciliation is required",
      );
    }
    return {
      disposition: "TERMINAL_NO_EFFECT",
      inspectedAtSeconds,
      providerEvidenceSha256: digest,
      providerResult: null,
    };
  }
  if (
    retrieved.status !== null
    && !["pending", "requires_action", "succeeded"].includes(
      retrieved.status,
    )
  ) {
    throw new Error("Stripe refund claim has an unsupported provider status");
  }
  return {
    disposition: "USABLE_REFUND",
    inspectedAtSeconds,
    providerEvidenceSha256: digest,
    providerResult: providerResult(retrieved),
  };
}

async function activeClaimProviderAuthorizedAt(claim: OrderRefundClaim) {
  const { prisma } = await import("@/lib/db");
  const order = await prisma.order.findFirst({
    where: {
      refundClaimId: claim.claimId,
      refundClaimGeneration: claim.claimGeneration,
      refundClaimSource: claim.source,
      refundClaimSourceId: claim.sourceId,
      refundClaimSourceGeneration: claim.sourceGeneration,
      refundClaimIdempotencyScope: claim.idempotencyScope,
      refundClaimProviderAuthorizedAt: { not: null },
    },
    select: { refundClaimProviderAuthorizedAt: true },
  });
  if (!order?.refundClaimProviderAuthorizedAt) {
    throw new Error("Order refund claim provider clock is no longer active");
  }
  return order.refundClaimProviderAuthorizedAt;
}

export async function resolveOrderRefundProviderOutcome(
  claim: OrderRefundClaim,
) {
  if (claim.action === "replay") {
    const authorizedAt = await activeClaimProviderAuthorizedAt(claim);
    const inspection = await inspectOrderRefundProviderEffect(claim, {
      providerAuthorizedAtSeconds: Math.floor(authorizedAt.getTime() / 1000),
    });
    if (inspection.disposition === "USABLE_REFUND") {
      return inspection.providerResult!;
    }
    if (inspection.disposition === "TERMINAL_NO_EFFECT") {
      throw new Error(
        "Stripe refund claim ended without a usable refund; staff reconciliation is required",
      );
    }
    if (Date.now() - authorizedAt.getTime() >= SAFE_IDEMPOTENCY_RETRY_MS) {
      throw new Error(
        "Stripe refund claim exceeded the safe idempotency retry window; staff reconciliation is required",
      );
    }
  }

  return createMarketplaceRefund({
    paymentIntentId: claim.paymentIntentId,
    resolution: "FULL",
    amountCents: claim.refundAmountCents,
    itemsSubtotalCents: claim.itemsSubtotalCents,
    shippingAmountCents: claim.shippingAmountCents,
    giftWrappingPriceCents: claim.giftWrappingPriceCents,
    taxAmountCents: claim.taxAmountCents,
    canReverseTransfer: claim.canReverseTransfer,
    idempotencyKeyBase: claim.idempotencyScope,
    claimMetadata: claimMetadata(claim),
  });
}
