import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { stripeLoginLinkRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { isSupportedStripeConnectAccountVersion } from "@/lib/stripeConnectV2";
import { logServerError } from "@/lib/serverErrorLogger";
import { privateJson, privateResponse } from "@/lib/privateResponse";

export async function POST() {
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const { success, reset } = await safeRateLimit(stripeLoginLinkRatelimit, userId);
  if (!success) return privateResponse(rateLimitResponse(reset, "Too many requests. Try again in a few minutes."));

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
  const stripeAccountId = seller?.stripeAccountId;
  if (!stripeAccountId) {
    return privateJson({ error: "No Stripe account connected" }, { status: 400 });
  }
  if (!isSupportedStripeConnectAccountVersion(seller.stripeAccountVersion)) {
    return privateJson({ error: "Reconnect Stripe payouts before opening the dashboard." }, { status: 409 });
  }

  try {
    const loginLink = await stripe.accounts.createLoginLink(stripeAccountId);
    return privateJson({ url: loginLink.url });
  } catch (e) {
    logServerError(e, {
      source: "stripe_connect_login_link",
      extra: { stripeAccountVersion: seller.stripeAccountVersion ?? "legacy" },
    });
    return privateJson({ error: "Failed to generate Stripe link" }, { status: 500 });
  }
}
