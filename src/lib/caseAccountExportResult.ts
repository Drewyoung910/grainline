import type { CaseMessagePageRow } from "@/lib/caseMessagePageResult";

export type CaseAccountExportPageRow = {
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
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CaseAccountExportRow = CaseAccountExportPageRow & {
  messages: CaseMessagePageRow[];
};

const RESULT_KEYS = Object.freeze([
  "buyerId",
  "createdAt",
  "description",
  "id",
  "orderId",
  "reason",
  "refundAmountCents",
  "resolution",
  "resolvedAt",
  "sellerId",
  "sellerRespondBy",
  "status",
  "updatedAt",
]);
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireId(value: unknown, label: string) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new TypeError(`Case account-export ${label} is invalid`);
  }
  return value;
}

function requireDate(value: unknown, label: string) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError(`Case account-export ${label} is invalid`);
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
    throw new TypeError(`Case account-export ${label} is invalid`);
  }
  return value as T[number];
}

function compareDescending(
  left: { createdAt: Date; id: string },
  right: { createdAt: Date; id: string },
) {
  const time = right.createdAt.getTime() - left.createdAt.getTime();
  return time || (left.id < right.id ? 1 : left.id > right.id ? -1 : 0);
}

function validateRow(
  value: unknown,
  actorUserId: string,
): CaseAccountExportPageRow {
  if (!isRecord(value)) {
    throw new TypeError("Case account-export row is not an object");
  }
  const actualKeys = Object.keys(value).sort();
  if (
    actualKeys.length !== RESULT_KEYS.length
    || actualKeys.some((key, index) => key !== RESULT_KEYS[index])
  ) {
    throw new TypeError("Case account-export row has an invalid shape");
  }
  if (
    typeof value.description !== "string"
    || value.description.length > 5000
  ) {
    throw new TypeError("Case account-export description is invalid");
  }
  if (
    value.refundAmountCents !== null
    && (
      typeof value.refundAmountCents !== "number"
      || !Number.isSafeInteger(value.refundAmountCents)
      || value.refundAmountCents < 0
    )
  ) {
    throw new TypeError("Case account-export refund amount is invalid");
  }

  const row: CaseAccountExportPageRow = {
    id: requireId(value.id, "id"),
    orderId: requireId(value.orderId, "Order id"),
    buyerId: value.buyerId === null
      ? null
      : requireId(value.buyerId, "buyer id"),
    sellerId: requireId(value.sellerId, "seller id"),
    reason: requireOneOf(
      value.reason,
      [
        "NOT_RECEIVED",
        "NOT_AS_DESCRIBED",
        "DAMAGED",
        "WRONG_ITEM",
        "OTHER",
      ] as const,
      "reason",
    ),
    description: value.description,
    status: requireOneOf(
      value.status,
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
    resolution: value.resolution === null
      ? null
      : requireOneOf(
          value.resolution,
          ["REFUND_FULL", "REFUND_PARTIAL", "DISMISSED"] as const,
          "resolution",
        ),
    refundAmountCents: value.refundAmountCents,
    sellerRespondBy: requireDate(
      value.sellerRespondBy,
      "seller response deadline",
    ),
    resolvedAt: value.resolvedAt === null
      ? null
      : requireDate(value.resolvedAt, "resolution time"),
    createdAt: requireDate(value.createdAt, "creation time"),
    updatedAt: requireDate(value.updatedAt, "update time"),
  };

  if (
    row.buyerId === row.sellerId
    || (
      actorUserId !== row.buyerId
      && actorUserId !== row.sellerId
    )
  ) {
    throw new TypeError("Case account-export participant identity drifted");
  }
  return row;
}

export function validateCaseAccountExportPage(
  value: unknown,
  expected: {
    actorUserId: string;
    cursor: { createdAt: Date; id: string } | null;
  },
): CaseAccountExportPageRow[] {
  if (!Array.isArray(value) || value.length > 25) {
    throw new TypeError("Case account-export page size is invalid");
  }
  const rows = value.map((row) => validateRow(row, expected.actorUserId));
  const ids = new Set<string>();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (ids.has(row.id)) {
      throw new TypeError("Case account-export ids are duplicated");
    }
    ids.add(row.id);
    if (
      index > 0
      && compareDescending(rows[index - 1], row) >= 0
    ) {
      throw new TypeError("Case account-export order is invalid");
    }
  }
  if (
    expected.cursor
    && rows.length > 0
    && compareDescending(expected.cursor, rows[0]) >= 0
  ) {
    throw new TypeError("Case account-export cursor did not advance");
  }
  return rows;
}
