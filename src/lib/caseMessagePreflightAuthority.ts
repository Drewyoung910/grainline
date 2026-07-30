import { prisma } from "@/lib/db";
import {
  validateCaseMessagePreflight,
  type CaseMessagePreflight,
} from "@/lib/caseMessagePreflightResult";

type CaseMessagePreflightClient = Pick<typeof prisma, "$queryRaw">;

export async function getCaseMessagePreflight(
  input: { actorUserId: string; caseId: string },
  db: CaseMessagePreflightClient = prisma,
): Promise<CaseMessagePreflight | null> {
  const rows = await db.$queryRaw<unknown[]>`
    SELECT *
      FROM public.grainline_case_message_preflight(
        ${input.actorUserId}::text,
        ${input.caseId}::text
      )
  `;
  if (rows.length === 0) return null;
  if (rows.length !== 1) {
    throw new TypeError(
      "Case-message preflight authority returned an invalid row count",
    );
  }
  return validateCaseMessagePreflight(rows[0], input);
}
