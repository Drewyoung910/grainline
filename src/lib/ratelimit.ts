import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";
import { limitWithFailurePolicy } from "@/lib/ratelimitPolicy";
import { requiredProductionEnv } from "@/lib/env";
import * as Sentry from "@sentry/nextjs";
import { HTTP_STATUS } from "./httpStatus.ts";

export const redis = new Redis({
  url: requiredProductionEnv("UPSTASH_REDIS_REST_URL"),
  token: requiredProductionEnv("UPSTASH_REDIS_REST_TOKEN"),
});

// For public endpoints — limit by IP
export const searchRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "10 s"),
  analytics: true,
  prefix: "rl:search",
});

export const viewRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "60 s"),
  analytics: true,
  prefix: "rl:view",
});

export const clickRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "60 s"),
  analytics: true,
  prefix: "rl:click",
});

export const LISTING_VIEW_DAILY_ANALYTICS_CAP = 5_000;
export const LISTING_CLICK_DAILY_ANALYTICS_CAP = 1_000;
const LISTING_ANALYTICS_DAILY_CAP_TTL_SECONDS = 60 * 60 * 48;

// For authenticated endpoints — limit by user ID
export const reviewRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "60 s"),
  analytics: true,
  prefix: "rl:review",
});

export const checkoutRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "60 s"),
  analytics: true,
  prefix: "rl:checkout",
});

export const cartMutationRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, "10 m"),
  analytics: true,
  prefix: "rl:cart_mutation",
});

export const messageRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "60 s"),
  analytics: true,
  prefix: "rl:message",
});

export const messageStreamRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(120, "60 s"),
  analytics: true,
  prefix: "rl:message_stream",
});

export const messageListRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(240, "60 m"),
  analytics: true,
  prefix: "rl:message_list",
});

// Follow/unfollow — prevent follow spam
export const followRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(50, "60 m"),
  analytics: true,
  prefix: "rl:follow",
});

// Save/unsave (favorites) — prevent save spam
export const saveRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, "60 m"),
  analytics: true,
  prefix: "rl:save",
});

export const savedSearchRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "60 m"),
  analytics: true,
  prefix: "rl:saved-search",
});

export const notificationPreferenceRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, "10 m"),
  analytics: true,
  prefix: "rl:notification-preference",
});

export const accountFeedRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(120, "10 m"),
  analytics: true,
  prefix: "rl:account-feed",
});

export const cartReadRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(120, "10 m"),
  analytics: true,
  prefix: "rl:cart-read",
});

export const notificationReadRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(120, "10 m"),
  analytics: true,
  prefix: "rl:notification-read",
});

export const sellerAnalyticsRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, "10 m"),
  analytics: true,
  prefix: "rl:seller-analytics",
});

export const sellerProfileRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "10 m"),
  analytics: true,
  prefix: "rl:seller-profile",
});

export const reviewVoteRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, "60 m"),
  analytics: true,
  prefix: "rl:review-vote",
});

export const blockRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "60 m"),
  analytics: true,
  prefix: "rl:block",
});

export const vacationRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "60 m"),
  analytics: true,
  prefix: "rl:vacation",
});

// Blog save/unsave
export const blogSaveRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, "60 m"),
  analytics: true,
  prefix: "rl:blog_save",
});

// Commission interest — prevent spam interest
export const commissionInterestRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "24 h"),
  analytics: true,
  prefix: "rl:commission_interest",
});

// Listing creation — prevent listing spam
export const listingCreateRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "24 h"),
  analytics: true,
  prefix: "rl:listing_create",
});

// Blog post creation — prevent blog spam
export const blogCreateRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(3, "24 h"),
  analytics: true,
  prefix: "rl:blog_create",
});

// Commission creation — prevent request spam
export const commissionCreateRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "24 h"),
  analytics: true,
  prefix: "rl:commission_create",
});

export const commissionStatusRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "60 m"),
  analytics: true,
  prefix: "rl:commission_status",
});

// Guild verification application — mutates review state and runs eligibility queries.
export const verificationApplyRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "24 h"),
  analytics: true,
  prefix: "rl:verification_apply",
});

export const commissionReferenceImageIpRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "24 h"),
  analytics: true,
  prefix: "rl:commission_ref_image_ip",
});

// Profile view dedup — deduplicate by IP+listingId combo
export const profileViewRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(1, "24 h"),
  analytics: false,
  prefix: "rl:profile_view",
});

// Broadcast — short attempt limiter before parse; weekly send limiter after validation/DB cooldown.
export const broadcastAttemptRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "10 m"),
  analytics: true,
  prefix: "rl:broadcast_attempt",
});

export const broadcastRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(1, "7 d"),
  analytics: true,
  prefix: "rl:broadcast",
});

// Cases — opening a case (fail closed — abuse has real cost)
export const caseCreateRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "24 h"),
  analytics: true,
  prefix: "rl:case_create",
});

// Case messages — replying in a case thread (fail closed)
export const caseMessageRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "60 m"),
  analytics: true,
  prefix: "rl:case_message",
});

export const caseActionRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "60 m"),
  analytics: true,
  prefix: "rl:case_action",
});

export const listingMutationRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, "60 m"),
  analytics: true,
  prefix: "rl:listing_mutation",
});

export const listingPhotoAiRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "60 m"),
  analytics: true,
  prefix: "rl:listing_photo_ai",
});

export const fulfillmentRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "60 m"),
  analytics: true,
  prefix: "rl:fulfillment",
});

export const refundRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "60 m"),
  analytics: true,
  prefix: "rl:refund",
});

export const labelPurchaseRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "60 m"),
  analytics: true,
  prefix: "rl:label_purchase",
});

export const adminActionRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(120, "10 m"),
  analytics: true,
  prefix: "rl:admin_action",
});

// Custom order request — messaging a seller with a request (fail closed)
export const customOrderRequestRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "24 h"),
  analytics: true,
  prefix: "rl:custom_order_request",
});

// Stripe Connect login link — generates a Stripe API call (fail closed)
export const stripeLoginLinkRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "60 m"),
  analytics: true,
  prefix: "rl:stripe_login_link",
});

// Admin email to user — ADMIN only, rate limited hard
export const adminEmailRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 h"),
  analytics: true,
  prefix: "rl:admin_email",
});

// Report user — fail closed (abuse has real cost)
export const reportRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "1 h"),
  analytics: true,
  prefix: "rl:report",
});

// Notification mark-read — low risk, but still a write path; fail closed.
export const markReadRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, "60 m"),
  analytics: true,
  prefix: "rl:mark_read",
});

export const shippingAddressRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "10 m"),
  analytics: true,
  prefix: "rl:shipping_address",
});

// Shipping quote — Shippo API calls cost money (fail closed)
export const shippingQuoteRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "60 s"),
  analytics: true,
  prefix: "rl:shipping-quote",
});

// Newsletter subscribe — public, IP-based (fail open — non-critical)
export const newsletterRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "60 s"),
  analytics: true,
  prefix: "rl:newsletter",
});

export const supportRequestRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "60 m"),
  analytics: true,
  prefix: "rl:support-request",
});

export const dataRequestRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(3, "24 h"),
  analytics: true,
  prefix: "rl:data-request",
});

// One-click unsubscribe — public endpoint, token-protected but still rate-limited
export const unsubscribeRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "60 m"),
  analytics: true,
  prefix: "rl:unsubscribe",
});

export const unsubscribeEmailRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(1, "60 s"),
  analytics: true,
  prefix: "rl:unsubscribe-email",
});

// CSP reports are unauthenticated browser telemetry. Keep enough signal for
// real violations while dropping flood/noise before it reaches Sentry.
export const cspReportRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, "10 m"),
  analytics: true,
  prefix: "rl:csp-report",
});

// Public health checks hit real backend dependencies; cache plus rate-limit them.
export const healthRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, "60 s"),
  analytics: true,
  prefix: "rl:health",
});

// Blog comment creation (fail closed — abuse has real cost)
export const blogCommentRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "60 s"),
  analytics: true,
  prefix: "rl:blog-comment",
});

// Stock notification subscribe/unsubscribe (fail closed)
export const notifyRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "60 s"),
  analytics: true,
  prefix: "rl:notify",
});

// R2 upload presigns / processed image uploads
export const uploadRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "10 m"),
  analytics: true,
  prefix: "rl:upload",
});

export const uploadHourlyRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(50, "60 m"),
  analytics: true,
  prefix: "rl:upload-hourly",
});

export const accountExportRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(3, "24 h"),
  analytics: true,
  prefix: "rl:account-export",
});

export const accountDeletionRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "60 m"),
  analytics: true,
  prefix: "rl:account-delete",
});

export const termsAcceptanceRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "10 m"),
  analytics: true,
  prefix: "rl:terms-acceptance",
});

// Stripe Connect account creation/onboarding (fail closed — Stripe API calls)
export const stripeConnectRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "60 s"),
  analytics: true,
  prefix: "rl:stripe-connect",
});

// Click dedup — 1 per IP+listing per 24h (analytics dedup, fail open)
export const clickDedupRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(1, "86400 s"),
  analytics: false,
  prefix: "rl:click-dedup",
});

/**
 * Fail CLOSED — if Redis is down, reject the request.
 * Use for: checkout, follow, broadcast, commission create,
 * commission interest, listing creation, reviews, blog save, favorites save,
 * newsletter signup, account feed, and public search/list reads that hit
 * Prisma or raw SQL.
 */
export async function safeRateLimit(
  limiter: Ratelimit,
  key: string
): Promise<{ success: boolean; reset: number }> {
  return limitWithFailurePolicy(limiter, key, false, "Rate limit Redis error (fail closed):");
}

/**
 * Fail OPEN — if Redis is down, allow the request.
 * Use ONLY for: view tracking, click tracking, profile view dedup, health/CSP
 * diagnostics, and other telemetry-only routes that should not block user
 * flows during a Redis outage.
 */
export async function safeRateLimitOpen(
  limiter: Ratelimit,
  key: string
): Promise<{ success: boolean; reset: number }> {
  return limitWithFailurePolicy(limiter, key, true, "Rate limit Redis error (fail open):");
}

type ListingAnalyticsKind = "view" | "click";

function listingAnalyticsDailyCap(kind: ListingAnalyticsKind) {
  return kind === "view" ? LISTING_VIEW_DAILY_ANALYTICS_CAP : LISTING_CLICK_DAILY_ANALYTICS_CAP;
}

function todayUtcKeyPart(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function listingAnalyticsDailyCapKey(
  kind: ListingAnalyticsKind,
  listingId: string,
  date = new Date(),
) {
  return `rl:listing-analytics-daily:${kind}:${todayUtcKeyPart(date)}:${listingId}`;
}

/**
 * Fail open: listing analytics should not break user browsing if Redis is down.
 */
export async function claimListingAnalyticsDailyCap(kind: ListingAnalyticsKind, listingId: string) {
  const key = listingAnalyticsDailyCapKey(kind, listingId);
  try {
    const count = Number(await redis.incr(key));
    if (count === 1) {
      await redis.expire(key, LISTING_ANALYTICS_DAILY_CAP_TTL_SECONDS);
    }
    return count <= listingAnalyticsDailyCap(kind);
  } catch (error) {
    Sentry.captureException(error, {
      level: "warning",
      tags: { source: "listing_analytics_daily_cap", kind },
      extra: { listingId },
    });
    return true;
  }
}

/** Returns the client IP from Vercel's x-forwarded-for header. */
export function getIP(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "127.0.0.1";
}

/**
 * Returns a 429 JSON response with a human-readable retry time.
 * Pass the `reset` field from Ratelimit.limit() — it is a Unix timestamp in milliseconds.
 */
export function rateLimitResponse(reset: number, customMessage?: string): Response {
  const diffMs = Math.max(0, reset - Date.now());
  const diffMins = Math.ceil(diffMs / 60000);
  const diffHours = Math.ceil(diffMs / 3600000);
  const resetDate = new Date(reset);
  const retryAfterSeconds = Math.max(1, Math.ceil(diffMs / 1000));

  let timeStr = "";
  if (diffMins < 2) timeStr = "a moment";
  else if (diffMins < 60) timeStr = `${diffMins} minutes`;
  else if (diffHours < 24) timeStr = `${diffHours} hour${diffHours === 1 ? "" : "s"}`;
  else timeStr = `tomorrow at ${resetDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;

  return NextResponse.json(
    {
      error: `${customMessage ?? "Too many requests."} Try again in ${timeStr}.`,
      code: "RATE_LIMITED",
      retryAfterSeconds,
      retryAt: resetDate.toISOString(),
    },
    {
      status: HTTP_STATUS.TOO_MANY_REQUESTS,
      headers: {
        "Retry-After": String(retryAfterSeconds),
        "X-RateLimit-Reset": String(reset),
      },
    }
  ) as Response;
}
