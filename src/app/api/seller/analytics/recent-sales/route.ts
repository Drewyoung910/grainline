// src/app/api/seller/analytics/recent-sales/route.ts
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { rateLimitResponse, safeRateLimit, sellerAnalyticsRatelimit } from "@/lib/ratelimit";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { blockingRefundLedgerWhere } from "@/lib/refundRouteState";
import { logServerError } from "@/lib/serverErrorLogger";
import { paidStripeOrderWhere } from "@/lib/orderTrust";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return privateJson({ error: "Sign in required" }, { status: 401 });

    const { success, reset } = await safeRateLimit(sellerAnalyticsRatelimit, userId);
    if (!success) return privateResponse(rateLimitResponse(reset, "Too many analytics requests."));

    const me = await ensureUserByClerkId(userId);
    const sellerProfile = await prisma.sellerProfile.findUnique({
      where: { userId: me.id },
      select: { id: true, onboardingComplete: true, chargesEnabled: true },
    });
    if (!sellerProfile) return privateJson({ error: "Seller profile not found" }, { status: 404 });
    if (!sellerProfile.onboardingComplete) {
      return privateJson(
        {
          error: sellerProfile.chargesEnabled
            ? "Finish setup to start accepting orders."
            : "Connect Stripe to start accepting orders.",
          code: "SETUP_REQUIRED",
          chargesEnabled: sellerProfile.chargesEnabled,
          sales: [],
        },
        { status: 409 },
      );
    }

    const sales = await prisma.order.findMany({
      where: {
        items: {
          some: { listing: { sellerId: sellerProfile.id } },
          every: { listing: { sellerId: sellerProfile.id } },
        },
        ...paidStripeOrderWhere(),
        sellerRefundId: null,
        paymentEvents: { none: blockingRefundLedgerWhere() },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 10,
      select: {
        id: true,
        createdAt: true,
        itemsSubtotalCents: true,
        shippingAmountCents: true,
        taxAmountCents: true,
        giftWrappingPriceCents: true,
        currency: true,
        fulfillmentStatus: true,
        buyer: { select: { name: true } },
        items: {
          where: { listing: { sellerId: sellerProfile.id } },
          take: 1,
          select: { listing: { select: { title: true } } },
        },
      },
    });

    return privateJson({ sales });
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;

    logServerError(err, { source: "seller_analytics_recent_sales" });
    return privateJson({ error: "Server error" }, { status: 500 });
  }
}
