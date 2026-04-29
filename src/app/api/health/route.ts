import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getIP, healthRatelimit, rateLimitResponse, safeRateLimitOpen } from "@/lib/ratelimit";
import {
  healthResponsePayload,
  isFreshHealthResult,
  isVerboseHealthRequest,
  type HealthCheckResult,
} from "@/lib/healthState";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

let cachedHealth: HealthCheckResult | null = null;

async function runHealthChecks(): Promise<HealthCheckResult> {
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

  // R2 check
  try {
    const { HeadBucketCommand } = await import("@aws-sdk/client-s3");
    const { r2, R2_BUCKET } = await import("@/lib/r2");
    await r2.send(new HeadBucketCommand({ Bucket: R2_BUCKET }));
    checks.r2 = "ok";
  } catch {
    checks.r2 = "fail";
  }

  const allOk = Object.values(checks).every((v) => v === "ok");
  return { ok: allOk, checks, timestamp: Date.now() };
}

export async function GET(req: Request) {
  const { success, reset } = await safeRateLimitOpen(healthRatelimit, getIP(req));
  if (!success) return rateLimitResponse(reset, "Too many health checks.");

  const verbose = isVerboseHealthRequest(req.url, process.env.HEALTH_CHECK_TOKEN);
  const cached = isFreshHealthResult(cachedHealth);
  if (!cached) {
    cachedHealth = await runHealthChecks();
  }

  return NextResponse.json(
    healthResponsePayload(cachedHealth!, verbose, cached),
    { status: cachedHealth!.ok ? 200 : 503 },
  );
}
