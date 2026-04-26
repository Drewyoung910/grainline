import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { stripeConnectRatelimit, safeRateLimit, rateLimitResponse } from "@/lib/ratelimit";
import { z } from "zod";

const ConnectCreateSchema = z.object({
  returnUrl: z.string().min(1).max(500).optional().nullable(),
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://thegrainline.com";

function safeInternalReturnUrl(returnUrl: string | null | undefined): string | null {
  if (!returnUrl || !returnUrl.startsWith("/") || returnUrl.startsWith("//") || returnUrl.startsWith("/\\")) {
    return null;
  }

  try {
    const parsed = new URL(returnUrl, APP_URL);
    if (parsed.origin !== new URL(APP_URL).origin) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

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
    select: { id: true, stripeAccountId: true },
  });
  if (!seller) return NextResponse.json({ error: "Seller profile not found" }, { status: 404 });

  // Optional custom return URL (used by onboarding wizard)
  let customReturnUrl: string | undefined;
  try {
    const body = ConnectCreateSchema.parse(await req.json());
    customReturnUrl = safeInternalReturnUrl(body.returnUrl) ?? undefined;
  } catch {
    // no body or invalid JSON — use default
  }

  let accountId = seller.stripeAccountId;

  if (!accountId) {
    const account = await stripe.accounts.create({
      type: "express",
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });
    await prisma.sellerProfile.update({
      where: { id: seller.id },
      data: { stripeAccountId: account.id, chargesEnabled: false },
    });
    accountId = account.id;
  } else {
    // Refresh charges_enabled status from Stripe
    try {
      const account = await stripe.accounts.retrieve(accountId);
      await prisma.sellerProfile.update({
        where: { id: seller.id },
        data: { chargesEnabled: account.charges_enabled ?? false },
      });
    } catch {
      // Non-fatal — continue to return the account link
    }
  }

  const refreshUrl = new URL("/seller/payouts", APP_URL).toString();
  const returnUrl = customReturnUrl ?? new URL("/seller/payouts?onboarded=1", APP_URL).toString();

  const link = await stripe.accountLinks.create({
    account: accountId!,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });

  return NextResponse.json({ url: link.url });
}
