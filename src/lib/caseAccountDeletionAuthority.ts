import { prisma } from "@/lib/db";
import {
  type CaseAccountDeletionRedaction,
  type CountValue,
  validateCaseAccountDeletionBlockerRows,
  validateCaseAccountDeletionRedactionRows,
} from "@/lib/caseAccountDeletionResult";

type CaseAccountDeletionClient = Pick<typeof prisma, "$queryRaw">;

function requireBoundedId(value: unknown, label: string) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 191
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

export async function getCaseAccountDeletionBlockerCount(
  userId: string,
  db: CaseAccountDeletionClient = prisma,
) {
  const actorUserId = requireBoundedId(
    userId,
    "Case account-deletion actor",
  );
  const rows = await db.$queryRaw<Array<{ count: CountValue }>>`
    SELECT public.grainline_case_account_deletion_blockers(
      ${actorUserId}::text
    ) AS count
  `;
  return validateCaseAccountDeletionBlockerRows(rows);
}

export async function redactCaseDataForAccountDeletion(
  input: { sideEffectId: string; userId: string },
  db: CaseAccountDeletionClient = prisma,
): Promise<CaseAccountDeletionRedaction> {
  const sideEffectId = requireBoundedId(
    input.sideEffectId,
    "Case account-deletion side effect",
  );
  const userId = requireBoundedId(
    input.userId,
    "Case account-deletion user",
  );
  const rows = await db.$queryRaw<unknown[]>`
    SELECT *
      FROM public.grainline_case_account_deletion_redact(
        ${sideEffectId}::text
      )
  `;
  return validateCaseAccountDeletionRedactionRows(rows, {
    sideEffectId,
    userId,
  });
}
