import { createHash } from "node:crypto";
import { normalizeClerkWebhookEmail } from "./clerkWebhookEmail.ts";

export type ClerkCurrentUserSnapshot = Readonly<{
  id: string;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string;
  primaryEmailAddressId: string | null;
  emailAddresses: readonly Readonly<{
    id: string;
    emailAddress: string;
  }>[];
}>;

export type ClerkCurrentUserIdentity = Readonly<{
  clerkId: string;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
  primaryEmail: string | null;
  emailResolution:
    | "resolved"
    | "missing_primary_email_id"
    | "primary_email_not_found"
    | "primary_email_empty";
}>;

export function isClerkUserNotFoundError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "clerkError" in error
    && error.clerkError === true
    && "status" in error
    && error.status === 404,
  );
}

export function clerkPlaceholderEmail(clerkId: string) {
  const normalizedId = clerkId.trim();
  if (!normalizedId || normalizedId.length > 255) {
    throw new Error("Clerk user id is invalid");
  }
  if (normalizedId === normalizedId.toLowerCase()) {
    return `${normalizedId}@placeholder.invalid`;
  }
  const digest = createHash("md5").update(normalizedId).digest("hex");
  return `${normalizedId.toLowerCase().slice(0, 200)}-${digest}@placeholder.invalid`;
}

export function clerkCurrentUserIdentityFromSnapshot(
  snapshot: ClerkCurrentUserSnapshot,
  expectedClerkId: string,
): ClerkCurrentUserIdentity {
  if (snapshot.id !== expectedClerkId) {
    throw new Error("Clerk current user lookup returned the wrong account");
  }

  const primaryId = snapshot.primaryEmailAddressId?.trim();
  const primaryAddress = primaryId
    ? snapshot.emailAddresses.find((address) => address.id === primaryId)
    : undefined;
  const primaryEmail = normalizeClerkWebhookEmail(primaryAddress?.emailAddress);
  const emailResolution = !primaryId
    ? "missing_primary_email_id"
    : !primaryAddress
      ? "primary_email_not_found"
      : !primaryEmail
        ? "primary_email_empty"
        : "resolved";

  return Object.freeze({
    clerkId: snapshot.id,
    firstName: snapshot.firstName,
    lastName: snapshot.lastName,
    imageUrl: snapshot.imageUrl || null,
    primaryEmail,
    emailResolution,
  });
}
