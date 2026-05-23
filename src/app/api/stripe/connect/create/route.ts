import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { safeInternalReturnUrl } from "@/lib/internalReturnUrl";
import { stripeConnectRatelimit, safeRateLimit, rateLimitResponse } from "@/lib/ratelimit";
import {
  createStripeConnectV2Account,
  STRIPE_CONNECT_ACCOUNT_VERSION,
  STRIPE_CONNECT_CONTROLLER_SUMMARY,
  isSupportedStripeConnectAccountVersion,
} from "@/lib/stripeConnectV2";
import { isRequestBodyTooLargeError, readOptionalBoundedJson } from "@/lib/requestBody";
import { z } from "zod";
import { revalidatePublicSellerVisibilityCaches } from "@/lib/searchCache";

const ConnectCreateSchema = z.object({
  returnUrl: z.string().min(1).max(500).optional().nullable(),
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://thegrainline.com";
const STRIPE_CONNECT_CREATE_BODY_MAX_BYTES = 8 * 1024;

export async function POST(req: Request) {
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
    select: {
      id: true,
      stripeAccountId: true,
      stripeAccountVersion: true,
      chargesEnabled: true,
      shipFromCountry: true,
      user: { select: { email: true } },
    },
  });
  if (!seller) return NextResponse.json({ error: "Seller profile not found" }, { status: 404 });

  // Optional custom return URL (used by onboarding wizard)
  let customReturnUrl: string | undefined;
  try {
    const body = ConnectCreateSchema.parse(await readOptionalBoundedJson(req, STRIPE_CONNECT_CREATE_BODY_MAX_BYTES, {}));
    customReturnUrl = safeInternalReturnUrl(body.returnUrl, APP_URL) ?? undefined;
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }
    // no body or invalid JSON — use default
  }

  let accountId = seller.stripeAccountId;

  if (!accountId) {
    const account = await createStripeConnectV2Account({
      email: seller.user.email,
      country: seller.shipFromCountry,
      idempotencyKey: `connect-v2-account:${seller.id}`,
    });
    await prisma.sellerProfile.update({
      where: { id: seller.id },
      data: {
        stripeAccountId: account.id,
        chargesEnabled: false,
        stripeAccountVersion: STRIPE_CONNECT_ACCOUNT_VERSION,
        stripeControllerType: STRIPE_CONNECT_CONTROLLER_SUMMARY,
      },
    });
    if (seller.chargesEnabled) {
      revalidatePublicSellerVisibilityCaches();
    }
    accountId = account.id;
  } else if (!isSupportedStripeConnectAccountVersion(seller.stripeAccountVersion)) {
    return NextResponse.json(
      { error: "This Stripe account was created with an older onboarding flow. Contact support to reconnect payouts." },
      { status: 409 },
    );
  } else {
    // Refresh charges_enabled status from Stripe
    try {
      const account = await stripe.accounts.retrieve(accountId);
      const chargesEnabled = account.charges_enabled ?? false;
      if (chargesEnabled !== seller.chargesEnabled) {
        await prisma.sellerProfile.update({
          where: { id: seller.id },
          data: { chargesEnabled },
        });
        revalidatePublicSellerVisibilityCaches();
      }
    } catch {
      // Non-fatal — continue to return the account link
    }
  }

  const refreshUrl = new URL("/dashboard/seller", APP_URL).toString();
  const returnUrl = customReturnUrl ?? new URL("/dashboard/seller?onboarded=1", APP_URL).toString();

  const link = await stripe.accountLinks.create({
    account: accountId!,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });

  return NextResponse.json({ url: link.url });
}
