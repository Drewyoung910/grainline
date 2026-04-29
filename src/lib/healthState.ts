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

export function isVerboseHealthRequest(url: string, configuredToken: string | null | undefined) {
  const token = configuredToken?.trim();
  if (!token) return false;

  let supplied: string | null = null;
  try {
    supplied = new URL(url).searchParams.get("token");
  } catch {
    return false;
  }
  return supplied === token;
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
