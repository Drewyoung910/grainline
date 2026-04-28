// src/lib/ensureUser.ts
import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { sanitizeUserName } from "@/lib/sanitize";

export class AccountAccessError extends Error {
  status = 403;

  constructor(
    message: string,
    public code: "ACCOUNT_SUSPENDED" | "ACCOUNT_DELETED",
  ) {
    super(message);
    this.name = "AccountAccessError";
  }
}

export function isAccountAccessError(error: unknown): error is AccountAccessError {
  return error instanceof AccountAccessError;
}

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
    termsAcceptedAt?: Date | null;
    termsVersion?: string | null;
    ageAttestedAt?: Date | null;
  }
) {
  const existing = await prisma.user.findUnique({ where: { clerkId } });

  if (existing) {
    if (existing.banned) {
      throw new AccountAccessError(
        "Your account has been suspended. Contact support@thegrainline.com",
        "ACCOUNT_SUSPENDED",
      );
    }
    if (existing.deletedAt) {
      throw new AccountAccessError(
        "This account has been deleted. Contact support@thegrainline.com",
        "ACCOUNT_DELETED",
      );
    }
    const updateData: {
      email?: string;
      name?: string | null;
      imageUrl?: string | null;
      termsAcceptedAt?: Date;
      termsVersion?: string | null;
      ageAttestedAt?: Date;
    } = {};

    // Only update fields if caller explicitly provided them
    if (typeof opts?.email === "string" && opts.email.trim() !== "") {
      updateData.email = opts.email.trim();
    }
    if (opts && "name" in opts) {
      updateData.name = opts.name ? sanitizeUserName(opts.name) || null : null;
    }
    if (opts && "imageUrl" in opts) {
      updateData.imageUrl = opts.imageUrl ?? null;
    }
    if (opts?.termsAcceptedAt) {
      updateData.termsAcceptedAt = opts.termsAcceptedAt;
    }
    if (opts && "termsVersion" in opts) {
      updateData.termsVersion = opts.termsVersion ?? null;
    }
    if (opts?.ageAttestedAt) {
      updateData.ageAttestedAt = opts.ageAttestedAt;
    }

    // If nothing to update, just return existing
    if (Object.keys(updateData).length === 0) return existing;

    try {
      return await prisma.user.update({
        where: { clerkId },
        data: updateData,
      });
    } catch (e) {
      // P2002 = unique constraint violation (another row already has this email)
      if ((e as { code?: string }).code === "P2002" && updateData.email) {
        const { email: _dropped, ...dataWithoutEmail } = updateData;
        if (Object.keys(dataWithoutEmail).length === 0) return existing;
        return prisma.user.update({
          where: { clerkId },
          data: dataWithoutEmail,
        });
      }
      throw e;
    }
  }

  // CREATE path: allow placeholder email if none provided
  const email = (opts?.email ?? `${clerkId}@placeholder.invalid`).trim();
  const name = opts?.name ? sanitizeUserName(opts.name) || null : null;
  const imageUrl = (opts?.imageUrl ?? null) as string | null;

  return prisma.user.create({
    data: {
      clerkId,
      email,
      name,
      imageUrl,
      ...(opts?.termsAcceptedAt ? { termsAcceptedAt: opts.termsAcceptedAt } : {}),
      ...(opts?.termsVersion ? { termsVersion: opts.termsVersion } : {}),
      ...(opts?.ageAttestedAt ? { ageAttestedAt: opts.ageAttestedAt } : {}),
    },
  });
}

function dateFromMetadata(value: unknown): Date | null {
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "number") {
    const millis = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
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

  const email =
    u.emailAddresses?.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ??
    u.emailAddresses?.[0]?.emailAddress ??
    `${u.id}@placeholder.invalid`;

  const name =
    u.fullName ||
    [u.firstName, u.lastName].filter(Boolean).join(" ") ||
    null;

  const imageUrl = u.imageUrl ?? null;

  const unsafeMetadata = (u.unsafeMetadata ?? {}) as Record<string, unknown>;
  const legalAcceptedAt = (u as unknown as { legalAcceptedAt?: number | string | null }).legalAcceptedAt;
  const termsAcceptedAt =
    dateFromMetadata(unsafeMetadata.termsAcceptedAt) ?? dateFromMetadata(legalAcceptedAt);
  const ageAttestedAt = dateFromMetadata(unsafeMetadata.ageAttestedAt);
  const termsVersion =
    typeof unsafeMetadata.termsVersion === "string" ? unsafeMetadata.termsVersion.slice(0, 50) : undefined;

  // Here we DO pass real fields so your DB stays accurate
  const result = await ensureUserByClerkId(u.id, {
    email,
    name,
    imageUrl,
    termsAcceptedAt,
    ageAttestedAt,
    termsVersion,
  });
  if (result && (result as { banned?: boolean }).banned) {
    throw new AccountAccessError(
      "Your account has been suspended. Contact support@thegrainline.com",
      "ACCOUNT_SUSPENDED",
    );
  }
  return result;
}
