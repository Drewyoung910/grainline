import { prisma } from "@/lib/db";
import { REFUND_LOCK_SENTINEL, refundLockCutoff } from "@/lib/refundLockState";

export {
  REFUND_AMBIGUOUS_SENTINEL,
  REFUND_LOCK_SENTINEL,
  REFUND_LOCK_STALE_MS,
} from "@/lib/refundLockState";

export async function releaseStaleRefundLocks(orderId?: string) {
  const cutoff = refundLockCutoff();
  return prisma.order.updateMany({
    where: {
      ...(orderId ? { id: orderId } : {}),
      sellerRefundId: REFUND_LOCK_SENTINEL,
      // Case resolution claims are explicit durable leases. They may only be
      // retried or released by the fixed reconciliation authority, never by
      // elapsed wall time.
      caseResolutionClaimId: null,
      OR: [
        { sellerRefundLockedAt: null },
        { sellerRefundLockedAt: { lt: cutoff } },
      ],
    },
    data: {
      sellerRefundId: null,
      sellerRefundLockedAt: null,
    },
  });
}
