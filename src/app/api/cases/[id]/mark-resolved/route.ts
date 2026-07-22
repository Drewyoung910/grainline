// src/app/api/cases/[id]/mark-resolved/route.ts
// Buyer or seller can call this to mark their side as resolved.
// When both parties have marked resolved → RESOLVED (DISMISSED).
// When only one party → PENDING_CLOSE.
// Note: a cron job should auto-close PENDING_CLOSE cases with no new messages after 48h.
import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { caseActionRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { caseResolutionMessage, isResolvableCaseStatus } from "@/lib/caseActionState";
import { createNotification } from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
import { logAdminActionOrThrow } from "@/lib/audit";
import { logServerError } from "@/lib/serverErrorLogger";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";

export const runtime = "nodejs";

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
  status: string;
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
      link: recipientIsBuyer ? `/dashboard/orders/${orderId}` : `/dashboard/sales/${orderId}`,
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
  { params }: { params: Promise<{ id: string }> }
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
    if (!success) return privateResponse(rateLimitResponse(reset, "Too many case actions."));

    const caseRecord = await prisma.case.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        buyerId: true,
        sellerId: true,
        orderId: true,
        buyerMarkedResolved: true,
        sellerMarkedResolved: true,
      },
    });
    if (!caseRecord) return privateJson({ error: "Case not found." }, { status: 404 });

    const isBuyer = me.id === caseRecord.buyerId;
    const isSeller = me.id === caseRecord.sellerId;
    if (!isBuyer && !isSeller) {
      return privateJson({ error: "Forbidden." }, { status: 403 });
    }

    if (!isResolvableCaseStatus(caseRecord.status)) {
      return privateJson({ error: "Case is not in an active state." }, { status: 400 });
    }

    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const updatedRows = await tx.$queryRaw<Array<{
        id: string;
        status: string;
        buyerMarkedResolved: boolean;
        sellerMarkedResolved: boolean;
      }>>`
        UPDATE "Case"
        SET
          "buyerMarkedResolved" = CASE WHEN "buyerId" = ${me.id} THEN true ELSE "buyerMarkedResolved" END,
          "sellerMarkedResolved" = CASE WHEN "sellerId" = ${me.id} THEN true ELSE "sellerMarkedResolved" END,
          "status" = CASE
            WHEN
              (CASE WHEN "buyerId" = ${me.id} THEN true ELSE "buyerMarkedResolved" END)
              AND
              (CASE WHEN "sellerId" = ${me.id} THEN true ELSE "sellerMarkedResolved" END)
            THEN 'RESOLVED'::"CaseStatus"
            ELSE 'PENDING_CLOSE'::"CaseStatus"
          END,
          "resolution" = CASE
            WHEN
              (CASE WHEN "buyerId" = ${me.id} THEN true ELSE "buyerMarkedResolved" END)
              AND
              (CASE WHEN "sellerId" = ${me.id} THEN true ELSE "sellerMarkedResolved" END)
            THEN 'DISMISSED'::"CaseResolution"
            ELSE "resolution"
          END,
          "resolvedAt" = CASE
            WHEN
              (CASE WHEN "buyerId" = ${me.id} THEN true ELSE "buyerMarkedResolved" END)
              AND
              (CASE WHEN "sellerId" = ${me.id} THEN true ELSE "sellerMarkedResolved" END)
            THEN COALESCE("resolvedAt", ${now})
            ELSE "resolvedAt"
          END,
          "resolvedById" = CASE
            WHEN
              (CASE WHEN "buyerId" = ${me.id} THEN true ELSE "buyerMarkedResolved" END)
              AND
              (CASE WHEN "sellerId" = ${me.id} THEN true ELSE "sellerMarkedResolved" END)
            THEN COALESCE("resolvedById", ${me.id})
            ELSE "resolvedById"
          END,
          "updatedAt" = ${now}
        WHERE
          id = ${id}
          AND ("buyerId" = ${me.id} OR "sellerId" = ${me.id})
          AND "status" IN ('OPEN'::"CaseStatus", 'IN_DISCUSSION'::"CaseStatus", 'PENDING_CLOSE'::"CaseStatus")
        RETURNING id, status::text AS status, "buyerMarkedResolved", "sellerMarkedResolved"
      `;
      const updated = updatedRows[0];
      if (!updated) return null;
      const auditLogId = await logAdminActionOrThrow({
        client: tx,
        adminId: me.id,
        action: "MARK_CASE_RESOLVED",
        targetType: "CASE",
        targetId: id,
        metadata: {
          actorKind: "user",
          orderId: caseRecord.orderId,
          status: updated.status,
        },
      });
      return { updated, auditLogId };
    });
    if (!result) {
      return privateJson(
        { error: "Case status changed before this resolution could be saved. Refresh and try again." },
        { status: 409 },
      );
    }
    const { updated, auditLogId } = result;

    const message = caseResolutionMessage(updated.status);
    await notifyCounterpartyOfResolutionMark({
      caseId: caseRecord.id,
      orderId: caseRecord.orderId,
      actorId: me.id,
      buyerId: caseRecord.buyerId,
      sellerId: caseRecord.sellerId,
      status: updated.status,
      authoritySourceId: auditLogId,
    });

    return privateJson({ ok: true, ...updated, message });
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;

    logServerError(err, { source: "case_mark_resolved_route" });
    return privateJson({ error: "Server error" }, { status: 500 });
  }
}
