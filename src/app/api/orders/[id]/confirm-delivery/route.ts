import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { CaseStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";
import { fulfillmentRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { blockingRefundLedgerWhere, orderHasRefundLedger } from "@/lib/refundRouteState";

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
    const { userId: clerkId } = await auth();
    if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let me: Awaited<ReturnType<typeof ensureUserByClerkId>>;
    try {
      me = await ensureUserByClerkId(clerkId);
    } catch (error) {
      if (isAccountAccessError(error)) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
      }
      throw error;
    }

    const { success, reset } = await safeRateLimit(fulfillmentRatelimit, `confirm-delivery:${me.id}`);
    if (!success) return rateLimitResponse(reset, "Too many delivery confirmations.");

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

    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
    if (order.buyerId !== me.id) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    if (order.case && ACTIVE_CASE_STATUS_SET.has(order.case.status)) {
      return NextResponse.json(
        { error: "Resolve the open case before confirming delivery." },
        { status: 409 },
      );
    }
    if (orderHasRefundLedger(order)) {
      return NextResponse.json({ error: "Refunded orders cannot be confirmed delivered." }, { status: 400 });
    }
    if ((order.fulfillmentMethod ?? "SHIPPING") !== "SHIPPING") {
      return NextResponse.json({ error: "Only shipped orders can be confirmed delivered." }, { status: 400 });
    }
    if (order.fulfillmentStatus !== "SHIPPED") {
      return NextResponse.json({ error: "Only shipped orders can be confirmed delivered." }, { status: 400 });
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
      return NextResponse.json({ error: "Order status changed. Refresh and try again." }, { status: 409 });
    }

    const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
    return NextResponse.redirect(new URL(`/dashboard/orders/${id}`, origin), { status: 303 });
  } catch (error) {
    Sentry.captureException(error, { tags: { source: "buyer_confirm_delivery" } });
    console.error("POST /api/orders/[id]/confirm-delivery error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
