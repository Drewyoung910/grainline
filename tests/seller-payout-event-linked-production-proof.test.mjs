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
  assert.match(plan, /Status: accepted/);
  assert.match(plan, /854233e3b8729da60c0da46ff8af492e53e48438/);
  assert.match(plan, /32552336641/);
  assert.match(plan, /8ff3c342bdc47ea5b8ebe9576c7a4de1253afa36e1a0a40798c0516cc55c3907/);
  assert.match(
    plan,
    /failed closed\s+before any Stripe or database mutation because no\s+existing linked test seller/i,
  );
  assert.match(plan, /authenticated read-only\s+`\/v13\/deployments\/\{id\}` API/);
  assert.match(plan, /requires the exact source\s+commit and every\s+canonical alias/);
  assert.match(plan, /e9239463a71860451191344b26dd20b45298f239/);
  assert.match(plan, /31927548800/);
  assert.match(plan, /dpl_7PRTnXtMrMNq83ZFPJNeqFtyXZ8h/);
  assert.match(plan, /does not authorize those later migrations, grant changes/);
  assert.match(plan, /RLS activation, FORCE, deployment or provider-configuration changes/);
  assert.match(plan, /test-mode/);
  assert.match(plan, /no customer order, payment, refund or live-mode Stripe object/);
  assert.match(plan, /every existing seller remains non-disposable/);
  assert.match(plan, /no longer contains an existing-seller selection path/);
  assert.match(plan, /bank ending `1116`/);
  assert.match(plan, /one\s+exact temporary User\/SellerProfile pair/);
  assert.match(plan, /seller in vacation mode/);
  assert.match(plan, /disposable connected account is deleted/);
});

test("linked payout proof binds source, projection, notification and exact retry", () => {
  assert.match(plan, /exactly one source-bound `PAYOUT_FAILED` notification/);
  assert.match(plan, /fixed latest projection/);
  assert.match(plan, /lease generation and update time[\s\S]*remain unchanged/);
  assert.match(plan, /payout row identity[\s\S]*notification identity and dedup key/);
  assert.match(plan, /processed\s+`StripeWebhookEvent` lease\s+remains/);
});

test("linked payout proof cleanup cannot become broad application cleanup", () => {
  assert.match(plan, /delete only that notification, payout, temporary seller and\s+temporary user/);
  assert.match(plan, /Never delete the webhook lease or any\s+unrelated row/);
  assert.match(plan, /Roll back\s+on\s+any count other than exactly one/);
  assert.match(plan, /mode-0600 provider-canary and database-proof\s+recovery records/);
  assert.match(plan, /may not create a second payout/);
  assert.match(plan, /marker-bound disposable account/);
});

test("linked payout proof is the documented pre-activation successor", () => {
  assert.match(audit, /existing canonical test endpoint[\s\S]*release-bound disposable Express account/);
  assert.match(audit, /never changes an existing seller or provider account/);
  assert.match(audit, /linked-seller signed test-mode production\s+proof/);
  assert.match(matrix, /seller-payout-event-linked-production-proof\.md/);
  assert.match(plan, /policyless[\s\S]*ENABLE[\s\S]*FORCE remain separate releases/);
});
