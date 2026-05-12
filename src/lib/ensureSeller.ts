// src/lib/ensureSeller.ts
import { auth, currentUser, clerkClient } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { AccountAccessError } from "@/lib/ensureUser";
import { sanitizeUserName } from "@/lib/sanitize";

export async function ensureSeller() {
  const { userId } = await auth();
  if (!userId) throw new Error("Not signed in");

  // 1) Ensure we have a local User row
  let me = await prisma.user.findUnique({ where: { clerkId: userId } });

  if (!me) {
    // Use currentUser first (cheap), fall back to clerkClient
    const cu = await currentUser();
    const u = cu ?? (await (await clerkClient()).users.getUser(userId));

    const email =
      u?.emailAddresses?.find(e => e.id === u.primaryEmailAddressId)?.emailAddress ??
      u?.emailAddresses?.[0]?.emailAddress ??
      "";
    const name = u?.fullName ? sanitizeUserName(u.fullName) || null : null;
    const imageUrl = u?.imageUrl ?? null;

    me = await prisma.user.create({
      data: { clerkId: userId, email, name, imageUrl },
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

  // 2) Ensure we have a SellerProfile row
  let seller = await prisma.sellerProfile.findUnique({ where: { userId: me.id } });
  if (!seller) {
    seller = await prisma.sellerProfile.create({
      data: {
        userId: me.id,
        displayName: sanitizeUserName(me.name ?? me.email.split("@")[0]) || "Maker",
      },
    });
  }

  return { me, seller };
}
