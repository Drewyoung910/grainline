import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET() {
  const checks: Record<string, "ok" | "fail"> = {};

  // DB check
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = "ok";
  } catch {
    checks.db = "fail";
  }

  // Redis check (Upstash)
  try {
    const { Redis } = await import("@upstash/redis");
    const redis = Redis.fromEnv();
    await redis.ping();
    checks.redis = "ok";
  } catch {
    checks.redis = "fail";
  }

  const allOk = Object.values(checks).every((v) => v === "ok");

  return NextResponse.json(
    { ok: allOk, checks, timestamp: Date.now() },
    { status: allOk ? 200 : 503 }
  );
}
