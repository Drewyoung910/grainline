import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.SHIPPING_RATE_SECRET = "test-shipping-rate-secret";

const { signRate, verifyRate } = await import("../src/lib/shipping-token.ts");

const fields = {
  objectId: "rate_123",
  amountCents: 1299,
  displayName: "Ground",
  carrier: "USPS",
  estDays: 3,
  contextId: "seller_123",
  buyerId: "user_123",
  buyerPostal: "78701",
};

describe("shipping rate tokens", () => {
  it("verifies a token signed for the same buyer and rate fields", () => {
    const signed = signRate(fields, 60);

    assert.deepEqual(verifyRate(fields, signed.token, signed.expiresAt), { ok: true });
  });

  it("rejects replay by a different buyer", () => {
    const signed = signRate(fields, 60);

    assert.equal(
      verifyRate({ ...fields, buyerId: "user_456" }, signed.token, signed.expiresAt).ok,
      false,
    );
  });

  it("rejects tampered amount, context, and postal-code fields", () => {
    const signed = signRate(fields, 60);

    assert.equal(
      verifyRate({ ...fields, amountCents: 1300 }, signed.token, signed.expiresAt).ok,
      false,
    );
    assert.equal(
      verifyRate({ ...fields, contextId: "seller_456" }, signed.token, signed.expiresAt).ok,
      false,
    );
    assert.equal(
      verifyRate({ ...fields, buyerPostal: "10001" }, signed.token, signed.expiresAt).ok,
      false,
    );
  });

  it("rejects expired or malformed tokens", () => {
    const expired = signRate(fields, -1);

    assert.deepEqual(verifyRate(fields, expired.token, expired.expiresAt), {
      ok: false,
      error: "Shipping rates have expired. Please go back and re-select a shipping option.",
      status: 422,
    });
    assert.deepEqual(verifyRate(fields, "not-hex", Math.floor(Date.now() / 1000) + 60), {
      ok: false,
      error: "Invalid shipping rate.",
      status: 400,
    });
  });
});
