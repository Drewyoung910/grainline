import { prisma } from "@/lib/db";
import {
  validateCaseMessagePageRows,
  type CaseMessagePageRow,
} from "@/lib/caseMessagePageResult";
import type { CaseMessageHistoryCursor } from "@/lib/caseMessageCursor";
import { normalizeDbUserContextUserId } from "@/lib/dbUserContextState";

type CaseMessagePageClient = Pick<typeof prisma, "$queryRaw">;

function isBoundedId(value: string) {
  return /^[A-Za-z0-9._:-]{1,191}$/.test(value);
}

export async function listCaseMessagePage(
  input: {
    actorUserId: string;
    caseId: string;
    cursor: CaseMessageHistoryCursor | null;
    limit: number;
  },
  db: CaseMessagePageClient = prisma,
): Promise<CaseMessagePageRow[]> {
  const actorUserId = normalizeDbUserContextUserId(input.actorUserId);
  if (
    !isBoundedId(input.caseId)
    || !Number.isSafeInteger(input.limit)
    || input.limit < 1
    || input.limit > 51
    || (
      input.cursor !== null
      && (
        !(input.cursor.createdAt instanceof Date)
        || !Number.isFinite(input.cursor.createdAt.getTime())
        || !isBoundedId(input.cursor.id)
      )
    )
  ) {
    throw new TypeError("Case-message page authority input is invalid");
  }

  const rows = await db.$queryRaw<unknown[]>`
    SELECT *
      FROM public.grainline_case_message_page(
        ${actorUserId}::text,
        ${input.caseId}::text,
        ${input.cursor?.createdAt ?? null}::timestamp,
        ${input.cursor?.id ?? null}::text,
        ${input.limit}::integer
      )
  `;
  return validateCaseMessagePageRows(rows);
}
