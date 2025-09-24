import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

export async function ensureSeller() {
  const u = await currentUser();
  if (!u) throw new Error("Not signed in");

  const email = u.emailAddresses?.[0]?.emailAddress ?? "";
  const name =
    [u.firstName, u.lastName].filter(Boolean).join(" ") ||
    u.username ||
    email.split("@")[0];

  const me = await prisma.user.upsert({
    where: { clerkId: u.id },
    update: { email, name, imageUrl: u.imageUrl ?? null },
    create: { clerkId: u.id, email, name, imageUrl: u.imageUrl ?? null },
  });

  const seller = await prisma.sellerProfile.upsert({
    where: { userId: me.id },
    update: { displayName: me.name ?? "Seller" },
    create: { userId: me.id, displayName: me.name ?? "Seller" },
  });

  return { me, seller };
}

