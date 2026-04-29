import { prisma } from "@/lib/db";
import { REFUND_LOCK_SENTINEL, refundLockCutoff } from "@/lib/refundLockState";

export { REFUND_LOCK_SENTINEL, REFUND_LOCK_STALE_MS } from "@/lib/refundLockState";

export async function releaseStaleRefundLocks(orderId?: string) {
  const cutoff = refundLockCutoff();
  return prisma.order.updateMany({
    where: {
      ...(orderId ? { id: orderId } : {}),
      sellerRefundId: REFUND_LOCK_SENTINEL,
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
