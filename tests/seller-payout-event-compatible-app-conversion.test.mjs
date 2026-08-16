import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const plan = readFileSync(
  "docs/seller-payout-event-compatible-app-conversion.md",
  "utf8",
);

test("SellerPayoutEvent app conversion records the exact non-production boundary", () => {
  assert.match(plan, /isolated application candidate only/i);
  assert.match(plan, /database authority candidate[\s\S]*merged into `main` but remains unapplied/i);
  assert.match(plan, /does not enable or FORCE RLS/);
  assert.match(plan, /must not be[\s\S]*deployed before the compatible migration/i);
  assert.match(plan, /three audited `SellerPayoutEvent` application\s+consumers/);
});

test("SellerPayoutEvent app conversion pins notification retry and projection semantics", () => {
  assert.match(plan, /`inserted`, `updated`, `legacy_converged` and `already_applied`/);
  assert.match(plan, /`already_applied` retries notification/);
  assert.match(plan, /`stale_ignored` emits no notification/);
  assert.match(plan, /identifier-free warning telemetry/);
  assert.match(plan, /database-clamped 500-row keyset projection/);
  assert.match(plan, /No source file under `src\/` retains direct[\s\S]*`prisma\.sellerPayoutEvent`/);
});

test("SellerPayoutEvent app conversion preserves separate rollout gates", () => {
  assert.match(plan, /aggregate-only production inspection/);
  assert.match(plan, /Apply and prove only the compatible migration/);
  assert.match(plan, /linked-seller signed test-mode child\/Preview proof/);
  assert.match(plan, /Drain predecessors/);
  assert.match(plan, /policyless RLS/);
  assert.match(plan, /posture-only FORCE/);
  assert.match(plan, /remain[\s\S]*separate domain-first releases/);
});
