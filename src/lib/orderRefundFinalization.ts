import { prisma } from "@/lib/db";
import { renderRefundIssuedEmail } from "@/lib/email";
import {
  enqueueEmailOutboxOnce,
  processEmailOutboxJobById,
} from "@/lib/emailOutbox";
import { localRefundEvidenceEventId } from "@/lib/localRefundEvidence";
import { createNotificationOrThrow } from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
import type { OrderRefundClaim } from "@/lib/orderRefundClaimAuthority";
import {
  recordBlockedCheckoutOrderRefund,
  recordReconciledBlockedCheckoutOrderRefund,
  recordSellerOrderRefund,
  type OrderRefundProviderEvidence,
} from "@/lib/orderRefundRecordAuthority";

const SELLER_REFUND_ACTION = "SELLER_REFUND_RECORDED";
const BLOCKED_CHECKOUT_REFUND_ACTION = "BLOCKED_CHECKOUT_REFUND_RECORDED";

/**
 * Commits the source-bound payment record and every durable buyer-facing
 * seller-refund side effect together. The email worker remains the delivery
 * boundary: after this transaction commits it can recover a missed direct
 * send from the deterministic outbox row without replaying the Stripe refund.
 */
export async function finalizeSellerOrderRefund(input: {
  actorUserId: string;
  orderId: string;
  claim: OrderRefundClaim;
  evidence: OrderRefundProviderEvidence;
}) {
  const committed = await prisma.$transaction(async (tx) => {
    const result = await recordSellerOrderRefund(input, tx);
    if (!result.buyerUserId) {
      return { result, emailOutboxId: null };
    }

    const sourceId = localRefundEvidenceEventId(
      SELLER_REFUND_ACTION,
      result.refundId,
    );
    await createNotificationOrThrow({
      userId: result.buyerUserId,
      type: "REFUND_ISSUED",
      title: "Refund issued",
      body: "Your refund has been issued.",
      sourceType: NOTIFICATION_SOURCE_TYPES.ORDER_PAYMENT,
      sourceId: sourceId,
      relatedUserId: input.actorUserId,
    }, tx);

    const buyer = await tx.user.findUnique({
      where: { id: result.buyerUserId },
      select: { name: true, email: true },
    });
    let emailOutboxId: string | null = null;
    if (buyer?.email) {
      const email = renderRefundIssuedEmail({
        buyer,
        refundAmountCents: result.refundAmountCents,
        currency: input.claim.currency,
        orderId: result.orderId,
      });
      const enqueued = await enqueueEmailOutboxOnce(
        {
          ...email,
          dedupKey: `refund-issued:${sourceId}`,
          templateName: "refund_issued",
          userId: result.buyerUserId,
          preferenceKey: "EMAIL_REFUND_ISSUED",
          sourceType: NOTIFICATION_SOURCE_TYPES.ORDER_PAYMENT,
          sourceId,
        },
        tx,
      );
      emailOutboxId = enqueued.job?.id ?? null;
    }

    return { result, emailOutboxId };
  });

  if (committed.emailOutboxId) {
    const delivery = await processEmailOutboxJobById(committed.emailOutboxId);
    if (delivery === "missing") {
      throw new Error("Committed refund email outbox row is missing");
    }
  }
  return committed.result;
}

/**
 * The blocked-checkout path has no email contract, but its source-validated
 * buyer notification must commit with the payment record for the same crash
 * safety and replay semantics.
 */
export async function finalizeBlockedCheckoutOrderRefund(input: {
  orderId: string;
  claim: OrderRefundClaim;
  evidence: OrderRefundProviderEvidence;
  reconciliationId?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const result = input.reconciliationId
      ? await recordReconciledBlockedCheckoutOrderRefund(
          {
            reconciliationId: input.reconciliationId,
            orderId: input.orderId,
            claim: input.claim,
            evidence: input.evidence,
          },
          tx,
        )
      : await recordBlockedCheckoutOrderRefund(input, tx);
    if (!result.buyerUserId) return result;

    await createNotificationOrThrow({
      userId: result.buyerUserId,
      type: "NEW_ORDER",
      title: "Payment refunded",
      body: "Your payment was refunded because this order could not be completed.",
      sourceType: NOTIFICATION_SOURCE_TYPES.ORDER_PAYMENT,
      sourceId: localRefundEvidenceEventId(
        BLOCKED_CHECKOUT_REFUND_ACTION,
        result.refundId,
      ),
    }, tx);

    return result;
  });
}
