import { sanitizeEmailOutboxError } from "./emailOutboxSanitize.ts";
import { emailSendErrorStatus, isRetryableEmailSendError } from "./emailRetry.ts";
import type { EmailOutboxFailureClass } from "./emailOutboxWorker.ts";

export function classifyEmailOutboxFailure(error: unknown): EmailOutboxFailureClass {
  const message = sanitizeEmailOutboxError(error).toLowerCase();
  if (
    message.includes("invalid recipient")
    || message.includes("compatible renderer")
  ) {
    return "invalid_payload";
  }
  if (
    message.includes("email provider not configured")
    || message.includes("unsubscribe url unavailable")
  ) {
    return "provider_retryable";
  }
  if (isRetryableEmailSendError(error)) return "provider_retryable";
  const status = emailSendErrorStatus(error);
  if (status === 401 || status === 403 || status === 422) {
    return "provider_retryable";
  }
  if (status !== null && status >= 400 && status < 500) return "provider_rejected";
  return "unexpected_internal";
}
