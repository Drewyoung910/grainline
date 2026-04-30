// src/app/api/cases/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
import { sendCaseOpened } from "@/lib/email";
import { caseCreateRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { blockingRefundLedgerWhere, orderHasRefundLedger } from "@/lib/refundRouteState";
import { logUserAuditAction } from "@/lib/audit";
import { caseEstimatedDeliveryBlockMessage } from "@/lib/caseCreateState";
import { truncateText } from "@/lib/sanitize";
import { z } from "zod";

export const runtime = "nodejs";

const CaseCreateSchema = z.object({
  orderId: z.string().min(1),
  reason: z.enum(["NOT_RECEIVED", "NOT_AS_DESCRIBED", "DAMAGED", "WRONG_ITEM", "OTHER"]),
  description: z.string().min(1).max(2000),
});

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { success, reset } = await safeRateLimit(caseCreateRatelimit, userId);
    if (!success) return rateLimitResponse(reset, "Too many case submissions. Try again later.");

    const me = await ensureUserByClerkId(userId);

    let parsed;
    try {
      parsed = CaseCreateSchema.parse(await req.json());
    } catch (e) {
      if (e instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
      }
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const { orderId, reason } = parsed;
    const description = parsed.description.trim();
    if (description.length < 20) {
      return NextResponse.json({ error: "Description must be at least 20 characters." }, { status: 400 });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        case: { select: { id: true } },
        paymentEvents: {
          where: blockingRefundLedgerWhere(),
          take: 1,
          select: { eventType: true, status: true },
        },
        items: {
          take: 1,
          include: {
            listing: {
              select: {
                seller: {
                  select: {
                    user: { select: { id: true, banned: true, deletedAt: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
    if (order.buyerId !== me.id) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    if (order.case) {
      return NextResponse.json(
        { error: "A case already exists for this order." },
        { status: 409 }
      );
    }

    // Block case if seller already refunded
    if (orderHasRefundLedger(order)) {
      return NextResponse.json(
        { error: "A refund has already been issued for this order." },
        { status: 400 }
      );
    }

    // Block case if order hasn't been shipped yet
    const sellerUser = order.items[0]?.listing.seller.user;
    const sellerUnavailable = Boolean(sellerUser?.banned || sellerUser?.deletedAt);
    const fulfillmentStatus = order.fulfillmentStatus ?? "PENDING";
    if (fulfillmentStatus === "PENDING" && !sellerUnavailable && !order.reviewNeeded) {
      return NextResponse.json(
        { error: "Please wait until your order has shipped before opening a case." },
        { status: 400 }
      );
    }

    // Block case if estimated delivery date is still in the future
    if (
      order.estimatedDeliveryDate &&
      order.estimatedDeliveryDate > new Date() &&
      !sellerUnavailable &&
      !order.reviewNeeded
    ) {
      return NextResponse.json(
        { error: caseEstimatedDeliveryBlockMessage(order.estimatedDeliveryDate) },
        { status: 400 }
      );
    }

    const sellerId = sellerUser?.id;
    if (!sellerId) {
      return NextResponse.json(
        { error: "Could not determine seller for this order." },
        { status: 400 }
      );
    }

    const sellerRespondBy = new Date(Date.now() + 48 * 60 * 60 * 1000);

    const newCase = await prisma.case.create({
      data: {
        orderId,
        buyerId: me.id,
        sellerId,
        reason,
        description,
        sellerRespondBy,
        messages: {
          create: { authorId: me.id, body: description },
        },
      },
      include: { messages: true },
    });

    await logUserAuditAction({
      actorId: me.id,
      action: "BUYER_OPEN_CASE",
      targetType: "CASE",
      targetId: newCase.id,
      metadata: { orderId, sellerId, reason },
    });

    await createNotification({
      userId: sellerId,
      type: "CASE_OPENED",
      title: `${me.name ?? me.email?.split("@")[0] ?? "A buyer"} opened a case`,
      body: truncateText(description, 60),
      link: `/dashboard/sales/${orderId}`,
    });

    try {
      if (await shouldSendEmail(sellerId, "EMAIL_CASE_OPENED")) {
        const sellerUser = await prisma.user.findUnique({
          where: { id: sellerId },
          select: { name: true, email: true },
        });
        if (sellerUser?.email) {
          await sendCaseOpened({
            orderId,
            seller: { name: sellerUser.name, email: sellerUser.email },
            buyer: { name: me.name },
            caseDescription: description,
          });
        }
      }
    } catch (emailError) {
      Sentry.captureException(emailError, {
        level: "warning",
        tags: { source: "case_open_email" },
        extra: { caseId: newCase.id, orderId, sellerId },
      });
    }

    return NextResponse.json(newCase, { status: 201 });
  } catch (err) {
    if (isAccountAccessError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error("POST /api/cases error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
