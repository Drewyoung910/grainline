// src/app/api/orders/[id]/refund/route.ts
// Seller-initiated refund. Issues a Stripe refund immediately. Connected
// seller refunds use Stripe reverse_transfer under the manual transfer_data
// checkout model; full refunds also restore IN_STOCK inventory.
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import {
  rateLimitResponse,
  refundRatelimit,
  safeRateLimit,
} from "@/lib/ratelimit";
import {
  releaseStaleRefundLocks,
} from "@/lib/refundLocks";
import { revalidateFeaturedMakerCaches, revalidateListingSearchCaches } from "@/lib/searchCache";
import {
  orderHasPurchasedLabel,
  orderHasRefundLedger,
  refundAmountForResolution,
  refundLockAcquisitionConflictResponse,
  sellerRefundIdAfterStaleRelease,
  sellerRefundConflictResponse,
} from "@/lib/refundRouteState";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";
import { logServerError } from "@/lib/serverErrorLogger";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { HTTP_STATUS } from "@/lib/httpStatus";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { claimSellerOrderRefund } from "@/lib/orderRefundClaimAuthority";
import {
  orderRefundProviderEvidence,
  type OrderRefundProviderEvidence,
  type OrderRefundRecordResult,
} from "@/lib/orderRefundRecordAuthority";
import { finalizeSellerOrderRefund } from "@/lib/orderRefundFinalization";
import { resolveOrderRefundProviderOutcome } from "@/lib/orderRefundProviderReconciliation";
import { markOrderRefundClaimAmbiguous } from "@/lib/orderRefundReconciliationAuthority";

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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
    if (crossOriginRejection) {
      return privateJson({ error: "Forbidden" }, { status: HTTP_STATUS.FORBIDDEN });
    }

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

    if (refundParsed.type === "PARTIAL") {
      return privateJson(
        {
          error:
            "Seller partial refunds require Grainline staff review. Issue a full refund or contact support.",
        },
        { status: HTTP_STATUS.BAD_REQUEST },
      );
    }

    const type = "FULL" as const;
    const requestedStockRestores = refundParsed.restoreStock ?? [];

    if (type === "FULL" && requestedStockRestores.length > 0) {
      return privateJson(
        {
          error:
            "Full refunds restore eligible stock automatically. Do not provide restoreStock.",
        },
        { status: HTTP_STATUS.BAD_REQUEST },
      );
    }

    // Verify seller owns this order (has a seller profile with items in it)
    const seller = await prisma.sellerProfile.findUnique({
      where: { userId: me.id },
      select: { id: true },
    });
    if (!seller) return privateJson({ error: "Forbidden." }, { status: HTTP_STATUS.FORBIDDEN });

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            listing: {
              select: {
                sellerId: true,
              },
            },
          },
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

    const staleLocksReleased = await releaseStaleRefundLocks(orderId);
    const orderForRefundState = {
      ...order,
      sellerRefundId: sellerRefundIdAfterStaleRelease(
        order.sellerRefundId,
        staleLocksReleased.count,
      ),
    };

    if (order.paymentOpenDisputeBlocked) {
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
      null,
    );
    if (refundAmountCents == null) {
      throw new TypeError("Full seller refund amount could not be derived from the order");
    }
    const refundClaim = await claimSellerOrderRefund({
      actorUserId: me.id,
      orderId,
    });
    if (!refundClaim) {
      const freshOrder = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          sellerRefundId: true,
          labelStatus: true,
          paymentRefundBlocked: true,
          paymentOpenDisputeBlocked: true,
        },
      });
      const conflict = refundLockAcquisitionConflictResponse(
        freshOrder,
        freshOrder?.paymentOpenDisputeBlocked ?? false,
      );
      return privateJson(
        { error: conflict.error },
        { status: conflict.status },
      );
    }
    if (
      refundClaim.refundAmountCents !== refundAmountCents
      || refundClaim.currency !== order.currency.toLowerCase()
      || refundClaim.paymentIntentId !== order.stripePaymentIntentId
    ) {
      await markOrderRefundClaimAmbiguous({
        claim: refundClaim,
        reason: "SELLER_CLAIM_DRIFT",
      });
      throw new Error("Seller refund claim result drifted from the loaded Order");
    }

    let refundId: string | null = null;
    let refundIds: string[] = [];
    let refundProviderEvidence: OrderRefundProviderEvidence | null = null;
    let refundRecordResult: OrderRefundRecordResult | null = null;
    try {
      const refund = await resolveOrderRefundProviderOutcome(refundClaim);
      refundId = refund.primaryRefundId;
      refundIds = refund.refundIds;
      if (!refundId) {
        throw new Error(
          "Seller refund completed without a primary refund identifier.",
        );
      }
      const providerEvidence = orderRefundProviderEvidence(refund);
      refundProviderEvidence = providerEvidence;
      refundRecordResult = await finalizeSellerOrderRefund({
        actorUserId: me.id,
        orderId,
        claim: refundClaim,
        evidence: providerEvidence,
      });
      if (refundRecordResult.restoredActiveListingCount > 0) {
        revalidateListingSearchCaches();
        revalidateFeaturedMakerCaches();
      }
    } catch (err) {
      if (refundId) {
        Sentry.captureException(err, {
          tags: { source: "seller_refund_finalize_retry" },
          extra: { orderId, refundId, refundIds, refundAmountCents },
        });
        if (!refundProviderEvidence) {
          throw err;
        }
        try {
          refundRecordResult = await finalizeSellerOrderRefund({
            actorUserId: me.id,
            orderId,
            claim: refundClaim,
            evidence: refundProviderEvidence,
          });
          if (refundRecordResult.restoredActiveListingCount > 0) {
            revalidateListingSearchCaches();
            revalidateFeaturedMakerCaches();
          }
        } catch (dbError) {
          Sentry.captureException(dbError, {
            tags: { source: "seller_refund_finalize_retry_failed" },
            extra: { orderId, refundId, refundIds, refundAmountCents },
          });
          throw dbError;
        }
      } else {
        try {
          await markOrderRefundClaimAmbiguous({
            claim: refundClaim,
            reason: "SELLER_PROVIDER_AMBIGUOUS",
          });
        } catch (dbError) {
          Sentry.captureException(dbError, {
            tags: { source: "seller_refund_ambiguous_record_failed" },
            extra: { orderId, refundAmountCents },
          });
          throw dbError;
        }
        throw err;
      }
    }

    if (!refundId || !refundRecordResult) {
      throw new Error("Seller refund completed without durable refund authority");
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
