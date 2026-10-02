type StripeProviderErrorLike = {
  type?: unknown;
  statusCode?: unknown;
  headers?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripeShouldRetry(headers: unknown) {
  if (!isRecord(headers)) return null;
  const value = headers["stripe-should-retry"]
    ?? headers["Stripe-Should-Retry"];
  return typeof value === "string" ? value.toLowerCase() : null;
}

/**
 * Stripe-node maps HTTP 400/404 responses to StripeInvalidRequestError and
 * HTTP 402 responses to StripeCardError. Those responses prove that the
 * refund request was rejected, unless Stripe explicitly marks it retryable.
 *
 * Connection failures, 5xx responses, idempotency conflicts, dependency
 * failures, and rate limits remain indeterminate or retryable and must not be
 * classified by this helper.
 */
export function isDefinitiveStripeRefundRejection(error: unknown) {
  if (!isRecord(error)) return false;
  const candidate = error as StripeProviderErrorLike;
  if (stripeShouldRetry(candidate.headers) === "true") return false;

  return (
    candidate.type === "StripeInvalidRequestError"
    && (candidate.statusCode === 400 || candidate.statusCode === 404)
  ) || (
    candidate.type === "StripeCardError"
    && candidate.statusCode === 402
  );
}
