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

  const email = primaryAddress.email_address?.trim();
  if (!email) {
    return { reason: "primary_email_empty", email: null };
  }

  return { reason: "resolved", email };
}
