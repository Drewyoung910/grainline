// src/app/messages/[id]/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
import { EMAIL_APP_URL } from "@/lib/emailBaseUrl";
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
import { isFirstPartyMediaUrlForUser } from "@/lib/urlValidation";
import {
  MESSAGE_ATTACHMENT_CONTENT_TYPES,
  verifyFirstPartyUploadForPersistence,
} from "@/lib/uploadPersistenceVerification";
import { messagingUnavailableReason } from "@/lib/messageRecipientState";
import { canViewListingDetail } from "@/lib/listingVisibility";
import { isSupportedStripeAccountVersion } from "@/lib/sellerVisibility";
import { sanitizeText, truncateText } from "@/lib/sanitize";
import { captureProfanityFlag } from "@/lib/profanityTelemetry";
import { DEFAULT_CURRENCY, formatCurrencyCents } from "@/lib/money";
import { logServerError } from "@/lib/serverErrorLogger";
import { claimDirectUploadForUrl, DirectUploadClaimError } from "@/lib/directUploadLifecycle";

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
      userA: { select: { id: true, name: true, imageUrl: true, banned: true, deletedAt: true } },
      userB: { select: { id: true, name: true, imageUrl: true, banned: true, deletedAt: true } },
      contextListing: {
        select: {
          id: true,
          title: true,
          priceCents: true,
          currency: true,
          status: true,
          isPrivate: true,
          reservedForUserId: true,
          seller: {
            select: {
              userId: true,
              chargesEnabled: true,
              stripeAccountVersion: true,
              vacationMode: true,
              user: { select: { id: true, banned: true, deletedAt: true } },
            },
          },
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
        select: {
          id: true,
          displayName: true,
          acceptsCustomOrders: true,
          avatarImageUrl: true,
          chargesEnabled: true,
          stripeAccountVersion: true,
        },
      })
    : null;

  const participantLabel = isStaffReviewMode
    ? `${convo.userA.name || "User"} ↔ ${convo.userB.name || "User"}`
    : otherSellerProfile?.displayName || other?.name || "User";

  const showCustomOrderButton = !!(isParticipant && otherSellerProfile?.acceptsCustomOrders && !otherUnavailableReason);

  // Avatar priority: custom seller avatar first, Clerk imageUrl fallback
  const otherAvatarUrl = otherSellerProfile?.avatarImageUrl ?? other?.imageUrl ?? null;

  // When the other party has a public seller profile, the header avatar +
  // name link to that shop. Otherwise no link.
  const sellerProfileHref = !otherUnavailableReason &&
    otherSellerProfile?.id &&
    otherSellerProfile.displayName &&
    otherSellerProfile.chargesEnabled &&
    isSupportedStripeAccountVersion(otherSellerProfile.stripeAccountVersion)
    ? publicSellerPath(otherSellerProfile.id, otherSellerProfile.displayName)
    : null;

  const messages = (await prisma.message.findMany({
    where: { conversationId: convo.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
  })).reverse();

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

    const body = truncateText(sanitizeText(String(formData.get("body") ?? "").trim()), 2000);
    const atts = normalizeMessageAttachments(
      String(formData.get("attachments") ?? "[]"),
      (url) => isFirstPartyMediaUrlForUser(url, userId, ["messageAny"]),
    );
    if (!body && atts.length === 0) {
      return { ok: false, error: "Write a message or attach a file." };
    }

    // Profanity check (log-only)
    if (body) {
      const { containsProfanity } = await import("@/lib/profanity");
      const p = containsProfanity(body);
      if (p.flagged) {
        captureProfanityFlag({
          source: "message_thread_send",
          matchCount: p.matches.length,
          extra: { clerkUserId: userId, conversationId: id },
        });
      }
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

    if (atts.length > 0) {
      const attachmentVerifications = await Promise.all(
        atts.map((attachment) =>
          verifyFirstPartyUploadForPersistence({
            url: attachment.url,
            endpoint: "messageAny",
            clerkUserId: userId,
            allowedContentTypes: MESSAGE_ATTACHMENT_CONTENT_TYPES,
          }),
        ),
      );
      const failedAttachment = attachmentVerifications.find((result) => !result.ok);
      if (failedAttachment && !failedAttachment.ok) {
        return { ok: false, error: failedAttachment.error };
      }
    }

    const hasMessageContent = atts.length > 0 || !!body;

    const messageSentAt = new Date();
    try {
      await prisma.$transaction(async (tx) => {
        // 1) attachments -> each as its own message (JSON payload in body)
        for (const a of atts) {
          await claimDirectUploadForUrl({
            client: tx,
            url: a.url,
            userId: me.id,
            claimedByType: "Message",
          });
          const payload = JSON.stringify({
            kind: "file",
            url: a.url,
            name: a.name,
            type: a.type,
          });
          const createdAttachment = await tx.message.create({
            data: { conversationId: id, senderId: me.id, recipientId, body: payload },
            select: { id: true },
          });
          await claimDirectUploadForUrl({
            client: tx,
            url: a.url,
            userId: me.id,
            claimedByType: "Message",
            claimedById: createdAttachment.id,
          });
        }

        // 2) text message if present
        if (body) {
          await tx.message.create({
            data: { conversationId: id, senderId: me.id, recipientId, body },
          });
        }

        // bump thread; set firstResponseAt if this is the first reply from the other side
        if (!c.firstResponseAt && hasMessageContent) {
          // Check if the other person has sent a prior message (this is a response, not an opener)
          const priorFromOther = await tx.message.findFirst({
            where: { conversationId: id, senderId: { not: me.id } },
            select: { id: true },
          });
          if (priorFromOther) {
            await tx.conversation.updateMany({
              where: { id, firstResponseAt: null },
              data: { firstResponseAt: messageSentAt },
            });
          }
        }
        await tx.conversation.update({
          where: { id },
          data: { updatedAt: messageSentAt, archivedAAt: null, archivedBAt: null },
        });
      });
    } catch (error) {
      if (error instanceof DirectUploadClaimError) {
        return { ok: false, error: error.message };
      }
      throw error;
    }

    // Notify recipient
    if (hasMessageContent) {
      await createNotification({
        userId: recipientId,
        type: "NEW_MESSAGE",
        title: `${me.name ?? "Someone"} sent you a message`,
        body: body || "Sent an attachment",
        link: `/messages/${id}`,
      });
    }

    // Email notification for new message (fire-and-forget, 5-min atomic throttle)
    try {
      if (hasMessageContent && (await shouldSendEmail(recipientId, "EMAIL_NEW_MESSAGE"))) {
        const recipientUser = await prisma.user.findUnique({
          where: { id: recipientId },
          select: { email: true, name: true },
        });
        if (recipientUser?.email) {
          const emailWindowStart = new Date(messageSentAt.getTime() - 5 * 60 * 1000);
          const emailClaim = await prisma.conversation.updateMany({
            where: {
              id,
              OR: [{ lastMessageEmailSentAt: null }, { lastMessageEmailSentAt: { lt: emailWindowStart } }],
            },
            data: { lastMessageEmailSentAt: messageSentAt },
          });
          if (emailClaim.count === 1) {
            await sendNewMessageEmail({
              recipientEmail: recipientUser.email,
              recipientName: recipientUser.name ?? "there",
              senderName: me.name ?? "Someone",
              messagePreview: body ? truncateText(body, 200) : "Sent an attachment",
              conversationUrl: new URL(`/messages/${id}`, EMAIL_APP_URL).toString(),
            });
          }
        }
      }
    } catch (e) {
      logServerError(e, {
        source: "message_thread_email",
        level: "warning",
        extra: { conversationId: id, recipientId },
      });
    }

    return { ok: true };
  }

  async function archiveThread(_prev: unknown, _formData: FormData): Promise<{ ok: boolean }> {
    "use server";
    const { userId } = await auth();
    if (!userId) redirect(`/sign-in?redirect_url=/messages/${id}`);
    const me = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { id: true, banned: true, deletedAt: true },
    });
    if (!me) redirect(`/sign-in?redirect_url=/messages/${id}`);
    if (me.banned || me.deletedAt) return { ok: false };

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
    const me = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { id: true, banned: true, deletedAt: true },
    });
    if (!me) redirect(`/sign-in?redirect_url=/messages/${id}`);
    if (me.banned || me.deletedAt) return { ok: false };

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
  const contextListingHref = ctx &&
    canViewListingDetail(ctx, {
      dbUserId: isParticipant ? me.id : null,
      role: me.role,
      banned: me.banned,
      deletedAt: me.deletedAt,
    })
    ? publicListingPath(ctx.id, ctx.title)
    : null;
  const archivedForMe =
    isParticipant ? (convo.userAId === me.id ? convo.archivedAAt : convo.archivedBAt) ?? null : null;
  const messageComposerFormId = `message-composer-${convo.id}`;

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
                  sellerName={otherSellerProfile?.displayName ?? other.name ?? "Maker"}
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
                  sellerName={otherSellerProfile?.displayName ?? other.name ?? "Maker"}
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

          {ctx && contextListingHref ? (
            <Link
              href={contextListingHref}
              className="flex items-center gap-3 p-3 rounded-lg bg-[#EFEAE0] border border-stone-200/60 hover:shadow-md transition-shadow"
            >
              <div className="h-14 w-14 rounded-md overflow-hidden bg-[#F7F5F0] shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {ctxImg ? <img src={ctxImg} alt="" className="h-full w-full object-cover" /> : null}
              </div>
              <div className="min-w-0">
                <div className="truncate font-medium">{ctx.title}</div>
                <div className="text-sm text-neutral-600">
                  {formatCurrencyCents(ctx.priceCents, ctx.currency ?? DEFAULT_CURRENCY)}
                </div>
              </div>
              <div className="ml-auto text-sm text-amber-700 shrink-0">View listing →</div>
            </Link>
          ) : ctx ? (
            <div className="flex items-center gap-3 rounded-lg border border-stone-200/60 bg-[#EFEAE0] p-3">
              <div className="h-14 w-14 rounded-md overflow-hidden bg-[#F7F5F0] shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {ctxImg ? <img src={ctxImg} alt="" className="h-full w-full object-cover" /> : null}
              </div>
              <div className="min-w-0">
                <div className="truncate font-medium">{ctx.title}</div>
                <div className="text-sm text-neutral-600">
                  {formatCurrencyCents(ctx.priceCents, ctx.currency ?? DEFAULT_CURRENCY)}
                </div>
              </div>
            </div>
          ) : null}

          {/* Scrollable thread */}
          <ThreadMessages
            convoId={convo.id}
            meId={me.id}
            initial={messages}
            otherUser={{ imageUrl: other?.imageUrl, avatarImageUrl: otherSellerProfile?.avatarImageUrl, name: other?.name }}
            refreshEventFormId={messageComposerFormId}
            liveUpdates={!isStaffReviewMode}
            canCreateCustomListings={isParticipant && !otherUnavailableReason}
          />
        </div>

        {/* Sticky composer at the bottom edge — rounded top on desktop only */}
        {isParticipant && !otherUnavailableReason ? (
          <ActionForm id={messageComposerFormId} action={sendMessage}>
            <MessageComposer successEventFormId={messageComposerFormId} />
          </ActionForm>
        ) : null}
      </div>
    </main>
  );
}
