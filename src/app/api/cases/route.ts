// src/app/api/cases/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { createNotification } from "@/lib/notifications";
import { sendCaseOpened } from "@/lib/email";
import type { CaseReason } from "@prisma/client";

export const runtime = "nodejs";

const VALID_REASONS: CaseReason[] = [
  "NOT_RECEIVED",
  "NOT_AS_DESCRIBED",
  "DAMAGED",
  "WRONG_ITEM",
  "OTHER",
];

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const me = await ensureUserByClerkId(userId);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* empty body */ }

    const orderId = body?.orderId ? String(body.orderId) : "";
    const reasonRaw = body?.reason ? String(body.reason) : "";
    const description = body?.description ? String(body.description).trim() : "";

    if (!orderId || !reasonRaw || !description) {
      return NextResponse.json(
        { error: "orderId, reason, and description are required." },
        { status: 400 }
      );
    }
    if (!VALID_REASONS.includes(reasonRaw as CaseReason)) {
      return NextResponse.json(
        { error: `Invalid reason. Must be one of: ${VALID_REASONS.join(", ")}` },
        { status: 400 }
      );
    }
    const reason = reasonRaw as CaseReason;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        case: { select: { id: true } },
        items: {
          take: 1,
          include: {
            listing: { select: { seller: { select: { userId: true } } } },
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

    // Block case if estimated delivery date is still in the future
    if (order.estimatedDeliveryDate && order.estimatedDeliveryDate > new Date()) {
      return NextResponse.json(
        { error: "Cannot open a case before the estimated delivery date." },
        { status: 400 }
      );
    }

    const sellerId = order.items[0]?.listing.seller.userId;
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

    await createNotification({
      userId: sellerId,
      type: "CASE_OPENED",
      title: `${me.name ?? me.email?.split("@")[0] ?? "A buyer"} opened a case`,
      body: description.slice(0, 60),
      link: `/dashboard/sales/${orderId}`,
    });

    try {
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
    } catch { /* non-fatal */ }

    return NextResponse.json(newCase, { status: 201 });
  } catch (err) {
    console.error("POST /api/cases error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
