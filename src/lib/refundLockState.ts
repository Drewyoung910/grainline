export const REFUND_LOCK_SENTINEL = "pending";
export const REFUND_AMBIGUOUS_SENTINEL = "ambiguous_refund_pending_reconciliation";
export const REFUND_LOCK_STALE_MS = 15 * 60 * 1000;

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

export function isAmbiguousRefundState(sellerRefundId: string | null | undefined) {
  return sellerRefundId === REFUND_AMBIGUOUS_SENTINEL;
}

export function isRefundProcessingState(sellerRefundId: string | null | undefined) {
  return sellerRefundId === REFUND_LOCK_SENTINEL || isAmbiguousRefundState(sellerRefundId);
}

export function isRecordedRefundId(sellerRefundId: string | null | undefined) {
  return Boolean(sellerRefundId && !isRefundProcessingState(sellerRefundId));
}
