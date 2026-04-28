// src/app/api/orders/[id]/refund/route.ts
// Seller-initiated refund. Issues a Stripe refund immediately using Stripe's
// refund_application_fee + reverse_transfer flags. Full refunds also restore
// IN_STOCK inventory.
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { sendRefundIssued } from "@/lib/email";
import { createMarketplaceRefund, isStripeRefundPartialFailure } from "@/lib/marketplaceRefunds";
import { createNotification } from "@/lib/notifications";
import { rateLimitResponse, refundRatelimit, safeRateLimit } from "@/lib/ratelimit";
import { REFUND_LOCK_SENTINEL, releaseStaleRefundLocks } from "@/lib/refundLocks";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";

const RefundSchema = z.object({
  type: z.enum(["FULL", "PARTIAL"]).optional(),
  amountCents: z.number().int().positive().optional().nullable(),
});

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "iad1";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params;

    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { success, reset } = await safeRateLimit(refundRatelimit, userId);
    if (!success) return rateLimitResponse(reset, "Too many refund attempts.");

    const me = await ensureUserByClerkId(userId);

    let refundParsed;
    try {
      refundParsed = RefundSchema.parse(await req.json());
    } catch (e) {
      if (e instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
      }
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const type: "FULL" | "PARTIAL" = refundParsed.type === "PARTIAL" ? "PARTIAL" : "FULL";
    const amountCents: number | null = refundParsed.amountCents ?? null;

    if (type === "PARTIAL" && (amountCents == null || amountCents <= 0)) {
      return NextResponse.json(
        { error: "amountCents is required and must be positive for PARTIAL refunds." },
        { status: 400 }
      );
    }

    // Verify seller owns this order (has a seller profile with items in it)
    const seller = await prisma.sellerProfile.findUnique({
      where: { userId: me.id },
      select: { id: true, stripeAccountId: true },
    });
    if (!seller) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    await releaseStaleRefundLocks(orderId);

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            listing: {
              select: { id: true, sellerId: true, listingType: true, stockQuantity: true, status: true },
            },
          },
        },
      },
    });
    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });

    const myItems = order.items.filter((it) => it.listing.sellerId === seller.id);
    if (myItems.length === 0) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    const latestDispute = await prisma.orderPaymentEvent.findFirst({
      where: { orderId, eventType: "DISPUTE" },
      orderBy: { createdAt: "desc" },
      select: { status: true },
    });
    const disputeClosedStatuses = new Set(["won", "lost", "warning_closed"]);
    if (latestDispute && !disputeClosedStatuses.has((latestDispute.status ?? "").toLowerCase())) {
      return NextResponse.json(
        { error: "This payment has an open Stripe dispute. Resolve the dispute before issuing a seller refund." },
        { status: 409 },
      );
    }

    if (order.sellerRefundId) {
      const pending = order.sellerRefundId === REFUND_LOCK_SENTINEL;
      return NextResponse.json(
        {
          error: pending
            ? "A refund is already being processed for this order."
            : "A refund has already been issued for this order.",
        },
        { status: pending ? 409 : 400 },
      );
    }

    if (!order.stripePaymentIntentId) {
      return NextResponse.json(
        { error: "Order has no Stripe payment intent. Refund must be processed manually." },
        { status: 400 }
      );
    }

    // Atomic lock: claim refund slot to prevent double-refund race
    const lockResult = await prisma.order.updateMany({
      where: { id: orderId, sellerRefundId: null, paymentEvents: { none: { eventType: "REFUND" } } },
      data: { sellerRefundId: REFUND_LOCK_SENTINEL, sellerRefundLockedAt: new Date() },
    });
    if (lockResult.count === 0) {
      return NextResponse.json({ error: "A refund has already been issued for this order." }, { status: 400 });
    }

    // Partial refund amount cap
    const refundAmountCents = type === "FULL"
      ? (order.itemsSubtotalCents + order.shippingAmountCents + order.taxAmountCents)
      : amountCents!;

    const orderTotal = (order.itemsSubtotalCents ?? 0) + (order.shippingAmountCents ?? 0) + (order.taxAmountCents ?? 0);
    if (type === "PARTIAL" && amountCents! > orderTotal) {
      // Clear the lock
      await prisma.order.update({ where: { id: orderId }, data: { sellerRefundId: null, sellerRefundLockedAt: null } }).catch(() => {});
      return NextResponse.json({ error: "Refund amount exceeds order total." }, { status: 400 });
    }

    let refundId: string | null = null;
    let refundIds: string[] = [];
    try {
      const refund = await createMarketplaceRefund({
        paymentIntentId: order.stripePaymentIntentId,
        resolution: type,
        amountCents: refundAmountCents,
        itemsSubtotalCents: order.itemsSubtotalCents,
        shippingAmountCents: order.shippingAmountCents,
        taxAmountCents: order.taxAmountCents,
        canReverseTransfer: Boolean(seller.stripeAccountId),
        idempotencyKeyBase: `seller-refund:${orderId}:${type}:${refundAmountCents}`,
      });
      refundId = refund.primaryRefundId;
      refundIds = refund.refundIds;

      const stockRestoreOps =
        type === "FULL"
          ? myItems
              .filter((it) => it.listing.listingType === "IN_STOCK")
              .map((it) => {
                return prisma.listing.update({
                  where: { id: it.listingId },
                  data: {
                    stockQuantity: { increment: it.quantity },
                    ...(it.listing.status === "SOLD_OUT" ? { status: "ACTIVE" } : {}),
                  },
                });
              })
          : [];

      // Resolve any open case on this order
      const existingCase = await prisma.case.findUnique({
        where: { orderId },
        select: { id: true, status: true },
      });

      const now = new Date();
      const refundSummary = refundIds.length > 1
        ? `Stripe refunds ${refundIds.join(", ")}`
        : `Stripe refund ${refundId}`;
      const transferNote = refund.usedPlatformOnly
        ? " Seller Stripe account is disconnected; transfer reversal must be reconciled manually."
        : "";
      const taxNote = refund.usedSplitTaxRefund
        ? " Tax was refunded separately without reversing seller transfer."
        : "";
      const reviewNote = `Seller-initiated ${type.toLowerCase()} refund of $${(refundAmountCents / 100).toFixed(2)} via ${refundSummary}.${transferNote}${taxNote}`;

      await prisma.$transaction([
        prisma.order.update({
          where: { id: orderId },
          data: {
            sellerRefundId: refundId,
            sellerRefundAmountCents: refundAmountCents,
            sellerRefundLockedAt: null,
            reviewNeeded: true,
            reviewNote,
          },
        }),
        ...(existingCase &&
        existingCase.status !== "RESOLVED" &&
        existingCase.status !== "CLOSED"
          ? [
              prisma.case.update({
                where: { id: existingCase.id },
                data: {
                  status: "RESOLVED",
                  resolution: type === "FULL" ? "REFUND_FULL" : "REFUND_PARTIAL",
                  refundAmountCents: refundAmountCents,
                  stripeRefundId: refundId,
                  resolvedAt: now,
                  resolvedById: me.id,
                },
              }),
            ]
          : []),
        ...stockRestoreOps,
      ]);
    } catch (err) {
      const partialRefundFailure = isStripeRefundPartialFailure(err) ? err : null;
      if (partialRefundFailure) {
        refundId = partialRefundFailure.primaryRefundId;
        refundIds = partialRefundFailure.refundIds;
      }
      if (refundId) {
        Sentry.captureException(err, {
          tags: { source: "seller_refund_orphaned_after_stripe" },
          extra: { orderId, refundId, refundIds, refundAmountCents },
        });
        await prisma.order.updateMany({
          where: { id: orderId, sellerRefundId: REFUND_LOCK_SENTINEL },
          data: {
            sellerRefundId: refundId,
            sellerRefundAmountCents: refundAmountCents,
            sellerRefundLockedAt: null,
            reviewNeeded: true,
            reviewNote: `ORPHANED REFUND: Stripe refund(s) ${refundIds.join(", ")} succeeded, but follow-up DB work failed. Manual reconciliation required.`,
          },
        }).catch(() => {});
      } else {
        await prisma.order.updateMany({
          where: { id: orderId, sellerRefundId: REFUND_LOCK_SENTINEL },
          data: { sellerRefundId: null, sellerRefundLockedAt: null },
        }).catch(() => {});
      }
      throw err;
    }

    // In-app notification for the buyer
    if (order.buyerId) {
      try {
        await createNotification({
          userId: order.buyerId,
          type: "REFUND_ISSUED",
          title: "Refund from maker",
          body: `Your maker issued a refund of $${(refundAmountCents / 100).toFixed(2)} for your order.`,
          link: `/dashboard/orders/${orderId}`,
        });
      } catch { /* non-fatal */ }
    }

    try {
      const buyerUser = order.buyerId
        ? await prisma.user.findUnique({
            where: { id: order.buyerId },
            select: { name: true, email: true },
          })
        : null;
      if (buyerUser?.email) {
        await sendRefundIssued({
          buyer: { name: buyerUser.name, email: buyerUser.email },
          refundAmountCents,
          orderId,
        });
      }
    } catch { /* non-fatal */ }

    return NextResponse.json({
      ok: true,
      refundId: refundId!,
      refundIds,
      refundAmountCents,
    });
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;

    console.error("POST /api/orders/[id]/refund error:", err);
    Sentry.captureException(err, { tags: { source: "seller_refund" } });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
