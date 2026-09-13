const REFUND_ID_PATTERN = /^re_[A-Za-z0-9_]+$/;

// Stripe's current Refund object does not expose a `livemode` field. Callers
// must establish test mode from the validated sk_test credential and the
// surrounding Session, Charge, Transfer or signed Event. This helper pins the
// real Refund object discriminator and rejects a future explicit live object.
export function assertStripeRefundObject(refund, label = "Stripe refund") {
  if (refund?.object !== "refund"
    || !REFUND_ID_PATTERN.test(String(refund?.id ?? ""))
    || refund?.livemode === true) {
    throw new Error(`${label} object shape drifted`);
  }
  return refund;
}
