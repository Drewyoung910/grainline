import { prisma } from "@/lib/db";
import { normalizeDbUserContextUserId } from "@/lib/dbUserContextState";
import { listCaseMessagePage } from "@/lib/caseMessagePageAuthority";
import type { CaseMessagePageRow } from "@/lib/caseMessagePageResult";
import {
  validateCaseAccountExportPage,
  type CaseAccountExportRow,
} from "@/lib/caseAccountExportResult";

type CaseAccountExportClient = Pick<typeof prisma, "$queryRaw">;

const CASE_EXPORT_PAGE_SIZE = 25;
const MESSAGE_EXPORT_PAGE_SIZE = 51;

function compareAscending(
  left: { createdAt: Date; id: string },
  right: { createdAt: Date; id: string },
) {
  const time = left.createdAt.getTime() - right.createdAt.getTime();
  return time || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

async function listAllCaseMessagesForExport(
  actorUserId: string,
  caseId: string,
  db: CaseAccountExportClient,
) {
  const messages: CaseMessagePageRow[] = [];
  const ids = new Set<string>();
  let cursor: { createdAt: Date; id: string } | null = null;
  while (true) {
    const page = await listCaseMessagePage({
      actorUserId,
      caseId,
      cursor,
      limit: MESSAGE_EXPORT_PAGE_SIZE,
    }, db);
    if (page.length === 0) break;
    for (const message of page) {
      if (ids.has(message.id)) {
        throw new TypeError("Case account-export message page repeated an id");
      }
      ids.add(message.id);
      messages.push(message);
    }
    if (page.length < MESSAGE_EXPORT_PAGE_SIZE) break;
    const last = page[page.length - 1];
    if (
      cursor
      && compareAscending(cursor, last) <= 0
    ) {
      throw new TypeError(
        "Case account-export message cursor did not advance",
      );
    }
    cursor = { createdAt: last.createdAt, id: last.id };
  }
  return messages.sort(compareAscending);
}

export async function exportParticipantCases(
  actorUserIdInput: string,
  db: CaseAccountExportClient = prisma,
): Promise<CaseAccountExportRow[]> {
  const actorUserId = normalizeDbUserContextUserId(actorUserIdInput);
  const exported: CaseAccountExportRow[] = [];
  const ids = new Set<string>();
  let cursor: { createdAt: Date; id: string } | null = null;

  while (true) {
    const rows = await db.$queryRaw<unknown[]>`
      SELECT *
        FROM public.grainline_case_export_page(
          ${actorUserId}::text,
          ${cursor?.createdAt ?? null}::timestamp,
          ${cursor?.id ?? null}::text,
          ${CASE_EXPORT_PAGE_SIZE}::integer
        )
    `;
    const page = validateCaseAccountExportPage(rows, {
      actorUserId,
      cursor,
    });
    if (page.length === 0) break;
    for (const caseRow of page) {
      if (ids.has(caseRow.id)) {
        throw new TypeError("Case account-export page repeated an id");
      }
      ids.add(caseRow.id);
      exported.push({
        ...caseRow,
        messages: await listAllCaseMessagesForExport(
          actorUserId,
          caseRow.id,
          db,
        ),
      });
    }
    if (page.length < CASE_EXPORT_PAGE_SIZE) break;
    const last = page[page.length - 1];
    cursor = { createdAt: last.createdAt, id: last.id };
  }

  return exported;
}
