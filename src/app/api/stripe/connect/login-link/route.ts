import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { stripeLoginLinkRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success, reset } = await safeRateLimit(stripeLoginLinkRatelimit, userId);
  if (!success) return rateLimitResponse(reset, "Too many requests. Try again in a few minutes.");

  const user = await prisma.user.findUnique({
    where: { clerkId: userId },
    include: { sellerProfile: { select: { stripeAccountId: true } } },
  });

  const stripeAccountId = user?.sellerProfile?.stripeAccountId;
  if (!stripeAccountId) {
    return NextResponse.json({ error: "No Stripe account connected" }, { status: 400 });
  }

  try {
    const loginLink = await stripe.accounts.createLoginLink(stripeAccountId);
    return NextResponse.json({ url: loginLink.url });
  } catch (e) {
    console.error("Failed to create Stripe login link:", e);
    return NextResponse.json({ error: "Failed to generate Stripe link" }, { status: 500 });
  }
}
