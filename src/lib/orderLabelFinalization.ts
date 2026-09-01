import { prisma } from "@/lib/db";
import { renderOrderShippedEmail } from "@/lib/email";
import { enqueueEmailOutboxOnce, processEmailOutboxJobById } from "@/lib/emailOutbox";
import {
  recordSellerLabelProviderResult,
  type SellerLabelProviderRecordResult,
} from "@/lib/orderLabelAuthority";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";

function optionalDate(value: string | null) {
  if (value === null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("Order label delivery date is invalid");
  return date;
}

/**
 * Records the source-bound Shippo result. Its fixed database operation
 * co-commits the normal shipped Notification from the immutable Order seller
 * relationship; this wrapper co-commits the deterministic email reservation.
 * A provider rejection or ambiguous response produces no buyer-visible event.
 */
export async function finalizeSellerLabelProviderResult(
  input: Parameters<typeof recordSellerLabelProviderResult>[0],
): Promise<SellerLabelProviderRecordResult> {
  const committed = await prisma.$transaction(async (tx) => {
    const result = await recordSellerLabelProviderResult(input, tx);
    if (result.outcome !== "recorded" || !result.buyerUserId) {
      return { result, emailOutboxId: null };
    }

    let emailOutboxId: string | null = null;
    if (result.buyerEmail) {
      const email = renderOrderShippedEmail({
        order: {
          id: result.orderId,
          estimatedDeliveryDate: optionalDate(result.estimatedDeliveryDate),
        },
        buyer: { name: result.buyerName, email: result.buyerEmail },
        carrier: result.carrier,
        trackingNumber: result.trackingNumber,
      });
      const enqueued = await enqueueEmailOutboxOnce({
        ...email,
        dedupKey: `order-label-shipped:${result.auditLogId}`,
        templateName: "order_shipped",
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
      throw new Error("Committed Order label email outbox row is missing");
    }
  }
  return committed.result;
}
