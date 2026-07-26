import { auth } from "@clerk/nextjs/server";
import {
  getActorConversation,
  markActorConversationMessagesRead,
} from "@/lib/conversationMessageAuthority";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";
import { markReadRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";
import { markOwnerMessageNotificationsRead } from "@/lib/notificationOwnerAccess";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
  if (crossOriginRejection) {
    return privateJson({ error: "Forbidden" }, { status: 403 });
  }

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

  // Staff report review is read-only; marking read remains participant-only.
  const conversation = await getActorConversation(me.id, id);
  const isParticipant = conversation
    && (conversation.userAId === me.id || conversation.userBId === me.id);
  if (!isParticipant) return privateJson({ ok: false }, { status: 403 });

  await markActorConversationMessagesRead(me.id, id);
  await markOwnerMessageNotificationsRead(me.id, id);

  return privateJson({ ok: true });
}
