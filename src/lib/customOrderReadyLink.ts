import * as Sentry from "@sentry/nextjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendCustomOrderReady } from "@/lib/email";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
import { publicListingPath } from "@/lib/publicPaths";
import { lockConversationParticipantPair } from "@/lib/conversationStartAccess";

const CUSTOM_ORDER_READY_LINK_LOCK_NAMESPACE = 913349;

type CustomOrderReadySource = {
  listingId: string;
  listingTitle: string;
  priceCents: number;
  currency: string | null;
  conversationId: string;
  sellerUserId: string;
  buyerUserId: string;
  sellerName: string | null;
  userAId: string;
  userBId: string;
};

type CustomOrderReadyCommit = {
  messageId: string;
  source: CustomOrderReadySource;
};

/**
 * Emits the buyer's ready-to-purchase card from one durable source id.
 *
 * Do not add caller-supplied participants, conversation ids, payload fields,
 * links, or dedup keys. The Listing reservation is the authority and every
 * security-relevant output is derived from it inside the locked transaction.
 */
export async function sendCustomOrderReadyLink({ listingId }: { listingId: string }) {
  if (!listingId) return { messageCreated: false };

  const committed = await prisma.$transaction<CustomOrderReadyCommit | null>(async (tx) => {
    const initial = await tx.listing.findUnique({
      where: { id: listingId },
      select: {
        reservedForUserId: true,
        customOrderConversationId: true,
        seller: { select: { userId: true } },
      },
    });
    if (
      !initial?.reservedForUserId
      || !initial.customOrderConversationId
      || initial.seller.userId === initial.reservedForUserId
    ) {
      return null;
    }

    const pair = await lockConversationParticipantPair(
      tx,
      initial.seller.userId,
      initial.reservedForUserId,
    );
    if (!pair.ok) return null;

    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        ${CUSTOM_ORDER_READY_LINK_LOCK_NAMESPACE},
        hashtext(${listingId})
      )
    `;

    const sources = await tx.$queryRaw<CustomOrderReadySource[]>`
      SELECT
        listing.id AS "listingId",
        listing.title::text AS "listingTitle",
        listing."priceCents",
        listing.currency::text AS currency,
        listing."customOrderConversationId" AS "conversationId",
        seller."userId" AS "sellerUserId",
        listing."reservedForUserId" AS "buyerUserId",
        seller."displayName" AS "sellerName",
        conversation."userAId",
        conversation."userBId"
      FROM "Listing" AS listing
      JOIN "SellerProfile" AS seller
        ON seller.id = listing."sellerId"
      JOIN "Conversation" AS conversation
        ON conversation.id = listing."customOrderConversationId"
      WHERE listing.id = ${listingId}
        AND listing.status = 'ACTIVE'
        AND listing."isPrivate" = true
        AND listing."reservedForUserId" = ${initial.reservedForUserId}
        AND listing."customOrderConversationId" = ${initial.customOrderConversationId}
        AND seller."userId" = ${initial.seller.userId}
        AND seller."chargesEnabled" = true
        AND seller."stripeAccountId" IS NOT NULL
        AND (seller."stripeAccountVersion" IS NULL OR seller."stripeAccountVersion" = 'v2')
        AND seller."vacationMode" = false
      FOR SHARE OF listing, seller, conversation
    `;
    const source = sources[0];
    if (
      sources.length !== 1
      || source.userAId !== pair.userAId
      || source.userBId !== pair.userBId
      || source.sellerUserId === source.buyerUserId
    ) {
      return null;
    }

    const existingLinkMessage = await tx.message.findFirst({
      where: {
        conversationId: source.conversationId,
        kind: "custom_order_link",
        body: { contains: source.listingId },
      },
      select: { id: true },
    });
    if (existingLinkMessage) return null;

    const createdMessage = await tx.message.create({
      data: {
        conversationId: source.conversationId,
        senderId: source.sellerUserId,
        recipientId: source.buyerUserId,
        contextListingId: source.listingId,
        kind: "custom_order_link",
        isSystemMessage: true,
        body: JSON.stringify({
          listingId: source.listingId,
          title: source.listingTitle,
          priceCents: source.priceCents,
          currency: source.currency,
        }),
      },
      select: { id: true },
    });
    await tx.conversation.update({
      where: { id: source.conversationId },
      data: { updatedAt: new Date(), archivedAAt: null, archivedBAt: null },
    });

    return { messageId: createdMessage.id, source };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  });

  if (!committed) return { messageCreated: false };

  const { source, messageId } = committed;
  const listingLink = publicListingPath(source.listingId, source.listingTitle);
  await createNotification({
    userId: source.buyerUserId,
    type: "CUSTOM_ORDER_LINK",
    title: "Your custom piece is ready to review!",
    body: `${source.listingTitle} - review and purchase`,
    link: listingLink,
    dedupScope: source.listingId,
    relatedUserId: source.sellerUserId,
    sourceType: NOTIFICATION_SOURCE_TYPES.MESSAGE,
    sourceId: messageId,
  });

  try {
    if (await shouldSendEmail(source.buyerUserId, "EMAIL_CUSTOM_ORDER")) {
      const buyerUser = await prisma.user.findUnique({
        where: { id: source.buyerUserId },
        select: { name: true, email: true },
      });
      if (buyerUser?.email) {
        await sendCustomOrderReady({
          buyer: { name: buyerUser.name, email: buyerUser.email },
          sellerName: source.sellerName ?? "Grainline maker",
          listingTitle: source.listingTitle,
          priceCents: source.priceCents,
          currency: source.currency,
          listingId: source.listingId,
        });
      }
    }
  } catch (error) {
    Sentry.captureException(error, {
      level: "warning",
      tags: { source: "custom_order_ready_email" },
      extra: {
        listingId: source.listingId,
        conversationId: source.conversationId,
        sellerUserId: source.sellerUserId,
        buyerUserId: source.buyerUserId,
      },
    });
    // Non-fatal: the in-app message and notification are the durable buyer path.
  }

  return { messageCreated: true };
}
