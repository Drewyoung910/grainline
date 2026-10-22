// src/lib/ensureSeller.ts
import { randomUUID } from "node:crypto";
import { auth, currentUser, clerkClient } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { AccountAccessError, ensureUserByClerkId } from "@/lib/ensureUser";
import { userAccountByClerkId } from "@/lib/userIdentityAccess";
import { sellerOwnerBootstrap } from "@/lib/sellerProfileOwnerAccess";
import {
  normalizeDisplayNameForLookup,
  sanitizeUserName,
} from "@/lib/sanitize";

export async function ensureSeller() {
  const { userId } = await auth();
  if (!userId) throw new Error("Not signed in");

  // 1) Ensure we have a local User row
  let me = await userAccountByClerkId(prisma, userId);

  if (!me) {
    // Use currentUser first (cheap), fall back to clerkClient
    const cu = await currentUser();
    const u = cu ?? (await (await clerkClient()).users.getUser(userId));

    const primaryEmail = u?.emailAddresses?.find(
      (e) => e.id === u.primaryEmailAddressId,
    )?.emailAddress;
    const name = u?.fullName ?? null;
    const imageUrl = u?.imageUrl ?? null;

    me = await ensureUserByClerkId(userId, {
      name,
      imageUrl,
      ...(primaryEmail ? { email: primaryEmail } : {}),
    });
  }
  if (me.banned) {
    throw new AccountAccessError(
      "Your account has been suspended. Contact support@thegrainline.com",
      "ACCOUNT_SUSPENDED",
    );
  }
  if (me.deletedAt) {
    throw new AccountAccessError(
      "This account has been deleted. Contact support@thegrainline.com",
      "ACCOUNT_DELETED",
    );
  }

  // 2) Atomically load or create the SellerProfile row.
  const displayName = sanitizeUserName(me.name ?? "") || "Maker";
  const seller = await sellerOwnerBootstrap(me.id, {
    proposedSellerProfileId: randomUUID(),
    displayName,
    displayNameNormalized: normalizeDisplayNameForLookup(displayName),
  });

  return { me, seller };
}
