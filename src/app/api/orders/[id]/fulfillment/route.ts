// src/app/api/orders/[id]/fulfillment/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { createNotification } from "@/lib/notifications";
import { sendOrderShipped, sendReadyForPickup } from "@/lib/email";
import { fulfillmentRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { blockingRefundLedgerWhere, orderHasRefundLedger } from "@/lib/refundRouteState";
import { assertContentLengthUnder, isRequestBodyTooLargeError, readOptionalBoundedJson } from "@/lib/requestBody";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";
import { CaseStatus, LabelStatus, type FulfillmentStatus, type Prisma } from "@prisma/client";
import { z } from "zod";
import { sanitizeText, truncateText } from "@/lib/sanitize";
import { logServerError } from "@/lib/serverErrorLogger";

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
const BUYER_DELIVERY_CONFIRMATION_ERROR = "Buyers confirm delivery for shipped orders.";
const ACTIVE_CASE_STATUSES = [
  CaseStatus.OPEN,
  CaseStatus.IN_DISCUSSION,
  CaseStatus.PENDING_CLOSE,
  CaseStatus.UNDER_REVIEW,
] as const;
const ACTIVE_CASE_STATUS_SET = new Set<CaseStatus>(ACTIVE_CASE_STATUSES);
const FULFILLMENT_JSON_BODY_MAX_BYTES = 24 * 1024;
const FULFILLMENT_FORM_BODY_MAX_BYTES = 24 * 1024;

async function notifyBuyer(orderId: string, buyerId: string, payload: Parameters<typeof createNotification>[0]) {
  try {
    await createNotification(payload);
  } catch (error) {
    Sentry.captureException(error, {
      level: "warning",
      tags: { source: "fulfillment_notification" },
      extra: { orderId, buyerId, notificationType: payload.type },
    });
  }
}

function captureFulfillmentEmailFailure(error: unknown, orderId: string, action: string) {
  Sentry.captureException(error, {
    level: "warning",
    tags: { source: "fulfillment_email", action },
    extra: { orderId },
  });
}

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
      paymentEvents: {
        where: blockingRefundLedgerWhere(),
        take: 1,
        select: { eventType: true, status: true },
      },
      items: { include: { listing: { select: { sellerId: true } } } },
    },
  });
  if (!order) return null;

  const ownsEntireOrder = order.items.length > 0 && order.items.every((it) => it.listing.sellerId === seller.id);
  return ownsEntireOrder ? { order, seller } : null;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
    if (crossOriginRejection) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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
      try {
        rawPayload = (await readOptionalBoundedJson(req, FULFILLMENT_JSON_BODY_MAX_BYTES, {})) as Record<string, unknown>;
      } catch (error) {
        if (isRequestBodyTooLargeError(error)) {
          return NextResponse.json({ error: "Request body too large" }, { status: 413 });
        }
        throw error;
      }
    } else {
      try {
        assertContentLengthUnder(req, FULFILLMENT_FORM_BODY_MAX_BYTES);
      } catch (error) {
        if (isRequestBodyTooLargeError(error)) {
          return NextResponse.json({ error: "Request body too large" }, { status: 413 });
        }
        throw error;
      }
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
    if (action !== "update_notes" && authz.order.case && ACTIVE_CASE_STATUS_SET.has(authz.order.case.status)) {
      return NextResponse.json(
        { error: "Resolve the open case before changing fulfillment." },
        { status: 409 },
      );
    }
    if (action !== "update_notes" && orderHasRefundLedger(authz.order)) {
      return NextResponse.json(
        { error: "Refunded orders cannot be fulfilled." },
        { status: 400 },
      );
    }
    if (action === "shipped" && authz.order.labelStatus === "PURCHASED") {
      return NextResponse.json(
        { error: "A Grainline shipping label has already been purchased for this order." },
        { status: 409 },
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
    if (action === "delivered") {
      return NextResponse.json(
        { error: BUYER_DELIVERY_CONFIRMATION_ERROR },
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
      case "shipped": {
        const trackingCarrier = payload.trackingCarrier?.trim() ?? "";
        const trackingNumber = payload.trackingNumber?.trim() ?? "";
        if (!trackingCarrier) {
          return NextResponse.json({ error: "Tracking carrier is required." }, { status: 400 });
        }
        if (!VALID_TRACKING_CARRIERS.has(trackingCarrier)) {
          return NextResponse.json({ error: "Unsupported tracking carrier." }, { status: 400 });
        }
        if (!trackingNumber) {
          return NextResponse.json({ error: "Tracking number is required." }, { status: 400 });
        }
        if (!TRACKING_NUMBER_RE.test(trackingNumber)) {
          return NextResponse.json({ error: "Invalid tracking number." }, { status: 400 });
        }
        data.fulfillmentMethod = "SHIPPING";
        data.fulfillmentStatus = "SHIPPED";
        data.shippedAt = now;
        data.trackingCarrier = trackingCarrier;
        data.trackingNumber = trackingNumber;
        break;
      }
      case "update_notes":
        data.sellerNotes = payload.sellerNotes ? truncateText(sanitizeText(payload.sellerNotes), 2000) || null : null;
        break;
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    const orderWhereAnd: Prisma.OrderWhereInput[] = [];
    if (action === "shipped") {
      orderWhereAnd.push({
        OR: [{ labelStatus: null }, { labelStatus: { not: LabelStatus.PURCHASED } }],
      });
    }
    if (action !== "update_notes") {
      orderWhereAnd.push({
        OR: [
          { case: { is: null } },
          { case: { is: { status: { notIn: [...ACTIVE_CASE_STATUSES] } } } },
        ],
      });
    }

    const updatedCount = await prisma.order.updateMany({
      where: {
        id,
        sellerRefundId: null,
        paymentEvents: { none: blockingRefundLedgerWhere() },
        ...(allowed ? { fulfillmentStatus: { in: allowed } } : {}),
        ...(orderWhereAnd.length ? { AND: orderWhereAnd } : {}),
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
      const carrier = typeof data.trackingCarrier === "string" ? data.trackingCarrier : null;
      const trackingNumber = typeof data.trackingNumber === "string" ? data.trackingNumber : null;
      if (updated.buyerId) {
        await notifyBuyer(id, updated.buyerId, {
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
        } catch (error) {
          captureFulfillmentEmailFailure(error, id, action);
        }
      }
    }

    if (action === "picked_up") {
      if (updated.buyerId) {
        await notifyBuyer(id, updated.buyerId, {
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
        await notifyBuyer(id, updated.buyerId, {
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
        } catch (error) {
          captureFulfillmentEmailFailure(error, id, action);
        }
      }
    }

    // Redirect with 303 so the browser converts POST → GET. Falls back to
    // the request's origin when NEXT_PUBLIC_APP_URL is missing so the redirect
    // never throws on a missing env var.
    const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
    return NextResponse.redirect(
      new URL(`/dashboard/sales/${id}`, origin),
      { status: 303 },
    );
  } catch (err) {
    logServerError(err, { source: "order_fulfillment_route" });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
