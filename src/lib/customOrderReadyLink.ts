import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { sendCustomOrderReady } from "@/lib/email";
import { createNotification } from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
import { publicListingPath } from "@/lib/publicPaths";
import { userEmailDeliveryRecipient } from "@/lib/userEmailDeliveryAccess";
import {
  sendActorCustomOrderReady,
  type SentActorCustomOrderReady,
} from "@/lib/conversationMessageAuthority";
import { getPrismaRawSqlState } from "@/lib/prismaRawSqlError";

/**
 * Emits the buyer's ready-to-purchase card from one durable source id.
 *
 * The caller must pass the seller user id it already authorized or loaded with
 * the Listing. Do not add a caller-supplied buyer, conversation id, payload,
 * link, or dedup key. The fixed database authority verifies seller ownership;
 * the Listing reservation derives every other security-relevant output.
 */
export async function sendCustomOrderReadyLink({
  listingId,
  sellerUserId,
}: {
  listingId: string;
  sellerUserId: string;
}) {
  if (!listingId || !sellerUserId) {
    return { messageDelivered: false, messageCreated: false };
  }

  let committed: SentActorCustomOrderReady | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      committed = await sendActorCustomOrderReady(
        sellerUserId,
        listingId,
      );
      break;
    } catch (error) {
      const sqlState = getPrismaRawSqlState(error);
      if (sqlState === "40001" && attempt === 0) continue;
      if (sqlState === "22023" || sqlState === "42501") {
        return { messageDelivered: false, messageCreated: false };
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
      const buyerRecipient = await userEmailDeliveryRecipient(prisma, {
        userId: source.buyerUserId,
        preferenceKey: "EMAIL_CUSTOM_ORDER",
      });
      if (buyerRecipient) {
        await sendCustomOrderReady({
          buyer: { name: buyerRecipient.name, email: buyerRecipient.email },
          sellerName: source.sellerName ?? "Grainline maker",
          listingTitle: source.listingTitle,
          priceCents: source.priceCents,
          currency: source.currency,
          listingId: source.listingId,
        });
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

  return { messageDelivered: true, messageCreated: committed.created };
}
