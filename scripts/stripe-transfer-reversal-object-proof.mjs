const TRANSFER_REVERSAL_ID_PATTERN = /^trr_[A-Za-z0-9_]+$/;

// Stripe's current TransferReversal object does not expose a `livemode` field.
// Callers must establish test mode from the validated sk_test credential and
// the parent Transfer. This helper pins the real object discriminator and
// rejects a future explicit live object.
export function assertStripeTransferReversalObject(
  reversal,
  label = "Stripe transfer reversal",
) {
  if (reversal?.object !== "transfer_reversal"
    || !TRANSFER_REVERSAL_ID_PATTERN.test(String(reversal?.id ?? ""))
    || reversal?.livemode === true) {
    throw new Error(`${label} object shape drifted`);
  }
  return reversal;
}
