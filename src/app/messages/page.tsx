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
import type { Metadata } from "next";

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

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string }>;
}) {
  const { tab = "inbox", q: qParam = "" } = await searchParams;
  const q = truncateText(qParam.trim(), 200);

  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/messages");

  const me = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (!me) redirect("/sign-in?redirect_url=/messages");

  const blockedUserIds = await getBlockedUserIdsFor(me.id);

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
  const where: Prisma.ConversationWhereInput = {
    AND: [
      participationFilter,
      // Hide empty conversations from the inbox. `/messages/new?to=X` creates
      // a conversation row up-front (so context/listing attaches atomically),
      // but if the buyer never sends a message the thread shouldn't appear in
      // either party's inbox. The thread becomes visible automatically once
      // someone sends the first message.
      { messages: { some: {} } },
      q
        ? {
            OR: [
              {
                userA: {
                  OR: [
                    { name: { contains: q, mode: "insensitive" } },
                    { email: { contains: q, mode: "insensitive" } },
                  ],
                },
              },
              {
                userB: {
                  OR: [
                    { name: { contains: q, mode: "insensitive" } },
                    { email: { contains: q, mode: "insensitive" } },
                  ],
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

  // Pull conversations newest-first with one latest message + listing context thumb
  const convos = await prisma.conversation.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 50,
    include: {
      userA: { select: { id: true, name: true, imageUrl: true } },
      userB: { select: { id: true, name: true, imageUrl: true } },
      messages: {
        orderBy: { createdAt: "desc" },
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

  // Unread counts in one query
  const unread = await prisma.message.groupBy({
    by: ["conversationId"],
    where: { recipientId: me.id, readAt: null },
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
          <div className="flex items-center gap-2 rounded-full border-2 border-stone-400 bg-white px-4 py-1.5 w-full sm:w-auto shadow-sm focus-within:border-stone-600 focus-within:shadow-md transition-shadow">
            <input
              name="q"
              defaultValue={q}
              maxLength={200}
              placeholder="Search messages"
              className="w-full sm:w-52 bg-transparent text-sm outline-none focus:outline-none focus-visible:outline-none focus-visible:shadow-none"
            />
            {q ? (
              <Link
                href={tab === "inbox" ? "/messages" : `/messages?tab=${tab}`}
                className="text-xs text-neutral-500 hover:underline"
              >
                Clear
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
                          <span className="ml-2 rounded-full border px-2 py-[2px] text-[11px] text-neutral-600">
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
    </main>
  );
}
