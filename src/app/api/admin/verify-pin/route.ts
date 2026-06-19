import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { logAdminAction } from "@/lib/audit";
import {
  ADMIN_PIN_COOKIE_NAME,
  ADMIN_PIN_MAX_AGE_SECONDS,
  createAdminPinSessionCookieValue,
} from "@/lib/adminPin";
import { getIP } from "@/lib/ratelimit";
import { logSecurityEvent } from "@/lib/security";
import { isRequestBodyTooLargeError, readOptionalBoundedJson } from "@/lib/requestBody";
import { hashIdentifierForTelemetry } from "@/lib/privacyTelemetry";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { HTTP_STATUS } from "@/lib/httpStatus";
import { createHash, timingSafeEqual } from "crypto";

// 5 attempts per 15 minutes per user — fail closed for compromised sessions.
const pinUserRatelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, "15 m"),
  analytics: true,
  prefix: "rl:admin-pin:user",
});
const ADMIN_PIN_BODY_MAX_BYTES = 8 * 1024;

// 50 attempts per 15 minutes per IP — broad bot-flood guard without locking
// out every staff member behind a shared office/network IP.
const pinIpRatelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(50, "15 m"),
  analytics: true,
  prefix: "rl:admin-pin:ip",
});

async function logAdminPinAttempt({
  adminId,
  action,
  ipHash,
  clerkUserIdHash,
  metadata = {},
}: {
  adminId: string;
  action: "ADMIN_PIN_VERIFY_OK" | "ADMIN_PIN_VERIFY_FAIL" | "ADMIN_PIN_RATE_LIMIT";
  ipHash: string;
  clerkUserIdHash: string;
  metadata?: Record<string, unknown>;
}) {
  await logAdminAction({
    adminId,
    action,
    targetType: "USER",
    targetId: adminId,
    metadata: {
      ipHash,
      clerkUserIdHash,
      ...metadata,
    },
  });
}

export async function POST(req: Request) {
  const { userId, sessionId } = await auth();
  if (!userId) return privateJson({}, { status: HTTP_STATUS.UNAUTHORIZED });

  // Verify user is allowed into the admin surface.
  const user = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, role: true, banned: true, deletedAt: true },
  });
  if (!user || user.banned || user.deletedAt || (user.role !== "ADMIN" && user.role !== "EMPLOYEE")) {
    return privateJson({}, { status: HTTP_STATUS.FORBIDDEN });
  }

  // Rate limit by both account and source IP. A compromised admin session
  // should not get a fresh PIN budget by changing networks, and one noisy IP
  // should not be able to brute-force across staff accounts.
  const ip = getIP(req);
  const ipHash = hashIdentifierForTelemetry(ip) ?? "unknown";
  const clerkUserIdHash = hashIdentifierForTelemetry(userId) ?? "unknown";
  const [userLimit, ipLimit] = await Promise.all([
    safeRateLimit(pinUserRatelimit, userId),
    safeRateLimit(pinIpRatelimit, ip),
  ]);
  if (!userLimit.success || !ipLimit.success) {
    await logAdminPinAttempt({
      adminId: user.id,
      action: "ADMIN_PIN_RATE_LIMIT",
      ipHash,
      clerkUserIdHash,
      metadata: {
        userLimitSuccess: userLimit.success,
        ipLimitSuccess: ipLimit.success,
        userLimitReset: userLimit.reset,
        ipLimitReset: ipLimit.reset,
      },
    });
    Sentry.captureMessage("ADMIN_PIN_BRUTEFORCE", {
      level: "warning",
      tags: { source: "admin_pin", reason: "rate_limit" },
      user: { id: user.id },
      extra: {
        adminId: user.id,
        ipHash,
        userLimitSuccess: userLimit.success,
        ipLimitSuccess: ipLimit.success,
        userLimitReset: userLimit.reset,
        ipLimitReset: ipLimit.reset,
      },
    });
    return privateResponse(rateLimitResponse(
      Math.max(userLimit.reset, ipLimit.reset),
      "Too many admin PIN attempts.",
    ));
  }

  let body: unknown;
  try {
    body = await readOptionalBoundedJson(req, ADMIN_PIN_BODY_MAX_BYTES, {});
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return privateJson({ error: "Request body too large" }, { status: HTTP_STATUS.PAYLOAD_TOO_LARGE });
    }
    throw error;
  }
  const bodyObject = body as { pin?: unknown };
  const pin = typeof bodyObject.pin === "string" ? bodyObject.pin : "";
  const adminPin = process.env.ADMIN_PIN;

  if (!adminPin) {
    if (
      process.env.NODE_ENV === "production" ||
      process.env.ALLOW_DEV_ADMIN_PIN_BYPASS !== "true"
    ) {
      return privateJson({ error: "Admin PIN is not configured" }, { status: HTTP_STATUS.SERVICE_UNAVAILABLE });
    }

    const cookieValue = await createAdminPinSessionCookieValue(userId, sessionId);
    if (!cookieValue) {
      return privateJson({ error: "Admin PIN cookie could not be signed" }, { status: HTTP_STATUS.SERVICE_UNAVAILABLE });
    }

    await logAdminPinAttempt({
      adminId: user.id,
      action: "ADMIN_PIN_VERIFY_OK",
      ipHash,
      clerkUserIdHash,
      metadata: { devBypass: true },
    });

    const devRes = privateResponse(NextResponse.json({ ok: true }));
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
    await logAdminPinAttempt({
      adminId: user.id,
      action: "ADMIN_PIN_VERIFY_FAIL",
      ipHash,
      clerkUserIdHash,
    });
    logSecurityEvent("auth_challenge_failed", {
      userId: user.id,
      ipHash,
      route: "/api/admin/verify-pin",
      reason: "invalid admin pin",
    });
    return privateJson({}, { status: HTTP_STATUS.UNAUTHORIZED });
  }

  // Set httpOnly cookie so admin APIs can verify PIN server-side
  const cookieValue = await createAdminPinSessionCookieValue(userId, sessionId);
  if (!cookieValue) {
    return privateJson({ error: "Admin PIN cookie could not be signed" }, { status: HTTP_STATUS.SERVICE_UNAVAILABLE });
  }

  await logAdminPinAttempt({
    adminId: user.id,
    action: "ADMIN_PIN_VERIFY_OK",
    ipHash,
    clerkUserIdHash,
  });

  const res = privateResponse(NextResponse.json({ ok: true }));
  res.cookies.set(ADMIN_PIN_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: ADMIN_PIN_MAX_AGE_SECONDS,
    path: "/",
  });
  return res;
}
