// src/app/messages/page.tsx
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { getBlockedUserIdsFor } from "@/lib/blocks";
import MessageTime from "@/components/MessageTime";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };

function parseFilePayload(body: string):
  | { kind: "file"; url: string; name: string | null; type: string | null }
  | null {
  try {
    const obj = JSON.parse(body);
    if (obj && obj.kind === "file" && typeof obj.url === "string") {
      return {
        kind: "file",
        url: obj.url,
        name: obj.name ?? null,
        type: obj.type ?? null,
      };
    }
  } catch {}
  return null;
}

function isImageUrl(s: string) {
  return /^https?:\/\/.+\.(png|jpe?g|gif|webp|avif)$/i.test(s.trim());
}
function isPdfUrl(s: string) {
  return /^https?:\/\/.+\.pdf$/i.test(s.trim());
}

function formatSnippet(body?: string | null) {
  const txt = (body ?? "").toString();
  if (!txt) return "No messages yet";

  const f = parseFilePayload(txt.trim());
  if (f) {
    const isImg = (f.type?.startsWith("image/") ?? false) || isImageUrl(f.url);
    if (isImg) return "Photo";
    if (f.type === "application/pdf" || isPdfUrl(f.url)) return f.name ?? "PDF";
    return f.name ?? "Attachment";
  }

  // Detect structured message types by JSON shape
  try {
    const obj = JSON.parse(txt.trim());
    if (obj && typeof obj === "object") {
      if (obj.commissionId) return "Interested in your commission";
      if (obj.description && (obj.timeline !== undefined || obj.budget !== undefined)) return "Custom order request";
      if (obj.listingId && obj.priceCents !== undefined) return "Custom listing ready";
    }
  } catch {}

  if (isImageUrl(txt)) return "Photo";
  if (isPdfUrl(txt)) return "PDF";
  return txt;
}

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string }>;
}) {
  const { tab = "inbox", q = "" } = await searchParams;

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
      userA: { select: { id: true, name: true, email: true, imageUrl: true } },
      userB: { select: { id: true, name: true, email: true, imageUrl: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, body: true, createdAt: true, senderId: true },
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
    return { c, other, latest, unreadCount, latestFromMe, ctxThumb };
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
            className={`rounded-full border px-3 py-1 text-sm hover:bg-neutral-50 ${
              tab === "inbox" ? "bg-neutral-900 text-white hover:bg-neutral-900" : ""
            }`}
          >
            Inbox
          </Link>
          <Link
            href={withQ("/messages?tab=unread")}
            className={`rounded-full border px-3 py-1 text-sm hover:bg-neutral-50 ${
              tab === "unread" ? "bg-neutral-900 text-white hover:bg-neutral-900" : ""
            }`}
          >
            Unread{" "}
            {unreadTotal > 0 && (
              <span className="ml-1 rounded-full bg-red-600 px-2 py-[2px] text-xs text-white">
                {unreadTotal}
              </span>
            )}
          </Link>
          <Link
            href={withQ("/messages?tab=sent")}
            className={`rounded-full border px-3 py-1 text-sm hover:bg-neutral-50 ${
              tab === "sent" ? "bg-neutral-900 text-white hover:bg-neutral-900" : ""
            }`}
          >
            Awaiting Reply{" "}
            {sentTotal > 0 && (
              <span className="ml-1 rounded-full bg-neutral-800 px-2 py-[2px] text-xs text-white">
                {sentTotal}
              </span>
            )}
          </Link>
          <Link
            href={withQ("/messages?tab=archived")}
            className={`rounded-full border px-3 py-1 text-sm hover:bg-neutral-50 ${
              tab === "archived" ? "bg-neutral-900 text-white hover:bg-neutral-900" : ""
            }`}
          >
            Archived
          </Link>
        </div>

        <form method="get" className="w-full sm:w-auto sm:ml-auto flex items-center gap-2">
          {/* keep current tab when searching */}
          {tab !== "inbox" && <input type="hidden" name="tab" value={tab} />}
          <div className="flex items-center gap-2 rounded-md border border-neutral-200 px-3 py-1.5 w-full sm:w-auto">
            <input
              name="q"
              defaultValue={q}
              placeholder="Search messages"
              className="w-full sm:w-52 bg-transparent text-sm outline-none"
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
        <div className="card-section p-6 text-neutral-600">
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
        <ul className="divide-y divide-neutral-100 card-section">
          {list.map(({ c, other, latest, unreadCount, ctxThumb }) => {
            const title = other?.name || other?.email || "User";
            const snippet = formatSnippet(latest?.body);
            const hasTime = !!latest;
            const isUnread = unreadCount > 0;

            return (
              <li key={c.id}>
                <Link
                  href={`/messages/${c.id}`}
                  className="block px-4 py-3 hover:bg-neutral-50"
                >
                  <div className="flex items-start gap-3">
                    {/* Avatar */}
                    <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-neutral-200">
                      {other?.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={other.imageUrl} alt="" className="h-full w-full object-cover" />
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

