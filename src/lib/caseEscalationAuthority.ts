import { prisma } from "@/lib/db";
import { validateCaseEscalationResult } from "@/lib/caseEscalationResult";

type CaseEscalationClient = Pick<typeof prisma, "$queryRaw">;

export async function escalateCaseWithFixedAuthority(
  input: { actorUserId: string; caseId: string },
  db: CaseEscalationClient = prisma,
) {
  const rows = await db.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_case_escalate(
      ${input.actorUserId}::text,
      ${input.caseId}::text
    ) AS result
  `;
  if (rows.length !== 1) {
    throw new TypeError(
      "Case-escalation authority returned an invalid row count",
    );
  }
  return validateCaseEscalationResult(rows[0].result, input);
}
