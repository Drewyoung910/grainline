// Buyer or seller may escalate an eligible Case. Staff may escalate after the
// existing session-bound PIN challenge. Scheduled transitions use the
// separate database-selected case-auto-close batch and never target a
// caller-supplied Case id through this route.
import { auth } from "@clerk/nextjs/server";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import {
  caseActionRatelimit,
  rateLimitResponse,
  safeRateLimit,
} from "@/lib/ratelimit";
import { logServerError } from "@/lib/serverErrorLogger";
import { requireStaffAdminPinForApi } from "@/lib/adminPinApi";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";
import { escalateCaseWithFixedAuthority } from "@/lib/caseEscalationAuthority";
import { getPrismaRawSqlState } from "@/lib/prismaRawSqlError";

export const runtime = "nodejs";

function caseEscalationFailureResponse(error: unknown) {
  const sqlState = getPrismaRawSqlState(error);
  if (sqlState === null) return null;
  if (sqlState === "22023") {
    return privateJson(
      { error: "The requested Case escalation is invalid." },
      { status: 400 },
    );
  }
  if (sqlState === "23503") {
    return privateJson({ error: "Case not found." }, { status: 404 });
  }
  if (sqlState === "42501") {
    return privateJson({ error: "Forbidden." }, { status: 403 });
  }
  if (sqlState === "55000") {
    return privateJson(
      {
        error:
          "Escalation is not yet available. You can escalate after 48 hours of discussion.",
      },
      { status: 400 },
    );
  }
  if (
    sqlState === "23505"
    || sqlState === "23514"
    || sqlState === "40001"
  ) {
    return privateJson(
      {
        error:
          "Case or refund state changed before escalation could be saved. Refresh and try again.",
      },
      { status: 409 },
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
      return privateJson({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const { userId, sessionId } = await auth();
    if (!userId) {
      return privateJson({ error: "Unauthorized" }, { status: 401 });
    }
    const me = await ensureUserByClerkId(userId);
    if (me.role === "EMPLOYEE" || me.role === "ADMIN") {
      const pinResponse = await requireStaffAdminPinForApi(
        req,
        userId,
        sessionId,
      );
      if (pinResponse) return pinResponse;
    }
    const { success, reset } = await safeRateLimit(
      caseActionRatelimit,
      me.id,
    );
    if (!success) {
      return privateResponse(
        rateLimitResponse(reset, "Too many case actions."),
      );
    }

    try {
      const result = await escalateCaseWithFixedAuthority({
        actorUserId: me.id,
        caseId: id,
      });
      return privateJson({
        ok: true,
        escalated: 1,
        caseId: result.caseId,
        status: result.status,
      });
    } catch (error) {
      const response = caseEscalationFailureResponse(error);
      if (response) return response;
      throw error;
    }
  } catch (error) {
    const accountResponse = accountAccessErrorResponse(error);
    if (accountResponse) return accountResponse;

    logServerError(error, { source: "case_escalate_route" });
    return privateJson({ error: "Server error" }, { status: 500 });
  }
}
