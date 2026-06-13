import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { isSupportedStripeConnectAccountVersion } from "@/lib/stripeConnectV2";
import { rateLimitResponse, safeRateLimit, stripeConnectRatelimit } from "@/lib/ratelimit";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { revalidatePublicSellerVisibilityCaches } from "@/lib/searchCache";
import { HTTP_STATUS } from "@/lib/httpStatus";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });

  const { success: rlOk, reset } = await safeRateLimit(stripeConnectRatelimit, userId);
  if (!rlOk) return privateResponse(rateLimitResponse(reset, "Too many Stripe status checks."));

  let me: Awaited<ReturnType<typeof ensureUserByClerkId>>;
  try {
    me = await ensureUserByClerkId(userId);
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;
    throw err;
  }

  const seller = await prisma.sellerProfile.findUnique({
    where: { userId: me.id },
    select: { id: true, stripeAccountId: true, stripeAccountVersion: true, chargesEnabled: true },
  });
  if (!seller?.stripeAccountId) {
    return privateJson({ hasStripeAccount: false, chargesEnabled: false });
  }
  if (!isSupportedStripeConnectAccountVersion(seller.stripeAccountVersion)) {
    return privateJson(
      { error: "Reconnect Stripe payouts before checking status." },
      { status: HTTP_STATUS.CONFLICT },
    );
  }

  const account = await stripe.accounts.retrieve(seller.stripeAccountId);
  const chargesEnabled = account.charges_enabled ?? false;
  if (chargesEnabled !== seller.chargesEnabled) {
    await prisma.sellerProfile.update({
      where: { id: seller.id },
      data: { chargesEnabled },
    });
    revalidatePublicSellerVisibilityCaches();
  }

  return privateJson({ hasStripeAccount: true, chargesEnabled });
}
