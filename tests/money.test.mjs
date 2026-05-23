import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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

  it("formats zero-decimal currency minor units without dividing by 100", () => {
    assert.match(formatCurrencyCents(12345, "jpy"), /12,345/);
    assert.doesNotMatch(formatCurrencyCents(12345, "jpy"), /123\.45/);
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

  it("keeps runtime currency fallbacks centralized on DEFAULT_CURRENCY", () => {
    const roots = ["src/app", "src/components", "src/lib"];
    const files = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
          walk(path);
          continue;
        }
        if (/\.(ts|tsx)$/.test(path)) files.push(path);
      }
    };
    roots.forEach(walk);

    const offenders = files.filter((path) => {
      if (path === "src/lib/money.ts") return false;
      return /["']usd["']/.test(readFileSync(path, "utf8"));
    });

    assert.deepEqual(offenders, []);
  });
});
