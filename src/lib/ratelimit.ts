import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
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
  limiter: Ratelimit.slidingWindow(20, "60 s"),
  analytics: true,
  prefix: "rl:view",
});

export const clickRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "60 s"),
  analytics: true,
  prefix: "rl:click",
});

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

export const messageRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "60 s"),
  analytics: true,
  prefix: "rl:message",
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

// Commission creation — prevent request spam
export const commissionCreateRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "24 h"),
  analytics: true,
  prefix: "rl:commission_create",
});

// Profile view dedup — deduplicate by IP+listingId combo
export const profileViewRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(1, "24 h"),
  analytics: false,
  prefix: "rl:profile_view",
});

// Broadcast — Redis layer on top of DB 7-day check
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

// Notification mark-read — low risk but cap it (fail open — non-critical)
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

/**
 * Fail CLOSED — if Redis is down, reject the request.
 * Use for: checkout, follow, broadcast, commission create,
 * commission interest, listing creation, reviews, blog save, favorites save
 */
export async function safeRateLimit(
  limiter: Ratelimit,
  key: string
): Promise<{ success: boolean; reset: number }> {
  try {
    const result = await limiter.limit(key);
    return { success: result.success, reset: result.reset };
  } catch (error) {
    console.error("Rate limit Redis error (fail closed):", error);
    return { success: false, reset: Date.now() + 60000 };
  }
}

/**
 * Fail OPEN — if Redis is down, allow the request.
 * Use ONLY for: view tracking, click tracking, search suggestions,
 * profile view dedup — non-critical read-path routes
 */
export async function safeRateLimitOpen(
  limiter: Ratelimit,
  key: string
): Promise<{ success: boolean; reset: number }> {
  try {
    const result = await limiter.limit(key);
    return { success: result.success, reset: result.reset };
  } catch (error) {
    console.error("Rate limit Redis error (fail open):", error);
    return { success: true, reset: Date.now() + 60000 };
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
  const diffMs = reset - Date.now();
  const diffMins = Math.ceil(diffMs / 60000);
  const diffHours = Math.ceil(diffMs / 3600000);
  const resetDate = new Date(reset);

  let timeStr = "";
  if (diffMins < 2) timeStr = "a moment";
  else if (diffMins < 60) timeStr = `${diffMins} minutes`;
  else if (diffHours < 24) timeStr = `${diffHours} hour${diffHours === 1 ? "" : "s"}`;
  else timeStr = `tomorrow at ${resetDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;

  return NextResponse.json(
    { error: `${customMessage ?? "Too many requests."} Try again in ${timeStr}.` },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.ceil(diffMs / 1000)),
        "X-RateLimit-Reset": String(reset),
      },
    }
  ) as Response;
}
