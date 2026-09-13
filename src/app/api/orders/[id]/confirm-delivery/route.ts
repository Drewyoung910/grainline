import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";
import { finalizeBuyerOrderReceipt } from "@/lib/orderFulfillmentFinalization";
import type { OrderFulfillmentConflictReason } from "@/lib/orderFulfillmentAuthority";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { fulfillmentRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";
import { logServerError } from "@/lib/serverErrorLogger";
import { APP_BASE_URL } from "@/lib/appBaseUrl";
import { HTTP_STATUS } from "@/lib/httpStatus";

export const runtime = "nodejs";

function conflictResponse(reason: OrderFulfillmentConflictReason) {
  switch (reason) {
    case "active_case":
      return privateJson(
        { error: "Resolve the open case before confirming receipt." },
        { status: HTTP_STATUS.CONFLICT },
      );
    case "refunded":
      return privateJson(
        { error: "Refunded orders cannot be confirmed received." },
        { status: 400 },
      );
    case "open_dispute":
      return privateJson(
        { error: "Resolve the open Stripe dispute before confirming receipt." },
        { status: HTTP_STATUS.CONFLICT },
      );
    case "unpaid":
    case "state_changed":
    case "method_mismatch":
      return privateJson(
        { error: "Only shipped or ready-for-pickup orders can be confirmed received." },
        { status: HTTP_STATUS.CONFLICT },
      );
    case "seller_deauthorized":
    case "label_purchased":
    case "buyer_data_purged":
      throw new TypeError("Buyer receipt returned a seller-only conflict reason");
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

    const { success, reset } = await safeRateLimit(
      fulfillmentRatelimit,
      `confirm-delivery:${me.id}`,
    );
    if (!success) {
      return privateResponse(rateLimitResponse(reset, "Too many delivery confirmations."));
    }

    const { id } = await params;
    const result = await finalizeBuyerOrderReceipt({ actorUserId: me.id, orderId: id });
    if (result.outcome === "unauthorized") {
      return privateJson({ error: "Order not found." }, { status: 404 });
    }
    if (result.outcome === "conflict") return conflictResponse(result.reason);

    return NextResponse.redirect(
      new URL(`/dashboard/orders/${id}`, APP_BASE_URL),
      { status: 303 },
    );
  } catch (error) {
    logServerError(error, { source: "buyer_confirm_delivery_route" });
    return privateJson({ error: "Server error" }, { status: 500 });
  }
}
