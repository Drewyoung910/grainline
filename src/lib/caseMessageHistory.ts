import { prisma } from "@/lib/db";
import {
  buildCaseMessageHistoryCursor,
  CASE_MESSAGE_PAGE_SIZE,
  parseCaseMessageHistoryCursor,
} from "@/lib/caseMessageCursor";

export async function findCaseMessageHistoryPage(
  caseId: string,
  rawCursor?: string | string[],
) {
  const cursor = parseCaseMessageHistoryCursor(rawCursor);
  const rows = await prisma.caseMessage.findMany({
    where: {
      caseId,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: CASE_MESSAGE_PAGE_SIZE + 1,
    select: {
      id: true,
      authorId: true,
      authorKind: true,
      body: true,
      createdAt: true,
      attachments: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          contentType: true,
          byteSize: true,
          createdAt: true,
        },
      },
      author: {
        select: {
          id: true,
          name: true,
          role: true,
        },
      },
    },
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
