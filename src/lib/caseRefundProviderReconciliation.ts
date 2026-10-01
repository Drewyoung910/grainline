import { createHash } from "node:crypto";
import type Stripe from "stripe";
import type {
  PreparedCaseStaffResolution,
} from "./caseStaffResolutionAuthority.ts";
import { createMarketplaceRefund } from "./marketplaceRefunds.ts";

const SAFE_IDEMPOTENCY_RETRY_MS = 23 * 60 * 60 * 1000;
const MAX_REFUND_SCAN_PAGES = 20;

export class CaseRefundProviderReconciliationRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaseRefundProviderReconciliationRequiredError";
  }
}

export function isCaseRefundProviderReconciliationRequiredError(
  error: unknown,
): error is CaseRefundProviderReconciliationRequiredError {
  return error instanceof CaseRefundProviderReconciliationRequiredError;
}

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

export type CaseRefundProviderDisposition =
  | "ABSENT"
  | "USABLE_REFUND"
  | "TERMINAL_NO_EFFECT";

export type CaseRefundProviderResult = {
  primaryRefundId: string;
  refundIds: string[];
  refundStatuses: Array<string | null>;
  accountingEvidence: {
    transferReversalId: string | null;
    transferReversalAmountCents: number | null;
  };
  requiresManualTransferReconciliation: boolean;
  requiresManualFollowUp: boolean;
};

export type CaseRefundProviderInspection = {
  disposition: CaseRefundProviderDisposition;
  inspectedAtSeconds: number;
  providerEvidenceSha256: string;
  providerResult: CaseRefundProviderResult | null;
};

function requireRefundPrepared(
  prepared: PreparedCaseStaffResolution,
): asserts prepared is PreparedCaseStaffResolution & {
  resolution: "REFUND_FULL" | "REFUND_PARTIAL";
  refundAmountCents: number;
  idempotencyScope: string;
  paymentIntentId: string;
} {
  if (
    (prepared.resolution !== "REFUND_FULL"
      && prepared.resolution !== "REFUND_PARTIAL")
    || prepared.refundAmountCents === null
    || prepared.idempotencyScope === null
    || prepared.paymentIntentId === null
  ) {
    throw new TypeError("Case refund provider claim is incomplete");
  }
}

function metadataMatchesClaim(
  metadata: Stripe.Metadata | null,
  prepared: PreparedCaseStaffResolution,
) {
  return Boolean(
    metadata
      && metadata.grainline_refund_claim_id === prepared.claimId
      && metadata.grainline_refund_claim_generation === "1"
      && metadata.grainline_refund_claim_source === "CASE"
      && metadata.grainline_refund_idempotency_scope
        === prepared.idempotencyScope,
  );
}

function refundPaymentIntentId(refund: Stripe.Refund) {
  return typeof refund.payment_intent === "string"
    ? refund.payment_intent
    : refund.payment_intent?.id ?? null;
}

function canonicalRefund(refund: Stripe.Refund) {
  return {
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
  };
}

function providerEvidenceSha256(input: {
  prepared: PreparedCaseStaffResolution;
  inspectedAtSeconds: number;
  scannedPageCount: number;
  scannedObjectCount: number;
  scannedRefunds: Stripe.Refund[];
  retrievedMatch: Stripe.Refund | null;
}) {
  const canonical = {
    claimId: input.prepared.claimId,
    caseId: input.prepared.caseId,
    orderId: input.prepared.orderId,
    idempotencyScope: input.prepared.idempotencyScope,
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

function validateMatchedRefund(
  refund: Stripe.Refund,
  prepared: PreparedCaseStaffResolution & {
    refundAmountCents: number;
    paymentIntentId: string;
  },
  providerAuthorizedAtSeconds: number,
) {
  if (
    refundPaymentIntentId(refund) !== prepared.paymentIntentId
    || refund.amount !== prepared.refundAmountCents
    || refund.currency.toLowerCase() !== prepared.currency
    || !metadataMatchesClaim(refund.metadata, prepared)
    || !["full", "platform", "tax-only", "seller"].includes(
      refund.metadata?.grainline_refund_component ?? "",
    )
    || refund.created < providerAuthorizedAtSeconds - 5 * 60
  ) {
    throw new CaseRefundProviderReconciliationRequiredError(
      "Stripe Case-refund evidence drifted from PostgreSQL authority",
    );
  }
}

function providerResult(refund: Stripe.Refund): CaseRefundProviderResult {
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
    requiresManualTransferReconciliation:
      refund.metadata?.grainline_refund_component === "platform",
    requiresManualFollowUp:
      refund.status === "pending" || refund.status === "requires_action",
  };
}

export async function inspectCaseRefundProviderEffect(
  prepared: PreparedCaseStaffResolution,
  options: {
    client?: RefundProviderClient;
    now?: Date;
    providerAuthorizedAtSeconds: number;
  },
): Promise<CaseRefundProviderInspection> {
  requireRefundPrepared(prepared);
  if (
    !Number.isSafeInteger(options.providerAuthorizedAtSeconds)
    || options.providerAuthorizedAtSeconds < 1
  ) {
    throw new TypeError(
      "Case refund provider inspection requires the database provider clock",
    );
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
      payment_intent: prepared.paymentIntentId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    scannedPageCount += 1;
    scannedObjectCount += page.data.length;
    scannedRefunds.push(...page.data);
    for (const refund of page.data) {
      if (metadataMatchesClaim(refund.metadata, prepared)) {
        matches.push(refund);
      } else if (
        refundPaymentIntentId(refund) === prepared.paymentIntentId
        && refund.amount === prepared.refundAmountCents
        && refund.currency.toLowerCase() === prepared.currency
        && refund.created >= options.providerAuthorizedAtSeconds - 5 * 60
      ) {
        plausibleUntagged.push(refund);
      }
    }
    if (!page.has_more) break;
    const last = page.data.at(-1);
    if (!last || pageNumber === MAX_REFUND_SCAN_PAGES - 1) {
      throw new CaseRefundProviderReconciliationRequiredError(
        "Stripe Case-refund inspection exceeded its bounded scan",
      );
    }
    startingAfter = last.id;
  }

  if (matches.length > 1) {
    throw new CaseRefundProviderReconciliationRequiredError(
      "Stripe returned multiple refunds for one Case claim",
    );
  }
  if (plausibleUntagged.length > 0) {
    throw new CaseRefundProviderReconciliationRequiredError(
      "Stripe returned a plausible untagged Case refund; manual reconciliation is required",
    );
  }

  if (matches.length === 0) {
    return {
      disposition: "ABSENT",
      inspectedAtSeconds,
      providerEvidenceSha256: providerEvidenceSha256({
        prepared,
        inspectedAtSeconds,
        scannedPageCount,
        scannedObjectCount,
        scannedRefunds,
        retrievedMatch: null,
      }),
      providerResult: null,
    };
  }

  const retrieved = await client.retrieve(matches[0]!.id, {
    expand: ["transfer_reversal"],
  });
  validateMatchedRefund(
    retrieved,
    prepared,
    options.providerAuthorizedAtSeconds,
  );
  const digest = providerEvidenceSha256({
    prepared,
    inspectedAtSeconds,
    scannedPageCount,
    scannedObjectCount,
    scannedRefunds,
    retrievedMatch: retrieved,
  });
  if (retrieved.status === "failed" || retrieved.status === "canceled") {
    if (retrieved.transfer_reversal || retrieved.source_transfer_reversal) {
      throw new CaseRefundProviderReconciliationRequiredError(
        "Stripe terminal Case refund retains transfer-reversal evidence",
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
    && !["pending", "requires_action", "succeeded"].includes(retrieved.status)
  ) {
    throw new CaseRefundProviderReconciliationRequiredError(
      "Stripe Case refund has an unsupported provider status",
    );
  }
  return {
    disposition: "USABLE_REFUND",
    inspectedAtSeconds,
    providerEvidenceSha256: digest,
    providerResult: providerResult(retrieved),
  };
}

async function activeCaseProviderAuthorizedAt(
  actorUserId: string,
  prepared: PreparedCaseStaffResolution,
) {
  const { prisma } = await import("@/lib/db");
  const rows = await prisma.$queryRaw<Array<{
    provider_authorized_at: Date;
  }>>`
    SELECT provider_authorized_at
      FROM public.grainline_case_staff_resolution_provider_clock(
        ${actorUserId},
        ${prepared.claimId},
        ${prepared.caseId},
        ${prepared.orderId},
        ${prepared.idempotencyScope}
      )
  `;
  if (
    rows.length !== 1
    || !(rows[0]?.provider_authorized_at instanceof Date)
    || Number.isNaN(rows[0].provider_authorized_at.getTime())
  ) {
    throw new Error("Case refund claim provider clock is no longer active");
  }
  return rows[0].provider_authorized_at;
}

async function recoverProviderClaim(
  actorUserId: string,
  prepared: PreparedCaseStaffResolution,
  recovery: {
    action: "RETRY_EXISTING_SCOPE" | "RECORD_DISCOVERED_EFFECT";
    inspectedAtSeconds: number;
    providerEvidenceSha256: string;
  },
) {
  const { recoverCaseStaffResolutionProvider } = await import(
    "./caseStaffResolutionAuthority.ts"
  );
  return recoverCaseStaffResolutionProvider(
    actorUserId,
    prepared,
    recovery,
  );
}

export async function resolveCaseRefundProviderOutcome(
  actorUserId: string,
  preparedInput: PreparedCaseStaffResolution,
) {
  requireRefundPrepared(preparedInput);
  let prepared: PreparedCaseStaffResolution = preparedInput;

  if (
    prepared.action === "replay"
    || prepared.action === "recovery_required"
    || prepared.action === "recovered"
  ) {
    const authorizedAt = await activeCaseProviderAuthorizedAt(
      actorUserId,
      prepared,
    );
    const inspection = await inspectCaseRefundProviderEffect(prepared, {
      providerAuthorizedAtSeconds: Math.floor(authorizedAt.getTime() / 1000),
    });

    if (inspection.disposition === "TERMINAL_NO_EFFECT") {
      throw new CaseRefundProviderReconciliationRequiredError(
        "Stripe Case refund ended without a usable refund",
      );
    }

    if (inspection.disposition === "USABLE_REFUND") {
      if (
        prepared.status === "RECONCILIATION_REQUIRED"
        || prepared.action === "recovery_required"
      ) {
        prepared = await recoverProviderClaim(
          actorUserId,
          prepared,
          {
            action: "RECORD_DISCOVERED_EFFECT",
            inspectedAtSeconds: inspection.inspectedAtSeconds,
            providerEvidenceSha256: inspection.providerEvidenceSha256,
          },
        );
        requireRefundPrepared(prepared);
      }
      return { prepared, providerResult: inspection.providerResult! };
    }

    if (
      prepared.action === "recovered"
      && prepared.providerRecoveryAction === "RECORD_DISCOVERED_EFFECT"
    ) {
      throw new CaseRefundProviderReconciliationRequiredError(
        "Previously discovered Case refund evidence is no longer visible",
      );
    }

    if (Date.now() - authorizedAt.getTime() >= SAFE_IDEMPOTENCY_RETRY_MS) {
      throw new CaseRefundProviderReconciliationRequiredError(
        "Case refund claim exceeded the safe idempotency retry window",
      );
    }
    if (
      prepared.status === "RECONCILIATION_REQUIRED"
      || prepared.action === "recovery_required"
    ) {
      prepared = await recoverProviderClaim(
        actorUserId,
        prepared,
        {
          action: "RETRY_EXISTING_SCOPE",
          inspectedAtSeconds: inspection.inspectedAtSeconds,
          providerEvidenceSha256: inspection.providerEvidenceSha256,
        },
      );
      requireRefundPrepared(prepared);
    }
  }

  requireRefundPrepared(prepared);
  const providerResult = await createMarketplaceRefund({
    paymentIntentId: prepared.paymentIntentId,
    resolution: prepared.resolution,
    amountCents: prepared.refundAmountCents,
    itemsSubtotalCents: prepared.itemsSubtotalCents,
    shippingAmountCents: prepared.shippingAmountCents,
    giftWrappingPriceCents: prepared.giftWrappingPriceCents,
    taxAmountCents: prepared.taxAmountCents,
    canReverseTransfer: prepared.canReverseTransfer,
    idempotencyKeyBase: prepared.idempotencyScope,
    claimMetadata: { claimId: prepared.claimId, source: "CASE" },
    reason: "requested_by_customer",
  });
  return { prepared, providerResult };
}
