export type CheckoutStockReservationRepairAction =
  | "restore"
  | "expire_and_restore"
  | "skip_paid_or_complete"
  | "skip_unrecognized";

export function checkoutStockReservationRepairAction(session: {
  status?: string | null;
  payment_status?: string | null;
}): CheckoutStockReservationRepairAction {
  const status = (session.status ?? "").toLowerCase();
  const paymentStatus = (session.payment_status ?? "").toLowerCase();

  if (paymentStatus === "paid" || status === "complete") return "skip_paid_or_complete";
  if (status === "expired") return "restore";
  if (status === "open") return "expire_and_restore";
  return "skip_unrecognized";
}
