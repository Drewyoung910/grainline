import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const plan = readFileSync(
  "docs/seller-payout-event-compatible-app-conversion.md",
  "utf8",
);

test("SellerPayoutEvent app conversion records the exact compatible production release", () => {
  assert.match(plan, /compatible application deployed and verified/i);
  assert.match(plan, /PR #226 merged[\s\S]*99591a8f93c45f9324fb834fcbc1ea525867ace8/);
  assert.match(plan, /exact-main CI `31925636570`[\s\S]*passed/);
  assert.match(plan, /e9239463a71860451191344b26dd20b45298f239/);
  assert.match(plan, /31927548800/);
  assert.match(plan, /dpl_7PRTnXtMrMNq83ZFPJNeqFtyXZ8h/);
  assert.match(plan, /Compatible database preparation[\s\S]*accepted in production/i);
  assert.match(plan, /RLS remains\s+off[\s\S]*predecessor runtime table CRUD remains available/i);
  assert.match(plan, /did not enable or FORCE RLS/);
  assert.match(plan, /all four canonical aliases/);
  assert.match(plan, /`\/api\/health` returned HTTP 200/);
  assert.match(plan, /immediate predecessor deployment[\s\S]*remains `READY`/);
  assert.match(plan, /engine-attested[\s\S]*repeatable-read\/read-only transactions/);
  assert.match(plan, /all four[\s\S]*runtime CRUD privileges retained/);
  assert.match(plan, /changed no production state/);
  assert.match(plan, /three audited `SellerPayoutEvent` application\s+consumers/);
});

test("SellerPayoutEvent app conversion pins notification retry and projection semantics", () => {
  assert.match(plan, /`inserted`, `updated`, `legacy_converged` and `already_applied`/);
  assert.match(plan, /`already_applied` retries notification/);
  assert.match(plan, /strict helper which reports\s+and rethrows/);
  assert.match(plan, /existing best-effort callers remain unchanged/);
  assert.match(plan, /`stale_ignored` emits no notification/);
  assert.match(plan, /identifier-free warning telemetry/);
  assert.match(plan, /database-clamped 500-row keyset projection/);
  assert.match(plan, /No source file under `src\/` retains direct[\s\S]*`prisma\.sellerPayoutEvent`/);
});

test("SellerPayoutEvent app conversion preserves separate rollout gates", () => {
  assert.match(plan, /engine-read-only inspection `31923608819`/);
  assert.doesNotMatch(plan, /Apply and prove only the compatible migration/);
  assert.match(plan, /linked-seller signed test-mode production proof/);
  assert.match(plan, /remove only those exact application fixture rows/);
  assert.match(plan, /Drain predecessors/);
  assert.match(plan, /policyless RLS/);
  assert.match(plan, /posture-only FORCE/);
  assert.match(plan, /remain[\s\S]*separate domain-first releases/);
});
