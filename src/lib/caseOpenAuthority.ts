import { prisma } from "@/lib/db";
import {
  validateCaseOpenResult,
  type CaseOpenResult,
} from "@/lib/caseOpenResult";

type CaseOpenClient = Pick<typeof prisma, "$queryRaw">;

export async function openCaseWithFixedAuthority(
  input: {
    actorUserId: string;
    orderId: string;
    reason: CaseOpenResult["reason"];
    description: string;
  },
  db: CaseOpenClient = prisma,
) {
  const rows = await db.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_case_open(
      ${input.actorUserId}::text,
      ${input.orderId}::text,
      ${input.reason}::text,
      ${input.description}::text
    ) AS result
  `;
  if (rows.length !== 1) {
    throw new TypeError(
      "Case-open authority returned an invalid row count",
    );
  }
  return validateCaseOpenResult(rows[0].result, input);
}
