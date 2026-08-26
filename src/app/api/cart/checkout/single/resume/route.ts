import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";
import { checkoutRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { getCheckoutLock, singleCheckoutLockKey } from "@/lib/checkoutSessionLock";
import {
  resolveSingleCheckoutResume,
  singleCheckoutResumeSourceIsAvailable,
} from "@/lib/singleCheckoutResume";
import { stripe } from "@/lib/stripe";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { logServerError } from "@/lib/serverErrorLogger";
import { HTTP_STATUS } from "@/lib/httpStatus";

export const runtime = "nodejs";
export const maxDuration = 30;

const EMPTY_RESUME = Object.freeze({
  clientSecret: null,
  sessionId: null,
  completedSessionId: null,
});

const UNAVAILABLE_RESUME = Object.freeze({ error: "This checkout is no longer available." });

export async function GET(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return privateJson({ error: "Sign in required" }, { status: HTTP_STATUS.UNAUTHORIZED });

    const { success, reset } = await safeRateLimit(checkoutRatelimit, userId);
    if (!success) return privateResponse(rateLimitResponse(reset, "Too many checkout attempts."));

    const listingIds = new URL(req.url).searchParams.getAll("listingId");
    const listingId = listingIds.length === 1 ? listingIds[0] : null;
    if (!listingId || !/^[A-Za-z0-9_-]{8,191}$/.test(listingId)) {
      return privateJson({ error: "Invalid listing" }, { status: HTTP_STATUS.BAD_REQUEST });
    }

    const me = await ensureUserByClerkId(userId);
    const checkoutLockKey = singleCheckoutLockKey(me.id, listingId);
    const lock = await getCheckoutLock(checkoutLockKey);
    if (lock?.state !== "ready" || !lock.sessionId || !lock.clientSecret) {
      return privateJson(EMPTY_RESUME);
    }

    // Stock may be zero because this exact ready Session owns the final-unit
    // reservation. Every other mutable orderability rule must still hold:
    // resuming must not bypass a later listing, seller or account shutdown.
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      select: {
        status: true,
        isPrivate: true,
        reservedForUserId: true,
        seller: {
          select: {
            id: true,
            userId: true,
            stripeAccountId: true,
            stripeAccountVersion: true,
            chargesEnabled: true,
            vacationMode: true,
            acceptingNewOrders: true,
            user: { select: { banned: true, deletedAt: true } },
          },
        },
      },
    });
    if (!listing || !singleCheckoutResumeSourceIsAvailable(listing, me.id)) {
      return privateJson(UNAVAILABLE_RESUME, { status: HTTP_STATUS.CONFLICT });
    }

    const session = await stripe.checkout.sessions.retrieve(lock.sessionId);
    const resumed = resolveSingleCheckoutResume(lock, session, {
      buyerId: me.id,
      listingId,
      sellerId: listing.seller.id,
      checkoutLockKey,
    });
    return privateJson(resumed ?? EMPTY_RESUME);
  } catch (error) {
    if (isAccountAccessError(error)) {
      return privateJson({ error: error.message, code: error.code }, { status: error.status });
    }
    logServerError(error, {
      source: "single_checkout_resume",
      tags: { route: "/api/cart/checkout/single/resume" },
    });
    return privateJson({ error: "Server error" }, { status: HTTP_STATUS.INTERNAL_SERVER_ERROR });
  }
}
