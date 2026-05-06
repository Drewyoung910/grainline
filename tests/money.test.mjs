import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { formatCurrencyCents, normalizeCurrencyCode, parseMoneyInputToCents } = await import("../src/lib/money.ts");

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

  it("parses decimal money input without accepting exponent notation", () => {
    assert.equal(parseMoneyInputToCents("12"), 1200);
    assert.equal(parseMoneyInputToCents("12.3"), 1230);
    assert.equal(parseMoneyInputToCents(".99"), 99);
    assert.equal(parseMoneyInputToCents(" 001.20 "), 120);
    assert.equal(parseMoneyInputToCents("1e10"), null);
    assert.equal(parseMoneyInputToCents("1.234"), null);
    assert.equal(parseMoneyInputToCents("-1"), null);
    assert.equal(parseMoneyInputToCents("-1.25", { allowNegative: true }), -125);
  });
});
