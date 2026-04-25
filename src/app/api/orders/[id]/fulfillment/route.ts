// src/app/api/orders/[id]/fulfillment/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { createNotification } from "@/lib/notifications";
import { sendOrderShipped, sendReadyForPickup, sendOrderDelivered } from "@/lib/email";
import { fulfillmentRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import type { FulfillmentStatus } from "@prisma/client";
import { z } from "zod";

const FulfillmentSchema = z.object({
  action: z.enum(["ready_for_pickup", "picked_up", "shipped", "delivered", "update_notes"]),
  trackingCarrier: z.string().max(100).optional().nullable(),
  trackingNumber: z.string().max(100).optional().nullable(),
  sellerNotes: z.string().max(2000).optional().nullable(),
});

export const runtime = "nodejs";
export const maxDuration = 30;
export const preferredRegion = "iad1";

const VALID_TRACKING_CARRIERS = new Set(["UPS", "USPS", "FedEx", "DHL", "Other"]);
const TRACKING_NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9 -]{4,99}$/;

async function ensureSellerOwnsOrder(userId: string, orderId: string) {
  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, banned: true, deletedAt: true },
  });
  if (!me) return null;
  if (me.banned || me.deletedAt) return null;

  const seller = await prisma.sellerProfile.findUnique({
    where: { userId: me.id },
    select: { id: true },
  });
  if (!seller) return null;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      case: { select: { status: true } },
      items: { include: { listing: { select: { sellerId: true } } } },
    },
  });
  if (!order) return null;

  const ownsAny = order.items.some((it) => it.listing.sellerId === seller.id);
  return ownsAny ? { order, seller } : null;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { success, reset } = await safeRateLimit(fulfillmentRatelimit, userId);
    if (!success) return rateLimitResponse(reset, "Too many fulfillment updates.");

    const authz = await ensureSellerOwnsOrder(userId, id);
    if (!authz) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    let rawPayload: Record<string, unknown> = {};
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try { rawPayload = await req.json(); } catch { /* empty */ }
    } else {
      const form = await req.formData();
      rawPayload = Object.fromEntries(form.entries()) as Record<string, unknown>;
    }

    let payload;
    try {
      payload = FulfillmentSchema.parse(rawPayload);
    } catch (e) {
      if (e instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
      }
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const action = payload.action;
    const activeCaseStatuses = new Set(["OPEN", "IN_DISCUSSION", "PENDING_CLOSE", "UNDER_REVIEW"]);
    if (action !== "update_notes" && authz.order.case && activeCaseStatuses.has(authz.order.case.status)) {
      return NextResponse.json(
        { error: "Resolve the open case before changing fulfillment." },
        { status: 409 },
      );
    }
    if (action !== "update_notes" && authz.order.sellerRefundId) {
      return NextResponse.json(
        { error: "Refunded orders cannot be fulfilled." },
        { status: 400 },
      );
    }

    // Prevent backwards state transitions
    const validTransitions: Partial<Record<typeof action, FulfillmentStatus[]>> = {
      shipped: ["PENDING", "READY_FOR_PICKUP"],
      delivered: ["SHIPPED"],
      ready_for_pickup: ["PENDING"],
      picked_up: ["READY_FOR_PICKUP"],
    };
    const allowed = validTransitions[action];
    if (allowed && !allowed.includes(authz.order.fulfillmentStatus ?? "PENDING")) {
      return NextResponse.json(
        { error: `Cannot transition from ${authz.order.fulfillmentStatus ?? "PENDING"} to ${action}.` },
        { status: 400 },
      );
    }

    // Guard: shipping orders can only use shipped/delivered actions, not pickup
    const currentMethod = authz.order.fulfillmentMethod ?? "SHIPPING";
    if ((action === "ready_for_pickup" || action === "picked_up") && currentMethod === "SHIPPING") {
      return NextResponse.json(
        { error: "Cannot use pickup actions on a shipping order." },
        { status: 400 },
      );
    }
    if ((action === "shipped" || action === "delivered") && currentMethod === "PICKUP") {
      return NextResponse.json(
        { error: "Cannot use shipping actions on a pickup order." },
        { status: 400 },
      );
    }

    const data: Record<string, unknown> = {};
    const now = new Date();

    switch (action) {
      case "ready_for_pickup":
        data.fulfillmentMethod = "PICKUP";
        data.fulfillmentStatus = "READY_FOR_PICKUP";
        data.pickupReadyAt = now;
        break;
      case "picked_up":
        data.fulfillmentMethod = "PICKUP";
        data.fulfillmentStatus = "PICKED_UP";
        data.pickedUpAt = now;
        break;
      case "shipped":
        data.fulfillmentMethod = "SHIPPING";
        data.fulfillmentStatus = "SHIPPED";
        data.shippedAt = now;
        if (payload.trackingCarrier && !VALID_TRACKING_CARRIERS.has(payload.trackingCarrier)) {
          return NextResponse.json({ error: "Unsupported tracking carrier." }, { status: 400 });
        }
        if (payload.trackingNumber && !TRACKING_NUMBER_RE.test(payload.trackingNumber.trim())) {
          return NextResponse.json({ error: "Invalid tracking number." }, { status: 400 });
        }
        if (payload.trackingCarrier) data.trackingCarrier = payload.trackingCarrier;
        if (payload.trackingNumber) data.trackingNumber = payload.trackingNumber.trim();
        break;
      case "delivered":
        data.fulfillmentStatus = "DELIVERED";
        data.deliveredAt = now;
        break;
      case "update_notes":
        data.sellerNotes = payload.sellerNotes ?? null;
        break;
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    const updatedCount = await prisma.order.updateMany({
      where: {
        id,
        sellerRefundId: null,
        ...(allowed ? { fulfillmentStatus: { in: allowed } } : {}),
      },
      data,
    });
    if (updatedCount.count === 0) {
      return NextResponse.json({ error: "Order status changed. Refresh and try again." }, { status: 409 });
    }

    const updated = await prisma.order.findUniqueOrThrow({
      where: { id },
      select: {
        buyerId: true,
        estimatedDeliveryDate: true,
        buyer: { select: { name: true, email: true } },
        items: {
          take: 1,
          select: { listing: { select: { seller: { select: { displayName: true } } } } },
        },
      },
    });

    const buyerEmail = updated.buyer?.email;

    if (action === "shipped") {
      const carrier = payload.trackingCarrier ?? null;
      const trackingNumber = payload.trackingNumber ?? null;
      if (updated.buyerId) {
        await createNotification({
          userId: updated.buyerId,
          type: "ORDER_SHIPPED",
          title: "Your piece is on its way!",
          body: carrier ? `Shipped via ${carrier}` : "Your order has been shipped",
          link: `/dashboard/orders/${id}`,
        });
      }
      if (buyerEmail) {
        try {
          await sendOrderShipped({
            order: { id, estimatedDeliveryDate: updated.estimatedDeliveryDate },
            buyer: { name: updated.buyer?.name, email: buyerEmail },
            carrier,
            trackingNumber,
          });
        } catch { /* non-fatal */ }
      }
    }

    if (action === "delivered") {
      if (updated.buyerId) {
        await createNotification({
          userId: updated.buyerId,
          type: "ORDER_DELIVERED",
          title: "Your piece has been delivered!",
          body: "Enjoy your new piece — leave a review to help other buyers",
          link: `/dashboard/orders/${id}`,
        });
      }
      if (buyerEmail) {
        try {
          await sendOrderDelivered({
            order: { id },
            buyer: { name: updated.buyer?.name, email: buyerEmail },
          });
        } catch { /* non-fatal */ }
      }
    }

    if (action === "picked_up") {
      if (updated.buyerId) {
        await createNotification({
          userId: updated.buyerId,
          type: "ORDER_DELIVERED",
          title: "Order picked up!",
          body: "Your order has been picked up. Enjoy!",
          link: `/dashboard/orders/${id}`,
        });
      }
    }

    if (action === "ready_for_pickup") {
      if (updated.buyerId) {
        await createNotification({
          userId: updated.buyerId,
          type: "ORDER_SHIPPED",
          title: "Ready for pickup!",
          body: "Your order is ready for pickup.",
          link: `/dashboard/orders/${id}`,
        });
      }
      if (buyerEmail) {
        const sellerName = updated.items[0]?.listing.seller.displayName;
        try {
          await sendReadyForPickup({
            order: { id },
            buyer: { name: updated.buyer?.name, email: buyerEmail },
            seller: { displayName: sellerName },
          });
        } catch { /* non-fatal */ }
      }
    }

    return NextResponse.redirect(
      new URL(`/dashboard/sales/${id}`, process.env.NEXT_PUBLIC_APP_URL)
    );
  } catch (err) {
    console.error("POST /api/orders/[id]/fulfillment error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
