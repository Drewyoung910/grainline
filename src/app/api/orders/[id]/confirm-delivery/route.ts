import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { CaseStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { fulfillmentRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { blockingRefundLedgerWhere, orderHasRefundLedger } from "@/lib/refundRouteState";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";
import { logServerError } from "@/lib/serverErrorLogger";
import { APP_BASE_URL } from "@/lib/appBaseUrl";

export const runtime = "nodejs";

const ACTIVE_CASE_STATUSES = [
  CaseStatus.OPEN,
  CaseStatus.IN_DISCUSSION,
  CaseStatus.PENDING_CLOSE,
  CaseStatus.UNDER_REVIEW,
] as const;
const ACTIVE_CASE_STATUS_SET = new Set<CaseStatus>(ACTIVE_CASE_STATUSES);

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
    const order = await prisma.order.findUnique({
      where: { id },
      select: {
        buyerId: true,
        fulfillmentMethod: true,
        fulfillmentStatus: true,
        sellerRefundId: true,
        case: { select: { status: true } },
        paymentEvents: {
          where: blockingRefundLedgerWhere(),
          take: 1,
          select: { eventType: true, status: true },
        },
      },
    });

    if (!order) return privateJson({ error: "Order not found." }, { status: 404 });
    if (order.buyerId !== me.id) return privateJson({ error: "Forbidden." }, { status: 403 });
    if (order.case && ACTIVE_CASE_STATUS_SET.has(order.case.status)) {
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

    const updated = await prisma.order.updateMany({
      where: {
        id,
        buyerId: me.id,
        fulfillmentStatus: "SHIPPED",
        sellerRefundId: null,
        paymentEvents: { none: blockingRefundLedgerWhere() },
        AND: [
          {
            OR: [
              { fulfillmentMethod: "SHIPPING" },
              { fulfillmentMethod: null },
            ],
          },
          {
            OR: [
              { case: { is: null } },
              { case: { is: { status: { notIn: [...ACTIVE_CASE_STATUSES] } } } },
            ],
          },
        ],
      },
      data: {
        fulfillmentMethod: "SHIPPING",
        fulfillmentStatus: "DELIVERED",
        deliveredAt: new Date(),
      },
    });

    if (updated.count === 0) {
      return privateJson({ error: "Order status changed. Refresh and try again." }, { status: 409 });
    }

    return NextResponse.redirect(new URL(`/dashboard/orders/${id}`, APP_BASE_URL), { status: 303 });
  } catch (error) {
    logServerError(error, { source: "buyer_confirm_delivery_route" });
    return privateJson({ error: "Server error" }, { status: 500 });
  }
}
