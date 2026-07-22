// src/app/api/orders/[id]/fulfillment/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { createNotification } from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
import { logSystemActionOrThrow } from "@/lib/systemAudit";
import { sendOrderShipped, sendReadyForPickup } from "@/lib/email";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { fulfillmentRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { blockingRefundLedgerWhere, orderHasRefundLedger } from "@/lib/refundRouteState";
import {
  blockingRefundLedgerExistsSql,
  latestOpenDisputeLedgerExistsSql,
} from "@/lib/refundLedgerSql";
import {
  assertKnownContentLengthUnder,
  isInvalidContentLengthError,
  isMissingContentLengthError,
  isRequestBodyTooLargeError,
  readOptionalBoundedJson,
} from "@/lib/requestBody";
import { HTTP_STATUS } from "@/lib/httpStatus";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";
import { CaseStatus, Prisma, type FulfillmentStatus } from "@prisma/client";
import { z } from "zod";
import { sanitizeText, truncateText } from "@/lib/sanitize";
import { logServerError } from "@/lib/serverErrorLogger";
import { APP_BASE_URL } from "@/lib/appBaseUrl";
import {
  DEAUTHORIZED_SELLER_FULFILLMENT_HOLD_MESSAGE,
  DEAUTHORIZED_SELLER_REVIEW_NOTE_SQL_PATTERN,
  orderHasDeauthorizedSellerReviewHold,
} from "@/lib/orderReviewHolds";

const FulfillmentSchema = z.object({
  action: z.enum(["ready_for_pickup", "picked_up", "shipped", "delivered", "update_notes"]),
  trackingCarrier: z.string().max(100).optional().nullable(),
  trackingNumber: z.string().max(100).optional().nullable(),
  sellerNotes: z.string().max(2000).optional().nullable(),
});

export const runtime = "nodejs";
export const maxDuration = 30;

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

function requiredFulfillmentAuditId(value: string | null): string {
  if (!value) throw new Error("Fulfillment transition did not return its audit authority");
  return value;
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
    select: { id: true, userId: true },
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
      return privateJson({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const { userId } = await auth();
    if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });

    const { success, reset } = await safeRateLimit(fulfillmentRatelimit, userId);
    if (!success) return privateResponse(rateLimitResponse(reset, "Too many fulfillment updates."));

    const authz = await ensureSellerOwnsOrder(userId, id);
    if (!authz) return privateJson({ error: "Forbidden" }, { status: 403 });

    let rawPayload: Record<string, unknown> = {};
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try {
        rawPayload = (await readOptionalBoundedJson(req, FULFILLMENT_JSON_BODY_MAX_BYTES, {})) as Record<string, unknown>;
      } catch (error) {
        if (isRequestBodyTooLargeError(error)) {
          return privateJson({ error: "Request body too large" }, { status: 413 });
        }
        throw error;
      }
    } else {
      try {
        assertKnownContentLengthUnder(req, FULFILLMENT_FORM_BODY_MAX_BYTES);
      } catch (error) {
        if (isRequestBodyTooLargeError(error)) {
          return privateJson({ error: "Request body too large" }, { status: HTTP_STATUS.PAYLOAD_TOO_LARGE });
        }
        if (isMissingContentLengthError(error)) {
          return privateJson({ error: "Content-Length header is required" }, { status: HTTP_STATUS.LENGTH_REQUIRED });
        }
        if (isInvalidContentLengthError(error)) {
          return privateJson({ error: "Invalid Content-Length header" }, { status: HTTP_STATUS.BAD_REQUEST });
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
        return privateJson({ error: "Invalid input", details: e.issues }, { status: 400 });
      }
      return privateJson({ error: "Invalid input" }, { status: 400 });
    }

    const action = payload.action;
    if (action !== "update_notes" && authz.order.case && ACTIVE_CASE_STATUS_SET.has(authz.order.case.status)) {
      return privateJson(
        { error: "Resolve the open case before changing fulfillment." },
        { status: 409 },
      );
    }
    if (action !== "update_notes" && orderHasRefundLedger(authz.order)) {
      return privateJson(
        { error: "Refunded orders cannot be fulfilled." },
        { status: 400 },
      );
    }
    if (action !== "update_notes") {
      const [{ hasOpenDispute } = { hasOpenDispute: false }] =
        await prisma.$queryRaw<Array<{ hasOpenDispute: boolean }>>`
          SELECT ${latestOpenDisputeLedgerExistsSql(Prisma.sql`${id}`)} AS "hasOpenDispute"
        `;
      if (hasOpenDispute) {
        return privateJson(
          { error: "Resolve the open Stripe dispute before changing fulfillment." },
          { status: HTTP_STATUS.CONFLICT },
        );
      }
    }
    if (action !== "update_notes" && orderHasDeauthorizedSellerReviewHold(authz.order)) {
      return privateJson(
        { error: DEAUTHORIZED_SELLER_FULFILLMENT_HOLD_MESSAGE },
        { status: 409 },
      );
    }
    if (action === "shipped" && authz.order.labelStatus === "PURCHASED") {
      return privateJson(
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
      return privateJson(
        { error: `Cannot transition from ${authz.order.fulfillmentStatus ?? "PENDING"} to ${action}.` },
        { status: 400 },
      );
    }

    // Guard: shipping orders can only use shipped/delivered actions, not pickup
    const currentMethod = authz.order.fulfillmentMethod ?? "SHIPPING";
    if ((action === "ready_for_pickup" || action === "picked_up") && currentMethod === "SHIPPING") {
      return privateJson(
        { error: "Cannot use pickup actions on a shipping order." },
        { status: 400 },
      );
    }
    if ((action === "shipped" || action === "delivered") && currentMethod === "PICKUP") {
      return privateJson(
        { error: "Cannot use shipping actions on a pickup order." },
        { status: 400 },
      );
    }
    if (action === "delivered") {
      return privateJson(
        { error: BUYER_DELIVERY_CONFIRMATION_ERROR },
        { status: 400 },
      );
    }

    const data: Record<string, unknown> = {};
    let notesWriteRequiresUnpurgedOrder = false;
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
          return privateJson({ error: "Tracking carrier is required." }, { status: 400 });
        }
        if (!VALID_TRACKING_CARRIERS.has(trackingCarrier)) {
          return privateJson({ error: "Unsupported tracking carrier." }, { status: 400 });
        }
        if (!trackingNumber) {
          return privateJson({ error: "Tracking number is required." }, { status: 400 });
        }
        if (!TRACKING_NUMBER_RE.test(trackingNumber)) {
          return privateJson({ error: "Invalid tracking number." }, { status: 400 });
        }
        data.fulfillmentMethod = "SHIPPING";
        data.fulfillmentStatus = "SHIPPED";
        data.shippedAt = now;
        data.trackingCarrier = trackingCarrier;
        data.trackingNumber = trackingNumber;
        break;
      }
      case "update_notes": {
        const sellerNotes = payload.sellerNotes ? truncateText(sanitizeText(payload.sellerNotes), 2000) || null : null;
        if (sellerNotes && authz.order.buyerDataPurgedAt) {
          return privateJson(
            { error: "Seller notes are unavailable after buyer data is purged." },
            { status: HTTP_STATUS.CONFLICT },
          );
        }
        notesWriteRequiresUnpurgedOrder = sellerNotes !== null;
        data.sellerNotes = sellerNotes;
        break;
      }
      default:
        return privateJson({ error: "Unknown action" }, { status: 400 });
    }

    let updatedCount: number;
    let fulfillmentAuditId: string | null = null;
    if (action === "update_notes") {
      const updated = await prisma.order.updateMany({
        where: {
          id,
          sellerRefundId: null,
          paymentEvents: { none: blockingRefundLedgerWhere() },
          ...(notesWriteRequiresUnpurgedOrder ? { buyerDataPurgedAt: null } : {}),
        },
        data,
      });
      updatedCount = updated.count;
    } else {
      const allowedStatusSql = allowed
        ? Prisma.sql`AND "fulfillmentStatus"::text IN (${Prisma.join(allowed)})`
        : Prisma.empty;
      const labelStatusSql = action === "shipped"
        ? Prisma.sql`AND ("labelStatus" IS NULL OR "labelStatus" != 'PURCHASED'::"LabelStatus")`
        : Prisma.empty;
      const mutationSql =
        action === "ready_for_pickup"
          ? Prisma.sql`
              "fulfillmentMethod" = 'PICKUP'::"FulfillmentMethod",
              "fulfillmentStatus" = 'READY_FOR_PICKUP'::"FulfillmentStatus",
              "pickupReadyAt" = ${now}
            `
          : action === "picked_up"
            ? Prisma.sql`
                "fulfillmentMethod" = 'PICKUP'::"FulfillmentMethod",
                "fulfillmentStatus" = 'PICKED_UP'::"FulfillmentStatus",
                "pickedUpAt" = ${now}
              `
            : Prisma.sql`
                "fulfillmentMethod" = 'SHIPPING'::"FulfillmentMethod",
                "fulfillmentStatus" = 'SHIPPED'::"FulfillmentStatus",
                "shippedAt" = ${now},
                "trackingCarrier" = ${data.trackingCarrier as string},
                "trackingNumber" = ${data.trackingNumber as string}
              `;

      const transition = await prisma.$transaction(async (tx) => {
        const count = await tx.$executeRaw`
          UPDATE "Order"
          SET ${mutationSql}
          WHERE id = ${id}
            AND "sellerRefundId" IS NULL
            AND NOT (${blockingRefundLedgerExistsSql(Prisma.sql`"Order".id`)})
            ${allowedStatusSql}
            ${labelStatusSql}
            AND NOT EXISTS (
              SELECT 1 FROM "Case" c
              WHERE c."orderId" = "Order".id
                AND c."status"::text IN (${Prisma.join([...ACTIVE_CASE_STATUSES])})
            )
            AND NOT ("reviewNeeded" = true AND COALESCE("reviewNote", '') LIKE ${DEAUTHORIZED_SELLER_REVIEW_NOTE_SQL_PATTERN})
            AND NOT (${latestOpenDisputeLedgerExistsSql(Prisma.sql`"Order".id`)})
        `;
        if (Number(count) === 0) return { count: 0, auditLogId: null as string | null };
        const newStatus = action === "ready_for_pickup"
          ? "READY_FOR_PICKUP"
          : action === "picked_up"
            ? "PICKED_UP"
            : "SHIPPED";
        const auditLogId = await logSystemActionOrThrow({
          client: tx,
          actorType: "user",
          actorId: authz.seller.userId,
          action: "ORDER_FULFILLMENT_TRANSITION",
          targetType: "ORDER",
          targetId: id,
          metadata: {
            action,
            previousStatus: authz.order.fulfillmentStatus ?? "PENDING",
            newStatus,
            trackingCarrier: action === "shipped" ? data.trackingCarrier as string : null,
          },
        });
        return { count: Number(count), auditLogId };
      });
      updatedCount = transition.count;
      fulfillmentAuditId = transition.auditLogId;
    }
    if (updatedCount === 0) {
      return privateJson({ error: "Order status changed. Refresh and try again." }, { status: 409 });
    }
    if (action !== "update_notes" && !fulfillmentAuditId) {
      throw new Error("Fulfillment transition did not return its audit authority");
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
          sourceType: NOTIFICATION_SOURCE_TYPES.ORDER_FULFILLMENT,
          sourceId: requiredFulfillmentAuditId(fulfillmentAuditId),
          relatedUserId: authz.seller.userId,
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
          sourceType: NOTIFICATION_SOURCE_TYPES.ORDER_FULFILLMENT,
          sourceId: requiredFulfillmentAuditId(fulfillmentAuditId),
          relatedUserId: authz.seller.userId,
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
          sourceType: NOTIFICATION_SOURCE_TYPES.ORDER_FULFILLMENT,
          sourceId: requiredFulfillmentAuditId(fulfillmentAuditId),
          relatedUserId: authz.seller.userId,
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

    // Redirect with 303 so the browser converts POST to GET. Use the canonical
    // app origin instead of trusting request Host/Origin fallback headers.
    return NextResponse.redirect(
      new URL(`/dashboard/sales/${id}`, APP_BASE_URL),
      { status: 303 },
    );
  } catch (err) {
    logServerError(err, { source: "order_fulfillment_route" });
    return privateJson({ error: "Server error" }, { status: 500 });
  }
}
