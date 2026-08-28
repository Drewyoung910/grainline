import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const scriptsDirectory = new URL("../scripts/", import.meta.url);

test("PostgreSQL catalog identifier arrays are cast to driver-parsed text arrays", () => {
  const offenders = [];
  for (const entry of readdirSync(scriptsDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || path.extname(entry.name) !== ".mjs") continue;
    const source = readFileSync(new URL(entry.name, scriptsDirectory), "utf8");
    if (/array_agg\(\s*[A-Za-z0-9_.]+\.attname(?!::text)/.test(source)) {
      offenders.push(entry.name);
    }
  }
  assert.deepEqual(offenders, []);
});

test("every dynamic foreign-key cleanup uses text-array catalog identities", () => {
  for (const name of [
    "order-payment-event-blocked-checkout-production-proof.mjs",
    "order-payment-event-seller-refund-production-proof.mjs",
    "order-payment-event-signed-production-proof.mjs",
  ]) {
    const source = readFileSync(new URL(name, scriptsDirectory), "utf8");
    assert.equal(
      source.match(/array_agg\(\s*(?:child|parent)_attribute\.attname::text/g)?.length,
      2,
      `${name} must cast both foreign-key identifier arrays to text[]`,
    );
  }
});
