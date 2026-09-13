export type CaseReadRow = {
  id: string;
  orderId: string;
  buyerId: string | null;
  sellerId: string;
  reason:
    | "NOT_RECEIVED"
    | "NOT_AS_DESCRIBED"
    | "DAMAGED"
    | "WRONG_ITEM"
    | "OTHER";
  description: string;
  status:
    | "OPEN"
    | "IN_DISCUSSION"
    | "PENDING_CLOSE"
    | "UNDER_REVIEW"
    | "RESOLVED"
    | "CLOSED";
  resolution:
    | "REFUND_FULL"
    | "REFUND_PARTIAL"
    | "DISMISSED"
    | null;
  refundAmountCents: number | null;
  sellerRespondBy: Date;
  escalateUnlocksAt: Date | null;
  buyerMarkedResolved: boolean;
  sellerMarkedResolved: boolean;
  resolvedAt: Date | null;
  createdAt: Date;
  actsAsStaff: boolean;
};

const RESULT_KEYS = Object.freeze([
  "actsAsStaff",
  "buyerId",
  "buyerMarkedResolved",
  "createdAt",
  "description",
  "escalateUnlocksAt",
  "id",
  "orderId",
  "reason",
  "refundAmountCents",
  "resolution",
  "resolvedAt",
  "sellerId",
  "sellerMarkedResolved",
  "sellerRespondBy",
  "status",
]);
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireExactRecord(value: unknown) {
  if (!isRecord(value)) {
    throw new TypeError("Case read result is not an object");
  }
  const actual = Object.keys(value).sort();
  if (
    actual.length !== RESULT_KEYS.length
    || actual.some((key, index) => key !== RESULT_KEYS[index])
  ) {
    throw new TypeError("Case read result has an invalid shape");
  }
  return value;
}

function requireId(value: unknown, label: string) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new TypeError(`Case read ${label} is invalid`);
  }
  return value;
}

function requireDate(value: unknown, label: string) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError(`Case read ${label} is invalid`);
  }
  return value;
}

function requireNullableDate(value: unknown, label: string) {
  return value === null ? null : requireDate(value, label);
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
    throw new TypeError(`Case read ${label} is invalid`);
  }
  return value as T[number];
}

export function validateCaseReadRow(
  value: unknown,
  expected: {
    actorUserId: string;
    caseId?: string;
    orderId?: string;
  },
): CaseReadRow {
  const row = requireExactRecord(value);
  if (
    typeof row.description !== "string"
    || row.description.length > 5000
    || typeof row.buyerMarkedResolved !== "boolean"
    || typeof row.sellerMarkedResolved !== "boolean"
    || typeof row.actsAsStaff !== "boolean"
  ) {
    throw new TypeError("Case read fields are invalid");
  }
  if (
    row.refundAmountCents !== null
    && (
      typeof row.refundAmountCents !== "number"
      || !Number.isSafeInteger(row.refundAmountCents)
      || row.refundAmountCents < 0
    )
  ) {
    throw new TypeError("Case read refund amount is invalid");
  }
  const result: CaseReadRow = {
    id: requireId(row.id, "id"),
    orderId: requireId(row.orderId, "Order id"),
    buyerId: row.buyerId === null
      ? null
      : requireId(row.buyerId, "buyer id"),
    sellerId: requireId(row.sellerId, "seller id"),
    reason: requireOneOf(
      row.reason,
      [
        "NOT_RECEIVED",
        "NOT_AS_DESCRIBED",
        "DAMAGED",
        "WRONG_ITEM",
        "OTHER",
      ] as const,
      "reason",
    ),
    description: row.description,
    status: requireOneOf(
      row.status,
      [
        "OPEN",
        "IN_DISCUSSION",
        "PENDING_CLOSE",
        "UNDER_REVIEW",
        "RESOLVED",
        "CLOSED",
      ] as const,
      "status",
    ),
    resolution: row.resolution === null
      ? null
      : requireOneOf(
          row.resolution,
          ["REFUND_FULL", "REFUND_PARTIAL", "DISMISSED"] as const,
          "resolution",
    ),
    refundAmountCents: row.refundAmountCents,
    sellerRespondBy: requireDate(
      row.sellerRespondBy,
      "seller response deadline",
    ),
    escalateUnlocksAt: requireNullableDate(
      row.escalateUnlocksAt,
      "escalation deadline",
    ),
    buyerMarkedResolved: row.buyerMarkedResolved,
    sellerMarkedResolved: row.sellerMarkedResolved,
    resolvedAt: requireNullableDate(row.resolvedAt, "resolution time"),
    createdAt: requireDate(row.createdAt, "creation time"),
    actsAsStaff: row.actsAsStaff,
  };

  if (
    (expected.caseId !== undefined && result.id !== expected.caseId)
    || (expected.orderId !== undefined && result.orderId !== expected.orderId)
    || result.buyerId === result.sellerId
  ) {
    throw new TypeError("Case read identity drifted");
  }
  const actorIsParty =
    expected.actorUserId === result.buyerId
    || expected.actorUserId === result.sellerId;
  if (result.actsAsStaff === actorIsParty) {
    throw new TypeError("Case read authority mode drifted");
  }
  return result;
}

export function validateCaseStaffActiveCount(value: unknown): number {
  if (
    !isRecord(value)
    || Object.keys(value).length !== 1
    || !Object.hasOwn(value, "activeCount")
  ) {
    throw new TypeError("Case staff active count has an invalid shape");
  }
  const count = value.activeCount;
  if (
    (typeof count !== "bigint" && typeof count !== "number")
    || count < 0
    || count > Number.MAX_SAFE_INTEGER
    || (typeof count === "number" && !Number.isSafeInteger(count))
  ) {
    throw new TypeError("Case staff active count is invalid");
  }
  return Number(count);
}
