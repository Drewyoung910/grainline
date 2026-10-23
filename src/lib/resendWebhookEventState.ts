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

type ResendSuppressionIdentity = {
  reason: string;
  source: string | null;
};

export function preserveDirectResendSuppression(
  existing: ResendSuppressionIdentity,
  incoming: ResendSuppressionIdentity,
): boolean {
  return incoming.source === "resend_provider_suppressed"
    && existing.source === "resend"
    && (existing.reason === "BOUNCE" || existing.reason === "COMPLAINT");
}

export async function requireResendRecipientTasks<T>(
  tasks: Promise<T>[],
  source: string,
  onFailure?: (reason: unknown, recipientIndex: number) => void,
): Promise<T[]> {
  const results = await Promise.allSettled(tasks);
  const values: T[] = [];
  const failures: unknown[] = [];

  results.forEach((result, recipientIndex) => {
    if (result.status === "fulfilled") {
      values.push(result.value);
      return;
    }
    failures.push(result.reason);
    onFailure?.(result.reason, recipientIndex);
  });

  if (failures.length > 0) {
    throw new Error(`${source} failed for ${failures.length} recipient(s)`);
  }

  return values;
}

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
