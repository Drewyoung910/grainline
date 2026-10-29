import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { classifyEmailOutboxFailure } = await import(
  "../src/lib/emailOutboxFailure.ts"
);

describe("email outbox failure classification", () => {
  it("keeps database and internal errors retryable instead of treating their codes as provider rejections", () => {
    assert.equal(classifyEmailOutboxFailure({ code: "P2010", message: "database query failed" }), "unexpected_internal");
    assert.equal(classifyEmailOutboxFailure({ code: "40P01", message: "deadlock detected" }), "unexpected_internal");
    assert.equal(classifyEmailOutboxFailure({ code: "P2024", message: "connection pool timed out" }), "unexpected_internal");
    assert.equal(classifyEmailOutboxFailure({ name: "validation_error", code: "invalid_parameter" }), "unexpected_internal");
  });

  it("keeps provider configuration and account-level failures retryable", () => {
    assert.equal(classifyEmailOutboxFailure(new Error("Email delivery skipped: email provider not configured")), "provider_retryable");
    assert.equal(classifyEmailOutboxFailure(new Error("One-click unsubscribe URL unavailable for configured email send")), "provider_retryable");
    assert.equal(classifyEmailOutboxFailure({ name: "invalid_api_key", statusCode: 401 }), "provider_retryable");
    assert.equal(classifyEmailOutboxFailure({ name: "invalid_access", statusCode: 403 }), "provider_retryable");
    assert.equal(classifyEmailOutboxFailure({ name: "validation_error", statusCode: 422 }), "provider_retryable");
  });

  it("distinguishes local payload defects, transient provider failures and definitive provider rejections", () => {
    assert.equal(classifyEmailOutboxFailure(new Error("Email delivery skipped: invalid recipient")), "invalid_payload");
    assert.equal(classifyEmailOutboxFailure(new Error("Structured email outbox payload requires the compatible renderer")), "invalid_payload");
    assert.equal(classifyEmailOutboxFailure({ name: "rate_limit_exceeded", statusCode: 429 }), "provider_retryable");
    assert.equal(classifyEmailOutboxFailure({ name: "internal_server_error", statusCode: 503 }), "provider_retryable");
    assert.equal(classifyEmailOutboxFailure({ name: "validation_error", statusCode: 400 }), "provider_rejected");
  });
});
