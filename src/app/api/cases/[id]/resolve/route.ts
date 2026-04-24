// src/app/api/cases/[id]/resolve/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
import { sendCaseResolved } from "@/lib/email";
import { z } from "zod";

export const runtime = "nodejs";

const CaseResolveSchema = z.object({
  resolution: z.enum(["REFUND_FULL", "REFUND_PARTIAL", "DISMISSED"]),
  refundAmountCents: z.number().int().positive().optional().nullable(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const me = await ensureUserByClerkId(userId);

    if (me.role !== "EMPLOYEE" && me.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    let parsed;
    try {
      parsed = CaseResolveSchema.parse(await req.json());
    } catch (e) {
      if (e instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
      }
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const { resolution, refundAmountCents } = parsed;

    if (
      resolution === "REFUND_PARTIAL" &&
      (refundAmountCents == null || refundAmountCents <= 0)
    ) {
      return NextResponse.json(
        { error: "refundAmountCents is required and must be positive for REFUND_PARTIAL." },
        { status: 400 }
      );
    }

    const caseRecord = await prisma.case.findUnique({
      where: { id },
      include: {
        order: {
          include: {
            items: {
              include: {
                listing: { select: { id: true, listingType: true, stockQuantity: true, status: true } },
              },
            },
          },
        },
      },
    });
    if (!caseRecord) return NextResponse.json({ error: "Case not found." }, { status: 404 });

    if (caseRecord.status === "RESOLVED" || caseRecord.status === "CLOSED") {
      return NextResponse.json({ error: "Case is already resolved." }, { status: 400 });
    }

    // Block refund if seller already issued one
    if (
      (resolution === "REFUND_FULL" || resolution === "REFUND_PARTIAL") &&
      caseRecord.order.sellerRefundId
    ) {
      return NextResponse.json(
        { error: "A refund has already been issued for this order by the seller." },
        { status: 400 }
      );
    }

    // Partial refund amount cap
    if (resolution === "REFUND_PARTIAL" && refundAmountCents) {
      const orderTotal = (caseRecord.order.itemsSubtotalCents ?? 0) + (caseRecord.order.shippingAmountCents ?? 0) + (caseRecord.order.taxAmountCents ?? 0);
      if (refundAmountCents > orderTotal) {
        return NextResponse.json({ error: "Refund amount exceeds order total." }, { status: 400 });
      }
    }

    let stripeRefundId: string | null = null;

    if (resolution === "REFUND_FULL" || resolution === "REFUND_PARTIAL") {
      const paymentIntentId = caseRecord.order.stripePaymentIntentId;
      if (!paymentIntentId) {
        return NextResponse.json(
          { error: "Order has no Stripe payment intent ID. Refund must be processed manually." },
          { status: 400 }
        );
      }

      const refund = await stripe.refunds.create(
        resolution === "REFUND_FULL"
          ? { payment_intent: paymentIntentId, reason: "fraudulent", refund_application_fee: true, reverse_transfer: true }
          : { payment_intent: paymentIntentId, amount: refundAmountCents!, refund_application_fee: true, reverse_transfer: true }
      );
      stripeRefundId = refund.id;
    }

    const now = new Date();
    const resolutionNote = [
      `Case resolved: ${resolution}`,
      refundAmountCents ? `(refund: $${(refundAmountCents / 100).toFixed(2)})` : null,
      `by ${me.name ?? me.email} at ${now.toISOString()}`,
    ]
      .filter(Boolean)
      .join(" ");

    const stockRestoreOps =
      resolution === "REFUND_FULL"
        ? caseRecord.order.items
            .filter((it) => it.listing.listingType === "IN_STOCK")
            .map((it) => {
              const restored = (it.listing.stockQuantity ?? 0) + it.quantity;
              return prisma.listing.update({
                where: { id: it.listingId },
                data: {
                  stockQuantity: restored,
                  ...(it.listing.status === "SOLD_OUT" ? { status: "ACTIVE" } : {}),
                },
              });
            })
        : [];

    let updatedCase;
    try {
      [updatedCase] = await prisma.$transaction([
        prisma.case.update({
          where: { id },
          data: {
            status: "RESOLVED",
            resolution,
            refundAmountCents: refundAmountCents ?? null,
            stripeRefundId,
            resolvedAt: now,
            resolvedById: me.id,
          },
          include: { messages: true, order: true },
        }),
        prisma.order.update({
          where: { id: caseRecord.orderId },
          data: {
            reviewNeeded: true,
            reviewNote: resolutionNote,
            ...(stripeRefundId ? { sellerRefundId: stripeRefundId, sellerRefundAmountCents: refundAmountCents ?? null } : {}),
          },
        }),
        ...stockRestoreOps,
      ]);
    } catch (txErr) {
      if (stripeRefundId) {
        console.error(`ORPHANED REFUND: ${stripeRefundId} for case ${id}. Manual reconciliation required.`);
      }
      throw txErr;
    }

    const resolutionLabel =
      resolution === "REFUND_FULL"
        ? "Full refund issued"
        : resolution === "REFUND_PARTIAL"
        ? `Partial refund of $${((refundAmountCents ?? 0) / 100).toFixed(2)}`
        : "Case dismissed";

    await createNotification({
      userId: caseRecord.buyerId,
      type: "CASE_RESOLVED",
      title: "Your case has been resolved",
      body: resolutionLabel,
      link: `/dashboard/orders/${caseRecord.orderId}`,
    });

    try {
      if (await shouldSendEmail(caseRecord.buyerId, "EMAIL_CASE_RESOLVED")) {
        const buyerUser = await prisma.user.findUnique({
          where: { id: caseRecord.buyerId },
          select: { name: true, email: true },
        });
        if (buyerUser?.email) {
          await sendCaseResolved({
            orderId: caseRecord.orderId,
            buyer: { name: buyerUser.name, email: buyerUser.email },
            resolution,
            refundAmountCents: refundAmountCents ?? null,
          });
        }
      }
    } catch { /* non-fatal */ }

    // Audit log
    try {
      const { logAdminAction } = await import("@/lib/audit");
      await logAdminAction({
        adminId: me.id,
        action: "RESOLVE_CASE",
        targetType: "CASE",
        targetId: id,
        reason: `${resolution}${refundAmountCents ? ` ($${(refundAmountCents / 100).toFixed(2)})` : ""}`,
        metadata: { resolution, refundAmountCents, stripeRefundId },
      });
    } catch { /* non-fatal */ }

    return NextResponse.json(updatedCase);
  } catch (err) {
    console.error("POST /api/cases/[id]/resolve error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
