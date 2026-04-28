import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { sanitizeEmailOutboxError } = await import("../src/lib/emailOutboxSanitize.ts");

describe("email outbox error sanitization", () => {
  it("redacts recipient emails, URLs, and likely tokens", () => {
    const sanitized = sanitizeEmailOutboxError(
      new Error(
        "Failed sending to buyer@example.com via https://api.resend.com/emails with sk_test_1234567890abcdef and 0123456789abcdef0123456789abcdef",
      ),
    );

    assert.equal(
      sanitized,
      "Failed sending to [email] via [url] with [token] and [token]",
    );
  });

  it("caps stored errors at the database field length", () => {
    assert.equal(sanitizeEmailOutboxError("x".repeat(1200)).length, 1000);
  });
});
