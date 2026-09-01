import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { fulfillmentRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { orderHasRefundLedger } from "@/lib/refundRouteState";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";
import { logServerError } from "@/lib/serverErrorLogger";
import { APP_BASE_URL } from "@/lib/appBaseUrl";
import {
  databaseClockTimestamp,
  lockOrderForCaseLifecycle,
} from "@/lib/caseLifecycleLocks";
import { caseOrderActiveForBuyer } from "@/lib/caseOrderActiveAuthority";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
    if (crossOriginRejection) {
      return privateJson({ error: "Forbidden" }, { status: 403 });
    }

    const { userId: clerkId } = await auth();
    if (!clerkId) return privateJson({ error: "Unauthorized" }, { status: 401 });

    let me: Awaited<ReturnType<typeof ensureUserByClerkId>>;
    try {
      me = await ensureUserByClerkId(clerkId);
    } catch (error) {
      if (isAccountAccessError(error)) {
        return privateJson({ error: error.message, code: error.code }, { status: error.status });
      }
      throw error;
    }

    const { success, reset } = await safeRateLimit(fulfillmentRatelimit, `confirm-delivery:${me.id}`);
    if (!success) return privateResponse(rateLimitResponse(reset, "Too many delivery confirmations."));

    const { id } = await params;
    const order = await prisma.order.findFirst({
      where: { id, buyerId: me.id },
      select: {
        buyerId: true,
        fulfillmentMethod: true,
        fulfillmentStatus: true,
        sellerRefundId: true,
        paymentRefundBlocked: true,
      },
    });

    if (!order) return privateJson({ error: "Order not found." }, { status: 404 });
    const activeCase = await caseOrderActiveForBuyer({
      actorUserId: me.id,
      orderId: id,
    });
    if (activeCase === null) {
      return privateJson({ error: "Forbidden." }, { status: 403 });
    }
    if (activeCase) {
      return privateJson(
        { error: "Resolve the open case before confirming delivery." },
        { status: 409 },
      );
    }
    if (orderHasRefundLedger(order)) {
      return privateJson({ error: "Refunded orders cannot be confirmed delivered." }, { status: 400 });
    }
    if ((order.fulfillmentMethod ?? "SHIPPING") !== "SHIPPING") {
      return privateJson({ error: "Only shipped orders can be confirmed delivered." }, { status: 400 });
    }
    if (order.fulfillmentStatus !== "SHIPPED") {
      return privateJson({ error: "Only shipped orders can be confirmed delivered." }, { status: 400 });
    }

    const updatedCount = await prisma.$transaction(async (tx) => {
      const orderExists = await lockOrderForCaseLifecycle(tx, id);
      if (!orderExists) return 0;
      const lockedActiveCase = await caseOrderActiveForBuyer(
        { actorUserId: me.id, orderId: id },
        tx,
      );
      if (lockedActiveCase !== false) return 0;
      const deliveredAt = await databaseClockTimestamp(tx);
      const updated = await tx.order.updateMany({
        where: {
          id,
          buyerId: me.id,
          fulfillmentStatus: "SHIPPED",
          sellerRefundId: null,
          paymentRefundBlocked: false,
          AND: [
            {
              OR: [
                { fulfillmentMethod: "SHIPPING" },
                { fulfillmentMethod: null },
              ],
            },
          ],
        },
        data: {
          fulfillmentMethod: "SHIPPING",
          fulfillmentStatus: "DELIVERED",
          deliveredAt,
        },
      });
      return updated.count;
    });

    if (updatedCount === 0) {
      return privateJson({ error: "Order status changed. Refresh and try again." }, { status: 409 });
    }

    return NextResponse.redirect(new URL(`/dashboard/orders/${id}`, APP_BASE_URL), { status: 303 });
  } catch (error) {
    logServerError(error, { source: "buyer_confirm_delivery_route" });
    return privateJson({ error: "Server error" }, { status: 500 });
  }
}
