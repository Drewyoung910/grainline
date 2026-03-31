import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

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
  limiter: Ratelimit.slidingWindow(10, "24 h"),
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

/** Returns the client IP from Vercel's x-forwarded-for header. */
export function getIP(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "127.0.0.1";
}
