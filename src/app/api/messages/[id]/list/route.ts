// src/app/api/messages/[id]/list/route.ts
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";
import { parseTimestampMsParam } from "@/lib/queryParams";
import { messageListRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { MESSAGE_POLL_LIMIT } from "@/lib/messagePolling";

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

  // Only if I’m in this conversation
  const belongs = await prisma.conversation.findFirst({
    where: { id, OR: [{ userAId: me.id }, { userBId: me.id }] },
    select: { id: true },
  });
  if (!belongs) return privateJson({ ok: false }, { status: 403 });

  const url = new URL(req.url);
  const sinceMs = parseTimestampMsParam(url.searchParams.get("since"));
  const sinceDate = sinceMs == null ? null : new Date(sinceMs);

  const messages = await prisma.message.findMany({
    where: {
      conversationId: id,
      ...(sinceDate ? { createdAt: { gt: sinceDate } } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MESSAGE_POLL_LIMIT,
    select: {
      id: true,
      senderId: true,
      recipientId: true,
      body: true,
      kind: true,
      createdAt: true,
      readAt: true,
    },
  });

  return privateJson({ ok: true, messages });
}
