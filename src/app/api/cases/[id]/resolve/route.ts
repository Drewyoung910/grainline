// src/app/api/cases/[id]/resolve/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
import { sendCaseResolved } from "@/lib/email";
import { createMarketplaceRefund, isStripeRefundPartialFailure } from "@/lib/marketplaceRefunds";
import { rateLimitResponse, refundRatelimit, safeRateLimit } from "@/lib/ratelimit";
import { REFUND_LOCK_SENTINEL, releaseStaleRefundLocks } from "@/lib/refundLocks";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "iad1";

const CaseResolveSchema = z.object({
  resolution: z.enum(["REFUND_FULL", "REFUND_PARTIAL", "DISMISSED"]),
  refundAmountCents: z.number().int().positive().optional().nullable(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const me = await ensureUserByClerkId(userId);

    if (me.role !== "EMPLOYEE" && me.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const { success, reset } = await safeRateLimit(refundRatelimit, `case-resolve:${userId}`);
    if (!success) return rateLimitResponse(reset, "Too many case resolution attempts.");

    await releaseStaleRefundLocks();

    let parsed;
    try {
      parsed = CaseResolveSchema.parse(await req.json());
    } catch (e) {
      if (e instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
      }
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const { resolution, refundAmountCents } = parsed;

    if (
      resolution === "REFUND_PARTIAL" &&
      (refundAmountCents == null || refundAmountCents <= 0)
    ) {
      return NextResponse.json(
        { error: "refundAmountCents is required and must be positive for REFUND_PARTIAL." },
        { status: 400 }
      );
    }

    const caseRecord = await prisma.case.findUnique({
      where: { id },
      include: {
        order: {
          include: {
            items: {
              include: {
                listing: { select: { id: true, listingType: true, stockQuantity: true, status: true } },
              },
            },
          },
        },
        seller: {
          select: {
            sellerProfile: { select: { stripeAccountId: true } },
          },
        },
      },
    });
    if (!caseRecord) return NextResponse.json({ error: "Case not found." }, { status: 404 });

    if (caseRecord.status === "RESOLVED" || caseRecord.status === "CLOSED") {
      return NextResponse.json({ error: "Case is already resolved." }, { status: 400 });
    }

    // Block refund if seller already issued one
    if (
      (resolution === "REFUND_FULL" || resolution === "REFUND_PARTIAL") &&
      caseRecord.order.sellerRefundId
    ) {
      return NextResponse.json(
        {
          error: caseRecord.order.sellerRefundId === REFUND_LOCK_SENTINEL
            ? "A refund is already being processed for this order."
            : "A refund has already been issued for this order by the seller.",
        },
        { status: caseRecord.order.sellerRefundId === REFUND_LOCK_SENTINEL ? 409 : 400 }
      );
    }

    // Partial refund amount cap
    if (resolution === "REFUND_PARTIAL" && refundAmountCents) {
      const orderTotal = (caseRecord.order.itemsSubtotalCents ?? 0) + (caseRecord.order.shippingAmountCents ?? 0) + (caseRecord.order.taxAmountCents ?? 0);
      if (refundAmountCents > orderTotal) {
        return NextResponse.json({ error: "Refund amount exceeds order total." }, { status: 400 });
      }
    }

    let stripeRefundId: string | null = null;
    let stripeRefundIds: string[] = [];
    let refundNote: string | null = null;
    const refunding = resolution === "REFUND_FULL" || resolution === "REFUND_PARTIAL";
    const refundAmountForOrder =
      resolution === "REFUND_FULL"
        ? caseRecord.order.itemsSubtotalCents + caseRecord.order.shippingAmountCents + caseRecord.order.taxAmountCents
        : refundAmountCents ?? null;

    if (refunding) {
      const paymentIntentId = caseRecord.order.stripePaymentIntentId;
      if (!paymentIntentId) {
        return NextResponse.json(
          { error: "Order has no Stripe payment intent ID. Refund must be processed manually." },
          { status: 400 }
        );
      }

      const lockResult = await prisma.order.updateMany({
        where: { id: caseRecord.orderId, sellerRefundId: null, paymentEvents: { none: { eventType: "REFUND" } } },
        data: { sellerRefundId: REFUND_LOCK_SENTINEL, sellerRefundLockedAt: new Date() },
      });
      if (lockResult.count === 0) {
        return NextResponse.json(
          { error: "A refund has already been issued for this order." },
          { status: 400 },
        );
      }

      try {
        const refund = await createMarketplaceRefund({
          paymentIntentId,
          resolution,
          amountCents: refundAmountForOrder!,
          itemsSubtotalCents: caseRecord.order.itemsSubtotalCents,
          shippingAmountCents: caseRecord.order.shippingAmountCents,
          taxAmountCents: caseRecord.order.taxAmountCents,
          canReverseTransfer: Boolean(caseRecord.seller.sellerProfile?.stripeAccountId),
          idempotencyKeyBase: `case-resolve:${id}:${resolution}:${refundAmountForOrder ?? 0}`,
          reason: resolution === "REFUND_FULL" ? "fraudulent" : undefined,
        });
        stripeRefundId = refund.primaryRefundId;
        stripeRefundIds = refund.refundIds;
        refundNote = [
          stripeRefundIds.length > 1
            ? `Stripe refunds ${stripeRefundIds.join(", ")}`
            : `Stripe refund ${stripeRefundId}`,
          refund.usedPlatformOnly ? "seller Stripe account disconnected; transfer reversal requires manual reconciliation" : null,
          refund.usedSplitTaxRefund ? "tax refunded separately without seller transfer reversal" : null,
        ].filter(Boolean).join("; ");
      } catch (stripeErr) {
        const partialRefundFailure = isStripeRefundPartialFailure(stripeErr) ? stripeErr : null;
        if (partialRefundFailure?.primaryRefundId) {
          stripeRefundId = partialRefundFailure.primaryRefundId;
          stripeRefundIds = partialRefundFailure.refundIds;
          await prisma.order.updateMany({
            where: { id: caseRecord.orderId, sellerRefundId: REFUND_LOCK_SENTINEL },
            data: {
              sellerRefundId: stripeRefundId,
              sellerRefundAmountCents: refundAmountForOrder,
              sellerRefundLockedAt: null,
              reviewNeeded: true,
              reviewNote: `ORPHANED REFUND: Stripe refund(s) ${stripeRefundIds.join(", ")} succeeded before a later refund step failed. Manual reconciliation required.`,
            },
          }).catch(() => {});
        } else {
          await prisma.order.updateMany({
            where: { id: caseRecord.orderId, sellerRefundId: REFUND_LOCK_SENTINEL },
            data: { sellerRefundId: null, sellerRefundLockedAt: null },
          }).catch(() => {});
        }
        throw stripeErr;
      }
    }

    const now = new Date();
    const resolutionNote = [
      `Case resolved: ${resolution}`,
      refundAmountCents ? `(refund: $${(refundAmountCents / 100).toFixed(2)})` : null,
      refundNote,
      `by ${me.name ?? me.email} at ${now.toISOString()}`,
    ]
      .filter(Boolean)
      .join(" ");

    const stockRestoreOps =
      resolution === "REFUND_FULL"
        ? caseRecord.order.items
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

    let updatedCase;
    try {
      [updatedCase] = await prisma.$transaction([
        prisma.case.update({
          where: { id },
          data: {
            status: "RESOLVED",
            resolution,
            refundAmountCents: refundAmountCents ?? null,
            stripeRefundId,
            resolvedAt: now,
            resolvedById: me.id,
          },
          include: { messages: true, order: true },
        }),
        prisma.order.update({
          where: { id: caseRecord.orderId },
          data: {
            reviewNeeded: true,
            reviewNote: resolutionNote,
            ...(refunding ? { sellerRefundLockedAt: null } : {}),
            ...(stripeRefundId ? { sellerRefundId: stripeRefundId, sellerRefundAmountCents: refundAmountForOrder } : {}),
          },
        }),
        ...stockRestoreOps,
      ]);
    } catch (txErr) {
      if (stripeRefundId) {
        console.error(`ORPHANED REFUND: ${stripeRefundId} for case ${id}. Manual reconciliation required.`);
        Sentry.captureException(txErr, {
          tags: { source: "case_refund_orphaned_after_stripe" },
          extra: { caseId: id, orderId: caseRecord.orderId, stripeRefundId, stripeRefundIds, refundAmountForOrder },
        });
        await prisma.order.updateMany({
          where: { id: caseRecord.orderId, sellerRefundId: REFUND_LOCK_SENTINEL },
          data: {
            sellerRefundId: stripeRefundId,
            sellerRefundAmountCents: refundAmountForOrder,
            sellerRefundLockedAt: null,
            reviewNeeded: true,
            reviewNote: `ORPHANED REFUND: Stripe refund(s) ${stripeRefundIds.join(", ")} succeeded, but case resolution DB work failed. Manual reconciliation required.`,
          },
        }).catch(() => {});
      } else if (refunding) {
        await prisma.order.updateMany({
          where: { id: caseRecord.orderId, sellerRefundId: REFUND_LOCK_SENTINEL },
          data: { sellerRefundId: null, sellerRefundLockedAt: null },
        }).catch(() => {});
      }
      throw txErr;
    }

    const resolutionLabel =
      resolution === "REFUND_FULL"
        ? "Full refund issued"
        : resolution === "REFUND_PARTIAL"
        ? `Partial refund of $${((refundAmountCents ?? 0) / 100).toFixed(2)}`
        : "Case dismissed";

    await createNotification({
      userId: caseRecord.buyerId,
      type: refunding ? "REFUND_ISSUED" : "CASE_RESOLVED",
      title: refunding ? "Refund issued" : "Your case has been resolved",
      body: resolutionLabel,
      link: `/dashboard/orders/${caseRecord.orderId}`,
    });

    try {
      if (await shouldSendEmail(caseRecord.buyerId, "EMAIL_CASE_RESOLVED")) {
        const buyerUser = await prisma.user.findUnique({
          where: { id: caseRecord.buyerId },
          select: { name: true, email: true },
        });
        if (buyerUser?.email) {
          await sendCaseResolved({
            orderId: caseRecord.orderId,
            buyer: { name: buyerUser.name, email: buyerUser.email },
            resolution,
            refundAmountCents: refundAmountCents ?? null,
          });
        }
      }
    } catch { /* non-fatal */ }

    // Audit log
    try {
      const { logAdminAction } = await import("@/lib/audit");
      await logAdminAction({
        adminId: me.id,
        action: "RESOLVE_CASE",
        targetType: "CASE",
        targetId: id,
        reason: `${resolution}${refundAmountCents ? ` ($${(refundAmountCents / 100).toFixed(2)})` : ""}`,
        metadata: { resolution, refundAmountCents, stripeRefundId },
      });
    } catch { /* non-fatal */ }

    return NextResponse.json(updatedCase);
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;

    console.error("POST /api/cases/[id]/resolve error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
