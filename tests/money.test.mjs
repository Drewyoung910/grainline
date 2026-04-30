import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { formatCurrencyCents, normalizeCurrencyCode } = await import("../src/lib/money.ts");

describe("money formatting", () => {
  it("normalizes ISO currency codes", () => {
    assert.equal(normalizeCurrencyCode("usd"), "USD");
    assert.equal(normalizeCurrencyCode(" eur "), "EUR");
    assert.equal(normalizeCurrencyCode("not-money"), "USD");
  });

  it("formats cents with the requested currency", () => {
    assert.equal(formatCurrencyCents(12345, "usd"), "$123.45");
    assert.match(formatCurrencyCents(12345, "eur"), /123\.45|123,45/);
    assert.notEqual(formatCurrencyCents(12345, "eur"), "$123.45");
  });
});
