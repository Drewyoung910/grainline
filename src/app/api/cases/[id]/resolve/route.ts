import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { createMarketplaceRefund } from "@/lib/marketplaceRefunds";
import {
  prepareCaseStaffResolution,
  recordAmbiguousCaseStaffResolutionProvider,
  recordCaseStaffResolutionProvider,
  type CaseStaffResolution,
} from "@/lib/caseStaffResolutionAuthority";
import { finalizeCaseStaffResolutionWithSideEffects } from "@/lib/caseStaffResolutionFinalization";
import { rateLimitResponse, refundRatelimit, safeRateLimit } from "@/lib/ratelimit";
import { releaseStaleRefundLocks } from "@/lib/refundLocks";
import {
  partialRefundInputError,
} from "@/lib/refundRouteState";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";
import { logServerError } from "@/lib/serverErrorLogger";
import { HTTP_STATUS } from "@/lib/httpStatus";
import { requireStaffAdminPinForApi } from "@/lib/adminPinApi";
import { getPrismaRawSqlState } from "@/lib/prismaRawSqlError";
import {
  revalidateFeaturedMakerCaches,
  revalidateListingSearchCaches,
} from "@/lib/searchCache";

export const runtime = "nodejs";
export const maxDuration = 60;

const CaseResolveSchema = z.object({
  resolution: z.enum(["REFUND_FULL", "REFUND_PARTIAL", "DISMISSED"]),
  refundAmountCents: z.number().int().positive().optional().nullable(),
  restoreStock: z.array(z.object({
    listingId: z.string().min(1),
    quantity: z.number().int().positive().max(99),
  })).max(50).optional(),
});
const CASE_RESOLVE_BODY_MAX_BYTES = 24 * 1024;

function authorityFailureResponse(
  error: unknown,
  stage: "prepare" | "provider" | "finalize",
) {
  const sqlState = getPrismaRawSqlState(error);
  if (sqlState === null) return null;
  if (sqlState === "42501") {
    return privateJson(
      { error: "Your staff authority changed. Refresh and try again." },
      { status: HTTP_STATUS.FORBIDDEN },
    );
  }
  if (stage === "prepare" && sqlState === "22023") {
    return privateJson(
      { error: "The requested Case resolution is invalid." },
      { status: HTTP_STATUS.BAD_REQUEST },
    );
  }
  if (stage === "prepare" && sqlState === "23503") {
    return privateJson(
      { error: "Case not found." },
      { status: HTTP_STATUS.NOT_FOUND },
    );
  }
  if (
    sqlState === "22023"
    || sqlState === "23503"
    || sqlState === "23505"
    || sqlState === "23514"
    || sqlState === "40001"
  ) {
    return privateJson(
      {
        error: stage === "provider"
          ? "Refund state requires staff reconciliation before this Case can be resolved."
          : "Case or refund state changed. Refresh and try again.",
      },
      { status: HTTP_STATUS.CONFLICT },
    );
  }
  return null;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
    if (crossOriginRejection) {
      return privateJson(
        { error: "Forbidden" },
        { status: HTTP_STATUS.FORBIDDEN },
      );
    }

    const { id } = await params;
    const { userId, sessionId } = await auth();
    if (!userId) {
      return privateJson(
        { error: "Unauthorized" },
        { status: HTTP_STATUS.UNAUTHORIZED },
      );
    }
    const me = await ensureUserByClerkId(userId);
    if (me.role !== "EMPLOYEE" && me.role !== "ADMIN") {
      return privateJson(
        { error: "Forbidden." },
        { status: HTTP_STATUS.FORBIDDEN },
      );
    }
    const pinResponse = await requireStaffAdminPinForApi(
      req,
      userId,
      sessionId,
    );
    if (pinResponse) return pinResponse;

    const { success, reset } = await safeRateLimit(
      refundRatelimit,
      `case-resolve:${userId}`,
    );
    if (!success) {
      return privateResponse(
        rateLimitResponse(reset, "Too many case resolution attempts."),
      );
    }

    // Legacy refund reservations may still be reclaimed, but the shared
    // cleanup excludes every Order carrying a durable Case claim lease.
    await releaseStaleRefundLocks();

    let parsed: z.infer<typeof CaseResolveSchema>;
    try {
      parsed = CaseResolveSchema.parse(
        await readBoundedJson(req, CASE_RESOLVE_BODY_MAX_BYTES),
      );
    } catch (error) {
      if (isRequestBodyTooLargeError(error)) {
        return privateJson(
          { error: "Request body too large" },
          { status: HTTP_STATUS.PAYLOAD_TOO_LARGE },
        );
      }
      if (isInvalidJsonBodyError(error)) {
        return privateJson(
          { error: "Invalid JSON" },
          { status: HTTP_STATUS.BAD_REQUEST },
        );
      }
      if (error instanceof z.ZodError) {
        return privateJson(
          { error: "Invalid input", details: error.issues },
          { status: HTTP_STATUS.BAD_REQUEST },
        );
      }
      throw error;
    }

    const resolution: CaseStaffResolution = parsed.resolution;
    const refundAmountCents = parsed.refundAmountCents ?? null;
    const requestedStockRestores = parsed.restoreStock ?? [];
    if (resolution !== "REFUND_PARTIAL" && requestedStockRestores.length > 0) {
      return privateJson(
        {
          error:
            "Stock restoration is only available for partial case refunds.",
        },
        { status: HTTP_STATUS.BAD_REQUEST },
      );
    }
    if (partialRefundInputError(resolution, refundAmountCents)) {
      return privateJson(
        {
          error:
            "refundAmountCents is required and must be positive for REFUND_PARTIAL.",
        },
        { status: HTTP_STATUS.BAD_REQUEST },
      );
    }

    const refunding =
      resolution === "REFUND_FULL" || resolution === "REFUND_PARTIAL";

    let prepared;
    try {
      prepared = await prepareCaseStaffResolution({
        actorUserId: me.id,
        caseId: id,
        resolution,
        partialRefundAmountCents:
          resolution === "REFUND_PARTIAL" ? refundAmountCents : null,
        stockRestoreDecision:
          resolution === "REFUND_PARTIAL" ? requestedStockRestores : [],
      });
    } catch (error) {
      const response = authorityFailureResponse(error, "prepare");
      if (response) return response;
      throw error;
    }

    if (prepared.status === "RECONCILIATION_REQUIRED") {
      return privateJson(
        {
          error:
            "This Case refund has an ambiguous provider outcome. An administrator must reconcile it before retrying.",
        },
        { status: HTTP_STATUS.CONFLICT },
      );
    }

    if (refunding && prepared.status === "PROVIDER_PENDING") {
      if (prepared.resolution === "DISMISSED") {
        throw new TypeError("Dismissal cannot enter provider processing");
      }
      let refund;
      try {
        refund = await createMarketplaceRefund({
          paymentIntentId: prepared.paymentIntentId!,
          resolution: prepared.resolution,
          amountCents: prepared.refundAmountCents!,
          itemsSubtotalCents: prepared.itemsSubtotalCents,
          shippingAmountCents: prepared.shippingAmountCents,
          giftWrappingPriceCents: prepared.giftWrappingPriceCents,
          taxAmountCents: prepared.taxAmountCents,
          canReverseTransfer: prepared.canReverseTransfer,
          idempotencyKeyBase: prepared.idempotencyScope!,
          reason: "requested_by_customer",
        });
      } catch (stripeError) {
        try {
          await recordAmbiguousCaseStaffResolutionProvider(
            me.id,
            prepared,
          );
        } catch (recordError) {
          Sentry.captureException(recordError, {
            tags: {
              source: "case_refund_ambiguous_record_failed",
            },
            extra: {
              caseId: prepared.caseId,
              orderId: prepared.orderId,
              resolutionClaimId: prepared.claimId,
            },
          });
        }
        throw stripeError;
      }

      try {
        await recordCaseStaffResolutionProvider(
          me.id,
          prepared,
          {
            primaryRefundId: refund.primaryRefundId,
            refundIds: refund.refundIds,
            refundStatuses: refund.refundStatuses,
            transferReversalId:
              refund.accountingEvidence.transferReversalId,
            transferReversalAmountCents:
              refund.accountingEvidence.transferReversalAmountCents,
            requiresManualTransferReconciliation:
              refund.requiresManualTransferReconciliation,
            requiresManualFollowUp: refund.requiresManualFollowUp,
          },
        );
      } catch (error) {
        logServerError(error, {
          source: "case_refund_provider_record_failed",
          extra: {
            caseId: prepared.caseId,
            orderId: prepared.orderId,
            resolutionClaimId: prepared.claimId,
            refundCount: refund.refundIds.length,
          },
        });
        const response = authorityFailureResponse(error, "provider");
        if (response) return response;
        throw error;
      }
    }

    let finalized;
    try {
      finalized = await finalizeCaseStaffResolutionWithSideEffects(
        me.id,
        prepared,
      );
    } catch (error) {
      const response = authorityFailureResponse(error, "finalize");
      if (response) return response;
      throw error;
    }

    if (finalized.stockStatusRestoredCount > 0) {
      revalidateListingSearchCaches();
      revalidateFeaturedMakerCaches();
    }

    return privateJson({
      ok: true,
      caseId: finalized.caseId,
      orderId: finalized.orderId,
      resolution: finalized.resolution,
    });
  } catch (error) {
    const accountResponse = accountAccessErrorResponse(error);
    if (accountResponse) return accountResponse;

    logServerError(error, { source: "case_resolve_route" });
    return privateJson(
      { error: "Server error" },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR },
    );
  }
}
