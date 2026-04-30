// src/app/api/me/route.ts
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { ensureUserByClerkId } from "@/lib/ensureUser";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ role: null, hasSeller: false, name: null, imageUrl: null, avatarImageUrl: null });

  let user;
  try {
    user = await ensureUserByClerkId(userId);
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;
    throw err;
  }

  const sellerProfile = await prisma.sellerProfile.findUnique({
    where: { userId: user.id },
    select: { id: true, avatarImageUrl: true },
  });

  return Response.json({
    role: user.role,
    hasSeller: !!sellerProfile,
    name: user.name,
    imageUrl: user.imageUrl,
    avatarImageUrl: sellerProfile?.avatarImageUrl ?? null,
  });
}
