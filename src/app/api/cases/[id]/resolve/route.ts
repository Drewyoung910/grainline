import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import {
  isCaseRefundProviderReconciliationRequiredError,
  resolveCaseRefundProviderOutcome,
} from "@/lib/caseRefundProviderReconciliation";
import {
  prepareCaseStaffResolution,
  loadCaseStaffResolutionProviderRecovery,
  recordAmbiguousCaseStaffResolutionProvider,
  recordCaseStaffResolutionProvider,
  type CaseStaffResolution,
} from "@/lib/caseStaffResolutionAuthority";
import { finalizeCaseStaffResolutionWithSideEffects } from "@/lib/caseStaffResolutionFinalization";
import { rateLimitResponse, refundRatelimit, safeRateLimit } from "@/lib/ratelimit";
import { releaseCaseLegacyRefundLock } from "@/lib/orderLegacyRefundLockAuthority";
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
const CASE_REFUND_PROVIDER_RETRY_AFTER_SECONDS = 30;

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
      // Retire only a stale pre-generation lock on this Case's exact Order.
      // The fixed operation independently revalidates the active staff actor,
      // nonterminal Case relationship and absence of every modern claim.
      await releaseCaseLegacyRefundLock({ actorUserId: me.id, caseId: id });
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
      if (getPrismaRawSqlState(error) === "23505") {
        try {
          prepared = await loadCaseStaffResolutionProviderRecovery({
            actorUserId: me.id,
            caseId: id,
            resolution,
            partialRefundAmountCents:
              resolution === "REFUND_PARTIAL" ? refundAmountCents : null,
          });
        } catch (recoveryLoadError) {
          const response = authorityFailureResponse(
            recoveryLoadError,
            "prepare",
          );
          if (response) return response;
          throw recoveryLoadError;
        }
      } else {
        const response = authorityFailureResponse(error, "prepare");
        if (response) return response;
        throw error;
      }
    }

    if (
      refunding
      && (
        prepared.status === "PROVIDER_PENDING"
        || prepared.status === "RECONCILIATION_REQUIRED"
        || (
          prepared.status === "PROVIDER_RECORDED"
          && prepared.action === "recovery_required"
        )
      )
    ) {
      if (prepared.resolution === "DISMISSED") {
        throw new TypeError("Dismissal cannot enter provider processing");
      }
      let refund;
      try {
        const outcome = await resolveCaseRefundProviderOutcome(me.id, prepared);
        prepared = outcome.prepared;
        refund = outcome.providerResult;
      } catch (stripeError) {
        if (isCaseRefundProviderReconciliationRequiredError(stripeError)) {
          // A recovery_required snapshot can become stale inside
          // resolveCaseRefundProviderOutcome after this ADMIN authorizes an
          // exact retry. Re-read the claim before choosing the actor-bound
          // ambiguous recorder. If no recovery was authorized, retain the
          // existing reconciliation state without claiming ownership.
          if (prepared.action === "recovery_required") {
            try {
              prepared = await loadCaseStaffResolutionProviderRecovery({
                actorUserId: me.id,
                caseId: id,
                resolution,
                partialRefundAmountCents:
                  resolution === "REFUND_PARTIAL" ? refundAmountCents : null,
              });
            } catch (recoveryReloadError) {
              const response = authorityFailureResponse(
                recoveryReloadError,
                "provider",
              );
              if (response) return response;
              throw recoveryReloadError;
            }
          }
          if (
            prepared.status === "PROVIDER_PENDING"
            && prepared.action !== "recovery_required"
          ) {
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
              throw recordError;
            }
          }
          return privateJson(
            {
              error:
                "Stripe refund evidence requires administrator reconciliation before this Case can be resolved.",
            },
            { status: HTTP_STATUS.CONFLICT },
          );
        }

        // A connection or provider read failure does not prove that Stripe
        // created a refund. Keep the exact claim pending so a later request
        // inspects Stripe before reusing the claim-bound idempotency key.
        Sentry.captureException(stripeError, {
          tags: { source: "case_refund_provider_retryable" },
          extra: {
            caseId: prepared.caseId,
            orderId: prepared.orderId,
            resolutionClaimId: prepared.claimId,
          },
        });
        return privateJson(
          {
            error:
              "The refund provider did not confirm the result. Retry shortly; the same Case refund will not be duplicated.",
          },
          {
            status: HTTP_STATUS.SERVICE_UNAVAILABLE,
            headers: {
              "Retry-After": String(
                CASE_REFUND_PROVIDER_RETRY_AFTER_SECONDS,
              ),
            },
          },
        );
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
