// src/app/api/cases/[id]/messages/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { createNotification } from "@/lib/notifications";
import { sendCaseMessage } from "@/lib/email";

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

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* empty body */ }
    const messageBody = body?.body ? String(body.body).trim() : "";
    if (!messageBody) return NextResponse.json({ error: "body is required." }, { status: 400 });

    const caseRecord = await prisma.case.findUnique({ where: { id } });
    if (!caseRecord) return NextResponse.json({ error: "Case not found." }, { status: 404 });

    const isParty = me.id === caseRecord.buyerId || me.id === caseRecord.sellerId;
    const isStaff = me.role === "EMPLOYEE" || me.role === "ADMIN";
    if (!isParty && !isStaff) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    if (caseRecord.status === "RESOLVED" || caseRecord.status === "CLOSED") {
      return NextResponse.json({ error: "This case is closed." }, { status: 400 });
    }

    const now = new Date();
    const caseUpdates: Record<string, unknown> = { updatedAt: now };

    // When seller responds to an OPEN case for the first time, transition to IN_DISCUSSION
    if (me.id === caseRecord.sellerId && caseRecord.status === "OPEN") {
      caseUpdates.status = "IN_DISCUSSION";
      caseUpdates.discussionStartedAt = now;
      caseUpdates.escalateUnlocksAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    }

    const [message] = await prisma.$transaction([
      prisma.caseMessage.create({
        data: { caseId: id, authorId: me.id, body: messageBody },
      }),
      prisma.case.update({
        where: { id },
        data: caseUpdates,
      }),
    ]);

    // Notify the OTHER party
    const recipientId = me.id === caseRecord.buyerId ? caseRecord.sellerId : caseRecord.buyerId;
    const caseLink =
      me.id === caseRecord.buyerId
        ? `/dashboard/sales/${caseRecord.orderId}`
        : `/dashboard/orders/${caseRecord.orderId}`;

    await createNotification({
      userId: recipientId,
      type: "CASE_MESSAGE",
      title: `${me.name ?? me.email?.split("@")[0] ?? "Someone"} sent a message in your case`,
      body: messageBody.slice(0, 60),
      link: caseLink,
    });

    try {
      const recipient = await prisma.user.findUnique({
        where: { id: recipientId },
        select: { name: true, email: true },
      });
      if (recipient?.email) {
        await sendCaseMessage({
          recipientName: recipient.name,
          recipientEmail: recipient.email,
          senderName: me.name,
          caseLink: `${process.env.NEXT_PUBLIC_APP_URL || "https://thegrainline.com"}${caseLink}`,
          messageSnippet: messageBody,
        });
      }
    } catch { /* non-fatal */ }

    return NextResponse.json(message, { status: 201 });
  } catch (err) {
    console.error("POST /api/cases/[id]/messages error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
