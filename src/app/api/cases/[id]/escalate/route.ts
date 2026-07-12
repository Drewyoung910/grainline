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
import { isEscalatableCaseStatus } from "@/lib/caseActionState";
import { unavailableCaseMessageRecipientReason } from "@/lib/caseMessagingState";
import { logSystemActionOrThrow } from "@/lib/systemAudit";
import { logServerError } from "@/lib/serverErrorLogger";
import { requireStaffAdminPinForApi } from "@/lib/adminPinApi";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";

export const runtime = "nodejs";

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

    const now = new Date();
    let escalated = 0;

    if (id === "all") {
      // Bulk escalation: staff/cron only
      if (!validCron && !isStaff) {
        return privateJson({ error: "Forbidden." }, { status: 403 });
      }

      // Escalate cases whose response/discussion windows have expired.
      const result = await prisma.$transaction(async (tx) => {
        const update = await tx.case.updateMany({
          where: {
            OR: [
              { status: "OPEN", sellerRespondBy: { lt: now } },
              { status: "IN_DISCUSSION", escalateUnlocksAt: { lt: now } },
            ],
          },
          data: { status: "UNDER_REVIEW" },
        });
        if (update.count > 0) {
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
              escalatedCount: update.count,
              at: now.toISOString(),
            },
          });
        }
        return update;
      });
      escalated = result.count;
    } else {
      // Single case escalation
      const caseRecord = await prisma.case.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          escalateUnlocksAt: true,
          buyerId: true,
          sellerId: true,
          buyer: { select: { id: true, banned: true, deletedAt: true } },
          seller: { select: { id: true, banned: true, deletedAt: true } },
        },
      });
      if (!caseRecord) return privateJson({ error: "Case not found." }, { status: 404 });

      if (!isEscalatableCaseStatus(caseRecord.status)) {
        return privateJson(
          { error: "Only OPEN or IN_DISCUSSION cases can be escalated." },
          { status: 400 }
        );
      }

      if (!validCron && !isStaff) {
        // User-triggered: must be a party to the case
        const isParty = me!.id === caseRecord.buyerId || me!.id === caseRecord.sellerId;
        if (!isParty) return privateJson({ error: "Forbidden." }, { status: 403 });

        const counterpartyUnavailable = unavailableCaseMessageRecipientReason({
          senderId: me!.id,
          buyer: caseRecord.buyer,
          seller: caseRecord.seller,
          isStaff: false,
        }) != null;

        // Escalation is available after 48 hours, or immediately if the other
        // party cannot participate because their account is unavailable.
        if (!counterpartyUnavailable && (!caseRecord.escalateUnlocksAt || caseRecord.escalateUnlocksAt > now)) {
          return privateJson(
            { error: "Escalation not yet available. You can escalate after 48 hours of discussion." },
            { status: 400 }
          );
        }
      }

      const result =
        validCron || isStaff
          ? await prisma.$transaction(async (tx) => {
              const update = await tx.case.updateMany({
                where: { id, status: { in: ["OPEN", "IN_DISCUSSION"] } },
                data: { status: "UNDER_REVIEW" },
              });
              if (update.count > 0) {
                await logSystemActionOrThrow({
                  client: tx,
                  actorType: validCron ? "cron" : "staff",
                  actorId: validCron ? "case-escalate" : me!.id,
                  action: "ESCALATE_CASE",
                  targetType: "CASE",
                  targetId: id,
                  reason: "Case manually escalated for review",
                  metadata: {
                    route: "/api/cases/[id]/escalate",
                    previousStatus: caseRecord.status,
                    newStatus: "UNDER_REVIEW",
                    at: now.toISOString(),
                  },
                });
              }
              return update;
            })
          : await prisma.case.updateMany({
              where: { id, status: { in: ["OPEN", "IN_DISCUSSION"] } },
              data: { status: "UNDER_REVIEW" },
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
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;

    logServerError(err, { source: "case_escalate_route" });
    return privateJson({ error: "Server error" }, { status: 500 });
  }
}
