import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { sendCustomOrderReady } from "@/lib/email";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
import { publicListingPath } from "@/lib/publicPaths";
import { messagingUnavailableReason } from "@/lib/messageRecipientState";

type CustomOrderReadyListing = {
  id: string;
  title: string;
  priceCents: number;
  currency: string | null;
};

const CUSTOM_ORDER_READY_LINK_LOCK_NAMESPACE = 913349;

export async function sendCustomOrderReadyLink({
  conversationId,
  sellerUserId,
  buyerUserId,
  sellerName,
  listing,
}: {
  conversationId: string;
  sellerUserId: string;
  buyerUserId: string;
  sellerName: string | null;
  listing: CustomOrderReadyListing;
}) {
  const listingLink = publicListingPath(listing.id, listing.title);

  const messageCreated = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(${CUSTOM_ORDER_READY_LINK_LOCK_NAMESPACE}, hashtext(${`${conversationId}:${listing.id}`}))
    `;

    const conversation = await tx.conversation.findUnique({
      where: { id: conversationId },
      select: {
        userAId: true,
        userBId: true,
        userA: { select: { banned: true, deletedAt: true } },
        userB: { select: { banned: true, deletedAt: true } },
      },
    });
    if (!conversation) return false;

    const participants = new Set([conversation.userAId, conversation.userBId]);
    if (
      sellerUserId === buyerUserId ||
      !participants.has(sellerUserId) ||
      !participants.has(buyerUserId)
    ) {
      return false;
    }

    const sellerState = conversation.userAId === sellerUserId ? conversation.userA : conversation.userB;
    const buyerState = conversation.userAId === buyerUserId ? conversation.userA : conversation.userB;
    if (messagingUnavailableReason(sellerState) || messagingUnavailableReason(buyerState)) {
      return false;
    }

    const blockExists = await tx.block.findFirst({
      where: {
        OR: [
          { blockerId: sellerUserId, blockedId: buyerUserId },
          { blockerId: buyerUserId, blockedId: sellerUserId },
        ],
      },
      select: { id: true },
    });
    if (blockExists) return false;

    const existingLinkMessage = await tx.message.findFirst({
      where: {
        conversationId,
        kind: "custom_order_link",
        body: { contains: listing.id },
      },
      select: { id: true },
    });

    if (existingLinkMessage) return false;

    await tx.message.create({
      data: {
        conversationId,
        senderId: sellerUserId,
        recipientId: buyerUserId,
        kind: "custom_order_link",
        body: JSON.stringify({
          listingId: listing.id,
          title: listing.title,
          priceCents: listing.priceCents,
          currency: listing.currency,
        }),
      },
    });
    await tx.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date(), archivedAAt: null, archivedBAt: null },
    });
    return true;
  });

  if (!messageCreated) {
    return { messageCreated: false };
  }

  await createNotification({
    userId: buyerUserId,
    type: "CUSTOM_ORDER_LINK",
    title: "Your custom piece is ready to review!",
    body: `${listing.title} - review and purchase`,
    link: listingLink,
    dedupScope: listing.id,
  });

  try {
    if (await shouldSendEmail(buyerUserId, "EMAIL_CUSTOM_ORDER")) {
      const buyerUser = await prisma.user.findUnique({
        where: { id: buyerUserId },
        select: { name: true, email: true },
      });
      if (buyerUser?.email) {
        await sendCustomOrderReady({
          buyer: { name: buyerUser.name, email: buyerUser.email },
          sellerName: sellerName ?? "Grainline maker",
          listingTitle: listing.title,
          priceCents: listing.priceCents,
          currency: listing.currency,
          listingId: listing.id,
        });
      }
    }
  } catch (error) {
    Sentry.captureException(error, {
      level: "warning",
      tags: { source: "custom_order_ready_email" },
      extra: { listingId: listing.id, conversationId, sellerUserId, buyerUserId },
    });
    // Non-fatal: the in-app message and notification are the durable buyer path.
  }

  return { messageCreated: true };
}
