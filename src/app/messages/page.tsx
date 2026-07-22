// src/app/messages/page.tsx
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { getBlockedUserIdsFor } from "@/lib/blocks";
import { parseFileMessageBody } from "@/lib/messageBodies";
import { truncateText } from "@/lib/sanitize";
import MessageTime from "@/components/MessageTime";
import { Search, X } from "@/components/icons";
import { Suspense } from "react";
import type { Metadata } from "next";
import { parseMessageCursor } from "@/lib/messageCursor";

export const metadata: Metadata = { robots: { index: false, follow: false } };

function isImageUrl(s: string) {
  return /^https?:\/\/.+\.(png|jpe?g|gif|webp|avif)$/i.test(s.trim());
}
function isPdfUrl(s: string) {
  return /^https?:\/\/.+\.pdf$/i.test(s.trim());
}

function formatSnippet(body?: string | null, kind?: string | null) {
  const txt = (body ?? "").toString();
  if (!txt) return "No messages yet";

  const f = parseFileMessageBody(txt.trim());
  if (f) {
    const isImg = (f.type?.startsWith("image/") ?? false) || isImageUrl(f.url);
    if (isImg) return "Photo";
    if (f.type === "application/pdf" || isPdfUrl(f.url)) return f.name ?? "PDF";
    return f.name ?? "Attachment";
  }

  if (kind === "commission_interest_card") return "Interested in your commission";
  if (kind === "custom_order_request") return "Custom order request";
  if (kind === "custom_order_link") return "Custom listing ready";

  if (isImageUrl(txt)) return "Photo";
  if (isPdfUrl(txt)) return "PDF";
  return txt;
}

type MessagesPageProps = {
  searchParams: Promise<{ tab?: string; q?: string; before?: string; beforeId?: string }>;
};

function MessagesInboxSkeleton() {
  return (
    <main className="mx-auto max-w-4xl p-8" aria-busy="true" aria-label="Loading messages">
      <div className="mb-6 flex items-end justify-between">
        <div className="h-8 w-36 rounded-md bg-[#EFEAE0] animate-pulse" />
        <div className="h-4 w-28 rounded bg-[#EFEAE0] animate-pulse" />
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-8 w-20 rounded-full bg-[#EFEAE0] animate-pulse"
            />
          ))}
        </div>
        <div className="h-11 w-full rounded-full bg-[#EFEAE0] animate-pulse sm:ml-auto sm:w-64" />
      </div>

      <ul className="divide-y divide-stone-300/50 overflow-hidden rounded-lg bg-[#EFEAE0]">
        {Array.from({ length: 6 }).map((_, index) => (
          <li key={index} className="px-4 py-3">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 shrink-0 rounded-full bg-white/70 animate-pulse" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-4 w-2/5 rounded bg-white/70 animate-pulse" />
                <div className="h-3 w-3/5 rounded bg-white/70 animate-pulse" />
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-white/70 animate-pulse" />
                <div className="hidden h-3 w-16 rounded bg-white/70 animate-pulse sm:block" />
              </div>
            </div>
          </li>
        ))}
      </ul>
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
  const { tab = "inbox", q: qParam = "", before, beforeId } = await searchParams;
  const q = truncateText(qParam.trim(), 200);
  const pageCursor = parseMessageCursor(before, beforeId, { requireId: true });

  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/messages");

  const me = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (!me) redirect("/sign-in?redirect_url=/messages");

  const blockedUserIds = await getBlockedUserIdsFor(me.id);
  const blockedUserIdList = [...blockedUserIds];

  const isArchivedTab = tab === "archived";

  // Participation + archived filter depending on tab
  const participationFilter = isArchivedTab
    ? {
        OR: [
          { AND: [{ userAId: me.id }, { NOT: { archivedAAt: null } }] },
          { AND: [{ userBId: me.id }, { NOT: { archivedBAt: null } }] },
        ],
      }
    : {
        OR: [
          { AND: [{ userAId: me.id }, { archivedAAt: null }] },
          { AND: [{ userBId: me.id }, { archivedBAt: null }] },
        ],
      };

  // Build dynamic where with optional search
  const baseWhere: Prisma.ConversationWhereInput = {
    AND: [
      participationFilter,
      // Hide empty conversations from the inbox. `/messages/new?to=X` creates
      // a conversation row up-front (so context/listing attaches atomically),
      // but if the buyer never sends a message the thread shouldn't appear in
      // either party's inbox. The thread becomes visible automatically once
      // someone sends the first message.
      { messages: { some: {} } },
      blockedUserIdList.length > 0
        ? {
            userAId: { notIn: blockedUserIdList },
            userBId: { notIn: blockedUserIdList },
          }
        : {},
      q
        ? {
            OR: [
              {
                userA: {
                  name: { contains: q, mode: "insensitive" },
                },
              },
              {
                userB: {
                  name: { contains: q, mode: "insensitive" },
                },
              },
              { contextListing: { title: { contains: q, mode: "insensitive" } } },
              // any message in the conversation
              { messages: { some: { body: { contains: q, mode: "insensitive" } } } },
            ],
          }
        : {},
    ],
  };
  const where: Prisma.ConversationWhereInput = {
    AND: [
      baseWhere,
      pageCursor
        ? {
            OR: [
              { updatedAt: { lt: pageCursor.createdAt } },
              { updatedAt: pageCursor.createdAt, id: { lt: pageCursor.id! } },
            ],
          }
        : {},
    ],
  };

  // Pull conversations newest-first with one latest message + listing context thumb
  const conversationRows = await prisma.conversation.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 51,
    include: {
      userA: { select: { id: true, name: true, imageUrl: true } },
      userB: { select: { id: true, name: true, imageUrl: true } },
      messages: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { id: true, body: true, kind: true, createdAt: true, senderId: true },
      },
      contextListing: {
        select: {
          id: true,
          title: true,
          photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
        },
      },
    },
  });
  const hasMoreConversations = conversationRows.length > 50;
  const convos = conversationRows.slice(0, 50);

  // Unread counts in one query
  const unread = await prisma.message.groupBy({
    by: ["conversationId"],
    where: { recipientId: me.id, readAt: null, conversation: { is: baseWhere } },
    _count: { _all: true },
  });
  const unreadByConvo = new Map<string, number>(
    unread.map((u) => [u.conversationId, u._count._all]),
  );

  // Prefer the seller's shop display name + custom avatar over Clerk's
  // imageUrl + legal name whenever the other party is a seller. Fetch all
  // seller profiles for the conversation partners in one query.
  const otherUserIds = Array.from(
    new Set(
      convos
        .map((c) => (c.userAId === me.id ? c.userB?.id : c.userA?.id))
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const sellerProfiles = otherUserIds.length
    ? await prisma.sellerProfile.findMany({
        where: { userId: { in: otherUserIds } },
        select: { userId: true, displayName: true, avatarImageUrl: true },
      })
    : [];
  const sellerByUserId = new Map(sellerProfiles.map((s) => [s.userId, s]));

  // Enrich for rendering — exclude conversations with blocked users
  const enrich = convos.filter((c) => {
    const other = c.userAId === me.id ? c.userB : c.userA;
    return !blockedUserIds.has(other.id);
  }).map((c) => {
    const other = c.userAId === me.id ? c.userB : c.userA;
    const latest = c.messages[0] || null;
    const unreadCount = unreadByConvo.get(c.id) || 0;
    const latestFromMe = latest?.senderId === me.id;
    const ctxThumb = c.contextListing?.photos?.[0]?.url ?? null;
    const seller = sellerByUserId.get(other.id) ?? null;
    return { c, other, latest, unreadCount, latestFromMe, ctxThumb, seller };
  });

  const inboxList = enrich;
  const unreadList = isArchivedTab ? [] : enrich.filter((x) => x.unreadCount > 0);
  const sentList = isArchivedTab ? [] : enrich.filter((x) => x.latestFromMe);

  const unreadTotal = unreadList.reduce((n, x) => n + x.unreadCount, 0);
  const sentTotal = sentList.length;

  const list =
    tab === "unread" ? unreadList : tab === "sent" ? sentList : tab === "archived" ? enrich : inboxList;

  // Helper to preserve ?q= across tab links
  const withQ = (base: string) =>
    q ? `${base}${base.includes("?") ? "&" : "?"}q=${encodeURIComponent(q)}` : base;
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
    <main className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-end justify-between">
        <h1 className="text-2xl font-semibold font-display">Messages</h1>
        <Link href="/browse" className="text-sm underline">
          Back to browse
        </Link>
      </div>

      {/* Tabs + Search */}
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex flex-wrap gap-2">
          <Link
            href={withQ("/messages")}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === "inbox"
                ? "bg-neutral-900 text-white"
                : "bg-[#EFEAE0] text-neutral-800 hover:bg-[#E3DCCB]"
            }`}
          >
            Inbox
          </Link>
          <Link
            href={withQ("/messages?tab=unread")}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === "unread"
                ? "bg-neutral-900 text-white"
                : "bg-[#EFEAE0] text-neutral-800 hover:bg-[#E3DCCB]"
            }`}
          >
            Unread
            {unreadTotal > 0 && (
              <span className="ml-1.5 rounded-full bg-red-600 px-2 py-[1px] text-xs text-white">
                {unreadTotal}
              </span>
            )}
          </Link>
          <Link
            href={withQ("/messages?tab=sent")}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === "sent"
                ? "bg-neutral-900 text-white"
                : "bg-[#EFEAE0] text-neutral-800 hover:bg-[#E3DCCB]"
            }`}
          >
            Awaiting Reply
            {sentTotal > 0 && (
              <span className={`ml-1.5 rounded-full px-2 py-[1px] text-xs ${tab === "sent" ? "bg-white text-neutral-900" : "bg-neutral-800 text-white"}`}>
                {sentTotal}
              </span>
            )}
          </Link>
          <Link
            href={withQ("/messages?tab=archived")}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === "archived"
                ? "bg-neutral-900 text-white"
                : "bg-[#EFEAE0] text-neutral-800 hover:bg-[#E3DCCB]"
            }`}
          >
            Archived
          </Link>
        </div>

        <form method="get" className="w-full sm:w-auto sm:ml-auto flex items-center gap-2">
          {/* keep current tab when searching */}
          {tab !== "inbox" && <input type="hidden" name="tab" value={tab} />}
          <div className="flex min-h-11 w-full items-center overflow-hidden rounded-full border-2 border-stone-400 bg-white shadow-sm transition-shadow focus-within:border-stone-600 focus-within:shadow-md sm:w-auto">
            <button
              type="submit"
              aria-label="Search messages"
              className="group flex min-w-11 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:text-neutral-900 focus-visible:outline-none"
            >
              <span
                aria-hidden="true"
                className="flex size-9 items-center justify-center rounded-full transition-colors group-hover:bg-neutral-100 group-active:bg-neutral-200/70 group-focus-visible:ring-2 group-focus-visible:ring-neutral-900/20"
              >
                <Search size={17} />
              </span>
            </button>
            <input
              name="q"
              defaultValue={q}
              maxLength={200}
              placeholder="Search messages"
              className="min-w-0 flex-1 bg-transparent py-2 pr-2 text-sm outline-none focus:outline-none focus-visible:outline-none focus-visible:shadow-none sm:w-52"
            />
            {q ? (
              <Link
                href={tab === "inbox" ? "/messages" : `/messages?tab=${tab}`}
                aria-label="Clear message search"
                className="group flex min-w-11 items-center justify-center rounded-full text-neutral-400 transition-colors hover:text-neutral-700 focus-visible:outline-none"
              >
                <span
                  aria-hidden="true"
                  className="flex size-9 items-center justify-center rounded-full transition-colors group-hover:bg-neutral-100 group-active:bg-neutral-200/70 group-focus-visible:ring-2 group-focus-visible:ring-neutral-900/20"
                >
                  <X size={15} />
                </span>
              </Link>
            ) : null}
          </div>
        </form>
      </div>

      {list.length === 0 ? (
        <div className="rounded-lg bg-[#EFEAE0] p-6 text-neutral-700">
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
        <ul className="divide-y divide-stone-300/50 rounded-lg bg-[#EFEAE0] overflow-hidden">
          {list.map(({ c, other, latest, unreadCount, ctxThumb, seller }) => {
            // Prefer seller display name + avatar when the other party is a
            // seller. Falls back to Clerk name/imageUrl for buyer-only users.
            const title = seller?.displayName || other?.name || "User";
            const avatarUrl = seller?.avatarImageUrl || other?.imageUrl || null;
            const snippet = formatSnippet(latest?.body, latest?.kind);
            const hasTime = !!latest;
            const isUnread = unreadCount > 0;

            return (
              <li key={c.id}>
                <Link
                  href={`/messages/${c.id}`}
                  className="block px-4 py-3 hover:bg-[#E3DCCB] transition-colors"
                >
                  <div className="flex items-start gap-3">
                    {/* Avatar */}
                    <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-neutral-200 ring-1 ring-neutral-200">
                      {avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : null}
                    </div>

                    {/* Main */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className={`truncate ${isUnread ? "font-semibold" : ""}`}>
                          {title}
                        </div>
                        {isUnread ? (
                          <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs text-white">
                            {unreadCount}
                          </span>
                        ) : null}
                        {tab === "archived" ? (
                          <span className="ml-2 rounded-full bg-[#EFEAE0] px-2.5 py-[2px] text-[11px] font-medium text-neutral-600">
                            Archived
                          </span>
                        ) : null}
                      </div>
                      <div className={`mt-1 truncate text-sm text-neutral-600 ${isUnread ? "font-semibold" : ""}`}>
                        {snippet}
                      </div>
                    </div>

                    {/* Context thumb + time */}
                    <div className="ml-auto flex shrink-0 items-center gap-3">
                      {ctxThumb ? (
                        <div className="h-10 w-10 overflow-hidden rounded-lg bg-neutral-100">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={ctxThumb} alt="" className="h-full w-full object-cover" />
                        </div>
                      ) : null}
                      {hasTime && (
                        <div className="hidden sm:block whitespace-nowrap text-xs text-neutral-500">
                          <MessageTime date={latest!.createdAt} />
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
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
    </main>
  );
}
