// src/app/api/messages/[id]/list/route.ts
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";
import { messageListRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { MESSAGE_POLL_LIMIT } from "@/lib/messagePolling";
import {
  messageAfterCursorWhere,
  messageBeforeCursorWhere,
  parseMessageCursor,
} from "@/lib/messageCursor";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { userId } = await auth();
  if (!userId) return privateJson({ ok: false }, { status: 401 });

  const { success, reset } = await safeRateLimit(messageListRatelimit, userId);
  if (!success) return privateResponse(rateLimitResponse(reset, "Too many message reads."));

  let me: Awaited<ReturnType<typeof ensureUserByClerkId>>;
  try {
    me = await ensureUserByClerkId(userId);
  } catch (err) {
    if (isAccountAccessError(err)) {
      return privateJson({ error: err.message, code: err.code }, { status: err.status });
    }
    throw err;
  }

  // Participants may read their thread. Staff get the same bounded read-only
  // history only while an unresolved report targets this exact thread.
  const belongs = await prisma.conversation.findFirst({
    where: { id, OR: [{ userAId: me.id }, { userBId: me.id }] },
    select: { id: true },
  });
  const isStaff = me.role === "ADMIN" || me.role === "EMPLOYEE";
  const reportedThread = !belongs && isStaff
    ? await prisma.userReport.findFirst({
        where: { targetType: "MESSAGE_THREAD", targetId: id, resolved: false },
        select: { id: true },
      })
    : null;
  if (!belongs && !reportedThread) return privateJson({ ok: false }, { status: 403 });

  const url = new URL(req.url);
  const beforeRaw = url.searchParams.get("before");
  const beforeIdRaw = url.searchParams.get("beforeId");
  const historyMode = beforeRaw !== null || beforeIdRaw !== null;
  const beforeCursor = historyMode
    ? parseMessageCursor(beforeRaw, beforeIdRaw, { requireId: true })
    : null;
  if (historyMode && !beforeCursor) {
    return privateJson({ error: "Invalid message cursor" }, { status: 400 });
  }
  const sinceRaw = url.searchParams.get("since");
  const sinceIdRaw = url.searchParams.get("sinceId");
  const sinceMode = !historyMode && (sinceRaw !== null || sinceIdRaw !== null);
  const sinceCursor = historyMode ? null : parseMessageCursor(sinceRaw, sinceIdRaw);
  if (sinceMode && !sinceCursor) {
    return privateJson({ error: "Invalid message cursor" }, { status: 400 });
  }

  const rows = await prisma.message.findMany({
    where: {
      conversationId: id,
      ...(beforeCursor
        ? messageBeforeCursorWhere(beforeCursor)
        : messageAfterCursorWhere(sinceCursor)),
    },
    orderBy: historyMode
      ? [{ createdAt: "desc" }, { id: "desc" }]
      : [{ createdAt: "asc" }, { id: "asc" }],
    take: historyMode ? MESSAGE_POLL_LIMIT + 1 : MESSAGE_POLL_LIMIT,
    select: {
      id: true,
      senderId: true,
      recipientId: true,
      body: true,
      kind: true,
      contextListing: { select: { id: true, title: true } },
      createdAt: true,
      readAt: true,
    },
  });

  const hasMoreBefore = historyMode && rows.length > MESSAGE_POLL_LIMIT;
  const messages = historyMode
    ? rows.slice(0, MESSAGE_POLL_LIMIT).reverse()
    : rows;
  return privateJson({ ok: true, messages, hasMoreBefore });
}
