// src/app/api/cases/[id]/escalate/route.ts
// Call with id="all" to bulk-escalate expired cases (staff/cron only).
// Call with a case cuid to escalate a single case:
//   - Staff / CRON_SECRET bearer: always allowed
//   - Buyer or seller: allowed if escalateUnlocksAt is in the past, or if
//     the counterparty account is unavailable.
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { caseActionRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { verifyCronRequest } from "@/lib/cronAuth";
import {
  caseEscalationAvailable,
  isEscalatableCaseStatus,
} from "@/lib/caseActionState";
import { unavailableCaseMessageRecipientReason } from "@/lib/caseMessagingState";
import { logSystemActionOrThrow } from "@/lib/systemAudit";
import { logUserAuditActionOrThrow } from "@/lib/audit";
import {
  databaseClockTimestamp,
  lockCaseForLifecycle,
} from "@/lib/caseLifecycleLocks";
import { logServerError } from "@/lib/serverErrorLogger";
import { requireStaffAdminPinForApi } from "@/lib/adminPinApi";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";

export const runtime = "nodejs";

class CaseEscalationRouteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CaseEscalationRouteError";
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

    // Auth: accept CRON_SECRET bearer token OR an authenticated user session
    const validCron = verifyCronRequest(req);

    let me: Awaited<ReturnType<typeof ensureUserByClerkId>> | null = null;

    if (!validCron) {
      const { userId, sessionId } = await auth();
      if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });
      me = await ensureUserByClerkId(userId);
      if (me.role === "EMPLOYEE" || me.role === "ADMIN") {
        const pinResponse = await requireStaffAdminPinForApi(req, userId, sessionId);
        if (pinResponse) return pinResponse;
      }
      const { success, reset } = await safeRateLimit(caseActionRatelimit, me.id);
      if (!success) return privateResponse(rateLimitResponse(reset, "Too many case actions."));
    }

    const isStaff = me?.role === "EMPLOYEE" || me?.role === "ADMIN";

    let escalated = 0;

    if (id === "all") {
      // Bulk escalation: staff/cron only
      if (!validCron && !isStaff) {
        return privateJson({ error: "Forbidden." }, { status: 403 });
      }

      // Escalate cases whose response/discussion windows have expired.
      const result = await prisma.$transaction(async (tx) => {
        const updatedRows = await tx.$queryRaw<Array<{ id: string }>>`
          UPDATE "Case"
             SET status = 'UNDER_REVIEW'::"CaseStatus",
                 "updatedAt" = pg_catalog.clock_timestamp()
           WHERE (
             (
               status = 'OPEN'::"CaseStatus"
               AND "sellerRespondBy" < pg_catalog.clock_timestamp()
             )
             OR (
               status = 'IN_DISCUSSION'::"CaseStatus"
               AND "escalateUnlocksAt" < pg_catalog.clock_timestamp()
             )
           )
          RETURNING id
        `;
        if (updatedRows.length > 0) {
          const auditedAt = await databaseClockTimestamp(tx);
          await logSystemActionOrThrow({
            client: tx,
            actorType: validCron ? "cron" : "staff",
            actorId: validCron ? "case-escalate-bulk" : me!.id,
            action: "BULK_ESCALATE_CASES",
            targetType: "CASE",
            targetId: "all",
            reason: "Case response or discussion windows expired",
            metadata: {
              route: "/api/cases/all/escalate",
              escalatedCount: updatedRows.length,
              at: auditedAt.toISOString(),
            },
          });
        }
        return { count: updatedRows.length };
      });
      escalated = result.count;
    } else {
      // Single case escalation
      const result = await prisma.$transaction(async (tx) => {
        const caseExists = await lockCaseForLifecycle(tx, id);
        if (!caseExists) {
          throw new CaseEscalationRouteError("Case not found.", 404);
        }
        const caseRecord = await tx.case.findUnique({
          where: { id },
          select: {
            id: true,
            orderId: true,
            status: true,
            escalateUnlocksAt: true,
            buyerId: true,
            sellerId: true,
            buyer: { select: { id: true, banned: true, deletedAt: true } },
            seller: { select: { id: true, banned: true, deletedAt: true } },
          },
        });
        if (!caseRecord) {
          throw new CaseEscalationRouteError("Case not found.", 404);
        }
        if (!isEscalatableCaseStatus(caseRecord.status)) {
          throw new CaseEscalationRouteError(
            "Only OPEN or IN_DISCUSSION cases can be escalated.",
            400,
          );
        }

        const transitionAt = await databaseClockTimestamp(tx);
        if (!validCron && !isStaff) {
          const isParty =
            me!.id === caseRecord.buyerId || me!.id === caseRecord.sellerId;
          if (!isParty) {
            throw new CaseEscalationRouteError("Forbidden.", 403);
          }
          const counterpartyUnavailable =
            unavailableCaseMessageRecipientReason({
              senderId: me!.id,
              buyer: caseRecord.buyer,
              seller: caseRecord.seller,
              isStaff: false,
            }) != null;
          if (
            !caseEscalationAvailable(
              caseRecord.status,
              caseRecord.escalateUnlocksAt,
              transitionAt,
              counterpartyUnavailable,
            )
          ) {
            throw new CaseEscalationRouteError(
              "Escalation not yet available. You can escalate after 48 hours of discussion.",
              400,
            );
          }
        }

        const update = await tx.case.updateMany({
          where: { id, status: caseRecord.status },
          data: { status: "UNDER_REVIEW", updatedAt: transitionAt },
        });
        if (update.count === 0) return update;

        const auditInput = {
          action: "ESCALATE_CASE",
          targetType: "CASE",
          targetId: id,
          reason: "Case manually escalated for review",
          metadata: {
            orderId: caseRecord.orderId,
            route: "/api/cases/[id]/escalate",
            previousStatus: caseRecord.status,
            newStatus: "UNDER_REVIEW",
            at: transitionAt.toISOString(),
          },
        };
        if (!validCron && !isStaff) {
          await logUserAuditActionOrThrow({
            client: tx,
            actorId: me!.id,
            ...auditInput,
          });
        } else {
          await logSystemActionOrThrow({
            client: tx,
            actorType: validCron ? "cron" : "staff",
            actorId: validCron ? "case-escalate" : me!.id,
            ...auditInput,
          });
        }
        return update;
      });
      if (result.count === 0) {
        return privateJson(
          { error: "Case status changed before escalation could be saved. Refresh and try again." },
          { status: 409 },
        );
      }
      escalated = result.count;
    }

    return privateJson({ ok: true, escalated });
  } catch (err) {
    if (err instanceof CaseEscalationRouteError) {
      return privateJson({ error: err.message }, { status: err.status });
    }
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;

    logServerError(err, { source: "case_escalate_route" });
    return privateJson({ error: "Server error" }, { status: 500 });
  }
}
