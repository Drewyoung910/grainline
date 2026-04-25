// src/app/api/cases/[id]/messages/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
import { sendCaseMessage } from "@/lib/email";
import { caseMessageRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { z } from "zod";

const CaseMessageSchema = z.object({
  body: z.string().min(1).max(5000),
});

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { success, reset } = await safeRateLimit(caseMessageRatelimit, userId);
    if (!success) return rateLimitResponse(reset, "Too many messages. Slow down and try again.");

    const me = await ensureUserByClerkId(userId);

    let parsed;
    try {
      parsed = CaseMessageSchema.parse(await req.json());
    } catch (e) {
      if (e instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
      }
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const messageBody = parsed.body.trim();
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

    // Notify the appropriate party/parties
    const senderName = me.name ?? me.email?.split("@")[0] ?? "Someone";
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://thegrainline.com";

    if (isStaff && !isParty) {
      // Staff message — notify both buyer and seller
      await createNotification({
        userId: caseRecord.buyerId,
        type: "CASE_MESSAGE",
        title: "Grainline Staff sent a message in your case",
        body: messageBody.slice(0, 60),
        link: `/dashboard/orders/${caseRecord.orderId}`,
      });
      await createNotification({
        userId: caseRecord.sellerId,
        type: "CASE_MESSAGE",
        title: "Grainline Staff sent a message in your case",
        body: messageBody.slice(0, 60),
        link: `/dashboard/sales/${caseRecord.orderId}`,
      });

      // Send emails to both parties
      try {
        const [buyer, seller] = await Promise.all([
          prisma.user.findUnique({ where: { id: caseRecord.buyerId }, select: { name: true, email: true } }),
          prisma.user.findUnique({ where: { id: caseRecord.sellerId }, select: { name: true, email: true } }),
        ]);
        if (buyer?.email && await shouldSendEmail(caseRecord.buyerId, "EMAIL_CASE_MESSAGE")) {
          await sendCaseMessage({
            recipientName: buyer.name,
            recipientEmail: buyer.email,
            senderName: "Grainline Staff",
            caseLink: `${appUrl}/dashboard/orders/${caseRecord.orderId}`,
            messageSnippet: messageBody,
          });
        }
        if (seller?.email && await shouldSendEmail(caseRecord.sellerId, "EMAIL_CASE_MESSAGE")) {
          await sendCaseMessage({
            recipientName: seller.name,
            recipientEmail: seller.email,
            senderName: "Grainline Staff",
            caseLink: `${appUrl}/dashboard/sales/${caseRecord.orderId}`,
            messageSnippet: messageBody,
          });
        }
      } catch { /* non-fatal */ }
    } else {
      // Buyer or seller message — notify the other party
      const recipientId = me.id === caseRecord.buyerId ? caseRecord.sellerId : caseRecord.buyerId;
      const caseLink =
        me.id === caseRecord.buyerId
          ? `/dashboard/sales/${caseRecord.orderId}`
          : `/dashboard/orders/${caseRecord.orderId}`;

      await createNotification({
        userId: recipientId,
        type: "CASE_MESSAGE",
        title: `${senderName} sent a message in your case`,
        body: messageBody.slice(0, 60),
        link: caseLink,
      });

      try {
        if (await shouldSendEmail(recipientId, "EMAIL_CASE_MESSAGE")) {
          const recipient = await prisma.user.findUnique({
            where: { id: recipientId },
            select: { name: true, email: true },
          });
          if (recipient?.email) {
            await sendCaseMessage({
              recipientName: recipient.name,
              recipientEmail: recipient.email,
              senderName: me.name,
              caseLink: `${appUrl}${caseLink}`,
              messageSnippet: messageBody,
            });
          }
        }
      } catch { /* non-fatal */ }
    }

    return NextResponse.json(message, { status: 201 });
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;

    console.error("POST /api/cases/[id]/messages error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
