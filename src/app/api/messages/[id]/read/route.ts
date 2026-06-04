import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";
import { markReadRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { privateJson, privateResponse } from "@/lib/privateResponse";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) return privateJson({ ok: false }, { status: 401 });

  let me: Awaited<ReturnType<typeof ensureUserByClerkId>>;
  try {
    me = await ensureUserByClerkId(userId);
  } catch (err) {
    if (isAccountAccessError(err)) {
      return privateJson({ error: err.message, code: err.code }, { status: err.status });
    }
    throw err;
  }

  const { success, reset } = await safeRateLimit(markReadRatelimit, `message:${me.id}`);
  if (!success) return privateResponse(rateLimitResponse(reset, "Too many read updates. Try again shortly."));

  // Ensure I’m a participant
  const convo = await prisma.conversation.findFirst({
    where: { id, OR: [{ userAId: me.id }, { userBId: me.id }] },
    select: { id: true },
  });
  if (!convo) return privateJson({ ok: false }, { status: 403 });

  await prisma.message.updateMany({
    where: { conversationId: id, recipientId: me.id, readAt: null },
    data: { readAt: new Date() },
  });

  return privateJson({ ok: true });
}
