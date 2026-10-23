export const RESEND_RECIPIENT_ACTION = Object.freeze({
  SUPPRESS_BOUNCE: "suppress_bounce",
  SUPPRESS_COMPLAINT: "suppress_complaint",
  SUPPRESS_PROVIDER: "suppress_provider",
  OBSERVE_PROVIDER_FAILURE: "observe_provider_failure",
  OBSERVE_DELIVERY_DELAY: "observe_delivery_delay",
  IGNORE: "ignore",
} as const);

export type ResendRecipientAction =
  (typeof RESEND_RECIPIENT_ACTION)[keyof typeof RESEND_RECIPIENT_ACTION];

export type ResendSuppressionReason = "BOUNCE" | "COMPLAINT" | null;
export type ResendSuppressionSource = "resend" | "resend_provider_suppressed" | null;

/**
 * Classify signed Resend delivery events by the action Grainline may take
 * against the recipient address.
 *
 * `email.failed` is intentionally not an address-level failure. Resend emits
 * it for provider and configuration errors as well as invalid recipients.
 * Temporary recipient/server failures use `email.delivery_delayed` or a
 * `Transient` bounce. Only a `Permanent` bounce is durable address evidence.
 */
export function resendRecipientAction(
  type: string,
  bounceType?: string,
): ResendRecipientAction {
  if (type === "email.bounced") {
    const normalizedBounceType = bounceType?.trim().toLowerCase();
    if (normalizedBounceType === "permanent") {
      return RESEND_RECIPIENT_ACTION.SUPPRESS_BOUNCE;
    }
    if (normalizedBounceType === "transient") {
      return RESEND_RECIPIENT_ACTION.OBSERVE_DELIVERY_DELAY;
    }
    return RESEND_RECIPIENT_ACTION.OBSERVE_PROVIDER_FAILURE;
  }
  if (type === "email.complained") return RESEND_RECIPIENT_ACTION.SUPPRESS_COMPLAINT;
  if (type === "email.suppressed") return RESEND_RECIPIENT_ACTION.SUPPRESS_PROVIDER;
  if (type === "email.failed") {
    return RESEND_RECIPIENT_ACTION.OBSERVE_PROVIDER_FAILURE;
  }
  if (type === "email.delivery_delayed") {
    return RESEND_RECIPIENT_ACTION.OBSERVE_DELIVERY_DELAY;
  }
  return RESEND_RECIPIENT_ACTION.IGNORE;
}

export function resendSuppressionReason(
  action: ResendRecipientAction,
): ResendSuppressionReason {
  if (action === RESEND_RECIPIENT_ACTION.SUPPRESS_COMPLAINT) {
    return "COMPLAINT";
  }
  if (
    action === RESEND_RECIPIENT_ACTION.SUPPRESS_BOUNCE
    || action === RESEND_RECIPIENT_ACTION.SUPPRESS_PROVIDER
  ) {
    return "BOUNCE";
  }
  return null;
}

export function resendSuppressionSource(
  action: ResendRecipientAction,
): ResendSuppressionSource {
  if (action === RESEND_RECIPIENT_ACTION.SUPPRESS_PROVIDER) {
    return "resend_provider_suppressed";
  }
  if (
    action === RESEND_RECIPIENT_ACTION.SUPPRESS_BOUNCE
    || action === RESEND_RECIPIENT_ACTION.SUPPRESS_COMPLAINT
  ) {
    return "resend";
  }
  return null;
}
