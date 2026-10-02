import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isDefinitiveStripeRefundRejection } from "../src/lib/stripeRefundProviderErrors.ts";

describe("Stripe refund provider error classification", () => {
  it("accepts only definitive request rejections", () => {
    for (const error of [
      { type: "StripeInvalidRequestError", statusCode: 400 },
      { type: "StripeInvalidRequestError", statusCode: 404 },
      { type: "StripeCardError", statusCode: 402 },
    ]) {
      assert.equal(isDefinitiveStripeRefundRejection(error), true);
    }
  });

  it("keeps indeterminate and retryable failures out of the terminal path", () => {
    for (const error of [
      new Error("connection reset"),
      { type: "StripeConnectionError" },
      { type: "StripeAPIError", statusCode: 500 },
      { type: "StripeIdempotencyError", statusCode: 400 },
      { type: "StripeRateLimitError", statusCode: 429 },
      { type: "StripeAPIError", statusCode: 424 },
      { type: "StripeInvalidRequestError", statusCode: 409 },
      {
        type: "StripeInvalidRequestError",
        statusCode: 400,
        headers: { "stripe-should-retry": "true" },
      },
    ]) {
      assert.equal(isDefinitiveStripeRefundRejection(error), false);
    }
  });
});
