import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { safeRateLimit } from "@/lib/ratelimit";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import {
  ADMIN_PIN_COOKIE_NAME,
  ADMIN_PIN_MAX_AGE_SECONDS,
  createAdminPinCookieValue,
} from "@/lib/adminPin";
import { createHash, timingSafeEqual } from "crypto";

// 5 attempts per 15 minutes per user — fail closed
const pinRatelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, "15 m"),
  analytics: true,
  prefix: "rl:admin-pin",
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

  // Rate limit
  const { success } = await safeRateLimit(pinRatelimit, userId);
  if (!success) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
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
