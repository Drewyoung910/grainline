import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { stripeConnectRatelimit, safeRateLimit, rateLimitResponse } from "@/lib/ratelimit";
import { isSupportedStripeConnectAccountVersion } from "@/lib/stripeConnectV2";
import { logServerError } from "@/lib/serverErrorLogger";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { HTTP_STATUS } from "@/lib/httpStatus";

export async function POST() {
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });

  const { success: rlOk, reset } = await safeRateLimit(stripeConnectRatelimit, userId);
  if (!rlOk) return privateResponse(rateLimitResponse(reset, "Too many requests."));

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
    select: { stripeAccountId: true, stripeAccountVersion: true },
  });
  if (!seller?.stripeAccountId) {
    return privateJson({ error: "Stripe account not connected" }, { status: HTTP_STATUS.BAD_REQUEST });
  }
  if (!isSupportedStripeConnectAccountVersion(seller.stripeAccountVersion)) {
    return privateJson({ error: "Reconnect Stripe payouts before opening the dashboard." }, { status: HTTP_STATUS.CONFLICT });
  }

  try {
    const link = await stripe.accounts.createLoginLink(seller.stripeAccountId);
    return privateJson({ url: link.url });
  } catch (error) {
    logServerError(error, {
      source: "stripe_connect_dashboard_link",
      extra: { stripeAccountVersion: seller.stripeAccountVersion ?? "legacy" },
    });
    return privateJson({ error: "Failed to generate Stripe dashboard link" }, { status: HTTP_STATUS.INTERNAL_SERVER_ERROR });
  }
}
