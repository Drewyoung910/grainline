import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { stripeLoginLinkRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success, reset } = await safeRateLimit(stripeLoginLinkRatelimit, userId);
  if (!success) return rateLimitResponse(reset, "Too many requests. Try again in a few minutes.");

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
    select: { stripeAccountId: true },
  });
  const stripeAccountId = seller?.stripeAccountId;
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
