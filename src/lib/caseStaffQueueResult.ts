export type CaseStaffQueueRow = {
  id: string;
  orderId: string;
  buyerLabel: string;
  buyerSecondaryEmail: string | null;
  sellerLabel: string;
  reason:
    | "NOT_RECEIVED"
    | "NOT_AS_DESCRIBED"
    | "DAMAGED"
    | "WRONG_ITEM"
    | "OTHER";
  status:
    | "OPEN"
    | "IN_DISCUSSION"
    | "PENDING_CLOSE"
    | "UNDER_REVIEW"
    | "RESOLVED"
    | "CLOSED";
  messageCount: number;
  createdAt: Date;
};

export type CaseStaffQueueResult = {
  totalCount: number;
  safePage: number;
  cases: CaseStaffQueueRow[];
};

const RESULT_KEYS = Object.freeze(["cases", "safePage", "totalCount"]);
const ROW_KEYS = Object.freeze([
  "buyerLabel",
  "buyerSecondaryEmail",
  "createdAt",
  "id",
  "messageCount",
  "orderId",
  "reason",
  "sellerLabel",
  "status",
]);
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/;
const UTC_OFFSET_PATTERN = /(?:Z|[+-]\d{2}:\d{2})$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireExactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
) {
  if (!isRecord(value)) {
    throw new TypeError(`Case staff queue ${label} is not an object`);
  }
  const actual = Object.keys(value).sort();
  if (
    actual.length !== keys.length
    || actual.some((key, index) => key !== keys[index])
  ) {
    throw new TypeError(`Case staff queue ${label} has an invalid shape`);
  }
  return value;
}

function requireSafeCount(value: unknown, label: string) {
  if (
    (typeof value !== "bigint" && typeof value !== "number")
    || value < 0
    || value > Number.MAX_SAFE_INTEGER
    || (typeof value === "number" && !Number.isSafeInteger(value))
  ) {
    throw new TypeError(`Case staff queue ${label} is invalid`);
  }
  return Number(value);
}

function requireId(value: unknown, label: string) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new TypeError(`Case staff queue ${label} is invalid`);
  }
  return value;
}

function requireDisplayText(value: unknown, label: string) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 254
  ) {
    throw new TypeError(`Case staff queue ${label} is invalid`);
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
    throw new TypeError(`Case staff queue ${label} is invalid`);
  }
  return value as T[number];
}

function requireUtcDate(value: unknown) {
  if (
    typeof value !== "string"
    || !UTC_OFFSET_PATTERN.test(value)
  ) {
    throw new TypeError("Case staff queue creation time lacks a UTC offset");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new TypeError("Case staff queue creation time is invalid");
  }
  return parsed;
}

export function validateCaseStaffQueueResult(
  value: unknown,
  expected: {
    requestedPage: number;
    pageSize: number;
    statusFilter: CaseStaffQueueRow["status"] | null;
  },
): CaseStaffQueueResult {
  const result = requireExactRecord(value, RESULT_KEYS, "result");
  const totalCount = requireSafeCount(result.totalCount, "total count");
  if (
    typeof result.safePage !== "number"
    || !Number.isSafeInteger(result.safePage)
  ) {
    throw new TypeError("Case staff queue safe page is invalid");
  }
  const totalPages = Math.max(1, Math.ceil(totalCount / expected.pageSize));
  const safePage = Math.min(expected.requestedPage, totalPages);
  if (result.safePage !== safePage || !Array.isArray(result.cases)) {
    throw new TypeError("Case staff queue pagination drifted");
  }
  const expectedRowCount = totalCount === 0
    ? 0
    : Math.min(
        expected.pageSize,
        totalCount - ((safePage - 1) * expected.pageSize),
      );
  if (result.cases.length !== expectedRowCount) {
    throw new TypeError("Case staff queue page size drifted");
  }

  const ids = new Set<string>();
  const cases = result.cases.map((value) => {
    const row = requireExactRecord(value, ROW_KEYS, "row");
    const id = requireId(row.id, "Case id");
    if (ids.has(id)) {
      throw new TypeError("Case staff queue contains duplicate rows");
    }
    ids.add(id);
    const status = requireOneOf(
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
    );
    if (expected.statusFilter !== null && status !== expected.statusFilter) {
      throw new TypeError("Case staff queue status filter drifted");
    }
    return {
      id,
      orderId: requireId(row.orderId, "Order id"),
      buyerLabel: requireDisplayText(row.buyerLabel, "buyer label"),
      buyerSecondaryEmail: row.buyerSecondaryEmail === null
        ? null
        : requireDisplayText(
            row.buyerSecondaryEmail,
            "buyer secondary email",
          ),
      sellerLabel: requireDisplayText(row.sellerLabel, "seller label"),
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
      status,
      messageCount: requireSafeCount(row.messageCount, "message count"),
      createdAt: requireUtcDate(row.createdAt),
    };
  });

  return { totalCount, safePage, cases };
}
