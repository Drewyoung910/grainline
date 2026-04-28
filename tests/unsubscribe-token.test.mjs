import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.UNSUBSCRIBE_SECRET = "test-unsubscribe-secret";
process.env.NEXT_PUBLIC_APP_URL = "https://example.test";

const {
  UNSUBSCRIBE_TOKEN_TTL_MS,
  buildUnsubscribeUrl,
  createUnsubscribeToken,
  normalizeUnsubscribeEmail,
  verifyUnsubscribeToken,
} = await import("../src/lib/unsubscribeToken.ts");

describe("unsubscribe token lifecycle", () => {
  it("normalizes valid addresses and rejects invalid ones", () => {
    assert.equal(normalizeUnsubscribeEmail("  Drew@Example.COM "), "drew@example.com");
    assert.equal(normalizeUnsubscribeEmail("not-an-email"), null);
    assert.equal(normalizeUnsubscribeEmail("drew@example"), null);
  });

  it("builds a tokenized one-click unsubscribe URL", () => {
    const url = new URL(buildUnsubscribeUrl("Drew@Example.COM") ?? "");

    assert.equal(url.origin, "https://example.test");
    assert.equal(url.pathname, "/api/email/unsubscribe");
    assert.equal(url.searchParams.get("email"), "drew@example.com");
    assert.match(url.searchParams.get("issuedAt") ?? "", /^\d+$/);
    assert.match(url.searchParams.get("token") ?? "", /^[a-f0-9]{64}$/);
  });

  it("verifies the original address and rejects address/token tampering", () => {
    const issuedAt = 1_800_000_000_000;
    const token = createUnsubscribeToken("drew@example.com", issuedAt);

    assert.equal(verifyUnsubscribeToken("Drew@Example.COM", token ?? "", issuedAt, issuedAt), true);
    assert.equal(verifyUnsubscribeToken("other@example.com", token ?? "", issuedAt, issuedAt), false);
    assert.equal(verifyUnsubscribeToken("drew@example.com", "0".repeat(64), issuedAt, issuedAt), false);
    assert.equal(verifyUnsubscribeToken("drew@example.com", "not-hex", issuedAt, issuedAt), false);
  });

  it("rejects expired tokens and tokens issued too far in the future", () => {
    const issuedAt = 1_800_000_000_000;
    const token = createUnsubscribeToken("drew@example.com", issuedAt);

    assert.equal(
      verifyUnsubscribeToken("drew@example.com", token ?? "", issuedAt, issuedAt + UNSUBSCRIBE_TOKEN_TTL_MS),
      true,
    );
    assert.equal(
      verifyUnsubscribeToken("drew@example.com", token ?? "", issuedAt, issuedAt + UNSUBSCRIBE_TOKEN_TTL_MS + 1),
      false,
    );
    assert.equal(
      verifyUnsubscribeToken("drew@example.com", token ?? "", issuedAt + 5 * 60 * 1000 + 1, issuedAt),
      false,
    );
  });
});
