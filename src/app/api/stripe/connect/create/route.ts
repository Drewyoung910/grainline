import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { z } from "zod";

const ConnectCreateSchema = z.object({
  returnUrl: z.string().min(1).max(500).optional().nullable(),
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Find this user's seller profile
  const seller = await prisma.sellerProfile.findFirst({
    where: { user: { clerkId: userId } },
    select: { id: true, stripeAccountId: true },
  });
  if (!seller) return NextResponse.json({ error: "Seller profile not found" }, { status: 404 });

  // Optional custom return URL (used by onboarding wizard)
  let customReturnUrl: string | undefined;
  try {
    const body = ConnectCreateSchema.parse(await req.json());
    if (body.returnUrl && body.returnUrl.startsWith("/")) {
      customReturnUrl = `${process.env.NEXT_PUBLIC_APP_URL}${body.returnUrl}`;
    }
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

  const refreshUrl = `${process.env.NEXT_PUBLIC_APP_URL}/seller/payouts`;
  const returnUrl  = customReturnUrl ?? `${process.env.NEXT_PUBLIC_APP_URL}/seller/payouts?onboarded=1`;

  const link = await stripe.accountLinks.create({
    account: accountId!,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });

  return NextResponse.json({ url: link.url });
}
