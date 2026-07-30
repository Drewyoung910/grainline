import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  validateCaseReplyResult,
  type CaseReplyResult,
} from "@/lib/caseReplyResult";

type CaseReplyClient = Pick<typeof prisma, "$queryRaw">;

export async function replyToCaseWithFixedAuthority(
  input: {
    actorUserId: string;
    caseId: string;
    body: string;
    verifiedAttachments: readonly {
      directUploadId: string;
      contentType: string;
      byteSize: number;
    }[];
  },
  db: CaseReplyClient = prisma,
): Promise<CaseReplyResult> {
  const uploadIds = input.verifiedAttachments.length > 0
    ? Prisma.sql`ARRAY[${Prisma.join(
        input.verifiedAttachments.map(({ directUploadId }) => directUploadId),
      )}]::text[]`
    : Prisma.sql`ARRAY[]::text[]`;
  const rows = await db.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_case_reply(
      ${input.actorUserId}::text,
      ${input.caseId}::text,
      ${input.body}::text,
      ${uploadIds}
    ) AS result
  `;
  if (rows.length !== 1) {
    throw new TypeError("Case-reply authority returned an invalid row count");
  }
  return validateCaseReplyResult(rows[0].result, {
    actorUserId: input.actorUserId,
    caseId: input.caseId,
    attachments: input.verifiedAttachments,
  });
}
