// src/app/api/me/route.ts
import { auth } from "@clerk/nextjs/server";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { privateJson } from "@/lib/privateResponse";
import { sellerOwnerAccountSummary } from "@/lib/sellerProfileOwnerAccess";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return privateJson({ role: null, hasSeller: false, name: null, imageUrl: null, avatarImageUrl: null });

  let user;
  try {
    user = await ensureUserByClerkId(userId);
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;
    throw err;
  }

  const sellerProfile = await sellerOwnerAccountSummary(user.id);

  return privateJson({
    role: user.role,
    hasSeller: !!sellerProfile,
    name: user.name,
    imageUrl: user.imageUrl,
    avatarImageUrl: sellerProfile?.avatarImageUrl ?? null,
  });
}
