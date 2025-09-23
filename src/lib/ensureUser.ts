// src/lib/ensureUser.ts
import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db"; // <-- named import

export async function ensureUser() {
  const u = await currentUser();
  if (!u) return null;

  const email = u.emailAddresses?.[0]?.emailAddress ?? null;
  const name =
    u.fullName ?? ([u.firstName, u.lastName].filter(Boolean).join(" ") || null);
  const imageUrl = u.imageUrl ?? null;

  const me = await prisma.user.upsert({
    where: { clerkId: u.id },
    update: { email, name, imageUrl },
    create: { clerkId: u.id, email, name, imageUrl },
  });

  return me;
}

