import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type CaseStaffResolutionClient = Pick<typeof prisma, "$queryRaw">;

export type CaseStaffResolution =
  | "DISMISSED"
  | "REFUND_FULL"
  | "REFUND_PARTIAL";

export type CaseStockRestore = {
  listingId: string;
  quantity: number;
};

export type PreparedCaseStaffResolution = {
  claimId: string;
  caseId: string;
  orderId: string;
  buyerUserId: string | null;
  sellerUserId: string;
  resolution: CaseStaffResolution;
  refundAmountCents: number | null;
  currency: string;
  stockRestorePlan: CaseStockRestore[];
  status:
    | "LOCAL_READY"
    | "PROVIDER_PENDING"
    | "PROVIDER_RECORDED"
    | "RECONCILIATION_REQUIRED";
  idempotencyScope: string | null;
  paymentIntentId: string | null;
  itemsSubtotalCents: number;
  shippingAmountCents: number;
  giftWrappingPriceCents: number | null;
  taxAmountCents: number;
  canReverseTransfer: boolean;
  action: "prepared" | "replay";
};

export type RecordedCaseStaffResolutionProvider = {
  claimId: string;
  caseId: string;
  orderId: string;
  paymentEventId: string;
  status: "PROVIDER_RECORDED";
  action: "recorded" | "replay";
};

export type AmbiguousCaseStaffResolutionProvider = {
  claimId: string;
  caseId: string;
  orderId: string;
  paymentEventId: null;
  status: "RECONCILIATION_REQUIRED";
  action: "ambiguous" | "ambiguous_replay";
};

export type FinalizedCaseStaffResolution = {
  claimId: string;
  caseId: string;
  orderId: string;
  buyerUserId: string | null;
  sellerUserId: string;
  resolution: CaseStaffResolution;
  refundAmountCents: number | null;
  currency: string;
  resolutionMessageId: string;
  stockStatusRestoredCount: number;
  status: "FINALIZED";
  action: "finalized" | "replay";
};

type ProviderEvidence = {
  primaryRefundId: string;
  refundIds: string[];
  refundStatuses: Array<string | null>;
  transferReversalId: string | null;
  transferReversalAmountCents: number | null;
  requiresManualTransferReconciliation: boolean;
  requiresManualFollowUp: boolean;
};

function validateProviderEvidence(
  evidence: ProviderEvidence,
): ProviderEvidence {
  const primaryRefundId = requireBoundedString(
    evidence.primaryRefundId,
    "Case staff-resolution primary refund",
    255,
  );
  if (
    !Array.isArray(evidence.refundIds)
    || evidence.refundIds.length < 1
    || evidence.refundIds.length > 5
    || evidence.refundStatuses.length !== evidence.refundIds.length
  ) {
    throw new TypeError("Case staff-resolution refund evidence is invalid");
  }

  const refundIds = evidence.refundIds.map((value) =>
    requireBoundedString(
      value,
      "Case staff-resolution refund id",
      255,
    ));
  if (
    new Set(refundIds).size !== refundIds.length
    || !refundIds.includes(primaryRefundId)
  ) {
    throw new TypeError("Case staff-resolution refund identity is invalid");
  }
  const refundStatuses = evidence.refundStatuses.map((value) =>
    requireNullableBoundedString(
      value,
      "Case staff-resolution refund status",
      64,
    ));
  const transferReversalId = requireNullableBoundedString(
    evidence.transferReversalId,
    "Case staff-resolution transfer reversal",
    255,
  );
  const transferReversalAmountCents = requireNullableInteger(
    evidence.transferReversalAmountCents,
    "Case staff-resolution transfer reversal amount",
    { min: 0 },
  );
  if (
    transferReversalId === null
    && transferReversalAmountCents !== null
  ) {
    throw new TypeError(
      "Case staff-resolution transfer reversal evidence is incomplete",
    );
  }

  return {
    primaryRefundId,
    refundIds,
    refundStatuses,
    transferReversalId,
    transferReversalAmountCents,
    requiresManualTransferReconciliation: requireBoolean(
      evidence.requiresManualTransferReconciliation,
      "Case staff-resolution transfer reconciliation posture",
    ),
    requiresManualFollowUp: requireBoolean(
      evidence.requiresManualFollowUp,
      "Case staff-resolution provider follow-up posture",
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string) {
  if (!isRecord(value)) {
    throw new TypeError(`${label} returned a non-object result`);
  }
  return value;
}

function requireBoundedString(value: unknown, label: string, max = 191) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > max
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function requireNullableBoundedString(
  value: unknown,
  label: string,
  max = 191,
) {
  return value === null ? null : requireBoundedString(value, label, max);
}

function requireInteger(
  value: unknown,
  label: string,
  { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {},
) {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < min
    || value > max
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function requireNullableInteger(
  value: unknown,
  label: string,
  bounds?: { min?: number; max?: number },
) {
  return value === null ? null : requireInteger(value, label, bounds);
}

function requireBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function requireOneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] {
  if (
    typeof value !== "string"
    || !(allowed as readonly string[]).includes(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as T[number];
}

function validateStockRestorePlan(value: unknown): CaseStockRestore[] {
  if (!Array.isArray(value) || value.length > 50) {
    throw new TypeError("Case staff-resolution stock plan is invalid");
  }
  const seen = new Set<string>();
  return value.map((entry) => {
    const row = requireRecord(entry, "Case staff-resolution stock plan");
    const listingId = requireBoundedString(
      row.listingId,
      "Case staff-resolution stock listing",
    );
    const quantity = requireInteger(
      row.quantity,
      "Case staff-resolution stock quantity",
      { min: 1 },
    );
    if (seen.has(listingId)) {
      throw new TypeError("Case staff-resolution stock plan is duplicated");
    }
    seen.add(listingId);
    return { listingId, quantity };
  });
}

function validatePreparedResult(
  value: unknown,
  expected: {
    caseId: string;
    resolution: CaseStaffResolution;
  },
): PreparedCaseStaffResolution {
  const row = requireRecord(value, "Case staff-resolution prepare");
  const claimId = requireBoundedString(
    row.claimId,
    "Case staff-resolution claim id",
  );
  const caseId = requireBoundedString(row.caseId, "Case staff-resolution Case");
  const orderId = requireBoundedString(
    row.orderId,
    "Case staff-resolution Order",
  );
  const resolution = requireOneOf(
    row.resolution,
    ["DISMISSED", "REFUND_FULL", "REFUND_PARTIAL"] as const,
    "Case staff-resolution resolution",
  );
  const refundAmountCents = requireNullableInteger(
    row.refundAmountCents,
    "Case staff-resolution refund amount",
    { min: 1 },
  );
  const status = requireOneOf(
    row.status,
    [
      "LOCAL_READY",
      "PROVIDER_PENDING",
      "PROVIDER_RECORDED",
      "RECONCILIATION_REQUIRED",
    ] as const,
    "Case staff-resolution prepare status",
  );
  const idempotencyScope = requireNullableBoundedString(
    row.idempotencyScope,
    "Case staff-resolution idempotency scope",
    500,
  );
  const paymentIntentId = requireNullableBoundedString(
    row.paymentIntentId,
    "Case staff-resolution payment intent",
    220,
  );
  const currency = requireBoundedString(
    row.currency,
    "Case staff-resolution currency",
    20,
  );
  const stockRestorePlan = validateStockRestorePlan(row.stockRestorePlan);

  if (caseId !== expected.caseId || resolution !== expected.resolution) {
    throw new TypeError("Case staff-resolution prepare identity drifted");
  }
  if (resolution === "DISMISSED") {
    if (
      refundAmountCents !== null
      || idempotencyScope !== null
      || status !== "LOCAL_READY"
      || stockRestorePlan.length !== 0
    ) {
      throw new TypeError("Dismissal preparation shape is invalid");
    }
  } else {
    if (
      refundAmountCents === null
      || paymentIntentId === null
      || idempotencyScope
        !== `case-resolve:${claimId}:${resolution}:${refundAmountCents}`
      || status === "LOCAL_READY"
    ) {
      throw new TypeError("Refund preparation shape is invalid");
    }
  }

  return {
    claimId,
    caseId,
    orderId,
    buyerUserId: requireNullableBoundedString(
      row.buyerUserId,
      "Case staff-resolution buyer",
    ),
    sellerUserId: requireBoundedString(
      row.sellerUserId,
      "Case staff-resolution seller",
    ),
    resolution,
    refundAmountCents,
    currency,
    stockRestorePlan,
    status,
    idempotencyScope,
    paymentIntentId,
    itemsSubtotalCents: requireInteger(
      row.itemsSubtotalCents,
      "Case staff-resolution item subtotal",
      { min: 0 },
    ),
    shippingAmountCents: requireInteger(
      row.shippingAmountCents,
      "Case staff-resolution shipping amount",
      { min: 0 },
    ),
    giftWrappingPriceCents: requireNullableInteger(
      row.giftWrappingPriceCents,
      "Case staff-resolution gift wrap amount",
      { min: 0 },
    ),
    taxAmountCents: requireInteger(
      row.taxAmountCents,
      "Case staff-resolution tax amount",
      { min: 0 },
    ),
    canReverseTransfer: requireBoolean(
      row.canReverseTransfer,
      "Case staff-resolution transfer posture",
    ),
    action: requireOneOf(
      row.action,
      ["prepared", "replay"] as const,
      "Case staff-resolution prepare action",
    ),
  };
}

function validateProviderResult(
  value: unknown,
  prepared: PreparedCaseStaffResolution,
  outcome: "RECORDED" | "AMBIGUOUS",
) {
  const row = requireRecord(value, "Case staff-resolution provider record");
  const returnedClaimId = requireBoundedString(
    row.claimId,
    "Case staff-resolution provider claim",
  );
  if (returnedClaimId !== prepared.claimId) {
    throw new TypeError("Case staff-resolution provider claim drifted");
  }
  const caseId = requireBoundedString(
    row.caseId,
    "Case staff-resolution provider Case",
  );
  const orderId = requireBoundedString(
    row.orderId,
    "Case staff-resolution provider Order",
  );
  if (
    caseId !== prepared.caseId
    || orderId !== prepared.orderId
  ) {
    throw new TypeError("Case staff-resolution provider identity drifted");
  }
  const base = {
    claimId: returnedClaimId,
    caseId,
    orderId,
  };

  if (outcome === "AMBIGUOUS") {
    if (row.paymentEventId !== null) {
      throw new TypeError("Ambiguous provider outcome asserted evidence");
    }
    return {
      ...base,
      paymentEventId: null,
      status: requireOneOf(
        row.status,
        ["RECONCILIATION_REQUIRED"] as const,
        "Case staff-resolution ambiguous status",
      ),
      action: requireOneOf(
        row.action,
        ["ambiguous", "ambiguous_replay"] as const,
        "Case staff-resolution ambiguous action",
      ),
    } satisfies AmbiguousCaseStaffResolutionProvider;
  }

  return {
    ...base,
    paymentEventId: requireBoundedString(
      row.paymentEventId,
      "Case staff-resolution payment event",
    ),
    status: requireOneOf(
      row.status,
      ["PROVIDER_RECORDED"] as const,
      "Case staff-resolution provider status",
    ),
    action: requireOneOf(
      row.action,
      ["recorded", "replay"] as const,
      "Case staff-resolution provider action",
    ),
  } satisfies RecordedCaseStaffResolutionProvider;
}

function validateFinalizedResult(
  value: unknown,
  prepared: PreparedCaseStaffResolution,
): FinalizedCaseStaffResolution {
  const row = requireRecord(value, "Case staff-resolution finalize");
  const result = {
    claimId: requireBoundedString(
      row.claimId,
      "Case staff-resolution finalized claim",
    ),
    caseId: requireBoundedString(
      row.caseId,
      "Case staff-resolution finalized Case",
    ),
    orderId: requireBoundedString(
      row.orderId,
      "Case staff-resolution finalized Order",
    ),
    buyerUserId: requireNullableBoundedString(
      row.buyerUserId,
      "Case staff-resolution finalized buyer",
    ),
    sellerUserId: requireBoundedString(
      row.sellerUserId,
      "Case staff-resolution finalized seller",
    ),
    resolution: requireOneOf(
      row.resolution,
      ["DISMISSED", "REFUND_FULL", "REFUND_PARTIAL"] as const,
      "Case staff-resolution finalized resolution",
    ),
    refundAmountCents: requireNullableInteger(
      row.refundAmountCents,
      "Case staff-resolution finalized refund amount",
      { min: 1 },
    ),
    currency: requireBoundedString(
      row.currency,
      "Case staff-resolution finalized currency",
      20,
    ),
    resolutionMessageId: requireBoundedString(
      row.resolutionMessageId,
      "Case staff-resolution message",
    ),
    stockStatusRestoredCount: requireInteger(
      row.stockStatusRestoredCount,
      "Case staff-resolution restored listing count",
      { min: 0 },
    ),
    status: requireOneOf(
      row.status,
      ["FINALIZED"] as const,
      "Case staff-resolution finalized status",
    ),
    action: requireOneOf(
      row.action,
      ["finalized", "replay"] as const,
      "Case staff-resolution finalized action",
    ),
  } satisfies FinalizedCaseStaffResolution;

  if (
    result.claimId !== prepared.claimId
    || result.caseId !== prepared.caseId
    || result.orderId !== prepared.orderId
    || result.buyerUserId !== prepared.buyerUserId
    || result.sellerUserId !== prepared.sellerUserId
    || result.resolution !== prepared.resolution
    || result.refundAmountCents !== prepared.refundAmountCents
    || result.currency !== prepared.currency
    || result.resolutionMessageId
      !== `case_resolution_message_${prepared.claimId}`
  ) {
    throw new TypeError("Case staff-resolution finalization identity drifted");
  }
  return result;
}

function requireSingleResult(
  rows: Array<{ result: unknown }>,
  label: string,
) {
  if (rows.length !== 1) {
    throw new TypeError(`${label} returned an invalid row count`);
  }
  return rows[0].result;
}

export async function prepareCaseStaffResolution(
  input: {
    actorUserId: string;
    caseId: string;
    resolution: CaseStaffResolution;
    partialRefundAmountCents: number | null;
    stockRestoreDecision: CaseStockRestore[];
  },
  db: CaseStaffResolutionClient = prisma,
) {
  const stockDecisionJson = JSON.stringify(input.stockRestoreDecision);
  const rows = await db.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_case_staff_resolution_prepare(
      ${input.actorUserId}::text,
      ${input.caseId}::text,
      ${input.resolution}::public."CaseResolution",
      ${input.partialRefundAmountCents}::integer,
      ${stockDecisionJson}::jsonb
    ) AS result
  `;
  return validatePreparedResult(
    requireSingleResult(rows, "Case staff-resolution prepare"),
    input,
  );
}

export async function recordCaseStaffResolutionProvider(
  actorUserId: string,
  prepared: PreparedCaseStaffResolution,
  evidence: ProviderEvidence,
  db: CaseStaffResolutionClient = prisma,
) {
  const validatedEvidence = validateProviderEvidence(evidence);
  const refundIds = Prisma.sql`
    ARRAY[${Prisma.join(
      validatedEvidence.refundIds.map((value) => Prisma.sql`${value}::text`),
    )}]::text[]
  `;
  const refundStatuses = Prisma.sql`
    ARRAY[${Prisma.join(
      validatedEvidence.refundStatuses.map(
        (value) => Prisma.sql`${value}::text`,
      ),
    )}]::text[]
  `;
  const rows = await db.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_case_staff_resolution_provider_record(
      ${actorUserId}::text,
      ${prepared.claimId}::text,
      'RECORDED'::text,
      ${validatedEvidence.primaryRefundId}::text,
      ${refundIds},
      ${refundStatuses},
      ${validatedEvidence.transferReversalId}::text,
      ${validatedEvidence.transferReversalAmountCents}::integer,
      ${validatedEvidence.requiresManualTransferReconciliation}::boolean,
      ${validatedEvidence.requiresManualFollowUp}::boolean
    ) AS result
  `;
  return validateProviderResult(
    requireSingleResult(rows, "Case staff-resolution provider record"),
    prepared,
    "RECORDED",
  );
}

export async function recordAmbiguousCaseStaffResolutionProvider(
  actorUserId: string,
  prepared: PreparedCaseStaffResolution,
  db: CaseStaffResolutionClient = prisma,
) {
  const rows = await db.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_case_staff_resolution_provider_record(
      ${actorUserId}::text,
      ${prepared.claimId}::text,
      'AMBIGUOUS'::text,
      NULL::text,
      ARRAY[]::text[],
      ARRAY[]::text[],
      NULL::text,
      NULL::integer,
      false,
      false
    ) AS result
  `;
  return validateProviderResult(
    requireSingleResult(rows, "Case staff-resolution ambiguous provider"),
    prepared,
    "AMBIGUOUS",
  );
}

export async function finalizeCaseStaffResolution(
  actorUserId: string,
  prepared: PreparedCaseStaffResolution,
  db: CaseStaffResolutionClient = prisma,
) {
  const rows = await db.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_case_staff_resolution_finalize(
      ${actorUserId}::text,
      ${prepared.claimId}::text
    ) AS result
  `;
  return validateFinalizedResult(
    requireSingleResult(rows, "Case staff-resolution finalize"),
    prepared,
  );
}
