// src/app/api/cases/[id]/mark-resolved/route.ts
// Buyer or seller can call this to mark their side as resolved.
// When both parties have marked resolved → RESOLVED (DISMISSED).
// When only one party → PENDING_CLOSE.
// Note: a cron job should auto-close PENDING_CLOSE cases with no new messages after 48h.
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { caseActionRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { caseResolutionMessage, isResolvableCaseStatus } from "@/lib/caseActionState";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const me = await ensureUserByClerkId(userId);
    const { success, reset } = await safeRateLimit(caseActionRatelimit, me.id);
    if (!success) return rateLimitResponse(reset, "Too many case actions.");

    const caseRecord = await prisma.case.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        buyerId: true,
        sellerId: true,
        buyerMarkedResolved: true,
        sellerMarkedResolved: true,
      },
    });
    if (!caseRecord) return NextResponse.json({ error: "Case not found." }, { status: 404 });

    const isBuyer = me.id === caseRecord.buyerId;
    const isSeller = me.id === caseRecord.sellerId;
    if (!isBuyer && !isSeller) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    if (!isResolvableCaseStatus(caseRecord.status)) {
      return NextResponse.json({ error: "Case is not in an active state." }, { status: 400 });
    }

    const now = new Date();
    const updatedRows = await prisma.$queryRaw<Array<{
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
    if (!updated) {
      return NextResponse.json(
        { error: "Case status changed before this resolution could be saved. Refresh and try again." },
        { status: 409 },
      );
    }

    const message = caseResolutionMessage(updated.status);

    return NextResponse.json({ ok: true, ...updated, message });
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;

    console.error("POST /api/cases/[id]/mark-resolved error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
