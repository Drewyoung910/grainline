export const EMAIL_SEND_MAX_ATTEMPTS = 3;
export const EMAIL_SEND_RETRY_BASE_DELAY_MS = 500;
export const EMAIL_SEND_RETRY_MAX_DELAY_MS = 5_000;

const RETRYABLE_NODE_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETRESET",
  "ENETUNREACH",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

type RetryOptions = {
  maxAttempts?: number;
  sleep?: (delayMs: number) => Promise<void>;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
};

function readRecordValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  return (value as Record<string, unknown>)[key];
}

function parseStatus(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number.parseInt(value, 10);
  return null;
}

function defaultSleep(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

export function emailSendRetryDelayMs(failedAttempt: number) {
  const normalizedAttempt = Math.max(1, Math.trunc(failedAttempt));
  return Math.min(
    EMAIL_SEND_RETRY_MAX_DELAY_MS,
    EMAIL_SEND_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, normalizedAttempt - 1),
  );
}

export function emailSendErrorStatus(error: unknown) {
  const response = readRecordValue(error, "response");
  const candidates = [
    readRecordValue(error, "statusCode"),
    readRecordValue(error, "status"),
    readRecordValue(response, "statusCode"),
    readRecordValue(response, "status"),
  ];

  for (const candidate of candidates) {
    const status = parseStatus(candidate);
    if (status !== null) return status;
  }

  return null;
}

export function isRetryableEmailSendError(error: unknown) {
  const status = emailSendErrorStatus(error);
  if (status !== null) {
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
  }

  const code = readRecordValue(error, "code");
  if (typeof code === "string" && RETRYABLE_NODE_ERROR_CODES.has(code)) return true;

  return error instanceof TypeError;
}

export async function sendEmailWithRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
) {
  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts ?? EMAIL_SEND_MAX_ATTEMPTS));
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableEmailSendError(error)) {
        throw error;
      }

      const delayMs = emailSendRetryDelayMs(attempt);
      options.onRetry?.(error, attempt, delayMs);
      await sleep(delayMs);
    }
  }

  throw new Error("Email send retry loop exhausted unexpectedly");
}
