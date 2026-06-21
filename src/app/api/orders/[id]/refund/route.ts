// src/app/api/orders/[id]/refund/route.ts
// Seller-initiated refund. Issues a Stripe refund immediately. Connected
// seller refunds use Stripe reverse_transfer under the manual transfer_data
// checkout model; full refunds also restore IN_STOCK inventory.
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { sendRefundIssued } from "@/lib/email";
import {
  createMarketplaceRefund,
  refundIdempotencyKeyBase,
} from "@/lib/marketplaceRefunds";
import { recordLocalRefundEvidence } from "@/lib/localRefundEvidence";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
import { formatCurrencyCents } from "@/lib/money";
import {
  rateLimitResponse,
  refundRatelimit,
  safeRateLimit,
} from "@/lib/ratelimit";
import {
  REFUND_LOCK_SENTINEL,
  releaseStaleRefundLocks,
} from "@/lib/refundLocks";
import { blockingRefundOrLatestOpenDisputeLedgerExistsSql } from "@/lib/refundLedgerSql";
import { revalidateFeaturedMakerCaches, revalidateListingSearchCaches } from "@/lib/searchCache";
import {
  blockingRefundLedgerWhere,
  blockingRefundOrDisputeLedgerWhere,
  isOpenStripeDisputeStatus,
  orderHasPurchasedLabel,
  orderHasRefundLedger,
  partialRefundExceedsOrderTotal,
  partialRefundInputError,
  refundAmountForResolution,
  refundLockAcquisitionConflictResponse,
  refundMayRestoreStock,
  requestedRefundStockRestoreQuantities,
  refundStockRestoreQuantities,
  sellerRefundIdAfterStaleRelease,
  sellerRefundConflictResponse,
} from "@/lib/refundRouteState";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { logServerError } from "@/lib/serverErrorLogger";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { HTTP_STATUS } from "@/lib/httpStatus";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";

const RefundSchema = z.object({
  type: z.enum(["FULL", "PARTIAL"]).optional(),
  amountCents: z.number().int().positive().optional().nullable(),
  restoreStock: z
    .array(
      z.object({
        listingId: z.string().min(1),
        quantity: z.number().int().positive().max(99),
      }),
    )
    .max(50)
    .optional(),
});
const REFUND_BODY_MAX_BYTES = 16 * 1024;

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "iad1";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: orderId } = await params;

    const { userId } = await auth();
    if (!userId) return privateJson({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });

    const { success, reset } = await safeRateLimit(refundRatelimit, userId);
    if (!success)
      return privateResponse(
        rateLimitResponse(reset, "Too many refund attempts."),
      );

    const me = await ensureUserByClerkId(userId);

    let refundParsed;
    try {
      refundParsed = RefundSchema.parse(
        await readBoundedJson(req, REFUND_BODY_MAX_BYTES),
      );
    } catch (e) {
      if (isRequestBodyTooLargeError(e)) {
        return privateJson(
          { error: "Request body too large" },
          { status: HTTP_STATUS.PAYLOAD_TOO_LARGE },
        );
      }
      if (isInvalidJsonBodyError(e)) {
        return privateJson({ error: "Invalid JSON" }, { status: HTTP_STATUS.BAD_REQUEST });
      }
      if (e instanceof z.ZodError) {
        return privateJson(
          { error: "Invalid input", details: e.issues },
          { status: HTTP_STATUS.BAD_REQUEST },
        );
      }
      throw e;
    }

    const type: "FULL" | "PARTIAL" =
      refundParsed.type === "PARTIAL" ? "PARTIAL" : "FULL";
    const amountCents: number | null = refundParsed.amountCents ?? null;
    const requestedStockRestores = refundParsed.restoreStock ?? [];

    if (type === "FULL" && requestedStockRestores.length > 0) {
      return privateJson(
        {
          error:
            "Full refunds restore eligible stock automatically. Use restoreStock only for partial refunds.",
        },
        { status: HTTP_STATUS.BAD_REQUEST },
      );
    }

    if (partialRefundInputError(type, amountCents)) {
      return privateJson(
        {
          error:
            "amountCents is required and must be positive for PARTIAL refunds.",
        },
        { status: HTTP_STATUS.BAD_REQUEST },
      );
    }

    // Verify seller owns this order (has a seller profile with items in it)
    const seller = await prisma.sellerProfile.findUnique({
      where: { userId: me.id },
      select: { id: true, stripeAccountId: true },
    });
    if (!seller) return privateJson({ error: "Forbidden." }, { status: HTTP_STATUS.FORBIDDEN });

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            listing: {
              select: {
                id: true,
                sellerId: true,
                listingType: true,
                stockQuantity: true,
                status: true,
              },
            },
          },
        },
        paymentEvents: {
          where: blockingRefundLedgerWhere(),
          take: 1,
          select: { eventType: true, status: true },
        },
      },
    });
    if (!order)
      return privateJson({ error: "Order not found." }, { status: HTTP_STATUS.NOT_FOUND });

    const allItemsBelongToSeller =
      order.items.length > 0 &&
      order.items.every((it) => it.listing.sellerId === seller.id);
    if (!allItemsBelongToSeller)
      return privateJson({ error: "Forbidden." }, { status: HTTP_STATUS.FORBIDDEN });
    const myItems = order.items;

    let partialStockRestores: Array<{ listingId: string; quantity: number }> =
      [];
    if (type === "PARTIAL" && requestedStockRestores.length > 0) {
      if (!refundMayRestoreStock(order)) {
        return privateJson(
          {
            error:
              "Stock cannot be restored after this order has shipped or been picked up.",
          },
          { status: HTTP_STATUS.BAD_REQUEST },
        );
      }
      const restoreValidation = requestedRefundStockRestoreQuantities(
        myItems,
        requestedStockRestores,
      );
      if (!restoreValidation.ok) {
        return privateJson({ error: restoreValidation.error }, { status: HTTP_STATUS.BAD_REQUEST });
      }
      partialStockRestores = restoreValidation.restores;
    }

    const staleLocksReleased = await releaseStaleRefundLocks(orderId);
    const orderForRefundState = {
      ...order,
      sellerRefundId: sellerRefundIdAfterStaleRelease(
        order.sellerRefundId,
        staleLocksReleased.count,
      ),
    };

    const latestDispute = await prisma.orderPaymentEvent.findFirst({
      where: { orderId, eventType: "DISPUTE" },
      orderBy: { createdAt: "desc" },
      select: { status: true },
    });
    if (latestDispute && isOpenStripeDisputeStatus(latestDispute.status)) {
      return privateJson(
        {
          error:
            "This payment has an open Stripe dispute. Resolve the dispute before issuing a seller refund.",
        },
        { status: HTTP_STATUS.CONFLICT },
      );
    }

    const refundConflict = sellerRefundConflictResponse(
      orderForRefundState.sellerRefundId,
    );
    if (refundConflict) {
      return privateJson(
        { error: refundConflict.error },
        { status: refundConflict.status },
      );
    }
    if (orderHasRefundLedger(orderForRefundState)) {
      return privateJson(
        { error: "A refund has already been issued for this order." },
        { status: HTTP_STATUS.BAD_REQUEST },
      );
    }
    if (orderHasPurchasedLabel(order)) {
      return privateJson(
        {
          error:
            "Cannot refund this order after a shipping label has been purchased. Void or resolve the label first.",
        },
        { status: HTTP_STATUS.CONFLICT },
      );
    }

    if (!order.stripePaymentIntentId) {
      return privateJson(
        {
          error:
            "Order has no Stripe payment intent. Refund must be processed manually.",
        },
        { status: HTTP_STATUS.BAD_REQUEST },
      );
    }

    const refundAmountCents = refundAmountForResolution(
      type,
      order,
      amountCents,
    );
    if (refundAmountCents == null) {
      return privateJson(
        {
          error:
            "amountCents is required and must be positive for PARTIAL refunds.",
        },
        { status: HTTP_STATUS.BAD_REQUEST },
      );
    }
    if (partialRefundExceedsOrderTotal(type, amountCents, order)) {
      return privateJson(
        { error: "Refund amount exceeds order total." },
        { status: HTTP_STATUS.BAD_REQUEST },
      );
    }
    const refundAmountDisplay = formatCurrencyCents(
      refundAmountCents,
      order.currency,
    );

    // Atomic lock: claim refund slot to prevent double-refund race after validation passes.
    const lockResult: number = await prisma.$executeRaw`
      UPDATE "Order"
      SET "sellerRefundId" = ${REFUND_LOCK_SENTINEL},
          "sellerRefundLockedAt" = ${new Date()}
      WHERE id = ${orderId}
        AND "sellerRefundId" IS NULL
        AND ("labelStatus" IS NULL OR "labelStatus" != 'PURCHASED'::"LabelStatus")
        AND NOT (${blockingRefundOrLatestOpenDisputeLedgerExistsSql(Prisma.sql`"Order".id`)})
    `;
    if (lockResult === 0) {
      const freshOrder = await prisma.order.findUnique({
        where: { id: orderId },
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
      return privateJson(
        { error: conflict.error },
        { status: conflict.status },
      );
    }

    let refundId: string | null = null;
    let refundIds: string[] = [];
    let refundStatuses: Array<string | null> = [];
    let refundRequiresManualTransferReconciliation = false;
    let refundRequiresManualFollowUp = false;
    try {
      const refund = await createMarketplaceRefund({
        paymentIntentId: order.stripePaymentIntentId,
        resolution: type,
        amountCents: refundAmountCents,
        itemsSubtotalCents: order.itemsSubtotalCents,
        shippingAmountCents: order.shippingAmountCents,
        giftWrappingPriceCents: order.giftWrappingPriceCents,
        taxAmountCents: order.taxAmountCents,
        canReverseTransfer: Boolean(seller.stripeAccountId),
        idempotencyKeyBase: refundIdempotencyKeyBase({
          scope: "seller-refund",
          id: orderId,
          resolution: type,
          amountCents: refundAmountCents,
        }),
      });
      refundId = refund.primaryRefundId;
      refundIds = refund.refundIds;
      refundStatuses = refund.refundStatuses;
      refundRequiresManualTransferReconciliation = refund.requiresManualTransferReconciliation;
      refundRequiresManualFollowUp = refund.requiresManualFollowUp;

      const stockRestores =
        type === "FULL" && refundMayRestoreStock(order)
          ? refundStockRestoreQuantities(myItems)
          : partialStockRestores;
      const stockRestoreIds = stockRestores.map((restore) => restore.listingId);

      // Resolve any open case on this order
      const existingCase = await prisma.case.findUnique({
        where: { orderId },
        select: { id: true, status: true },
      });

      const now = new Date();
      const refundSummary =
        refundIds.length > 1
          ? `Stripe refunds ${refundIds.join(", ")}`
          : `Stripe refund ${refundId}`;
      const transferNote = refund.requiresManualTransferReconciliation
        ? " Seller Stripe account is disconnected; transfer reversal must be reconciled manually."
        : "";
      const statusNote = refund.requiresManualFollowUp
        ? ` Stripe refund status requires manual follow-up: ${refund.refundStatuses.filter(Boolean).join(", ") || "provider pending"}.`
        : "";
      const reviewNote = `Seller-initiated ${type.toLowerCase()} refund of ${refundAmountDisplay} via ${refundSummary}.${transferNote}${statusNote}`;

      const refundWrite = await prisma.$transaction(async (tx) => {
        const orderUpdate = await tx.order.updateMany({
          where: { id: orderId, sellerRefundId: REFUND_LOCK_SENTINEL },
          data: {
            sellerRefundId: refundId,
            sellerRefundAmountCents: refundAmountCents,
            sellerRefundLockedAt: null,
            reviewNeeded: true,
            reviewNote,
          },
        });
        if (orderUpdate.count !== 1) {
          throw new Error(
            "Seller refund lock was no longer held while recording Stripe refund.",
          );
        }
        if (refundId) {
          await recordLocalRefundEvidence(tx, {
            action: "SELLER_REFUND_RECORDED",
            actorType: "system",
            actorId: me.id,
            orderId,
            refundId,
            refundIds,
            amountCents: refundAmountCents,
            currency: order.currency,
            status: refund.refundStatuses[0] ?? null,
            reason: "seller_refund",
            description: reviewNote,
            metadata: {
              refundType: type,
              requiresManualTransferReconciliation: refund.requiresManualTransferReconciliation,
              requiresManualFollowUp: refund.requiresManualFollowUp,
            },
          });
        }

        if (refund.requiresManualTransferReconciliation) {
          await tx.sellerProfile.update({
            where: { id: seller.id },
            data: {
              manualStripeReconciliationNeeded: true,
              manualStripeReconciliationNote:
                "Seller refund used a platform-only Stripe refund because the connected account transfer could not be reversed. Staff must reconcile the seller transfer manually.",
            },
          });
        }

        if (existingCase) {
          const caseUpdate = await tx.case.updateMany({
            where: {
              id: existingCase.id,
              status: { notIn: ["RESOLVED", "CLOSED"] },
            },
            data: {
              status: "RESOLVED",
              resolution: type === "FULL" ? "REFUND_FULL" : "REFUND_PARTIAL",
              refundAmountCents: refundAmountCents,
              stripeRefundId: refundId,
              resolvedAt: now,
              resolvedById: me.id,
            },
          });
          if (caseUpdate.count !== 1) {
            await tx.order.update({
              where: { id: orderId },
              data: {
                reviewNote: `${reviewNote} Case auto-resolution did not update because case state changed; staff must reconcile the case manually.`,
              },
            });
          }
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
        return { stockStatusRestoredCount: restoredActiveListingCount };
      });
      if (refundWrite.stockStatusRestoredCount > 0) {
        revalidateListingSearchCaches();
        revalidateFeaturedMakerCaches();
      }
    } catch (err) {
      if (refundId) {
        Sentry.captureException(err, {
          tags: { source: "seller_refund_orphaned_after_stripe" },
          extra: { orderId, refundId, refundIds, refundAmountCents },
        });
        try {
          const orphanRefundId = refundId;
          const orphanReviewNote = `ORPHANED REFUND: Stripe refund(s) ${refundIds.join(", ")} were created, but follow-up DB work failed. Manual reconciliation required.`;
          await prisma.$transaction(async (tx) => {
            const orphanRecord = await tx.order.updateMany({
              where: { id: orderId, sellerRefundId: REFUND_LOCK_SENTINEL },
              data: {
                sellerRefundId: orphanRefundId,
                sellerRefundAmountCents: refundAmountCents,
                sellerRefundLockedAt: null,
                reviewNeeded: true,
                reviewNote: orphanReviewNote,
              },
            });
            if (orphanRecord.count !== 1) {
              throw new Error("Seller refund orphan record was not written.");
            }
            await recordLocalRefundEvidence(tx, {
              action: "SELLER_REFUND_RECORDED",
              actorType: "system",
              actorId: me.id,
              orderId,
              refundId: orphanRefundId,
              refundIds,
              amountCents: refundAmountCents,
              currency: order.currency,
              status: refundStatuses[0] ?? null,
              reason: "seller_refund",
              description: orphanReviewNote,
              metadata: {
                refundType: type,
                orphanRecovery: true,
                requiresManualTransferReconciliation: refundRequiresManualTransferReconciliation,
                requiresManualFollowUp: refundRequiresManualFollowUp,
              },
            });
            if (refundRequiresManualTransferReconciliation) {
              await tx.sellerProfile.update({
                where: { id: seller.id },
                data: {
                  manualStripeReconciliationNeeded: true,
                  manualStripeReconciliationNote:
                    "Seller refund used a platform-only Stripe refund because the connected account transfer could not be reversed. Staff must reconcile the seller transfer manually.",
                },
              });
            }
          });
        } catch (dbError) {
          Sentry.captureException(dbError, {
            tags: { source: "seller_refund_orphan_record_failed" },
            extra: { orderId, refundId, refundIds, refundAmountCents },
          });
          throw dbError;
        }
      } else {
        await prisma.order
          .updateMany({
            where: { id: orderId, sellerRefundId: REFUND_LOCK_SENTINEL },
            data: { sellerRefundId: null, sellerRefundLockedAt: null },
          })
          .catch((dbError) => {
            Sentry.captureException(dbError, {
              tags: { source: "seller_refund_lock_release_failed" },
              extra: { orderId, refundAmountCents },
            });
          });
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
          body: `Your maker issued a refund of ${refundAmountDisplay} for your order.`,
          link: `/dashboard/orders/${orderId}`,
        });
      } catch (error) {
        Sentry.captureException(error, {
          level: "warning",
          tags: { source: "seller_refund_notification" },
          extra: { orderId, buyerId: order.buyerId, refundAmountCents },
        });
      }
    }

    try {
      const refundEmailAllowed = order.buyerId
        ? await shouldSendEmail(order.buyerId, "EMAIL_REFUND_ISSUED")
        : false;
      const buyerUser =
        order.buyerId && refundEmailAllowed
          ? await prisma.user.findUnique({
              where: { id: order.buyerId },
              select: { name: true, email: true },
            })
          : null;
      if (buyerUser?.email) {
        await sendRefundIssued({
          buyer: { name: buyerUser.name, email: buyerUser.email },
          refundAmountCents,
          currency: order.currency,
          orderId,
        });
      }
    } catch (error) {
      Sentry.captureException(error, {
        level: "warning",
        tags: { source: "seller_refund_email" },
        extra: { orderId, buyerId: order.buyerId ?? null, refundAmountCents },
      });
    }

    return privateJson({
      ok: true,
      refundId: refundId!,
      refundIds,
      refundAmountCents,
    });
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;

    logServerError(err, { source: "seller_refund_route" });
    return privateJson({ error: "Server error" }, { status: HTTP_STATUS.INTERNAL_SERVER_ERROR });
  }
}
