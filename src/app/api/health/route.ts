import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getIP, healthRatelimit, rateLimitResponse, safeRateLimitOpen } from "@/lib/ratelimit";
import {
  healthResponsePayload,
  isFreshHealthResult,
  isVerboseHealthRequest,
  type HealthCheckResult,
} from "@/lib/healthState";
import { HTTP_STATUS } from "@/lib/httpStatus";
import { probeR2Health } from "@/lib/r2Health";

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

  // Check every configured application bucket using the application's client.
  // Preview and Development intentionally configure only the public bucket.
  const privateBucket = process.env.CLOUDFLARE_R2_PRIVATE_BUCKET_NAME;
  try {
    const { HeadBucketCommand } = await import("@aws-sdk/client-s3");
    const { r2, R2_BUCKET } = await import("@/lib/r2");
    Object.assign(checks, await probeR2Health({
      publicBucket: R2_BUCKET,
      privateBucket,
      headBucket: (bucket) => r2.send(new HeadBucketCommand({ Bucket: bucket })),
    }));
  } catch {
    checks.r2 = "fail";
    if (privateBucket) checks.r2Private = "fail";
  }

  const allOk = Object.values(checks).every((v) => v === "ok");
  return { ok: allOk, checks, timestamp: Date.now() };
}

export async function GET(req: Request) {
  const { success, reset } = await safeRateLimitOpen(healthRatelimit, getIP(req));
  if (!success) return rateLimitResponse(reset, "Too many health checks.");

  const verbose = isVerboseHealthRequest(req, process.env.HEALTH_CHECK_TOKEN);
  const cached = isFreshHealthResult(cachedHealth);
  if (!cached) {
    cachedHealth = await runHealthChecks();
  }

  return NextResponse.json(
    healthResponsePayload(cachedHealth!, verbose, cached),
    {
      status: cachedHealth!.ok ? HTTP_STATUS.OK : HTTP_STATUS.SERVICE_UNAVAILABLE,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        Vary: "Authorization, X-Health-Check-Token",
      },
    },
  );
}
