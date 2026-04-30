import { createHash } from "crypto";

export const EMAIL_OUTBOX_MAX_ATTEMPTS = 10;
export const EMAIL_OUTBOX_PROCESSING_STALE_MS = 10 * 60 * 1000;

export type EmailOutboxProcessingCandidate = {
  status: string;
  updatedAt: Date | null;
};

export function emailOutboxRetryDelayMs(attempts: number) {
  const normalizedAttempts = Math.max(1, Math.trunc(attempts));
  const seconds = Math.min(6 * 60 * 60, 60 * 2 ** Math.max(0, normalizedAttempts - 1));
  return seconds * 1000;
}

export function emailOutboxProcessingStaleCutoff(now = new Date()) {
  return new Date(now.getTime() - EMAIL_OUTBOX_PROCESSING_STALE_MS);
}

export function isEmailOutboxProcessingStale(
  job: EmailOutboxProcessingCandidate,
  now = new Date(),
) {
  return (
    job.status === "PROCESSING" &&
    job.updatedAt instanceof Date &&
    job.updatedAt.getTime() < emailOutboxProcessingStaleCutoff(now).getTime()
  );
}

export function isTerminalEmailOutboxAttempt(attempts: number) {
  return attempts >= EMAIL_OUTBOX_MAX_ATTEMPTS;
}

export function emailOutboxDedupKey(rawKey: string) {
  if (rawKey.length <= 128) return rawKey;
  return `sha256:${createHash("sha256").update(rawKey).digest("hex")}`;
}

export function emailOutboxFailureState(attempts: number, now = new Date()) {
  const terminal = isTerminalEmailOutboxAttempt(attempts);
  return {
    terminal,
    status: terminal ? "DEAD" : "FAILED",
    nextAttemptAt: terminal ? null : new Date(now.getTime() + emailOutboxRetryDelayMs(attempts)),
  };
}
