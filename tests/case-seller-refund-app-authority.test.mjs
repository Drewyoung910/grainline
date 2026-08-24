import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const route = fs.readFileSync(
  "src/app/api/orders/[id]/refund/route.ts",
  "utf8",
);
const helper = fs.readFileSync(
  "src/lib/orderRefundRecordAuthority.ts",
  "utf8",
);
const migration = fs.readFileSync(
  "prisma/migrations/20260824020000_prepare_order_refund_record_authority/migration.sql",
  "utf8",
);

function orderedIndex(text, needles) {
  let previous = -1;
  for (const needle of needles) {
    const index = text.indexOf(needle);
    assert.ok(index >= 0, `${needle} is missing`);
    assert.ok(index > previous, `${needle} is out of order`);
    previous = index;
  }
}

test("seller refund route uses only the source-bound Case operation", () => {
  assert.doesNotMatch(route, /(?:prisma|tx)\.case\./);
  assert.match(route, /finalizeSellerOrderRefund\(\{/);
  assert.doesNotMatch(route, /grainline_case_seller_refund_apply/);
  assert.match(helper, /grainline_seller_refund_record/);
  assert.match(migration, /FROM public\.grainline_case_seller_refund_apply\(/);
});

test("seller refund finalization preserves User then Order then Case lock order", () => {
  const finalization = migration.slice(
    migration.indexOf("-- Mutable actor posture is required only"),
    migration.indexOf("CREATE FUNCTION public.grainline_blocked_checkout_refund_record"),
  );
  orderedIndex(finalization, [
    'FROM public."User" AS actor',
    'FROM public."SellerProfile" AS seller',
    'FROM public."Order" AS orders',
    'INSERT INTO public."OrderPaymentEvent"',
    "FROM public.grainline_case_seller_refund_apply(",
  ]);
});

test("seller refund validates the complete database-derived relationship", () => {
  for (const contract of [
    /case_result\.action NOT IN \('resolve', 'terminal', 'no_case', 'replay'\)/,
    /case_result\."orderId" IS DISTINCT FROM locked_order\.id/,
    /case_result\."paymentEventId" IS DISTINCT FROM payment_event_id/,
    /locked_order\."sellerProfileId" IS DISTINCT FROM locked_seller\.id/,
    /locked_order\."refundClaimSourceId" IS DISTINCT FROM locked_actor\.id/,
    /existing_event\.metadata - 'restoredActiveListingCount'/,
  ]) {
    assert.match(migration, contract);
  }
});

test("terminal Case disposition retains the existing reconciliation warning", () => {
  assert.match(migration, /IF case_action = 'terminal' THEN/);
  assert.match(
    migration,
    /Case auto-resolution did not update because Case state changed; staff must reconcile it manually\./,
  );
  assert.match(route, /seller_refund_finalize_retry/);
  assert.match(route, /seller_refund_finalize_retry_failed/);
  assert.doesNotMatch(route, /orphanRecovery|recordLocalRefundEvidence/);
});
