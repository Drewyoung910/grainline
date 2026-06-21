import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { isSupportedStripeConnectAccountVersion } from "@/lib/stripeConnectV2";
import { mirrorStripeChargesEnabled } from "@/lib/stripeWebhookMirror";
import { rateLimitResponse, safeRateLimit, stripeConnectRatelimit } from "@/lib/ratelimit";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { HTTP_STATUS } from "@/lib/httpStatus";
import { logServerError } from "@/lib/serverErrorLogger";

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

  try {
    const account = await stripe.accounts.retrieve(seller.stripeAccountId);
    const chargesEnabled = account.charges_enabled ?? false;
    const mirrorResult = await mirrorStripeChargesEnabled({
      accountId: seller.stripeAccountId,
      chargesEnabled,
      route: "/api/stripe/connect/status",
    });

    return privateJson({
      hasStripeAccount: true,
      chargesEnabled: mirrorResult.matched ? mirrorResult.chargesEnabled : chargesEnabled,
    });
  } catch (error) {
    logServerError(error, {
      source: "stripe_connect_status_refresh",
      extra: {
        stripeAccountVersion: seller.stripeAccountVersion ?? "legacy",
        previousChargesEnabled: seller.chargesEnabled,
      },
    });
    return privateJson(
      {
        hasStripeAccount: true,
        chargesEnabled: seller.chargesEnabled,
        refreshUnavailable: true,
      },
      { status: HTTP_STATUS.SERVICE_UNAVAILABLE },
    );
  }
}
