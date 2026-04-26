import { prisma } from "@/lib/db";

export const REFUND_LOCK_SENTINEL = "pending";
export const REFUND_LOCK_STALE_MS = 5 * 60 * 1000;

export async function releaseStaleRefundLocks(orderId?: string) {
  const cutoff = new Date(Date.now() - REFUND_LOCK_STALE_MS);
  return prisma.order.updateMany({
    where: {
      ...(orderId ? { id: orderId } : {}),
      sellerRefundId: REFUND_LOCK_SENTINEL,
      sellerRefundLockedAt: { lt: cutoff },
    },
    data: {
      sellerRefundId: null,
      sellerRefundLockedAt: null,
    },
  });
}
