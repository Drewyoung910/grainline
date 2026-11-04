// src/app/messages/page.tsx
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { userIdByClerkId } from "@/lib/userIdentityAccess";
import { formatSnippet } from "@/lib/messageSnippet";
import { MessageCircle } from "@/components/icons";
import { Suspense } from "react";
import type { Metadata } from "next";
import { parseMessageCursor } from "@/lib/messageCursor";
import { listActorConversationInbox } from "@/lib/conversationMessageAuthority";
import { sellerConversationParticipantCards } from "@/lib/sellerProfileParticipantAccess";
import MessageInboxControls, { type MessageInboxTab } from "@/components/MessageInboxControls";
import { messageSearchQuery } from "@/lib/messageInputState";
import ConversationListItem from "@/components/ConversationListItem";

export const metadata: Metadata = { robots: { index: false, follow: false } };

type MessagesPageProps = {
  searchParams: Promise<{ tab?: string; q?: string; before?: string; beforeId?: string }>;
};

function MessagesInboxSkeleton() {
  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-8 lg:grid lg:max-w-[1280px] lg:grid-cols-[400px_minmax(0,1fr)] lg:items-start lg:gap-8 lg:px-6" aria-busy="true" aria-label="Loading messages">
      <section className="overflow-hidden rounded-3xl border border-[#2C1F1A]/10 bg-[#F2EEE6]/80 shadow-[0_12px_34px_-30px_rgba(44,31,26,0.75)]">
        <div className="border-b border-[#2C1F1A]/10 p-3">
          <div className="mb-3 flex items-center justify-between px-1">
            <div className="h-7 w-28 animate-pulse rounded-md bg-white/70 motion-reduce:animate-none" />
            <div className="h-4 w-24 animate-pulse rounded bg-white/70 motion-reduce:animate-none" />
          </div>
          <div className="grid grid-cols-4 gap-1 rounded-full bg-[#EFEAE0] p-1">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-8 animate-pulse rounded-full bg-white/60 motion-reduce:animate-none" />
            ))}
          </div>
          <div className="mt-3 h-11 w-full animate-pulse rounded-full bg-white/70 motion-reduce:animate-none" />
        </div>
        <ul className="grid gap-0.5 p-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <li key={index} className="flex items-center gap-2.5 rounded-xl px-3 py-3">
              <div className="size-10 shrink-0 animate-pulse rounded-full bg-white/70 motion-reduce:animate-none" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3.5 w-2/3 animate-pulse rounded bg-white/70 motion-reduce:animate-none" />
                <div className="h-3 w-5/6 animate-pulse rounded bg-white/70 motion-reduce:animate-none" />
              </div>
            </li>
          ))}
        </ul>
      </section>
      <div className="hidden min-h-[420px] animate-pulse rounded-2xl border border-stone-200/60 bg-white/30 motion-reduce:animate-none lg:block" />
    </main>
  );
}

export default function MessagesPage(props: MessagesPageProps) {
  return (
    <Suspense fallback={<MessagesInboxSkeleton />}>
      <MessagesInbox {...props} />
    </Suspense>
  );
}

async function MessagesInbox({
  searchParams,
}: MessagesPageProps) {
  const { tab: rawTab = "inbox", q: qParam = "", before, beforeId } = await searchParams;
  const tab: MessageInboxTab = rawTab === "unread" || rawTab === "sent" || rawTab === "archived"
    ? rawTab
    : "inbox";
  const q = messageSearchQuery(qParam);
  const pageCursor = parseMessageCursor(before, beforeId, { requireId: true });

  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/messages");

  const me = await userIdByClerkId(prisma, userId);
  if (!me) redirect("/sign-in?redirect_url=/messages");

  const isArchivedTab = tab === "archived";
  // The fixed projection applies participant, archive, reciprocal-block,
  // non-empty-thread, search and stable keyset bounds in one statement.
  const currentRowsPromise = listActorConversationInbox(me.id, {
    archived: isArchivedTab,
    query: q,
    cursor: pageCursor,
    limit: 51,
  });
  // Tabs describe the active inbox even while someone is viewing archived or
  // searched results. Reuse the current read whenever it already represents
  // that inbox; only issue the second bounded read when needed.
  const summaryRowsPromise = isArchivedTab || q
    ? listActorConversationInbox(me.id, { archived: false, query: "", cursor: null, limit: 51 })
    : currentRowsPromise;
  const [conversationRows, summaryRows] = await Promise.all([currentRowsPromise, summaryRowsPromise]);
  const hasMoreConversations = conversationRows.length > 50;
  const convos = conversationRows.slice(0, 50);

  // Prefer the seller's shop display name + custom avatar over Clerk's
  // imageUrl + legal name whenever the other party is a seller. Fetch all
  // seller profiles for the conversation partners in one query.
  const otherUserIds = Array.from(
    new Set(
      convos
        .map((c) => (c.userAId === me.id ? c.userB.id : c.userA.id))
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const sellerProfiles = await sellerConversationParticipantCards(me.id, otherUserIds);
  const sellerByUserId = new Map(sellerProfiles.map((s) => [s.userId, s]));

  const enrich = convos.map((c) => {
    const other = c.userAId === me.id ? c.userB : c.userA;
    const latest = c.latestMessage;
    const unreadCount = c.unreadCount;
    const latestFromMe = latest?.senderId === me.id;
    const ctxThumb = c.contextListing?.photoUrl ?? null;
    const seller = sellerByUserId.get(other.id) ?? null;
    return { c, other, latest, unreadCount, latestFromMe, ctxThumb, seller };
  });

  const inboxList = enrich;
  const unreadList = isArchivedTab ? [] : enrich.filter((x) => x.unreadCount > 0);
  const sentList = isArchivedTab ? [] : enrich.filter((x) => x.latestFromMe);

  const unreadTotal = summaryRows.reduce((total, conversation) => total + conversation.unreadCount, 0);
  const sentTotal = summaryRows.filter((conversation) => conversation.latestMessage?.senderId === me.id).length;

  const list =
    tab === "unread" ? unreadList : tab === "sent" ? sentList : tab === "archived" ? enrich : inboxList;

  const oldestConversation = convos[convos.length - 1];
  const olderConversationsHref = oldestConversation
    ? (() => {
        const params = new URLSearchParams();
        if (tab !== "inbox") params.set("tab", tab);
        if (q) params.set("q", q);
        params.set("before", String(oldestConversation.updatedAt.getTime()));
        params.set("beforeId", oldestConversation.id);
        return `/messages?${params.toString()}`;
      })()
    : null;

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-8 lg:grid lg:max-w-[1280px] lg:grid-cols-[400px_minmax(0,1fr)] lg:items-start lg:gap-8 lg:px-6">
      <section className="min-w-0 overflow-hidden rounded-3xl border border-[#2C1F1A]/10 bg-[#F2EEE6]/80 shadow-[0_12px_34px_-30px_rgba(44,31,26,0.75)]">
        <div className="border-b border-[#2C1F1A]/10 p-3">
          <div className="mb-3 flex items-center justify-between px-1">
            <h1 className="font-display text-xl">Messages</h1>
            <Link href="/browse" className="text-sm text-neutral-600 underline-offset-4 hover:underline">
              Back to browse
            </Link>
          </div>
          <MessageInboxControls
            tab={tab}
            query={q}
            unreadTotal={unreadTotal}
            awaitingReplyTotal={sentTotal}
          />
        </div>

        <div className="p-2">
          {list.length === 0 ? (
            <div className="rounded-2xl bg-white/60 p-6 text-neutral-700">
              {q ? (
                <>
                  No results for “<span className="font-medium">{q}</span>”.
                </>
              ) : tab === "unread" ? (
                <>No unread messages.</>
              ) : tab === "sent" ? (
                <>No conversations yet — reach out to a maker about their work.</>
              ) : tab === "archived" ? (
                <>No archived conversations.</>
              ) : (
                <>No conversations yet — reach out to a maker about their work.</>
              )}
            </div>
          ) : (
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
              {list.map(({ c, other, latest, unreadCount, ctxThumb, seller }) => {
                // Prefer seller display name + avatar when the other party is a
                // seller. Falls back to Clerk name/imageUrl for buyer-only users.
                const title = seller?.displayName || other?.name || "User";
                const avatarUrl = seller?.avatarImageUrl || other?.imageUrl || null;
                const snippet = formatSnippet(latest?.body, latest?.kind);

                return (
                  <ConversationListItem
                    key={c.id}
                    id={c.id}
                    title={title}
                    avatarUrl={avatarUrl}
                    snippet={snippet}
                    latestAt={latest?.createdAt ?? null}
                    unreadCount={unreadCount}
                    archived={tab === "archived"}
                    contextThumb={ctxThumb}
                  />
                );
              })}
            </ul>
          )}
          {hasMoreConversations && olderConversationsHref && (
            <div className="mt-4 flex justify-center">
              <Link
                href={olderConversationsHref}
                className="inline-flex min-h-[40px] items-center rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Older conversations
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* Desktop: the thread opens here once a conversation is chosen. */}
      <div className="sticky top-[calc(var(--site-header-offset)+1.5rem)] hidden min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-stone-300/70 px-6 text-center lg:flex">
        <span className="flex size-12 items-center justify-center rounded-full bg-[#EFEAE0] text-neutral-600">
          <MessageCircle size={22} />
        </span>
        <p className="mt-3 font-medium text-neutral-900">Choose a conversation</p>
        <p className="mt-1 max-w-xs text-sm text-neutral-500">Your messages with makers and buyers open here.</p>
      </div>
    </main>
  );
}
