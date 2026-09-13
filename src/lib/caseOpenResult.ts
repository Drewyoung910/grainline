export type CaseOpenResult = {
  caseId: string;
  orderId: string;
  buyerUserId: string;
  sellerUserId: string;
  openingMessageId: string;
  auditLogId: string;
  reason:
    | "NOT_RECEIVED"
    | "NOT_AS_DESCRIBED"
    | "DAMAGED"
    | "WRONG_ITEM"
    | "OTHER";
  status: "OPEN";
  action: "created" | "replay";
};

const RESULT_KEYS = Object.freeze([
  "action",
  "auditLogId",
  "buyerUserId",
  "caseId",
  "openingMessageId",
  "orderId",
  "reason",
  "sellerUserId",
  "status",
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AUDIT_ID_PATTERN =
  /^case-open-audit:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown) {
  if (!isRecord(value)) {
    throw new TypeError("Case-open authority returned a non-object result");
  }
  const keys = Object.keys(value).sort();
  if (
    keys.length !== RESULT_KEYS.length
    || keys.some((key, index) => key !== RESULT_KEYS[index])
  ) {
    throw new TypeError("Case-open authority returned an invalid shape");
  }
  return value;
}

function requireBoundedString(
  value: unknown,
  label: string,
  max = 191,
) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > max
  ) {
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

function requireUuid(value: unknown, label: string) {
  const result = requireBoundedString(value, label);
  if (!UUID_PATTERN.test(result)) {
    throw new TypeError(`${label} is invalid`);
  }
  return result;
}

export function validateCaseOpenResult(
  value: unknown,
  expected: {
    actorUserId: string;
    orderId: string;
    reason: CaseOpenResult["reason"];
  },
): CaseOpenResult {
  const row = requireRecord(value);
  const result: CaseOpenResult = {
    caseId: requireUuid(row.caseId, "Case-open Case"),
    orderId: requireBoundedString(row.orderId, "Case-open Order"),
    buyerUserId: requireBoundedString(row.buyerUserId, "Case-open buyer"),
    sellerUserId: requireBoundedString(row.sellerUserId, "Case-open seller"),
    openingMessageId: requireUuid(
      row.openingMessageId,
      "Case-open opening message",
    ),
    auditLogId: requireBoundedString(row.auditLogId, "Case-open audit"),
    reason: requireOneOf(
      row.reason,
      [
        "NOT_RECEIVED",
        "NOT_AS_DESCRIBED",
        "DAMAGED",
        "WRONG_ITEM",
        "OTHER",
      ] as const,
      "Case-open reason",
    ),
    status: requireOneOf(row.status, ["OPEN"] as const, "Case-open status"),
    action: requireOneOf(
      row.action,
      ["created", "replay"] as const,
      "Case-open action",
    ),
  };

  if (
    result.orderId !== expected.orderId
    || result.buyerUserId !== expected.actorUserId
    || result.sellerUserId === result.buyerUserId
    || result.reason !== expected.reason
    || !AUDIT_ID_PATTERN.test(result.auditLogId)
  ) {
    throw new TypeError("Case-open authority identity drifted");
  }
  return result;
}
