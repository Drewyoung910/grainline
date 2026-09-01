import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";
import { finalizeSellerOrderFulfillment } from "@/lib/orderFulfillmentFinalization";
import {
  updateSellerOrderNotes,
  type OrderFulfillmentConflictReason,
} from "@/lib/orderFulfillmentAuthority";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { fulfillmentRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import {
  assertKnownContentLengthUnder,
  isInvalidContentLengthError,
  isMissingContentLengthError,
  isRequestBodyTooLargeError,
  readOptionalBoundedJson,
} from "@/lib/requestBody";
import { HTTP_STATUS } from "@/lib/httpStatus";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";
import { sanitizeText, truncateText } from "@/lib/sanitize";
import { logServerError } from "@/lib/serverErrorLogger";
import { APP_BASE_URL } from "@/lib/appBaseUrl";
import { DEAUTHORIZED_SELLER_FULFILLMENT_HOLD_MESSAGE } from "@/lib/orderReviewHolds";

const FulfillmentSchema = z.object({
  action: z.enum(["ready_for_pickup", "shipped", "update_notes"]),
  trackingCarrier: z.string().max(100).optional().nullable(),
  trackingNumber: z.string().max(100).optional().nullable(),
  sellerNotes: z.string().max(2000).optional().nullable(),
});

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_TRACKING_CARRIERS = new Set(["UPS", "USPS", "FedEx", "DHL", "Other"]);
const TRACKING_NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9 -]{4,99}$/;
const FULFILLMENT_JSON_BODY_MAX_BYTES = 24 * 1024;
const FULFILLMENT_FORM_BODY_MAX_BYTES = 24 * 1024;

function conflictResponse(reason: OrderFulfillmentConflictReason) {
  switch (reason) {
    case "active_case":
      return privateJson(
        { error: "Resolve the open case before changing fulfillment." },
        { status: HTTP_STATUS.CONFLICT },
      );
    case "refunded":
      return privateJson({ error: "Refunded orders cannot be fulfilled." }, { status: 400 });
    case "open_dispute":
      return privateJson(
        { error: "Resolve the open Stripe dispute before changing fulfillment." },
        { status: HTTP_STATUS.CONFLICT },
      );
    case "seller_deauthorized":
      return privateJson(
        { error: DEAUTHORIZED_SELLER_FULFILLMENT_HOLD_MESSAGE },
        { status: HTTP_STATUS.CONFLICT },
      );
    case "label_purchased":
      return privateJson(
        { error: "A Grainline shipping label has already been purchased for this order." },
        { status: HTTP_STATUS.CONFLICT },
      );
    case "buyer_data_purged":
      return privateJson(
        { error: "Seller notes are unavailable after buyer data is purged." },
        { status: HTTP_STATUS.CONFLICT },
      );
    case "unpaid":
    case "state_changed":
    case "method_mismatch":
      return privateJson(
        { error: "Order state changed. Refresh and try again." },
        { status: HTTP_STATUS.CONFLICT },
      );
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
    if (crossOriginRejection) {
      return privateJson({ error: "Forbidden" }, { status: 403 });
    }

    const { userId: clerkId } = await auth();
    if (!clerkId) return privateJson({ error: "Unauthorized" }, { status: 401 });

    let me: Awaited<ReturnType<typeof ensureUserByClerkId>>;
    try {
      me = await ensureUserByClerkId(clerkId);
    } catch (error) {
      if (isAccountAccessError(error)) {
        return privateJson({ error: error.message, code: error.code }, { status: error.status });
      }
      throw error;
    }

    const { success, reset } = await safeRateLimit(fulfillmentRatelimit, me.id);
    if (!success) return privateResponse(rateLimitResponse(reset, "Too many fulfillment updates."));

    const { id } = await params;
    let rawPayload: Record<string, unknown> = {};
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try {
        rawPayload = (await readOptionalBoundedJson(
          req,
          FULFILLMENT_JSON_BODY_MAX_BYTES,
          {},
        )) as Record<string, unknown>;
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
          return privateJson(
            { error: "Request body too large" },
            { status: HTTP_STATUS.PAYLOAD_TOO_LARGE },
          );
        }
        if (isMissingContentLengthError(error)) {
          return privateJson(
            { error: "Content-Length header is required" },
            { status: HTTP_STATUS.LENGTH_REQUIRED },
          );
        }
        if (isInvalidContentLengthError(error)) {
          return privateJson(
            { error: "Invalid Content-Length header" },
            { status: HTTP_STATUS.BAD_REQUEST },
          );
        }
        throw error;
      }
      const form = await req.formData();
      rawPayload = Object.fromEntries(form.entries()) as Record<string, unknown>;
    }

    let payload: z.infer<typeof FulfillmentSchema>;
    try {
      payload = FulfillmentSchema.parse(rawPayload);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return privateJson({ error: "Invalid input", details: error.issues }, { status: 400 });
      }
      return privateJson({ error: "Invalid input" }, { status: 400 });
    }

    if (payload.action === "update_notes") {
      const sellerNotes = payload.sellerNotes
        ? truncateText(sanitizeText(payload.sellerNotes), 2000) || null
        : null;
      const result = await updateSellerOrderNotes({
        actorUserId: me.id,
        orderId: id,
        sellerNotes,
      });
      if (result.outcome === "unauthorized") {
        return privateJson({ error: "Forbidden" }, { status: 403 });
      }
      if (result.outcome === "conflict") return conflictResponse(result.reason);
    } else {
      const trackingCarrier = payload.trackingCarrier?.trim() || null;
      const trackingNumber = payload.trackingNumber?.trim() || null;
      if (payload.action === "shipped") {
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
      }
      const result = await finalizeSellerOrderFulfillment({
        actorUserId: me.id,
        orderId: id,
        action: payload.action,
        trackingCarrier,
        trackingNumber,
      });
      if (result.outcome === "unauthorized") {
        return privateJson({ error: "Forbidden" }, { status: 403 });
      }
      if (result.outcome === "conflict") return conflictResponse(result.reason);
    }

    return NextResponse.redirect(
      new URL(`/dashboard/sales/${id}`, APP_BASE_URL),
      { status: 303 },
    );
  } catch (error) {
    logServerError(error, { source: "order_fulfillment_route" });
    return privateJson({ error: "Server error" }, { status: 500 });
  }
}
