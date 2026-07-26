import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { sendCustomOrderReady } from "@/lib/email";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
import { publicListingPath } from "@/lib/publicPaths";
import {
  sendActorCustomOrderReady,
  type SentActorCustomOrderReady,
} from "@/lib/conversationMessageAuthority";
import { getPrismaRawSqlState } from "@/lib/prismaRawSqlError";

/**
 * Emits the buyer's ready-to-purchase card from one durable source id.
 *
 * Do not add caller-supplied participants, conversation ids, payload fields,
 * links, or dedup keys. The Listing reservation is the authority and every
 * security-relevant output is derived from it inside the locked transaction.
 */
export async function sendCustomOrderReadyLink({ listingId }: { listingId: string }) {
  if (!listingId) return { messageCreated: false };

  const initial = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { seller: { select: { userId: true } } },
  });
  if (!initial) return { messageCreated: false };

  let committed: SentActorCustomOrderReady | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      committed = await sendActorCustomOrderReady(
        initial.seller.userId,
        listingId,
      );
      break;
    } catch (error) {
      const sqlState = getPrismaRawSqlState(error);
      if (sqlState === "40001" && attempt === 0) continue;
      if (sqlState === "22023" || sqlState === "42501") {
        return { messageCreated: false };
      }
      throw error;
    }
  }

  if (committed === null) {
    throw new Error("custom-order-ready authority retry exhausted");
  }

  const source = committed;
  const messageId = committed.messageId;
  const listingLink = publicListingPath(source.listingId, source.listingTitle);
  // The notification writer is source-deduplicated. Re-running it for an
  // existing valid message heals a prior post-commit notification failure
  // without creating another message or notification.
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

  if (committed.created) {
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
  }

  return { messageCreated: committed.created };
}
