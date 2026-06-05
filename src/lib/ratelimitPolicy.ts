import * as Sentry from "@sentry/nextjs";
import { createHash } from "node:crypto";

export type RateLimitResult = {
  success: boolean;
  reset: number;
};

export type RateLimitLike = {
  limit(key: string): Promise<RateLimitResult>;
};

export function providerRateLimitKey(key: string): string {
  return `sha256:${createHash("sha256").update(key).digest("hex")}`;
}

export async function limitWithFailurePolicy(
  limiter: RateLimitLike,
  key: string,
  failOpen: boolean,
  logMessage: string,
): Promise<RateLimitResult> {
  try {
    const result = await limiter.limit(providerRateLimitKey(key));
    return { success: result.success, reset: result.reset };
  } catch (error) {
    console.error(logMessage, error);
    Sentry.captureException?.(error, {
      tags: {
        source: "ratelimit_failure_policy",
        failurePolicy: failOpen ? "fail_open" : "fail_closed",
      },
      extra: { keyLength: key.length },
    });
    return { success: failOpen, reset: Date.now() + 60000 };
  }
}
