// src/app/api/cases/[id]/escalate/route.ts
// Call with id="all" to bulk-escalate expired cases (staff/cron only).
// Call with a case cuid to escalate a single case:
//   - Staff / CRON_SECRET bearer: always allowed
//   - Buyer or seller: allowed only if escalateUnlocksAt is in the past
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { caseActionRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { verifyCronRequest } from "@/lib/cronAuth";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Auth: accept CRON_SECRET bearer token OR an authenticated user session
    const validCron = verifyCronRequest(req);

    let me: Awaited<ReturnType<typeof ensureUserByClerkId>> | null = null;

    if (!validCron) {
      const { userId } = await auth();
      if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      me = await ensureUserByClerkId(userId);
      const { success, reset } = await safeRateLimit(caseActionRatelimit, me.id);
      if (!success) return rateLimitResponse(reset, "Too many case actions.");
    }

    const isStaff = me?.role === "EMPLOYEE" || me?.role === "ADMIN";

    const now = new Date();
    let escalated = 0;

    if (id === "all") {
      // Bulk escalation: staff/cron only
      if (!validCron && !isStaff) {
        return NextResponse.json({ error: "Forbidden." }, { status: 403 });
      }

      // Escalate OPEN cases past their seller response deadline
      const result = await prisma.case.updateMany({
        where: { status: "OPEN", sellerRespondBy: { lt: now } },
        data: { status: "UNDER_REVIEW" },
      });
      escalated = result.count;
    } else {
      // Single case escalation
      const caseRecord = await prisma.case.findUnique({
        where: { id },
        select: { id: true, status: true, escalateUnlocksAt: true, buyerId: true, sellerId: true },
      });
      if (!caseRecord) return NextResponse.json({ error: "Case not found." }, { status: 404 });

      if (caseRecord.status !== "OPEN" && caseRecord.status !== "IN_DISCUSSION") {
        return NextResponse.json(
          { error: "Only OPEN or IN_DISCUSSION cases can be escalated." },
          { status: 400 }
        );
      }

      if (!validCron && !isStaff) {
        // User-triggered: must be a party to the case
        const isParty = me!.id === caseRecord.buyerId || me!.id === caseRecord.sellerId;
        if (!isParty) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

        // Escalation only available after 48 hours of discussion
        if (!caseRecord.escalateUnlocksAt || caseRecord.escalateUnlocksAt > now) {
          return NextResponse.json(
            { error: "Escalation not yet available. You can escalate after 48 hours of discussion." },
            { status: 400 }
          );
        }
      }

      await prisma.case.update({
        where: { id },
        data: { status: "UNDER_REVIEW" },
      });
      escalated = 1;
    }

    return NextResponse.json({ ok: true, escalated });
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;

    console.error("POST /api/cases/[id]/escalate error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
