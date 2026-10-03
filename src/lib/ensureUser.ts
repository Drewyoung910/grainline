// src/lib/ensureUser.ts
import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { sanitizeUserName } from "@/lib/sanitize";
import {
  AccountAccessError,
  isAccountAccessError,
} from "@/lib/accountAccessError";
import { normalizeEmailAddress } from "@/lib/emailSuppression";
import { ensureUserIdentityByClerkId } from "@/lib/userIdentityAccess";
import * as Sentry from "@sentry/nextjs";

export { AccountAccessError, isAccountAccessError };

/**
 * Upserts a User row given a Clerk userId.
 * - On CREATE: uses provided fields, or falls back to a placeholder email.
 * - On UPDATE: **does not overwrite** existing email/name/image unless explicitly provided.
 */
export async function ensureUserByClerkId(
  clerkId: string,
  opts?: {
    email?: string;
    name?: string | null;
    imageUrl?: string | null;
  },
) {
  const identity: {
    clerkId: string;
    email?: string;
    name?: string | null;
    imageUrl?: string | null;
  } = { clerkId };
  if (typeof opts?.email === "string" && opts.email.trim() !== "") {
    const normalizedEmail = normalizeEmailAddress(opts.email);
    if (normalizedEmail) identity.email = normalizedEmail;
  }
  if (opts && "name" in opts) {
    identity.name = opts.name ? sanitizeUserName(opts.name) || null : null;
  }
  if (opts && "imageUrl" in opts) {
    identity.imageUrl = opts.imageUrl ?? null;
  }
  const result = await prisma.$transaction((tx) =>
    ensureUserIdentityByClerkId(tx, identity),
  );
  if (result.emailConflict) {
    Sentry.captureMessage("Clerk identity email belongs to another account", {
      level: "warning",
      tags: {
        source: result.created
          ? "ensure_user_create_email_conflict"
          : "ensure_user_email_conflict",
      },
      extra: { clerkId, droppedField: "email" },
    });
  }
  if (result.user.banned) {
    throw new AccountAccessError(
      "Your account has been suspended. Contact support@thegrainline.com",
      "ACCOUNT_SUSPENDED",
    );
  }
  if (result.user.deletedAt) {
    throw new AccountAccessError(
      "This account has been deleted. Contact support@thegrainline.com",
      "ACCOUNT_DELETED",
    );
  }
  return result.user;
}

/**
 * Convenience wrapper that reads the signed-in user via Clerk and ensures a DB user.
 * Returns `null` if no user is signed in.
 * - On create: seeds real email/name/image.
 * - On update: refreshes email/name/image from Clerk.
 */
export async function ensureUser() {
  const u = await currentUser();
  if (!u) return null;

  const primaryEmail = u.emailAddresses?.find(
    (e) => e.id === u.primaryEmailAddressId,
  )?.emailAddress;

  const name =
    u.fullName || [u.firstName, u.lastName].filter(Boolean).join(" ") || null;

  const imageUrl = u.imageUrl ?? null;

  const userFields: Parameters<typeof ensureUserByClerkId>[1] = {
    name,
    imageUrl,
    ...(primaryEmail ? { email: primaryEmail } : {}),
  };

  // Profile synchronization deliberately excludes legal acceptance state.
  // Only /api/account/accept-terms may write those durable audit fields.
  const result = await ensureUserByClerkId(u.id, userFields);
  if (result && (result as { banned?: boolean }).banned) {
    throw new AccountAccessError(
      "Your account has been suspended. Contact support@thegrainline.com",
      "ACCOUNT_SUSPENDED",
    );
  }
  return result;
}
