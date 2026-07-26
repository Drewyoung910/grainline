// src/app/messages/[id]/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
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
import {
  DirectUploadClaimError,
  syncLegacyMessageDirectUploadReference,
} from "@/lib/directUploadLifecycle";
import { canAttachConversationContextListing } from "@/lib/conversationStartState";
import {
  claimActorConversationMessageEmail,
  getActorConversation,
  listLatestActorMessages,
  sendActorOrdinaryMessage,
  setActorConversationArchived,
} from "@/lib/conversationMessageAuthority";
import { getPrismaRawSqlState } from "@/lib/prismaRawSqlError";

export default async function ThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ listing?: string }>;
}) {
  const [{ id }, { listing: requestedListingParam }] = await Promise.all([params, searchParams]);

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

  const conversation = await getActorConversation(me.id, id);
  if (!conversation) return notFound();
  const conversationUsers = await prisma.user.findMany({
    where: { id: { in: [conversation.userAId, conversation.userBId] } },
    select: { id: true, name: true, imageUrl: true, banned: true, deletedAt: true },
  });
  const userById = new Map(conversationUsers.map((user) => [user.id, user]));
  const userA = userById.get(conversation.userAId);
  const userB = userById.get(conversation.userBId);
  if (!userA || !userB) return notFound();
  const contextListing = conversation.contextListingId
    ? await prisma.listing.findUnique({
        where: { id: conversation.contextListingId },
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
      })
    : null;
  const convo = {
    ...conversation,
    userA,
    userB,
    contextListing,
  };
  const isParticipant = convo.userAId === me.id || convo.userBId === me.id;
  const isStaffReviewMode = canStaffReviewThread && !isParticipant;

  const requestedListingId = requestedListingParam?.trim();
  const requestedListing = isParticipant && requestedListingId && requestedListingId.length <= 191
    ? requestedListingId === convo.contextListing?.id
      ? convo.contextListing
      : await prisma.listing.findUnique({
          where: { id: requestedListingId },
          select: {
            id: true,
            title: true,
            status: true,
            isPrivate: true,
            reservedForUserId: true,
            seller: {
              select: {
                chargesEnabled: true,
                stripeAccountVersion: true,
                vacationMode: true,
                user: { select: { id: true, banned: true, deletedAt: true } },
              },
            },
          },
        })
    : null;
  const composerContextListing = requestedListing
    && canAttachConversationContextListing(
      requestedListing,
      [convo.userAId, convo.userBId],
    )
    ? { id: requestedListing.id, title: requestedListing.title }
    : null;

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

  const messageRows = await listLatestActorMessages(me.id, conversation, 201);
  const hasMoreMessagesBefore = messageRows.length > 200;
  const messages = messageRows.slice(-200);

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
    const submittedContextListingId = String(formData.get("contextListingId") ?? "").trim();
    if (submittedContextListingId.length > 191) {
      return { ok: false, error: "The listing context is invalid." };
    }
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

    // Validate participation before upload checks, then re-check inside the
    // write transaction so blocks/account-state changes cannot race the send.
    const c = await getActorConversation(me.id, id);
    if (
      !c
      || (c.userAId !== me.id && c.userBId !== me.id)
    ) return { ok: false };

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
            accountUserId: me.id,
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

    let committed: {
      recipientId: string;
      notificationMessageId: string;
    };
    try {
      committed = await prisma.$transaction(async (tx) => {
        let notificationMessageId: string | null = null;

        // 1) attachments -> each as its own message (JSON payload in body)
        for (const a of atts) {
          const payload = JSON.stringify({
            kind: "file",
            url: a.url,
            name: a.name,
            type: a.type,
          });
          const createdAttachment = await sendActorOrdinaryMessage(
            me.id,
            id,
            {
              body: payload,
              kind: "file",
              contextListingId: submittedContextListingId || null,
            },
            tx,
          );
          if (createdAttachment.recipientId !== recipientId) {
            throw new TypeError(
              "ordinary-message write RPC changed the validated recipient",
            );
          }
          notificationMessageId = createdAttachment.messageId;
          await syncLegacyMessageDirectUploadReference({
            client: tx,
            userId: me.id,
            messageId: createdAttachment.messageId,
            requireAllTracked: true,
          });
        }

        // 2) text message if present
        if (body) {
          const createdText = await sendActorOrdinaryMessage(
            me.id,
            id,
            {
              body,
              kind: null,
              contextListingId: submittedContextListingId || null,
            },
            tx,
          );
          if (createdText.recipientId !== recipientId) {
            throw new TypeError(
              "ordinary-message write RPC changed the validated recipient",
            );
          }
          notificationMessageId = createdText.messageId;
        }

        if (notificationMessageId === null) {
          throw new TypeError("ordinary-message transaction created no message");
        }
        return {
          recipientId,
          notificationMessageId,
        };
      }, { isolationLevel: "ReadCommitted" });
    } catch (error) {
      if (error instanceof DirectUploadClaimError) {
        return { ok: false, error: error.message };
      }
      const sqlState = getPrismaRawSqlState(error);
      if (
        sqlState === "22023"
        || sqlState === "42501"
        || sqlState === "40001"
      ) {
        return { ok: false, error: "Messaging is unavailable." };
      }
      throw error;
    }
    const {
      recipientId: committedRecipientId,
      notificationMessageId: committedNotificationMessageId,
    } = committed;

    // Notify recipient
    if (hasMessageContent) {
      await createNotification({
        userId: committedRecipientId,
        type: "NEW_MESSAGE",
        title: `${me.name ?? "Someone"} sent you a message`,
        body: body || "Sent an attachment",
        link: `/messages/${id}`,
        relatedUserId: me.id,
        sourceType: NOTIFICATION_SOURCE_TYPES.MESSAGE,
        sourceId: committedNotificationMessageId,
      });
    }

    // Email notification for new message (fire-and-forget, 5-min atomic throttle)
    try {
      if (hasMessageContent && (await shouldSendEmail(committedRecipientId, "EMAIL_NEW_MESSAGE"))) {
        const recipientUser = await prisma.user.findUnique({
          where: { id: committedRecipientId },
          select: { email: true, name: true },
        });
        if (recipientUser?.email) {
          const emailClaim = await claimActorConversationMessageEmail(
            me.id,
            committedNotificationMessageId,
          );
          if (emailClaim) {
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
        extra: { conversationId: id, recipientId: committedRecipientId },
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
    const { conversationStateRatelimit, safeRateLimit } = await import("@/lib/ratelimit");
    const { success } = await safeRateLimit(conversationStateRatelimit, me.id);
    if (!success) return { ok: false };

    try {
      if (!(await setActorConversationArchived(me.id, id, true))) {
        return { ok: false };
      }
    } catch (error) {
      const sqlState = getPrismaRawSqlState(error);
      if (sqlState === "22023" || sqlState === "42501") {
        return { ok: false };
      }
      throw error;
    }

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
    const { conversationStateRatelimit, safeRateLimit } = await import("@/lib/ratelimit");
    const { success } = await safeRateLimit(conversationStateRatelimit, me.id);
    if (!success) return { ok: false };

    try {
      if (!(await setActorConversationArchived(me.id, id, false))) {
        return { ok: false };
      }
    } catch (error) {
      const sqlState = getPrismaRawSqlState(error);
      if (sqlState === "22023" || sqlState === "42501") {
        return { ok: false };
      }
      throw error;
    }

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
    <main className="min-h-[100svh] w-full max-w-full overflow-x-clip bg-[#F7F5F0]">
      <div className="mx-auto w-full min-w-0 max-w-4xl px-0 py-0 sm:px-6 sm:py-6">
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

        <div className="min-w-0 space-y-4 px-0 pt-4 sm:px-5">
          {otherUnavailableReason ? (
            <div className="mx-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:mx-0">
              {otherUnavailableReason}
            </div>
          ) : null}

          {ctx && contextListingHref ? (
            <Link
              href={contextListingHref}
              className="mx-4 flex min-w-0 items-center gap-3 rounded-lg border border-stone-200/60 bg-[#EFEAE0] p-3 transition-shadow hover:shadow-md sm:mx-0"
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
              <div className="ml-auto text-sm text-neutral-600 shrink-0">View listing →</div>
            </Link>
          ) : ctx ? (
            <div className="mx-4 flex min-w-0 items-center gap-3 rounded-lg border border-stone-200/60 bg-[#EFEAE0] p-3 sm:mx-0">
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
            initialHasMoreBefore={hasMoreMessagesBefore}
            otherUser={{ imageUrl: other?.imageUrl, avatarImageUrl: otherSellerProfile?.avatarImageUrl, name: other?.name }}
            refreshEventFormId={messageComposerFormId}
            liveUpdates={!isStaffReviewMode}
            canCreateCustomListings={isParticipant && !otherUnavailableReason}
          />
        </div>

        {/* Sticky composer at the bottom edge — rounded top on desktop only */}
        {isParticipant && !otherUnavailableReason ? (
          <ActionForm
            id={messageComposerFormId}
            action={sendMessage}
            className="w-full min-w-0 max-w-full"
          >
            <MessageComposer
              successEventFormId={messageComposerFormId}
              contextListing={composerContextListing}
              clearContextHref={`/messages/${convo.id}`}
            />
          </ActionForm>
        ) : null}
      </div>
    </main>
  );
}
