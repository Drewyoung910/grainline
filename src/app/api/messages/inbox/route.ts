// src/app/api/messages/inbox/route.ts
// The newest conversations for the desktop list beside an open thread.
import { auth } from "@clerk/nextjs/server";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { countActorUnreadMessages, listActorConversationInbox } from "@/lib/conversationMessageAuthority";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { messageSearchQuery } from "@/lib/messageInputState";
import { formatSnippet } from "@/lib/messageSnippet";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { messageInboxRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { truncateText } from "@/lib/sanitize";
import { sellerConversationParticipantCards } from "@/lib/sellerProfileParticipantAccess";

const RAIL_CONVERSATIONS = 30;
const SNIPPET_LENGTH = 120;

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Sign in required" }, { status: 401 });

  const { success, reset } = await safeRateLimit(messageInboxRatelimit, userId);
  if (!success) return privateResponse(rateLimitResponse(reset, "Too many message reads."));

  let me: Awaited<ReturnType<typeof ensureUserByClerkId>>;
  try {
    me = await ensureUserByClerkId(userId);
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;
    throw err;
  }

  const url = new URL(request.url);
  const rawTab = url.searchParams.get("tab") ?? "inbox";
  const tab = rawTab === "unread" || rawTab === "sent" || rawTab === "archived"
    ? rawTab
    : "inbox";
  const query = messageSearchQuery(url.searchParams.get("q"));
  const archived = tab === "archived";
  const [conversations, unreadTotal] = await Promise.all([
    listActorConversationInbox(me.id, {
      archived,
      query,
      cursor: null,
      limit: RAIL_CONVERSATIONS + 1,
    }),
    countActorUnreadMessages(me.id),
  ]);
  const tabConversations = tab === "unread"
    ? conversations.filter((conversation) => conversation.unreadCount > 0)
    : tab === "sent"
      ? conversations.filter((conversation) => conversation.latestMessage?.senderId === me.id)
      : conversations;
  const visibleConversations = tabConversations.slice(0, RAIL_CONVERSATIONS);

  const summaryConversations = archived || query
    ? await listActorConversationInbox(me.id, {
        archived: false,
        query: "",
        cursor: null,
        limit: RAIL_CONVERSATIONS + 1,
      })
    : conversations;
  const otherUserIds = Array.from(new Set(
    visibleConversations.map((conversation) =>
      conversation.userAId === me.id ? conversation.userB.id : conversation.userA.id),
  ));
  const sellers = await sellerConversationParticipantCards(me.id, otherUserIds);
  const sellerByUserId = new Map(sellers.map((seller) => [seller.userId, seller]));

  return privateJson({
    // Keep the path to the full inbox whenever this compact read was
    // truncated. A tab may have no matches among the newest conversations
    // even though older matching conversations exist.
    hasMore: conversations.length > RAIL_CONVERSATIONS,
    unreadTotal,
    awaitingReplyTotal: summaryConversations.filter(
      (conversation) => conversation.latestMessage?.senderId === me.id,
    ).length,
    awaitingReplyMore: summaryConversations.length > RAIL_CONVERSATIONS,
    conversations: visibleConversations.map((conversation) => {
      const other = conversation.userAId === me.id ? conversation.userB : conversation.userA;
      const seller = sellerByUserId.get(other.id) ?? null;
      const latest = conversation.latestMessage;
      return {
        id: conversation.id,
        title: seller?.displayName || other.name || "User",
        avatarUrl: seller?.avatarImageUrl || other.imageUrl || null,
        snippet: truncateText(formatSnippet(latest?.body, latest?.kind), SNIPPET_LENGTH),
        latestAt: latest?.createdAt ?? null,
        unreadCount: conversation.unreadCount,
        latestFromMe: latest?.senderId === me.id,
      };
    }),
  });
}
