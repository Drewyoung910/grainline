import { createHash } from "node:crypto";

export type CaseParticipantResolutionResult = {
  caseId: string;
  orderId: string;
  actorUserId: string;
  buyerUserId: string | null;
  sellerUserId: string;
  status: "PENDING_CLOSE" | "RESOLVED";
  buyerMarkedResolved: boolean;
  sellerMarkedResolved: boolean;
  auditLogId: string;
  action: "updated" | "replay" | "historical_replay" | "legacy_recovered";
};

const RESULT_KEYS = Object.freeze([
  "action",
  "actorUserId",
  "auditLogId",
  "buyerMarkedResolved",
  "buyerUserId",
  "caseId",
  "orderId",
  "sellerMarkedResolved",
  "sellerUserId",
  "status",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown) {
  if (!isRecord(value)) {
    throw new TypeError(
      "Case participant-resolution authority returned a non-object result",
    );
  }
  const keys = Object.keys(value).sort();
  if (
    keys.length !== RESULT_KEYS.length
    || keys.some((key, index) => key !== RESULT_KEYS[index])
  ) {
    throw new TypeError(
      "Case participant-resolution authority returned an invalid shape",
    );
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

function requireNullableBoundedString(
  value: unknown,
  label: string,
) {
  return value === null ? null : requireBoundedString(value, label);
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

function expectedAuditLogIdPrefix(caseId: string, actorUserId: string) {
  const digest = createHash("md5")
    .update(`${caseId}:${actorUserId}`, "utf8")
    .digest("hex");
  return `case_resolution_mark_${digest}`;
}

function isExpectedAuditLogId(
  value: string,
  caseId: string,
  actorUserId: string,
) {
  const prefix = expectedAuditLogIdPrefix(caseId, actorUserId);
  if (value === prefix) return true;
  if (!value.startsWith(`${prefix}:`)) return false;
  return /^[0-9a-f]{32}$/.test(value.slice(prefix.length + 1));
}

export function validateParticipantResolutionResult(
  value: unknown,
  expected: { actorUserId: string; caseId: string },
): CaseParticipantResolutionResult {
  const row = requireRecord(value);
  const result: CaseParticipantResolutionResult = {
    caseId: requireBoundedString(
      row.caseId,
      "Case participant-resolution Case",
    ),
    orderId: requireBoundedString(
      row.orderId,
      "Case participant-resolution Order",
    ),
    actorUserId: requireBoundedString(
      row.actorUserId,
      "Case participant-resolution actor",
    ),
    buyerUserId: requireNullableBoundedString(
      row.buyerUserId,
      "Case participant-resolution buyer",
    ),
    sellerUserId: requireBoundedString(
      row.sellerUserId,
      "Case participant-resolution seller",
    ),
    status: requireOneOf(
      row.status,
      ["PENDING_CLOSE", "RESOLVED"] as const,
      "Case participant-resolution status",
    ),
    buyerMarkedResolved: requireBoolean(
      row.buyerMarkedResolved,
      "Case participant-resolution buyer mark",
    ),
    sellerMarkedResolved: requireBoolean(
      row.sellerMarkedResolved,
      "Case participant-resolution seller mark",
    ),
    auditLogId: requireBoundedString(
      row.auditLogId,
      "Case participant-resolution audit",
    ),
    action: requireOneOf(
      row.action,
      [
        "updated",
        "replay",
        "historical_replay",
        "legacy_recovered",
      ] as const,
      "Case participant-resolution action",
    ),
  };

  const actorIsBuyer = result.actorUserId === result.buyerUserId;
  const actorIsSeller = result.actorUserId === result.sellerUserId;
  if (
    result.caseId !== expected.caseId
    || result.actorUserId !== expected.actorUserId
    || actorIsBuyer === actorIsSeller
    || !isExpectedAuditLogId(
      result.auditLogId,
      result.caseId,
      result.actorUserId,
    )
  ) {
    throw new TypeError(
      "Case participant-resolution authority identity drifted",
    );
  }

  const actorMarkedResolved = actorIsBuyer
    ? result.buyerMarkedResolved
    : result.sellerMarkedResolved;
  if (
    !actorMarkedResolved
    || (
      result.status === "RESOLVED"
      && result.action !== "historical_replay"
      && (
        !result.buyerMarkedResolved
        || !result.sellerMarkedResolved
      )
    )
    || (
      result.action === "updated"
      && result.status === "PENDING_CLOSE"
      && (
        result.buyerMarkedResolved
        === result.sellerMarkedResolved
      )
    )
    || (
      result.action === "historical_replay"
      && result.status !== "RESOLVED"
    )
  ) {
    throw new TypeError(
      "Case participant-resolution authority state drifted",
    );
  }
  return result;
}
