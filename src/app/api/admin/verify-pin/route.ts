import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import {
  ADMIN_PIN_COOKIE_NAME,
  ADMIN_PIN_MAX_AGE_SECONDS,
  createAdminPinCookieValue,
} from "@/lib/adminPin";
import { getIP } from "@/lib/ratelimit";
import { createHash, timingSafeEqual } from "crypto";

// 5 attempts per 15 minutes per user — fail closed for compromised sessions.
const pinUserRatelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, "15 m"),
  analytics: true,
  prefix: "rl:admin-pin:user",
});

// 50 attempts per 15 minutes per IP — broad bot-flood guard without locking
// out every staff member behind a shared office/network IP.
const pinIpRatelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(50, "15 m"),
  analytics: true,
  prefix: "rl:admin-pin:ip",
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({}, { status: 401 });

  // Verify user is allowed into the admin surface.
  const user = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { role: true },
  });
  if (user?.role !== "ADMIN" && user?.role !== "EMPLOYEE") {
    return NextResponse.json({}, { status: 403 });
  }

  // Rate limit by both account and source IP. A compromised admin session
  // should not get a fresh PIN budget by changing networks, and one noisy IP
  // should not be able to brute-force across staff accounts.
  const ip = getIP(req);
  const [userLimit, ipLimit] = await Promise.all([
    safeRateLimit(pinUserRatelimit, userId),
    safeRateLimit(pinIpRatelimit, ip),
  ]);
  if (!userLimit.success || !ipLimit.success) {
    return rateLimitResponse(
      Math.max(userLimit.reset, ipLimit.reset),
      "Too many admin PIN attempts.",
    );
  }

  const body = await req.json().catch(() => ({}));
  const pin = typeof body.pin === "string" ? body.pin : "";
  const adminPin = process.env.ADMIN_PIN;

  if (!adminPin) {
    if (
      process.env.NODE_ENV === "production" ||
      process.env.ALLOW_DEV_ADMIN_PIN_BYPASS !== "true"
    ) {
      return NextResponse.json({ error: "Admin PIN is not configured" }, { status: 503 });
    }

    const cookieValue = await createAdminPinCookieValue(userId);
    if (!cookieValue) {
      return NextResponse.json({ error: "Admin PIN cookie could not be signed" }, { status: 503 });
    }

    const devRes = NextResponse.json({ ok: true });
    devRes.cookies.set(ADMIN_PIN_COOKIE_NAME, cookieValue, {
      httpOnly: true,
      secure: false,
      sameSite: "strict",
      maxAge: ADMIN_PIN_MAX_AGE_SECONDS,
      path: "/",
    });
    return devRes;
  }

  // Constant-time comparison to prevent timing attacks
  const pinDigest = createHash("sha256").update(pin).digest();
  const adminPinDigest = createHash("sha256").update(adminPin).digest();
  const match = timingSafeEqual(pinDigest, adminPinDigest);
  if (!match) {
    return NextResponse.json({}, { status: 401 });
  }

  // Set httpOnly cookie so admin APIs can verify PIN server-side
  const cookieValue = await createAdminPinCookieValue(userId);
  if (!cookieValue) {
    return NextResponse.json({ error: "Admin PIN cookie could not be signed" }, { status: 503 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_PIN_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: ADMIN_PIN_MAX_AGE_SECONDS,
    path: "/",
  });
  return res;
}
