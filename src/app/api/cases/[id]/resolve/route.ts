// src/app/api/cases/[id]/resolve/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
import { sendCaseResolved } from "@/lib/email";
import { createMarketplaceRefund, refundIdempotencyKeyBase } from "@/lib/marketplaceRefunds";
import { formatCurrencyCents } from "@/lib/money";
import { rateLimitResponse, refundRatelimit, safeRateLimit } from "@/lib/ratelimit";
import { REFUND_LOCK_SENTINEL, releaseStaleRefundLocks } from "@/lib/refundLocks";
import { blockingRefundOrLatestOpenDisputeLedgerExistsSql } from "@/lib/refundLedgerSql";
import { caseResolutionCopy } from "@/lib/caseResolutionCopy";
import { revalidateListingSearchCaches } from "@/lib/searchCache";
import {
  blockingRefundLedgerWhere,
  blockingRefundOrDisputeLedgerWhere,
  orderHasRefundLedger,
  partialRefundExceedsOrderTotal,
  partialRefundInputError,
  refundAmountForResolution,
  refundLockAcquisitionConflictResponse,
  refundMayRestoreStock,
  orderHasPurchasedLabel,
  requestedRefundStockRestoreQuantities,
  refundStockRestoreQuantities,
  sellerRefundConflictResponse,
} from "@/lib/refundRouteState";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { logServerError } from "@/lib/serverErrorLogger";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "iad1";

const CaseResolveSchema = z.object({
  resolution: z.enum(["REFUND_FULL", "REFUND_PARTIAL", "DISMISSED"]),
  refundAmountCents: z.number().int().positive().optional().nullable(),
  restoreStock: z.array(z.object({
    listingId: z.string().min(1),
    quantity: z.number().int().positive().max(99),
  })).max(50).optional(),
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
    const requestedStockRestores = parsed.restoreStock ?? [];

    if (resolution !== "REFUND_PARTIAL" && requestedStockRestores.length > 0) {
      return NextResponse.json(
        { error: "Stock restoration is only available for partial case refunds." },
        { status: 400 },
      );
    }

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
            sellerProfile: { select: { id: true, stripeAccountId: true } },
          },
        },
      },
    });
    if (!caseRecord) return NextResponse.json({ error: "Case not found." }, { status: 404 });

    if (caseRecord.status === "RESOLVED" || caseRecord.status === "CLOSED") {
      return NextResponse.json({ error: "Case is already resolved." }, { status: 400 });
    }

    const refunding = resolution === "REFUND_FULL" || resolution === "REFUND_PARTIAL";

    let partialStockRestores: Array<{ listingId: string; quantity: number }> = [];
    if (resolution === "REFUND_PARTIAL" && requestedStockRestores.length > 0) {
      if (!refundMayRestoreStock(caseRecord.order)) {
        return NextResponse.json(
          { error: "Stock cannot be restored after this order has shipped or been picked up." },
          { status: 400 },
        );
      }
      const restoreValidation = requestedRefundStockRestoreQuantities(
        caseRecord.order.items,
        requestedStockRestores,
      );
      if (!restoreValidation.ok) {
        return NextResponse.json({ error: restoreValidation.error }, { status: 400 });
      }
      partialStockRestores = restoreValidation.restores;
    }

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
      if (orderHasPurchasedLabel(caseRecord.order)) {
        return NextResponse.json(
          { error: "Cannot refund this order after a shipping label has been purchased. Void or resolve the label first." },
          { status: 409 },
        );
      }
    }

    // Partial refund amount cap
    if (partialRefundExceedsOrderTotal(resolution, refundAmountCents, caseRecord.order)) {
      return NextResponse.json({ error: "Refund amount exceeds order total." }, { status: 400 });
    }

    let stripeRefundId: string | null = null;
    let stripeRefundIds: string[] = [];
    let refundNote: string | null = null;
    let refundRequiresManualTransferReconciliation = false;
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

      const lockResult: number = await prisma.$executeRaw`
        UPDATE "Order"
        SET "sellerRefundId" = ${REFUND_LOCK_SENTINEL},
            "sellerRefundLockedAt" = ${new Date()}
        WHERE id = ${caseRecord.orderId}
          AND "sellerRefundId" IS NULL
          AND ("labelStatus" IS NULL OR "labelStatus" != 'PURCHASED'::"LabelStatus")
          AND NOT (${blockingRefundOrLatestOpenDisputeLedgerExistsSql(Prisma.sql`"Order".id`)})
      `;
      if (lockResult === 0) {
        const freshOrder = await prisma.order.findUnique({
          where: { id: caseRecord.orderId },
          select: {
            sellerRefundId: true,
            labelStatus: true,
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
          idempotencyKeyBase: refundIdempotencyKeyBase({
            scope: "case-resolve",
            id,
            resolution,
            amountCents: refundAmountForOrder!,
          }),
          reason: "requested_by_customer",
        });
        stripeRefundId = refund.primaryRefundId;
        stripeRefundIds = refund.refundIds;
        refundRequiresManualTransferReconciliation = refund.requiresManualTransferReconciliation;
        refundNote = [
          stripeRefundIds.length > 1
            ? `Stripe refunds ${stripeRefundIds.join(", ")}`
            : `Stripe refund ${stripeRefundId}`,
          refund.requiresManualTransferReconciliation ? "seller Stripe account disconnected; transfer reversal requires manual reconciliation" : null,
          refund.requiresManualFollowUp
            ? `Stripe refund status requires manual follow-up: ${refund.refundStatuses.filter(Boolean).join(", ") || "provider pending"}`
            : null,
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
    const persistedRefundAmountDisplay = persistedRefundAmountCents
      ? formatCurrencyCents(persistedRefundAmountCents, caseRecord.order.currency)
      : null;
    const resolutionNote = [
      `Case resolved: ${resolution}`,
      persistedRefundAmountDisplay ? `(refund: ${persistedRefundAmountDisplay})` : null,
      refundNote,
      `by ${me.name ?? me.email} at ${now.toISOString()}`,
    ]
      .filter(Boolean)
      .join(" ");

    const stockRestores =
      resolution === "REFUND_FULL" && refundMayRestoreStock(caseRecord.order)
        ? refundStockRestoreQuantities(caseRecord.order.items)
        : resolution === "REFUND_PARTIAL"
          ? partialStockRestores
        : [];
    const stockRestoreIds = stockRestores.map((restore) => restore.listingId);

    let updatedCase;
    let stockStatusRestoredCount = 0;
    try {
      const caseWrite = await prisma.$transaction(async (tx) => {
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

        if (refunding) {
          const orderUpdate = await tx.order.updateMany({
            where: { id: caseRecord.orderId, sellerRefundId: REFUND_LOCK_SENTINEL },
            data: {
              reviewNeeded: true,
              reviewNote: resolutionNote,
              sellerRefundLockedAt: null,
              ...(stripeRefundId ? { sellerRefundId: stripeRefundId, sellerRefundAmountCents: refundAmountForOrder } : {}),
            },
          });
          if (orderUpdate.count !== 1) {
            throw new Error("CASE_REFUND_LOCK_LOST");
          }
        } else {
          await tx.order.update({
            where: { id: caseRecord.orderId },
            data: {
              reviewNeeded: true,
              reviewNote: resolutionNote,
            },
          });
        }
        if (refundRequiresManualTransferReconciliation && caseRecord.seller.sellerProfile?.id) {
          await tx.sellerProfile.update({
            where: { id: caseRecord.seller.sellerProfile.id },
            data: {
              manualStripeReconciliationNeeded: true,
              manualStripeReconciliationNote: "Staff case refund used a platform-only Stripe refund because the connected account transfer could not be reversed. Staff must reconcile the seller transfer manually.",
            },
          });
        }
        for (const restore of stockRestores) {
          await tx.listing.update({
            where: { id: restore.listingId },
            data: { stockQuantity: { increment: restore.quantity } },
          });
        }
        let restoredActiveListingCount = 0;
        if (stockRestoreIds.length) {
          const stockStatusUpdate = await tx.listing.updateMany({
            where: {
              id: { in: stockRestoreIds },
              listingType: "IN_STOCK",
              status: "SOLD_OUT",
              stockQuantity: { gt: 0 },
              isPrivate: false,
            },
            data: { status: "ACTIVE" },
          });
          restoredActiveListingCount = stockStatusUpdate.count;
        }
        const updatedCase = await tx.case.findUniqueOrThrow({
          where: { id },
          include: { messages: true, order: true },
        });
        return { updatedCase, stockStatusRestoredCount: restoredActiveListingCount };
      });
      updatedCase = caseWrite.updatedCase;
      stockStatusRestoredCount = caseWrite.stockStatusRestoredCount;
    } catch (txErr) {
      if (stripeRefundId) {
        logServerError(txErr, {
          source: "case_refund_orphaned_after_stripe",
          extra: {
            caseId: id,
            orderId: caseRecord.orderId,
            refundCount: stripeRefundIds.length,
            refundAmountForOrder,
          },
        });
        await prisma.order.updateMany({
          where: { id: caseRecord.orderId, sellerRefundId: REFUND_LOCK_SENTINEL },
          data: {
            sellerRefundId: stripeRefundId,
            sellerRefundAmountCents: refundAmountForOrder,
            sellerRefundLockedAt: null,
            reviewNeeded: true,
            reviewNote: `ORPHANED REFUND: Stripe refund(s) ${stripeRefundIds.join(", ")} were created, but case resolution DB work failed. Manual reconciliation required.`,
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
      if (txErr instanceof Error && txErr.message === "CASE_REFUND_LOCK_LOST") {
        return NextResponse.json(
          { error: "Refund state changed after Stripe accepted the refund. Staff must reconcile this order before retrying." },
          { status: 409 },
        );
      }
      throw txErr;
    }
    if (stockStatusRestoredCount > 0) {
      revalidateListingSearchCaches();
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
      const emailPreferenceKey = refunding ? "EMAIL_REFUND_ISSUED" : "EMAIL_CASE_RESOLVED";
      if (caseRecord.buyerId && await shouldSendEmail(caseRecord.buyerId, emailPreferenceKey)) {
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
        reason: `${resolution}${persistedRefundAmountDisplay ? ` (${persistedRefundAmountDisplay})` : ""}`,
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

    logServerError(err, { source: "case_resolve_route" });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
