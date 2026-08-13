// src/app/api/cases/[id]/mark-resolved/route.ts
// Buyer or seller can call this to mark their side as resolved.
// When both parties have marked resolved → RESOLVED (DISMISSED).
// When only one party → PENDING_CLOSE.
// Note: a cron job should auto-close PENDING_CLOSE cases with no new messages after 48h.
import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import {
  caseActionRatelimit,
  rateLimitResponse,
  safeRateLimit,
} from "@/lib/ratelimit";
import { caseResolutionMessage } from "@/lib/caseActionState";
import { createNotification } from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
import { logServerError } from "@/lib/serverErrorLogger";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";
import { markCaseParticipantResolved } from "@/lib/caseParticipantResolutionAuthority";
import type { CaseParticipantResolutionResult } from "@/lib/caseParticipantResolutionResult";
import { getPrismaRawSqlState } from "@/lib/prismaRawSqlError";

export const runtime = "nodejs";

function participantResolutionFailureResponse(error: unknown) {
  const sqlState = getPrismaRawSqlState(error);
  if (sqlState === null) return null;
  if (sqlState === "22023") {
    return privateJson(
      { error: "The requested Case resolution is invalid." },
      { status: 400 },
    );
  }
  if (sqlState === "23503") {
    return privateJson({ error: "Case not found." }, { status: 404 });
  }
  if (sqlState === "42501") {
    return privateJson({ error: "Forbidden." }, { status: 403 });
  }
  if (
    sqlState === "23505"
    || sqlState === "23514"
    || sqlState === "40001"
  ) {
    return privateJson(
      {
        error:
          "Case or refund state changed before this resolution could be saved. Refresh and try again.",
      },
      { status: 409 },
    );
  }
  return null;
}

async function notifyCounterpartyOfResolutionMark({
  caseId,
  orderId,
  actorId,
  buyerId,
  sellerId,
  status,
  authoritySourceId,
}: {
  caseId: string;
  orderId: string;
  actorId: string;
  buyerId: string | null;
  sellerId: string;
  status: "PENDING_CLOSE" | "RESOLVED";
  authoritySourceId: string;
}) {
  const recipientId = actorId === buyerId ? sellerId : buyerId;
  if (!recipientId) return;
  const recipientIsBuyer = recipientId === buyerId;
  const resolved = status === "RESOLVED";

  try {
    await createNotification({
      userId: recipientId,
      type: resolved ? "CASE_RESOLVED" : "CASE_MESSAGE",
      title: resolved ? "Case resolved" : "Case marked resolved",
      body: resolved
        ? "The case was resolved after both parties confirmed."
        : "The other party marked this case resolved. Confirm resolution or continue the discussion.",
      link: recipientIsBuyer
        ? `/dashboard/orders/${orderId}`
        : `/dashboard/sales/${orderId}`,
      dedupScope: `${caseId}:${status}:${actorId}`,
      relatedUserId: actorId,
      sourceType: NOTIFICATION_SOURCE_TYPES.CASE_RESOLUTION_MARK,
      sourceId: authoritySourceId,
    });
  } catch (error) {
    Sentry.captureException(error, {
      level: "warning",
      tags: { source: "case_mark_resolved_notification" },
      extra: { caseId, orderId, recipientId, status },
    });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
    if (crossOriginRejection) {
      return privateJson({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const { userId } = await auth();
    if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });
    const me = await ensureUserByClerkId(userId);
    const { success, reset } = await safeRateLimit(caseActionRatelimit, me.id);
    if (!success) {
      return privateResponse(
        rateLimitResponse(reset, "Too many case actions."),
      );
    }

    let result: CaseParticipantResolutionResult;
    try {
      result = await markCaseParticipantResolved({
        actorUserId: me.id,
        caseId: id,
      });
    } catch (error) {
      const response = participantResolutionFailureResponse(error);
      if (response) return response;
      throw error;
    }

    const message = caseResolutionMessage(result.status);
    if (result.action !== "historical_replay") {
      await notifyCounterpartyOfResolutionMark({
        caseId: result.caseId,
        orderId: result.orderId,
        actorId: me.id,
        buyerId: result.buyerUserId,
        sellerId: result.sellerUserId,
        status: result.status,
        authoritySourceId: result.auditLogId,
      });
    }

    return privateJson({
      ok: true,
      id: result.caseId,
      status: result.status,
      buyerMarkedResolved: result.buyerMarkedResolved,
      sellerMarkedResolved: result.sellerMarkedResolved,
      message,
    });
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;

    logServerError(err, { source: "case_mark_resolved_route" });
    return privateJson({ error: "Server error" }, { status: 500 });
  }
}
