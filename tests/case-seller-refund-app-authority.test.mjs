import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const route = fs.readFileSync(
  "src/app/api/orders/[id]/refund/route.ts",
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
  assert.match(
    route,
    /FROM public\.grainline_case_seller_refund_apply\(\s*\$\{me\.id\}::text,\s*\$\{paymentEvent\.id\}::text\s*\)/s,
  );
  assert.match(route, /SELLER_REFUND_PAYMENT_EVENT_SOURCE_MISMATCH/);
  assert.match(route, /SELLER_REFUND_CASE_AUTHORITY_RESULT_INVALID/);
});

test("seller refund finalization preserves User then Order then Case lock order", () => {
  const finalization = route.slice(
    route.indexOf("const refundWrite = await prisma.$transaction"),
  );
  orderedIndex(finalization, [
    "await lockUserForCaseLifecycle(tx, me.id)",
    "const orderUpdate = await tx.order.updateMany",
    "await recordLocalRefundEvidence(tx, {",
    "const paymentEvent = await tx.orderPaymentEvent.findUnique",
    "FROM public.grainline_case_seller_refund_apply(",
  ]);
});

test("seller refund validates the complete database-derived relationship", () => {
  for (const contract of [
    /caseResults\.length !== 1/,
    /caseResult\.orderId !== orderId/,
    /caseResult\.sellerUserId !== me\.id/,
    /caseResult\.buyerUserId !== order\.buyerId/,
    /caseResult\.paymentEventId !== paymentEvent\.id/,
    /caseResult\?\.action === "resolve"/,
    /caseResult\?\.action === "terminal"/,
    /caseResult\?\.action === "no_case"/,
    /caseResult\?\.action === "replay"/,
    /caseResult\?\.action === "no_case"\s*\?\s*caseResult\.caseId === null/s,
  ]) {
    assert.match(route, contract);
  }
});

test("terminal Case disposition retains the existing reconciliation warning", () => {
  assert.match(route, /if \(caseResult\.action === "terminal"\)/);
  assert.match(
    route,
    /Case auto-resolution did not update because case state changed; staff must reconcile the case manually\./,
  );
  assert.match(route, /seller_refund_orphaned_after_stripe/);
  assert.match(route, /orphanRecovery: true/);
});
