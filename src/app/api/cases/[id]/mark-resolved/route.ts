// src/app/api/cases/[id]/mark-resolved/route.ts
// Buyer or seller can call this to mark their side as resolved.
// When both parties have marked resolved → RESOLVED (DISMISSED).
// When only one party → PENDING_CLOSE.
// Note: a cron job should auto-close PENDING_CLOSE cases with no new messages after 48h.
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId } from "@/lib/ensureUser";

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

    const ACTIVE_STATUSES = ["OPEN", "IN_DISCUSSION", "PENDING_CLOSE"];
    if (!ACTIVE_STATUSES.includes(caseRecord.status)) {
      return NextResponse.json({ error: "Case is not in an active state." }, { status: 400 });
    }

    const buyerResolved = isBuyer ? true : caseRecord.buyerMarkedResolved;
    const sellerResolved = isSeller ? true : caseRecord.sellerMarkedResolved;
    const bothResolved = buyerResolved && sellerResolved;

    const now = new Date();
    const updated = await prisma.case.update({
      where: { id },
      data: {
        buyerMarkedResolved: buyerResolved,
        sellerMarkedResolved: sellerResolved,
        status: bothResolved ? "RESOLVED" : "PENDING_CLOSE",
        ...(bothResolved
          ? { resolution: "DISMISSED", resolvedAt: now, resolvedById: me.id }
          : {}),
        updatedAt: now,
      },
      select: { id: true, status: true, buyerMarkedResolved: true, sellerMarkedResolved: true },
    });

    const message = bothResolved
      ? "Case resolved by mutual agreement."
      : "Waiting for other party to confirm resolution.";

    return NextResponse.json({ ok: true, ...updated, message });
  } catch (err) {
    console.error("POST /api/cases/[id]/mark-resolved error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
