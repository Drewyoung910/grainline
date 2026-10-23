export const RESEND_RECIPIENT_ACTION = Object.freeze({
  SUPPRESS_BOUNCE: "suppress_bounce",
  SUPPRESS_COMPLAINT: "suppress_complaint",
  OBSERVE_PROVIDER_FAILURE: "observe_provider_failure",
  OBSERVE_DELIVERY_DELAY: "observe_delivery_delay",
  IGNORE: "ignore",
} as const);

export type ResendRecipientAction =
  (typeof RESEND_RECIPIENT_ACTION)[keyof typeof RESEND_RECIPIENT_ACTION];

/**
 * Classify signed Resend delivery events by the action Grainline may take
 * against the recipient address.
 *
 * `email.failed` is intentionally not an address-level failure. Resend emits
 * it for provider and configuration errors as well as invalid recipients.
 * Temporary recipient/server failures use `email.delivery_delayed`; Resend
 * retries those before emitting a terminal bounce.
 */
export function resendRecipientAction(type: string): ResendRecipientAction {
  if (type === "email.bounced") return RESEND_RECIPIENT_ACTION.SUPPRESS_BOUNCE;
  if (type === "email.complained" || type === "email.suppressed") {
    return RESEND_RECIPIENT_ACTION.SUPPRESS_COMPLAINT;
  }
  if (type === "email.failed") {
    return RESEND_RECIPIENT_ACTION.OBSERVE_PROVIDER_FAILURE;
  }
  if (type === "email.delivery_delayed") {
    return RESEND_RECIPIENT_ACTION.OBSERVE_DELIVERY_DELAY;
  }
  return RESEND_RECIPIENT_ACTION.IGNORE;
}
