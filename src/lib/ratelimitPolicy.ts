import { createHash } from "node:crypto";
import { logServerError } from "./serverErrorLogger.ts";

export type RateLimitResult = {
  success: boolean;
  reset: number;
  /** The limiter could not be reached, so this answer says nothing about the caller. */
  unavailable?: true;
};

export type RateLimitLike = {
  limit(key: string): Promise<RateLimitResult & { reason?: string }>;
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
    // Upstash answers success when its own timeout wins the race. That is a Redis
    // failure, not an allowed request, so it follows the same policy as an error.
    if (result.reason === "timeout") throw new Error("Rate limiter timed out");
    return { success: result.success, reset: result.reset };
  } catch (error) {
    logServerError(error, {
      source: "ratelimit_failure_policy",
      level: "warning",
      tags: {
        failurePolicy: failOpen ? "fail_open" : "fail_closed",
      },
      extra: { keyLength: key.length, message: logMessage },
    });
    return { success: failOpen, reset: Date.now() + 60000, unavailable: true };
  }
}
