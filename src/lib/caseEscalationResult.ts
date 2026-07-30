import { createHash } from "node:crypto";

export type CaseEscalationResult = {
  caseId: string;
  orderId: string;
  actorUserId: string;
  buyerUserId: string | null;
  sellerUserId: string;
  previousStatus: "OPEN" | "IN_DISCUSSION";
  status: "UNDER_REVIEW";
  auditLogId: string;
  actorKind: "user" | "staff";
  action: "updated" | "replay";
};

const RESULT_KEYS = Object.freeze([
  "action",
  "actorKind",
  "actorUserId",
  "auditLogId",
  "buyerUserId",
  "caseId",
  "orderId",
  "previousStatus",
  "sellerUserId",
  "status",
]);

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

function requireNullableBoundedString(value: unknown, label: string) {
  return value === null ? null : requireBoundedString(value, label);
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

function requireRecord(value: unknown) {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
  ) {
    throw new TypeError(
      "Case-escalation authority returned a non-object result",
    );
  }
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort();
  if (
    keys.length !== RESULT_KEYS.length
    || keys.some((key, index) => key !== RESULT_KEYS[index])
  ) {
    throw new TypeError(
      "Case-escalation authority returned an invalid shape",
    );
  }
  return row;
}

function expectedAuditId(caseId: string, actorUserId: string) {
  const material =
    `${Buffer.byteLength(caseId, "utf8")}:${caseId}:`
    + `${Buffer.byteLength(actorUserId, "utf8")}:${actorUserId}`;
  return `case_escalation_${createHash("sha256")
    .update(material, "utf8")
    .digest("hex")}`;
}

export function validateCaseEscalationResult(
  value: unknown,
  expected: { actorUserId: string; caseId: string },
): CaseEscalationResult {
  const row = requireRecord(value);
  const result: CaseEscalationResult = {
    caseId: requireBoundedString(row.caseId, "Case-escalation Case"),
    orderId: requireBoundedString(row.orderId, "Case-escalation Order"),
    actorUserId: requireBoundedString(
      row.actorUserId,
      "Case-escalation actor",
    ),
    buyerUserId: requireNullableBoundedString(
      row.buyerUserId,
      "Case-escalation buyer",
    ),
    sellerUserId: requireBoundedString(
      row.sellerUserId,
      "Case-escalation seller",
    ),
    previousStatus: requireOneOf(
      row.previousStatus,
      ["OPEN", "IN_DISCUSSION"] as const,
      "Case-escalation previous status",
    ),
    status: requireOneOf(
      row.status,
      ["UNDER_REVIEW"] as const,
      "Case-escalation status",
    ),
    auditLogId: requireBoundedString(
      row.auditLogId,
      "Case-escalation audit",
    ),
    actorKind: requireOneOf(
      row.actorKind,
      ["user", "staff"] as const,
      "Case-escalation actor kind",
    ),
    action: requireOneOf(
      row.action,
      ["updated", "replay"] as const,
      "Case-escalation action",
    ),
  };

  const actorIsBuyer = result.actorUserId === result.buyerUserId;
  const actorIsSeller = result.actorUserId === result.sellerUserId;
  if (
    result.caseId !== expected.caseId
    || result.actorUserId !== expected.actorUserId
    || result.auditLogId
      !== expectedAuditId(result.caseId, result.actorUserId)
    || (
      result.actorKind === "user"
      && actorIsBuyer === actorIsSeller
    )
    || (
      result.actorKind === "staff"
      && (actorIsBuyer || actorIsSeller)
    )
  ) {
    throw new TypeError("Case-escalation authority identity drifted");
  }
  return result;
}
