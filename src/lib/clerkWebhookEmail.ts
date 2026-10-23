export interface ClerkWebhookEmailAddress {
  id?: string | null;
  email_address?: string | null;
}

export type ClerkWebhookEmailResolutionReason =
  | "resolved"
  | "missing_primary_email_id"
  | "primary_email_not_found"
  | "primary_email_empty";

export type ClerkWebhookEmailResolution =
  | {
      reason: "resolved";
      email: string;
    }
  | {
      reason: Exclude<ClerkWebhookEmailResolutionReason, "resolved">;
      email: null;
    };

export function normalizeClerkWebhookEmail(email: string | null | undefined): string | null {
  const normalized = email?.trim().normalize("NFC").toLowerCase();
  if (!normalized || !normalized.includes("@")) return null;
  return normalized;
}

export function resolveClerkWebhookPrimaryEmail({
  emailAddresses,
  primaryEmailAddressId,
}: {
  emailAddresses: ClerkWebhookEmailAddress[] | null | undefined;
  primaryEmailAddressId: string | null | undefined;
}): ClerkWebhookEmailResolution {
  const primaryId = primaryEmailAddressId?.trim();
  if (!primaryId) {
    return { reason: "missing_primary_email_id", email: null };
  }

  const primaryAddress = emailAddresses?.find((address) => address.id === primaryId);
  if (!primaryAddress) {
    return { reason: "primary_email_not_found", email: null };
  }

  const email = normalizeClerkWebhookEmail(primaryAddress.email_address);
  if (!email) {
    return { reason: "primary_email_empty", email: null };
  }

  return { reason: "resolved", email };
}

export function shouldReserveClerkWelcomeEmail({
  eventType,
  email,
  welcomeEmailSentAt,
}: {
  eventType: string;
  email: string | null | undefined;
  welcomeEmailSentAt: Date | string | null | undefined;
}) {
  return eventType === "user.created" && Boolean(email?.trim()) && !welcomeEmailSentAt;
}

export type ClerkWelcomeDelivery<T> = {
  kind: "buyer" | "seller";
  email: T;
  dedupKey: string;
};

export async function deliverClerkWelcomeEmails<T>({
  deliveries,
  send,
  enqueue,
  onSendError,
  onEnqueueError,
}: {
  deliveries: ClerkWelcomeDelivery<T>[];
  send: (delivery: ClerkWelcomeDelivery<T>) => Promise<void>;
  enqueue: (delivery: ClerkWelcomeDelivery<T>) => Promise<void>;
  onSendError?: (error: unknown, delivery: ClerkWelcomeDelivery<T>) => void;
  onEnqueueError?: (error: unknown, delivery: ClerkWelcomeDelivery<T>) => void;
}) {
  for (const delivery of deliveries) {
    try {
      await send(delivery);
    } catch (error) {
      onSendError?.(error, delivery);
      try {
        await enqueue(delivery);
      } catch (enqueueError) {
        onEnqueueError?.(enqueueError, delivery);
      }
    }
  }
}
