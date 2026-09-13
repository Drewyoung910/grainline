import { prisma } from "@/lib/db";
import {
  validateParticipantResolutionResult,
} from "@/lib/caseParticipantResolutionResult";

type CaseParticipantResolutionClient = Pick<typeof prisma, "$queryRaw">;

export async function markCaseParticipantResolved(
  input: { actorUserId: string; caseId: string },
  db: CaseParticipantResolutionClient = prisma,
) {
  const rows = await db.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_case_mark_resolved(
      ${input.actorUserId}::text,
      ${input.caseId}::text
    ) AS result
  `;
  if (rows.length !== 1) {
    throw new TypeError(
      "Case participant-resolution authority returned an invalid row count",
    );
  }
  return validateParticipantResolutionResult(rows[0].result, input);
}
