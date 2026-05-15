// src/app/api/cases/[id]/resolve/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
import { sendCaseResolved } from "@/lib/email";
import { createMarketplaceRefund } from "@/lib/marketplaceRefunds";
import { rateLimitResponse, refundRatelimit, safeRateLimit } from "@/lib/ratelimit";
import { REFUND_LOCK_SENTINEL, releaseStaleRefundLocks } from "@/lib/refundLocks";
import { caseResolutionCopy } from "@/lib/caseResolutionCopy";
import {
  blockingRefundLedgerWhere,
  blockingRefundOrDisputeLedgerWhere,
  orderHasRefundLedger,
  partialRefundExceedsOrderTotal,
  partialRefundInputError,
  refundAmountForResolution,
  refundLockAcquisitionConflictResponse,
  refundStockRestoreQuantities,
  sellerRefundConflictResponse,
} from "@/lib/refundRouteState";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "iad1";

const CaseResolveSchema = z.object({
  resolution: z.enum(["REFUND_FULL", "REFUND_PARTIAL", "DISMISSED"]),
  refundAmountCents: z.number().int().positive().optional().nullable(),
});
const CASE_RESOLVE_BODY_MAX_BYTES = 24 * 1024;

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
      parsed = CaseResolveSchema.parse(await readBoundedJson(req, CASE_RESOLVE_BODY_MAX_BYTES));
    } catch (e) {
      if (isRequestBodyTooLargeError(e)) {
        return NextResponse.json({ error: "Request body too large" }, { status: 413 });
      }
      if (isInvalidJsonBodyError(e)) {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
      }
      if (e instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
      }
      throw e;
    }
    const { resolution, refundAmountCents } = parsed;

    if (partialRefundInputError(resolution, refundAmountCents)) {
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
            paymentEvents: {
              where: blockingRefundLedgerWhere(),
              take: 1,
              select: { eventType: true, status: true },
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

    const refunding = resolution === "REFUND_FULL" || resolution === "REFUND_PARTIAL";

    // Block refund if one is already in flight, locally recorded, or recorded by Stripe webhook.
    if (refunding) {
      const refundConflict = sellerRefundConflictResponse(caseRecord.order.sellerRefundId);
      if (refundConflict) {
        return NextResponse.json(
          { error: refundConflict.error },
          { status: refundConflict.status },
        );
      }
      if (orderHasRefundLedger(caseRecord.order)) {
        return NextResponse.json({ error: "A refund has already been issued for this order." }, { status: 400 });
      }
    }

    // Partial refund amount cap
    if (partialRefundExceedsOrderTotal(resolution, refundAmountCents, caseRecord.order)) {
      return NextResponse.json({ error: "Refund amount exceeds order total." }, { status: 400 });
    }

    let stripeRefundId: string | null = null;
    let stripeRefundIds: string[] = [];
    let refundNote: string | null = null;
    const refundAmountForOrder = refundAmountForResolution(resolution, caseRecord.order, refundAmountCents);
    const persistedRefundAmountCents = refunding ? refundAmountForOrder : null;

    if (refunding) {
      const paymentIntentId = caseRecord.order.stripePaymentIntentId;
      if (!paymentIntentId) {
        return NextResponse.json(
          { error: "Order has no Stripe payment intent ID. Refund must be processed manually." },
          { status: 400 }
        );
      }

      const lockResult = await prisma.order.updateMany({
        where: { id: caseRecord.orderId, sellerRefundId: null, paymentEvents: { none: blockingRefundOrDisputeLedgerWhere() } },
        data: { sellerRefundId: REFUND_LOCK_SENTINEL, sellerRefundLockedAt: new Date() },
      });
      if (lockResult.count === 0) {
        const freshOrder = await prisma.order.findUnique({
          where: { id: caseRecord.orderId },
          select: {
            sellerRefundId: true,
            paymentEvents: {
              where: blockingRefundOrDisputeLedgerWhere(),
              take: 2,
              select: { eventType: true, status: true },
            },
          },
        });
        const conflict = refundLockAcquisitionConflictResponse(freshOrder);
        return NextResponse.json(
          { error: conflict.error },
          { status: conflict.status },
        );
      }

      try {
        const refund = await createMarketplaceRefund({
          paymentIntentId,
          resolution,
          amountCents: refundAmountForOrder!,
          itemsSubtotalCents: caseRecord.order.itemsSubtotalCents,
          shippingAmountCents: caseRecord.order.shippingAmountCents,
          giftWrappingPriceCents: caseRecord.order.giftWrappingPriceCents,
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
        ].filter(Boolean).join("; ");
      } catch (stripeErr) {
        await prisma.order.updateMany({
          where: { id: caseRecord.orderId, sellerRefundId: REFUND_LOCK_SENTINEL },
          data: { sellerRefundId: null, sellerRefundLockedAt: null },
        }).catch((dbError) => {
          Sentry.captureException(dbError, {
            tags: { source: "case_refund_lock_release_failed" },
            extra: { caseId: id, orderId: caseRecord.orderId },
          });
        });
        throw stripeErr;
      }
    }

    const now = new Date();
    const resolutionNote = [
      `Case resolved: ${resolution}`,
      persistedRefundAmountCents ? `(refund: $${(persistedRefundAmountCents / 100).toFixed(2)})` : null,
      refundNote,
      `by ${me.name ?? me.email} at ${now.toISOString()}`,
    ]
      .filter(Boolean)
      .join(" ");

    const stockRestores =
      resolution === "REFUND_FULL"
        ? refundStockRestoreQuantities(caseRecord.order.items)
        : [];
    const stockRestoreIds = stockRestores.map((restore) => restore.listingId);

    let updatedCase;
    try {
      updatedCase = await prisma.$transaction(async (tx) => {
        const caseUpdate = await tx.case.updateMany({
          where: {
            id,
            status: { notIn: ["RESOLVED", "CLOSED"] },
            resolvedAt: null,
          },
          data: {
            status: "RESOLVED",
            resolution,
            refundAmountCents: persistedRefundAmountCents,
            stripeRefundId,
            resolvedAt: now,
            resolvedById: me.id,
          },
        });
        if (caseUpdate.count === 0) {
          throw new Error("CASE_RESOLUTION_CONFLICT");
        }

        await tx.order.update({
          where: { id: caseRecord.orderId },
          data: {
            reviewNeeded: true,
            reviewNote: resolutionNote,
            ...(refunding ? { sellerRefundLockedAt: null } : {}),
            ...(stripeRefundId ? { sellerRefundId: stripeRefundId, sellerRefundAmountCents: refundAmountForOrder } : {}),
          },
        });
        for (const restore of stockRestores) {
          await tx.listing.update({
            where: { id: restore.listingId },
            data: { stockQuantity: { increment: restore.quantity } },
          });
        }
        if (stockRestoreIds.length) {
          await tx.listing.updateMany({
            where: {
              id: { in: stockRestoreIds },
              listingType: "IN_STOCK",
              status: "SOLD_OUT",
              stockQuantity: { gt: 0 },
              isPrivate: false,
            },
            data: { status: "ACTIVE" },
          });
        }
        return tx.case.findUniqueOrThrow({
          where: { id },
          include: { messages: true, order: true },
        });
      });
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
        }).catch((reviewUpdateError) => {
          Sentry.captureException(reviewUpdateError, {
            tags: { source: "case_refund_orphaned_review_update_failed" },
            extra: { caseId: id, orderId: caseRecord.orderId, stripeRefundId, stripeRefundIds },
          });
        });
      } else if (refunding) {
        await prisma.order.updateMany({
          where: { id: caseRecord.orderId, sellerRefundId: REFUND_LOCK_SENTINEL },
          data: { sellerRefundId: null, sellerRefundLockedAt: null },
        }).catch((lockReleaseError) => {
          Sentry.captureException(lockReleaseError, {
            tags: { source: "case_refund_lock_release_failed" },
            extra: { caseId: id, orderId: caseRecord.orderId },
          });
        });
      }
      if (txErr instanceof Error && txErr.message === "CASE_RESOLUTION_CONFLICT") {
        return NextResponse.json(
          { error: "Case status changed before this resolution could be saved. Refresh and try again." },
          { status: 409 },
        );
      }
      throw txErr;
    }

    const resolutionCopy = caseResolutionCopy(
      resolution,
      refundAmountForOrder ?? refundAmountCents ?? null,
      caseRecord.order.currency,
    );

    if (caseRecord.buyerId) {
      await createNotification({
        userId: caseRecord.buyerId,
        type: refunding ? "REFUND_ISSUED" : "CASE_RESOLVED",
        title: resolutionCopy.notificationTitle,
        body: resolutionCopy.body,
        link: `/dashboard/orders/${caseRecord.orderId}`,
      });
    }

    try {
      if (caseRecord.buyerId && await shouldSendEmail(caseRecord.buyerId, "EMAIL_CASE_RESOLVED")) {
        const buyerUser = await prisma.user.findUnique({
          where: { id: caseRecord.buyerId },
          select: { name: true, email: true },
        });
        if (buyerUser?.email) {
          await sendCaseResolved({
            orderId: caseRecord.orderId,
            buyer: { name: buyerUser.name, email: buyerUser.email },
            resolution,
            refundAmountCents: persistedRefundAmountCents,
            currency: caseRecord.order.currency,
          });
        }
      }
    } catch (emailError) {
      Sentry.captureException(emailError, {
        level: "warning",
        tags: { source: "case_resolved_email" },
        extra: { caseId: id, orderId: caseRecord.orderId, resolution },
      });
    }

    // Audit log
    try {
      const { logAdminAction } = await import("@/lib/audit");
      await logAdminAction({
        adminId: me.id,
        action: "RESOLVE_CASE",
        targetType: "CASE",
        targetId: id,
        reason: `${resolution}${persistedRefundAmountCents ? ` ($${(persistedRefundAmountCents / 100).toFixed(2)})` : ""}`,
        metadata: { resolution, refundAmountCents: persistedRefundAmountCents, stripeRefundId },
      });
    } catch (auditError) {
      Sentry.captureException(auditError, {
        level: "warning",
        tags: { source: "case_resolve_audit_log" },
        extra: { caseId: id, orderId: caseRecord.orderId, resolution },
      });
    }

    return NextResponse.json(updatedCase);
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;

    console.error("POST /api/cases/[id]/resolve error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
