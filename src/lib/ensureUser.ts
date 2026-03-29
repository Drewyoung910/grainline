// src/lib/ensureUser.ts
import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

/**
 * Upserts a User row given a Clerk userId.
 * - On CREATE: uses provided fields, or falls back to a placeholder email.
 * - On UPDATE: **does not overwrite** existing email/name/image unless explicitly provided.
 */
export async function ensureUserByClerkId(
  clerkId: string,
  opts?: { email?: string; name?: string | null; imageUrl?: string | null }
) {
  const existing = await prisma.user.findUnique({ where: { clerkId } });

  if (existing) {
    const updateData: Record<string, string | null> = {};

    // Only update fields if caller explicitly provided them
    if (typeof opts?.email === "string" && opts.email.trim() !== "") {
      updateData.email = opts.email.trim();
    }
    if (opts && "name" in opts) {
      updateData.name = opts.name ?? null;
    }
    if (opts && "imageUrl" in opts) {
      updateData.imageUrl = opts.imageUrl ?? null;
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
  const name = (opts?.name ?? null) as string | null;
  const imageUrl = (opts?.imageUrl ?? null) as string | null;

  return prisma.user.create({
    data: { clerkId, email, name, imageUrl },
  });
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
    u.emailAddresses?.[0]?.emailAddress ?? `${u.id}@placeholder.invalid`;

  const name =
    u.fullName ||
    [u.firstName, u.lastName].filter(Boolean).join(" ") ||
    null;

  const imageUrl = u.imageUrl ?? null;

  // Here we DO pass real fields so your DB stays accurate
  return ensureUserByClerkId(u.id, { email, name, imageUrl });
}





