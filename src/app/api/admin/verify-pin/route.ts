import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { safeRateLimit } from "@/lib/ratelimit";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

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

  // Verify user is ADMIN role
  const user = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { role: true },
  });
  if (user?.role !== "ADMIN") {
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
    // If ADMIN_PIN is not set, allow access (dev mode / not configured)
    return NextResponse.json({ ok: true });
  }

  // Constant-time comparison to prevent timing attacks
  if (pin.length !== adminPin.length) {
    return NextResponse.json({}, { status: 401 });
  }
  let match = true;
  for (let i = 0; i < pin.length; i++) {
    if (pin[i] !== adminPin[i]) match = false;
  }
  if (!match) {
    return NextResponse.json({}, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
