import {
  buildCaseMessageHistoryCursor,
  CASE_MESSAGE_PAGE_SIZE,
  parseCaseMessageHistoryCursor,
} from "@/lib/caseMessageCursor";
import { listCaseMessagePage } from "@/lib/caseMessagePageAuthority";

export async function findCaseMessageHistoryPage(
  actorUserId: string,
  caseId: string,
  rawCursor?: string | string[],
) {
  const cursor = parseCaseMessageHistoryCursor(rawCursor);
  const rows = await listCaseMessagePage({
    actorUserId,
    caseId,
    cursor,
    limit: CASE_MESSAGE_PAGE_SIZE + 1,
  });

  const descendingPage = rows.slice(0, CASE_MESSAGE_PAGE_SIZE);
  const oldestVisible = descendingPage.at(-1);

  return {
    messages: descendingPage.reverse(),
    olderCursor:
      rows.length > CASE_MESSAGE_PAGE_SIZE && oldestVisible
        ? buildCaseMessageHistoryCursor(oldestVisible)
        : null,
    isHistoricalPage: cursor !== null,
  };
}
