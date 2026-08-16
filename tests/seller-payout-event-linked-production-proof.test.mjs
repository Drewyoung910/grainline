import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const plan = readFileSync(
  "docs/seller-payout-event-linked-production-proof.md",
  "utf8",
);
const audit = readFileSync("docs/seller-payout-event-pre-rls-audit.md", "utf8");
const matrix = readFileSync("docs/rls-coverage-matrix.md", "utf8");

test("linked payout proof keeps its production boundary explicit", () => {
  assert.match(plan, /reviewed operator ready but not executed/i);
  assert.match(plan, /e9239463a71860451191344b26dd20b45298f239/);
  assert.match(plan, /31927548800/);
  assert.match(plan, /dpl_7PRTnXtMrMNq83ZFPJNeqFtyXZ8h/);
  assert.match(plan, /Nothing in this document[\s\S]*authorizes a provider mutation/);
  assert.match(plan, /RLS activation or grant change/);
  assert.match(plan, /test-mode/);
  assert.match(plan, /no customer order, payment, refund or live-mode Stripe object/);
  assert.match(plan, /must still treat every existing seller\s+as non-disposable/);
  assert.match(plan, /never changes the seller[\s\S]*account\s+configuration/i);
  assert.match(plan, /default USD external[\s\S]*test bank ending `1116`/);
  assert.match(plan, /stops before creating[\s\S]*charge or payout/);
  assert.match(plan, /test-mode\s+balance\/history entries/);
});

test("linked payout proof binds source, projection, notification and exact retry", () => {
  assert.match(plan, /exactly one source-bound `PAYOUT_FAILED` notification/);
  assert.match(plan, /fixed latest projection/);
  assert.match(plan, /lease generation and update time[\s\S]*remain unchanged/);
  assert.match(plan, /payout row identity[\s\S]*notification identity and dedup key/);
  assert.match(plan, /processed `StripeWebhookEvent` lease remains/);
});

test("linked payout proof cleanup cannot become broad application cleanup", () => {
  assert.match(plan, /delete only that notification and payout row, in that order/);
  assert.match(plan, /Never delete or[\s\S]*rewrite the seller, webhook lease or any unrelated notification/);
  assert.match(plan, /Roll back\s+on any count other than exactly one/);
  assert.match(plan, /mode-0600 local recovery record/);
  assert.match(plan, /may not create a second payout/);
});

test("linked payout proof is the documented pre-activation successor", () => {
  assert.match(audit, /existing canonical test endpoint[\s\S]*already-linked eligible test seller/);
  assert.match(audit, /linked-seller signed test-mode production proof/);
  assert.match(matrix, /seller-payout-event-linked-production-proof\.md/);
  assert.match(plan, /policyless[\s\S]*ENABLE[\s\S]*FORCE remain separate releases/);
});
