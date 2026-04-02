// src/app/api/me/route.ts
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ role: null, hasSeller: false, name: null, imageUrl: null, avatarImageUrl: null });

  const user = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: {
      role: true,
      name: true,
      imageUrl: true,
      sellerProfile: { select: { id: true, avatarImageUrl: true } },
    },
  });

  return Response.json({
    role: user?.role ?? null,
    hasSeller: !!user?.sellerProfile,
    name: user?.name ?? null,
    imageUrl: user?.imageUrl ?? null,
    avatarImageUrl: user?.sellerProfile?.avatarImageUrl ?? null,
  });
}
