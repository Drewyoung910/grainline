import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { stripeConnectRatelimit, safeRateLimit, rateLimitResponse } from "@/lib/ratelimit";

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success: rlOk, reset } = await safeRateLimit(stripeConnectRatelimit, userId);
  if (!rlOk) return rateLimitResponse(reset, "Too many requests.");

  const seller = await prisma.sellerProfile.findFirst({
    where: { user: { clerkId: userId } },
    select: { stripeAccountId: true },
  });
  if (!seller?.stripeAccountId) {
    return NextResponse.json({ error: "Stripe account not connected" }, { status: 400 });
  }

  const link = await stripe.accounts.createLoginLink(seller.stripeAccountId);
  return NextResponse.json({ url: link.url });
}
