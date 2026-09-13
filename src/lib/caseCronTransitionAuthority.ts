import { prisma } from "@/lib/db";

export const CASE_CRON_TRANSITION_FAMILIES = [
  "PENDING_CLOSE_EXPIRED",
  "OPEN_RESPONSE_DUE",
  "STALE_DISCUSSION",
] as const;

export type CaseCronTransitionFamily =
  (typeof CASE_CRON_TRANSITION_FAMILIES)[number];

export type CaseCronTransitionResult = {
  caseId: string;
  orderId: string;
  buyerUserId: string | null;
  sellerUserId: string;
  auditLogId: string;
  previousStatus: "PENDING_CLOSE" | "OPEN" | "IN_DISCUSSION";
  status: "RESOLVED" | "UNDER_REVIEW";
  notificationType: "CASE_RESOLVED" | "CASE_MESSAGE";
};

type CaseCronTransitionClient = Pick<typeof prisma, "$queryRaw">;

const RESULT_KEYS = Object.freeze([
  "auditLogId",
  "buyerUserId",
  "caseId",
  "notificationType",
  "orderId",
  "previousStatus",
  "sellerUserId",
  "status",
]);
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

function validateRow(
  value: unknown,
  family: CaseCronTransitionFamily,
): CaseCronTransitionResult {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
  ) {
    throw new TypeError(
      "Case cron-transition authority returned a non-object row",
    );
  }
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort();
  if (
    keys.length !== RESULT_KEYS.length
    || keys.some((key, index) => key !== RESULT_KEYS[index])
  ) {
    throw new TypeError(
      "Case cron-transition authority returned an invalid shape",
    );
  }
  const result = {
    caseId: requireBoundedString(row.caseId, "Case cron-transition Case"),
    orderId: requireBoundedString(row.orderId, "Case cron-transition Order"),
    buyerUserId: row.buyerUserId === null
      ? null
      : requireBoundedString(
          row.buyerUserId,
          "Case cron-transition buyer",
        ),
    sellerUserId: requireBoundedString(
      row.sellerUserId,
      "Case cron-transition seller",
    ),
    auditLogId: requireBoundedString(
      row.auditLogId,
      "Case cron-transition audit",
    ),
    previousStatus: requireBoundedString(
      row.previousStatus,
      "Case cron-transition previous status",
    ),
    status: requireBoundedString(row.status, "Case cron-transition status"),
    notificationType: requireBoundedString(
      row.notificationType,
      "Case cron-transition notification type",
    ),
  } as CaseCronTransitionResult;

  if (!UUID_V4.test(result.auditLogId)) {
    throw new TypeError("Case cron-transition audit identity is invalid");
  }
  const expected = {
    PENDING_CLOSE_EXPIRED: {
      previousStatus: "PENDING_CLOSE",
      status: "RESOLVED",
      notificationType: "CASE_RESOLVED",
    },
    OPEN_RESPONSE_DUE: {
      previousStatus: "OPEN",
      status: "UNDER_REVIEW",
      notificationType: "CASE_MESSAGE",
    },
    STALE_DISCUSSION: {
      previousStatus: "IN_DISCUSSION",
      status: "UNDER_REVIEW",
      notificationType: "CASE_MESSAGE",
    },
  } as const;
  const target = expected[family];
  if (
    result.previousStatus !== target.previousStatus
    || result.status !== target.status
    || result.notificationType !== target.notificationType
    || result.buyerUserId === result.sellerUserId
  ) {
    throw new TypeError("Case cron-transition authority state drifted");
  }
  return result;
}

export async function runCaseCronTransitionBatch(
  input: { family: CaseCronTransitionFamily; limit: number },
  db: CaseCronTransitionClient = prisma,
) {
  if (
    !CASE_CRON_TRANSITION_FAMILIES.includes(input.family)
    || !Number.isInteger(input.limit)
    || input.limit < 1
    || input.limit > 100
  ) {
    throw new TypeError("Case cron-transition input is invalid");
  }
  const rows = await db.$queryRaw<unknown[]>`
    SELECT *
      FROM public.grainline_case_cron_transition_batch(
        ${input.family}::text,
        ${input.limit}::integer
      )
  `;
  const ids = new Set<string>();
  return rows.map((row) => {
    const result = validateRow(row, input.family);
    if (ids.has(result.caseId)) {
      throw new TypeError(
        "Case cron-transition authority repeated a Case",
      );
    }
    ids.add(result.caseId);
    return result;
  });
}
