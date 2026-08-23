import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const audit = readFileSync("docs/seller-payout-event-pre-rls-audit.md", "utf8");
const matrix = readFileSync("docs/rls-coverage-matrix.md", "utf8");
const strategy = readFileSync("STRATEGY.md", "utf8");

test("pins the complete current SellerPayoutEvent source and actor audit", () => {
  for (const source of [
    "src/lib/stripePayoutWebhook.ts",
    "src/app/dashboard/seller/page.tsx",
    "src/app/api/account/export/route.ts",
    "src/app/api/stripe/webhook/connect/route.ts",
    "src/app/api/stripe/webhook/route.ts",
  ]) {
    assert.match(audit, new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(audit, /Operation-by-principal authority matrix/);
  assert.match(audit, /signed-provider write[\s\S]*seller banner[\s\S]*account-export/);
  assert.match(audit, /account deletion intentionally retains/);
});

test("does not bless arrival-order payout mutation", () => {
  assert.match(audit, /provider event ordering is not durable/);
  assert.match(audit, /older provider event cannot overwrite newer/);
  assert.match(audit, /equal-time different event is[\s\S]*rejected/);
  assert.match(audit, /cannot independently authenticate Clerk or a[\s\S]*Stripe signature/);
  assert.match(
    audit,
    /already_applied` writer result[\s\S]*must not[\s\S]*`stale_ignored` or `ignored_unknown_account`/,
  );
});

test("classifies activation gates and deferred product work explicitly", () => {
  for (const findingClass of [
    "FIX_BEFORE_ACTIVATION",
    "DEFERRED_PRODUCT_WORK",
  ]) assert.match(audit, new RegExp(findingClass));
  assert.match(audit, /GO for isolated\s+policyless activation preparation only/);
  assert.match(audit, /NO-GO for production RLS\s+activation/);
  assert.match(audit, /linked-seller signed test-mode/);
  assert.match(audit, /live-mode Stripe proof remains a launch gate/);
  assert.match(audit, /staff payout tooling is intentionally absent/);
});

test("selects a separate bounded table without bundling Order authority", () => {
  assert.match(matrix, /`SellerPayoutEvent` \| `ACTIVATION_RELEASE_MERGED_UNAPPLIED`/);
  assert.match(matrix, /seller-payout-event-pre-rls-audit\.md/);
  assert.match(strategy, /SellerPayoutEvent` is the smallest independent remaining service ledger/);
  assert.match(audit, /OrderPaymentEvent`, `OrderShippingRateQuote`, `Order`, and `OrderItem` remain[\s\S]*separate audited releases/);
});
