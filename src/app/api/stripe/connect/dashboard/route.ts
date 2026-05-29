import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { stripeConnectRatelimit, safeRateLimit, rateLimitResponse } from "@/lib/ratelimit";
import { isSupportedStripeConnectAccountVersion } from "@/lib/stripeConnectV2";

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success: rlOk, reset } = await safeRateLimit(stripeConnectRatelimit, userId);
  if (!rlOk) return rateLimitResponse(reset, "Too many requests.");

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
    return NextResponse.json({ error: "Stripe account not connected" }, { status: 400 });
  }
  if (!isSupportedStripeConnectAccountVersion(seller.stripeAccountVersion)) {
    return NextResponse.json({ error: "Reconnect Stripe payouts before opening the dashboard." }, { status: 409 });
  }

  try {
    const link = await stripe.accounts.createLoginLink(seller.stripeAccountId);
    return NextResponse.json({ url: link.url });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: "stripe_connect_dashboard_link" },
      extra: { stripeAccountVersion: seller.stripeAccountVersion ?? "legacy" },
    });
    return NextResponse.json({ error: "Failed to generate Stripe dashboard link" }, { status: 500 });
  }
}
