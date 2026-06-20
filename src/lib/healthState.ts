import { createHash, timingSafeEqual } from "crypto";

export const HEALTH_CACHE_MS = 30_000;

type HealthCheckStatus = "ok" | "fail";

export type HealthCheckResult = {
  ok: boolean;
  checks: Record<string, HealthCheckStatus>;
  timestamp: number;
};

export function isFreshHealthResult(
  result: Pick<HealthCheckResult, "timestamp"> | null | undefined,
  now = Date.now(),
) {
  return Boolean(result && now - result.timestamp < HEALTH_CACHE_MS);
}

type VerboseHealthRequest = Pick<Request, "headers">;

function verboseHealthTokenFromHeaders(headers: Headers) {
  const authorization = headers.get("authorization")?.trim();
  const bearerMatch = authorization?.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch?.[1]?.trim()) return bearerMatch[1].trim();

  const healthHeader = headers.get("x-health-check-token")?.trim();
  return healthHeader || null;
}

export function isVerboseHealthRequest(
  request: VerboseHealthRequest,
  configuredToken: string | null | undefined,
) {
  const token = configuredToken?.trim();
  if (!token) return false;

  const supplied = verboseHealthTokenFromHeaders(request.headers);
  if (!supplied) return false;
  return timingSafeEqual(sha256(supplied), sha256(token));
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest();
}

export function healthResponsePayload(result: HealthCheckResult, verbose: boolean, cached: boolean) {
  if (!verbose) return { ok: result.ok };
  return {
    ok: result.ok,
    checks: result.checks,
    timestamp: result.timestamp,
    cached,
  };
}
