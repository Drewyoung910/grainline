export type CaseMessagePreflight = {
  caseId: string;
  orderId: string;
  buyerUserId: string | null;
  sellerUserId: string;
  status:
    | "OPEN"
    | "IN_DISCUSSION"
    | "PENDING_CLOSE"
    | "UNDER_REVIEW"
    | "RESOLVED"
    | "CLOSED";
  authorKind: "BUYER" | "SELLER" | "STAFF";
  actsAsStaff: boolean;
  canCreateMessage: boolean;
  recipientUnavailableReason: "suspended" | "deleted" | "missing" | null;
};

const RESULT_KEYS = Object.freeze([
  "actsAsStaff",
  "authorKind",
  "buyerUserId",
  "canCreateMessage",
  "caseId",
  "orderId",
  "recipientUnavailableReason",
  "sellerUserId",
  "status",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireExactRecord(value: unknown) {
  if (!isRecord(value)) {
    throw new TypeError("Case-message preflight result is not an object");
  }
  const keys = Object.keys(value).sort();
  if (
    keys.length !== RESULT_KEYS.length
    || keys.some((key, index) => key !== RESULT_KEYS[index])
  ) {
    throw new TypeError("Case-message preflight result has an invalid shape");
  }
  return value;
}

function requireBoundedString(value: unknown, label: string) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 191
  ) {
    throw new TypeError(`Case-message preflight ${label} is invalid`);
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
    throw new TypeError(`Case-message preflight ${label} is invalid`);
  }
  return value as T[number];
}

export function validateCaseMessagePreflight(
  value: unknown,
  expected: { actorUserId: string; caseId: string },
): CaseMessagePreflight {
  const row = requireExactRecord(value);
  if (
    typeof row.actsAsStaff !== "boolean"
    || typeof row.canCreateMessage !== "boolean"
  ) {
    throw new TypeError("Case-message preflight authority flags are invalid");
  }

  const result: CaseMessagePreflight = {
    caseId: requireBoundedString(row.caseId, "Case"),
    orderId: requireBoundedString(row.orderId, "Order"),
    buyerUserId: row.buyerUserId === null
      ? null
      : requireBoundedString(row.buyerUserId, "buyer"),
    sellerUserId: requireBoundedString(row.sellerUserId, "seller"),
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
    authorKind: requireOneOf(
      row.authorKind,
      ["BUYER", "SELLER", "STAFF"] as const,
      "author kind",
    ),
    actsAsStaff: row.actsAsStaff,
    canCreateMessage: row.canCreateMessage,
    recipientUnavailableReason: row.recipientUnavailableReason === null
      ? null
      : requireOneOf(
          row.recipientUnavailableReason,
          ["suspended", "deleted", "missing"] as const,
          "recipient state",
        ),
  };

  if (
    result.caseId !== expected.caseId
    || result.buyerUserId === result.sellerUserId
  ) {
    throw new TypeError("Case-message preflight identity drifted");
  }

  const actorIsBuyer = expected.actorUserId === result.buyerUserId;
  const actorIsSeller = expected.actorUserId === result.sellerUserId;
  if (
    (actorIsBuyer
      && (result.authorKind !== "BUYER" || result.actsAsStaff))
    || (actorIsSeller
      && (result.authorKind !== "SELLER" || result.actsAsStaff))
    || (!actorIsBuyer
      && !actorIsSeller
      && (result.authorKind !== "STAFF" || !result.actsAsStaff))
    || (result.actsAsStaff && result.recipientUnavailableReason !== null)
  ) {
    throw new TypeError("Case-message preflight authority identity drifted");
  }

  const messageableStatuses = result.actsAsStaff
    ? ["OPEN", "IN_DISCUSSION", "PENDING_CLOSE", "UNDER_REVIEW"]
    : ["OPEN", "IN_DISCUSSION", "PENDING_CLOSE"];
  if (
    result.canCreateMessage
    !== messageableStatuses.includes(result.status)
  ) {
    throw new TypeError("Case-message preflight messageable state drifted");
  }
  return result;
}
