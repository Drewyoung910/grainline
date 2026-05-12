// src/app/messages/[id]/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
import { sendNewMessageEmail } from "@/lib/email";
import ActionForm, { SubmitButton } from "@/components/ActionForm";
import MarkReadClient from "@/components/MarkReadClient";
import ThreadMessages from "@/components/ThreadMessages";
import MessageComposer from "@/components/MessageComposer";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };
import Link from "next/link";
import ThreadCustomOrderButton from "@/components/ThreadCustomOrderButton";
import BlockReportButton from "@/components/BlockReportButton";
import { normalizeMessageAttachments } from "@/lib/messageAttachments";
import { publicListingPath, publicSellerPath } from "@/lib/publicPaths";
import { isFirstPartyMediaUrl } from "@/lib/urlValidation";
import { messagingUnavailableReason } from "@/lib/messageRecipientState";
import { truncateText } from "@/lib/sanitize";

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { userId } = await auth();
  if (!userId) redirect(`/sign-in?redirect_url=/messages/${id}`);

  const me = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (!me) redirect(`/sign-in?redirect_url=/messages/${id}`);
  const isStaff = me.role === "ADMIN" || me.role === "EMPLOYEE";
  const reportedThread = isStaff
    ? await prisma.userReport.findFirst({
        where: { targetType: "MESSAGE_THREAD", targetId: id, resolved: false },
        select: { id: true },
      })
    : null;
  const canStaffReviewThread = !!reportedThread;

  const convo = await prisma.conversation.findFirst({
    where: canStaffReviewThread ? { id } : { id, OR: [{ userAId: me.id }, { userBId: me.id }] },
    include: {
      userA: { select: { id: true, name: true, email: true, imageUrl: true, banned: true, deletedAt: true } },
      userB: { select: { id: true, name: true, email: true, imageUrl: true, banned: true, deletedAt: true } },
      contextListing: {
        select: {
          id: true,
          title: true,
          priceCents: true,
          currency: true,
          photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
        },
      },
    },
  });
  if (!convo) return notFound();
  const isParticipant = convo.userAId === me.id || convo.userBId === me.id;
  const isStaffReviewMode = canStaffReviewThread && !isParticipant;

  // Auto-mark any unread NEW_MESSAGE notifications for this conversation as read
  if (isParticipant) {
    await prisma.notification.updateMany({
      where: {
        userId: me.id,
        type: "NEW_MESSAGE",
        read: false,
        link: { contains: `/messages/${id}` },
      },
      data: { read: true },
    });
  }

  const other = isParticipant ? (convo.userAId === me.id ? convo.userB : convo.userA) : null;
  const otherUnavailableReason = isParticipant ? messagingUnavailableReason(other) : null;

  // Check if the other participant is a seller (display name overrides
  // account name so threads with makers show the shop name, not the
  // person's legal name).
  const otherSellerProfile = other
    ? await prisma.sellerProfile.findUnique({
        where: { userId: other.id },
        select: { id: true, displayName: true, acceptsCustomOrders: true, avatarImageUrl: true },
      })
    : null;

  const participantLabel = isStaffReviewMode
    ? `${convo.userA.name || convo.userA.email || "User"} ↔ ${convo.userB.name || convo.userB.email || "User"}`
    : otherSellerProfile?.displayName || other?.name || other?.email || "User";

  const showCustomOrderButton = !!(isParticipant && otherSellerProfile?.acceptsCustomOrders && !otherUnavailableReason);

  // Avatar priority: custom seller avatar first, Clerk imageUrl fallback
  const otherAvatarUrl = otherSellerProfile?.avatarImageUrl ?? other?.imageUrl ?? null;

  // When the other party has a public seller profile, the header avatar +
  // name link to that shop. Otherwise no link.
  const sellerProfileHref = otherSellerProfile?.id && otherSellerProfile.displayName
    ? publicSellerPath(otherSellerProfile.id, otherSellerProfile.displayName)
    : null;

  const messages = await prisma.message.findMany({
    where: { conversationId: convo.id },
    orderBy: { createdAt: "asc" },
    take: 200,
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

  // --- Server actions --------------------------------------------------------
  async function sendMessage(_prev: unknown, formData: FormData) {
    "use server";

    const { userId } = await auth();
    if (!userId) return { ok: false };

    const me = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!me) return { ok: false };
    if (me.banned || me.deletedAt) return { ok: false, error: "Your account has been suspended." };

    // Rate limit: 30 messages per 5 minutes
    const { safeRateLimit, messageRatelimit } = await import("@/lib/ratelimit");
    const { success: rlOk } = await safeRateLimit(messageRatelimit, me.id);
    if (!rlOk) return { ok: false, error: "You're sending messages too quickly. Please wait a moment." };

    const body = truncateText(String(formData.get("body") ?? "").trim(), 2000);
    const atts = normalizeMessageAttachments(String(formData.get("attachments") ?? "[]"), isFirstPartyMediaUrl);

    // Profanity check (log-only)
    if (body) {
      const { containsProfanity } = await import("@/lib/profanity");
      const p = containsProfanity(body);
      if (p.flagged) console.error(`[PROFANITY] Message by ${userId}: ${p.matches.join(", ")}`);
    }

    // Validate participation
    const c = await prisma.conversation.findFirst({
      where: { id, OR: [{ userAId: me.id }, { userBId: me.id }] },
      select: { id: true, userAId: true, userBId: true, firstResponseAt: true },
    });
    if (!c) return { ok: false };

    const recipientId = c.userAId === me.id ? c.userBId : c.userAId;
    const recipient = await prisma.user.findUnique({
      where: { id: recipientId },
      select: { banned: true, deletedAt: true },
    });
    const unavailableReason = messagingUnavailableReason(recipient);
    if (unavailableReason) return { ok: false, error: unavailableReason };

    // Block check — reject if either user has blocked the other
    const blockExists = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: me.id, blockedId: recipientId },
          { blockerId: recipientId, blockedId: me.id },
        ],
      },
      select: { id: true },
    });
    if (blockExists) return { ok: false, error: "blocked" };

    // 1) attachments -> each as its own message (JSON payload in body)
    for (const a of atts) {
      const payload = JSON.stringify({
        kind: "file",
        url: a.url,
        name: a.name,
        type: a.type,
      });
      await prisma.message.create({
        data: { conversationId: id, senderId: me.id, recipientId, body: payload },
      });
    }

    // 2) text message if present
    if (body) {
      await prisma.message.create({
        data: { conversationId: id, senderId: me.id, recipientId, body },
      });
    }

    // bump thread; set firstResponseAt if this is the first reply from the other side
    const conversationUpdate: Record<string, unknown> = { updatedAt: new Date() };
    if (!c.firstResponseAt && (atts.length > 0 || body)) {
      // Check if the other person has sent a prior message (this is a response, not an opener)
      const priorFromOther = await prisma.message.findFirst({
        where: { conversationId: id, senderId: { not: me.id } },
        select: { id: true },
      });
      if (priorFromOther) {
        conversationUpdate.firstResponseAt = new Date();
      }
    }
    await prisma.conversation.update({
      where: { id },
      data: conversationUpdate,
    });

    // Notify recipient
    if (atts.length > 0 || body) {
      await createNotification({
        userId: recipientId,
        type: "NEW_MESSAGE",
        title: `${me.name ?? me.email?.split("@")[0] ?? "Someone"} sent you a message`,
        body: body || "Sent an attachment",
        link: `/messages/${id}`,
      });
    }

    // Email notification for new message (fire-and-forget, 5-min throttle)
    try {
      const recentReply = await prisma.message.findFirst({
        where: {
          conversationId: id,
          senderId: recipientId,
          createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
        },
        select: { id: true },
      });
      if (!recentReply) {
        if (await shouldSendEmail(recipientId, "EMAIL_NEW_MESSAGE")) {
          const recipientUser = await prisma.user.findUnique({
            where: { id: recipientId },
            select: { email: true, name: true },
          });
          if (recipientUser?.email && body) {
            await sendNewMessageEmail({
              recipientEmail: recipientUser.email,
              recipientName: recipientUser.name ?? "there",
              senderName: me.name ?? me.email?.split("@")[0] ?? "Someone",
              messagePreview: truncateText(body, 200),
              conversationUrl: `https://thegrainline.com/messages/${id}`,
            });
          }
        }
      }
    } catch (e) {
      console.error("Failed to send message notification email:", e);
    }

    return { ok: true };
  }

  async function archiveThread(_prev: unknown, _formData: FormData): Promise<{ ok: boolean }> {
    "use server";
    const { userId } = await auth();
    if (!userId) redirect(`/sign-in?redirect_url=/messages/${id}`);
    const me = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!me) redirect(`/sign-in?redirect_url=/messages/${id}`);

    const c = await prisma.conversation.findFirst({
      where: { id, OR: [{ userAId: me.id }, { userBId: me.id }] },
      select: { id: true, userAId: true, userBId: true },
    });
    if (!c) return { ok: false };

    await prisma.conversation.update({
      where: { id },
      data:
        c.userAId === me.id
          ? { archivedAAt: new Date() }
          : { archivedBAt: new Date() },
    });

    redirect("/messages?tab=archived");
  }

  async function unarchiveThread(_prev: unknown, _formData: FormData): Promise<{ ok: boolean }> {
    "use server";
    const { userId } = await auth();
    if (!userId) redirect(`/sign-in?redirect_url=/messages/${id}`);
    const me = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!me) redirect(`/sign-in?redirect_url=/messages/${id}`);

    const c = await prisma.conversation.findFirst({
      where: { id, OR: [{ userAId: me.id }, { userBId: me.id }] },
      select: { id: true, userAId: true, userBId: true },
    });
    if (!c) return { ok: false };

    await prisma.conversation.update({
      where: { id },
      data:
        c.userAId === me.id
          ? { archivedAAt: null }
          : { archivedBAt: null },
    });

    redirect("/messages");
  }
  // ---------------------------------------------------------------------------

  const ctx = convo.contextListing;
  const ctxImg = ctx?.photos?.[0]?.url ?? null;
  const archivedForMe =
    isParticipant ? (convo.userAId === me.id ? convo.archivedAAt : convo.archivedBAt) ?? null : null;

  return (
    <main className="bg-[#F7F5F0] min-h-[100svh]">
      <div className="max-w-4xl mx-auto px-0 sm:px-6 py-0 sm:py-6">
        {isParticipant && <MarkReadClient id={id} />}

        {/* Compact chat header — single row with all actions inline. Edge-to-edge
            on mobile, contained on desktop. */}
        <header className="sticky top-0 z-10 bg-[#F7F5F0]/95 backdrop-blur-sm border-b border-neutral-200 px-4 sm:px-5 py-3 sm:rounded-t-2xl">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href={isStaffReviewMode ? "/admin/reports" : "/messages"}
              className="shrink-0 inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-neutral-900"
              aria-label={isStaffReviewMode ? "Back to reports" : "Back to inbox"}
            >
              <span aria-hidden="true" className="text-base">←</span>
              <span className="hidden sm:inline">{isStaffReviewMode ? "Reports" : "Inbox"}</span>
            </Link>

            {sellerProfileHref ? (
              <Link
                href={sellerProfileHref}
                className="h-10 w-10 rounded-full bg-neutral-200 overflow-hidden shrink-0 ring-1 ring-neutral-200 shadow-sm hover:ring-stone-400 transition-shadow"
                aria-label={`Visit ${participantLabel}'s shop`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {otherAvatarUrl ? <img src={otherAvatarUrl} alt="" className="h-full w-full object-cover" /> : null}
              </Link>
            ) : (
              <div className="h-10 w-10 rounded-full bg-neutral-200 overflow-hidden shrink-0 ring-1 ring-neutral-200 shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {otherAvatarUrl ? <img src={otherAvatarUrl} alt="" className="h-full w-full object-cover" /> : null}
              </div>
            )}

            <div className="min-w-0 flex-1">
              {sellerProfileHref ? (
                <Link
                  href={sellerProfileHref}
                  className="font-semibold truncate text-neutral-900 hover:underline block"
                >
                  {participantLabel}
                </Link>
              ) : (
                <div className="font-semibold truncate text-neutral-900">{participantLabel}</div>
              )}
              {(isStaffReviewMode || archivedForMe) && (
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  {isStaffReviewMode ? (
                    <span className="rounded-full bg-blue-100 px-2 py-[2px] text-[11px] text-blue-800 font-medium">
                      Staff review
                    </span>
                  ) : null}
                  {archivedForMe ? (
                    <span className="rounded-full bg-[#EFEAE0] px-2 py-[2px] text-[11px] text-neutral-700">
                      Archived
                    </span>
                  ) : null}
                </div>
              )}
            </div>

            {/* Right-side: ··· menu is always on the top row (compact).
                Custom Order + Archive move to a second row on mobile to avoid
                crowding the badge area beneath the name. */}
            <div className="shrink-0 hidden sm:flex items-center gap-1.5">
              {showCustomOrderButton && other && (
                <ThreadCustomOrderButton
                  sellerUserId={other.id}
                  sellerName={otherSellerProfile?.displayName ?? other.name ?? other.email ?? "Maker"}
                />
              )}
              {isParticipant && (
                <ActionForm action={archivedForMe ? unarchiveThread : archiveThread}>
                  <SubmitButton className="rounded-md bg-[#EFEAE0] px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-[#E3DCCB] transition-colors">
                    {archivedForMe ? "Unarchive" : "Archive"}
                  </SubmitButton>
                </ActionForm>
              )}
              {isParticipant && other && other.id !== me.id && (
                <BlockReportButton
                  targetUserId={other.id}
                  targetName={other.name ?? "this user"}
                  targetType="MESSAGE_THREAD"
                  targetId={id}
                />
              )}
            </div>
            {isParticipant && other && other.id !== me.id && (
              <div className="shrink-0 sm:hidden">
                <BlockReportButton
                  targetUserId={other.id}
                  targetName={other.name ?? "this user"}
                  targetType="MESSAGE_THREAD"
                  targetId={id}
                />
              </div>
            )}
          </div>

          {/* Mobile-only action row: Custom Order + Archive on a second
              line so they don't crowd the avatar+name+badges area. */}
          {(showCustomOrderButton || isParticipant) && (
            <div className="sm:hidden mt-2 flex flex-wrap items-center gap-1.5">
              {showCustomOrderButton && other && (
                <ThreadCustomOrderButton
                  sellerUserId={other.id}
                  sellerName={otherSellerProfile?.displayName ?? other.name ?? other.email ?? "Maker"}
                />
              )}
              {isParticipant && (
                <ActionForm action={archivedForMe ? unarchiveThread : archiveThread}>
                  <SubmitButton className="rounded-md bg-[#EFEAE0] px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-[#E3DCCB] transition-colors">
                    {archivedForMe ? "Unarchive" : "Archive"}
                  </SubmitButton>
                </ActionForm>
              )}
            </div>
          )}
        </header>

        <div className="px-4 sm:px-5 pt-4 space-y-4">
          {otherUnavailableReason ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {otherUnavailableReason}
            </div>
          ) : null}

          {ctx && (
            <Link
              href={publicListingPath(ctx.id, ctx.title)}
              className="flex items-center gap-3 p-3 rounded-lg bg-white border border-stone-200/60 hover:shadow-md transition-shadow"
            >
              <div className="h-14 w-14 rounded-md overflow-hidden bg-neutral-100 shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {ctxImg ? <img src={ctxImg} alt="" className="h-full w-full object-cover" /> : null}
              </div>
              <div className="min-w-0">
                <div className="truncate font-medium">{ctx.title}</div>
                <div className="text-sm text-neutral-600">
                  {(ctx.priceCents / 100).toLocaleString("en-US", {
                    style: "currency",
                    currency: ctx.currency ?? "USD",
                  })}
                </div>
              </div>
              <div className="ml-auto text-sm text-amber-700 shrink-0">View listing →</div>
            </Link>
          )}

          {/* Scrollable thread */}
          <ThreadMessages
            convoId={convo.id}
            meId={me.id}
            initial={messages}
            otherUser={{ imageUrl: other?.imageUrl, avatarImageUrl: otherSellerProfile?.avatarImageUrl, name: other?.name }}
          />
        </div>

        {/* Sticky composer at the bottom edge — rounded top on desktop only */}
        {isParticipant && !otherUnavailableReason ? (
          <ActionForm action={sendMessage}>
            <MessageComposer />
          </ActionForm>
        ) : null}
      </div>
    </main>
  );
}
