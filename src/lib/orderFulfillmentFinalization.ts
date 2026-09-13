import { prisma } from "@/lib/db";
import {
  renderOrderShippedEmail,
  renderReadyForPickupEmail,
} from "@/lib/email";
import {
  enqueueEmailOutboxOnce,
  processEmailOutboxJobById,
} from "@/lib/emailOutbox";
import {
  confirmBuyerOrderReceipt,
  transitionSellerOrderFulfillment,
  type BuyerReceiptAuthorityResult,
  type SellerFulfillmentAuthorityResult,
} from "@/lib/orderFulfillmentAuthority";
import { createNotificationOrThrow } from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";

function optionalDate(value: string | null) {
  if (value === null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("Order fulfillment returned an invalid delivery date");
  }
  return date;
}

/**
 * Commits the fixed seller transition, source-validated in-app Notification
 * and deterministic email reservation together. The outbox worker remains the
 * recovery boundary if the immediate post-commit send does not complete.
 */
export async function finalizeSellerOrderFulfillment(input: {
  actorUserId: string;
  orderId: string;
  action: "shipped" | "ready_for_pickup";
  trackingCarrier?: string | null;
  trackingNumber?: string | null;
}): Promise<SellerFulfillmentAuthorityResult> {
  const committed = await prisma.$transaction(async (tx) => {
    const result = await transitionSellerOrderFulfillment(input, tx);
    if (result.outcome !== "changed" || !result.buyerUserId) {
      return { result, emailOutboxId: null };
    }

    // Keep both domain-event variants as explicit authority call sites. The
    // Notification completeness gate inventories each path independently,
    // while the owner function derives the canonical payload from the audit.
    if (result.action === "shipped") {
      await createNotificationOrThrow({
        userId: result.buyerUserId,
        type: "ORDER_SHIPPED",
        title: "Your piece is on its way!",
        body: result.trackingCarrier
          ? `Shipped via ${result.trackingCarrier}`
          : "Your order has been shipped",
        link: `/dashboard/orders/${result.orderId}`,
        sourceType: NOTIFICATION_SOURCE_TYPES.ORDER_FULFILLMENT,
        sourceId: result.auditLogId,
        relatedUserId: input.actorUserId,
      }, tx);
    } else {
      await createNotificationOrThrow({
        userId: result.buyerUserId,
        type: "ORDER_SHIPPED",
        title: "Ready for pickup!",
        body: "Your order is ready for pickup.",
        link: `/dashboard/orders/${result.orderId}`,
        sourceType: NOTIFICATION_SOURCE_TYPES.ORDER_FULFILLMENT,
        sourceId: result.auditLogId,
        relatedUserId: input.actorUserId,
      }, tx);
    }

    let emailOutboxId: string | null = null;
    if (result.buyerEmail) {
      const email = result.action === "shipped"
        ? renderOrderShippedEmail({
            order: {
              id: result.orderId,
              estimatedDeliveryDate: optionalDate(result.estimatedDeliveryDate),
            },
            buyer: { name: result.buyerName, email: result.buyerEmail },
            carrier: result.trackingCarrier,
            trackingNumber: result.trackingNumber,
          })
        : renderReadyForPickupEmail({
            order: { id: result.orderId },
            buyer: { name: result.buyerName, email: result.buyerEmail },
            seller: { displayName: result.sellerDisplayName },
          });
      const enqueued = await enqueueEmailOutboxOnce({
        ...email,
        dedupKey: `order-fulfillment:${result.auditLogId}`,
        templateName: result.action === "shipped"
          ? "order_shipped"
          : "ready_for_pickup",
        userId: result.buyerUserId,
        sourceType: NOTIFICATION_SOURCE_TYPES.ORDER_FULFILLMENT,
        sourceId: result.auditLogId,
      }, tx);
      emailOutboxId = enqueued.job?.id ?? null;
    }
    return { result, emailOutboxId };
  });

  if (committed.emailOutboxId) {
    const delivery = await processEmailOutboxJobById(committed.emailOutboxId);
    if (delivery === "missing") {
      throw new Error("Committed fulfillment email outbox row is missing");
    }
  }
  return committed.result;
}

/** Buyer receipt and the derived seller Notification are one local commit. */
export async function finalizeBuyerOrderReceipt(input: {
  actorUserId: string;
  orderId: string;
}): Promise<BuyerReceiptAuthorityResult> {
  return prisma.$transaction(async (tx) => {
    const result = await confirmBuyerOrderReceipt(input, tx);
    if (result.outcome !== "changed" || !result.sellerUserId) return result;
    await createNotificationOrThrow({
      userId: result.sellerUserId,
      type: "ORDER_DELIVERED",
      title: result.action === "delivered"
        ? "Buyer confirmed delivery"
        : "Buyer confirmed pickup",
      body: result.action === "delivered"
        ? "The buyer confirmed delivery."
        : "The buyer confirmed pickup.",
      link: `/dashboard/sales/${result.orderId}`,
      sourceType: NOTIFICATION_SOURCE_TYPES.ORDER_FULFILLMENT,
      sourceId: result.auditLogId,
      relatedUserId: input.actorUserId,
    }, tx);
    return result;
  });
}
