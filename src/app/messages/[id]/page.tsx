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
import { publicListingPath } from "@/lib/publicPaths";
import { isR2PublicUrl } from "@/lib/urlValidation";

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

  const convo = await prisma.conversation.findFirst({
    where: { id, OR: [{ userAId: me.id }, { userBId: me.id }] },
    include: {
      userA: { select: { id: true, name: true, email: true, imageUrl: true } },
      userB: { select: { id: true, name: true, email: true, imageUrl: true } },
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

  // Auto-mark any unread NEW_MESSAGE notifications for this conversation as read
  await prisma.notification.updateMany({
    where: {
      userId: me.id,
      type: "NEW_MESSAGE",
      read: false,
      link: { contains: `/messages/${id}` },
    },
    data: { read: true },
  });

  const other = convo.userAId === me.id ? convo.userB : convo.userA;

  // Check if the other participant is a seller accepting custom orders
  const otherSellerProfile = other
    ? await prisma.sellerProfile.findUnique({
        where: { userId: other.id },
        select: { displayName: true, acceptsCustomOrders: true, avatarImageUrl: true },
      })
    : null;
  const showCustomOrderButton = !!(otherSellerProfile?.acceptsCustomOrders);

  // Avatar priority: custom seller avatar first, Clerk imageUrl fallback
  const otherAvatarUrl = otherSellerProfile?.avatarImageUrl ?? other?.imageUrl ?? null;

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

    const body = String(formData.get("body") ?? "").trim().slice(0, 2000);
    const atts = normalizeMessageAttachments(String(formData.get("attachments") ?? "[]"), isR2PublicUrl);

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
              messagePreview: body.slice(0, 200),
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
    (convo.userAId === me.id ? convo.archivedAAt : convo.archivedBAt) ?? null;

  return (
    <main className="max-w-3xl mx-auto p-4 sm:p-8 space-y-4 sm:space-y-6">
      <MarkReadClient id={id} />

      {/* Two-row header for mobile friendliness */}
      <header className="flex flex-col gap-2">
        {/* Row 1: back link + participant name */}
        <div className="flex items-center gap-3">
          <Link href="/messages" className="text-sm text-neutral-500 hover:text-neutral-800 shrink-0">
            ← Inbox
          </Link>
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-8 w-8 rounded-full bg-neutral-200 overflow-hidden shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {otherAvatarUrl ? <img src={otherAvatarUrl} alt="" className="h-full w-full object-cover" /> : null}
            </div>
            <div className="font-medium truncate">{other?.name || other?.email || "User"}</div>
            {archivedForMe ? (
              <span className="rounded-full border px-2 py-[2px] text-[11px] text-neutral-600 shrink-0">Archived</span>
            ) : null}
            {other && other.id !== me.id && (
              <BlockReportButton
                targetUserId={other.id}
                targetName={other.name ?? "this user"}
                targetType="MESSAGE_THREAD"
                targetId={id}
              />
            )}
          </div>
        </div>

        {/* Row 2: action buttons (only rendered when there's something to show) */}
        <div className="flex items-center gap-2 flex-wrap pl-[4.5rem]">
          {showCustomOrderButton && other && (
            <ThreadCustomOrderButton
              sellerUserId={other.id}
              sellerName={otherSellerProfile?.displayName ?? other.name ?? other.email ?? "Maker"}
            />
          )}
          {/* Archive / Unarchive */}
          <ActionForm action={archivedForMe ? unarchiveThread : archiveThread}>
            <SubmitButton className="rounded-md border px-3 py-1.5 text-sm hover:bg-neutral-50">
              {archivedForMe ? "Unarchive" : "Archive"}
            </SubmitButton>
          </ActionForm>
        </div>
      </header>

      {ctx && (
        <Link
          href={publicListingPath(ctx.id, ctx.title)}
          className="flex items-center gap-3 rounded-lg border bg-white p-3 hover:bg-neutral-50"
        >
          <div className="h-14 w-14 rounded-lg overflow-hidden bg-neutral-100">
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
          <div className="ml-auto text-sm text-neutral-500">View listing →</div>
        </Link>
      )}

      {/* scrollable thread */}
      <ThreadMessages
        convoId={convo.id}
        meId={me.id}
        initial={messages}
        otherUser={{ imageUrl: other?.imageUrl, avatarImageUrl: otherSellerProfile?.avatarImageUrl, name: other?.name }}
      />

      {/* sticky composer */}
      <ActionForm action={sendMessage}>
        <MessageComposer />
      </ActionForm>
    </main>
  );
}

