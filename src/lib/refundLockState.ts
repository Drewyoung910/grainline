export const REFUND_LOCK_SENTINEL = "pending";
export const REFUND_LOCK_STALE_MS = 5 * 60 * 1000;

type RefundLockState = {
  sellerRefundId: string | null;
  sellerRefundLockedAt: Date | null;
};

export function refundLockCutoff(now = new Date()) {
  return new Date(now.getTime() - REFUND_LOCK_STALE_MS);
}

export function isStaleRefundLock(order: RefundLockState, now = new Date()) {
  if (order.sellerRefundId !== REFUND_LOCK_SENTINEL) return false;

  const lockedAt = order.sellerRefundLockedAt;
  if (!(lockedAt instanceof Date) || Number.isNaN(lockedAt.getTime())) return true;

  return lockedAt.getTime() < refundLockCutoff(now).getTime();
}
