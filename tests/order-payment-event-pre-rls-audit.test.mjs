import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const AUDIT_PATH = "docs/order-payment-event-pre-rls-audit.md";
const audit = fs.readFileSync(AUDIT_PATH, "utf8");

function sourceFiles(root = "src") {
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(filePath);
      else if (/\.(?:mjs|ts|tsx)$/.test(entry.name)) files.push(filePath);
    }
  }
  walk(root);
  return files.sort();
}

function paymentSemanticFiles() {
  const reference =
    /orderPaymentEvent|paymentEvents|OrderPaymentEvent|latestConversionBlockingDisputeLedgerExistsSql/;
  return sourceFiles().filter((file) => reference.test(fs.readFileSync(file, "utf8")));
}

const expectedSemanticFiles = [
  "src/app/account/orders/page.tsx",
  "src/app/account/page.tsx",
  "src/app/admin/orders/[id]/page.tsx",
  "src/app/api/account/export/route.ts",
  "src/app/api/orders/[id]/confirm-delivery/route.ts",
  "src/app/api/orders/[id]/fulfillment/route.ts",
  "src/app/api/orders/[id]/label/route.ts",
  "src/app/api/orders/[id]/refund/route.ts",
  "src/app/api/reviews/route.ts",
  "src/app/api/seller/analytics/recent-sales/route.ts",
  "src/app/api/stripe/webhook/route.ts",
  "src/app/dashboard/orders/[id]/page.tsx",
  "src/app/dashboard/orders/page.tsx",
  "src/app/dashboard/sales/[orderId]/page.tsx",
  "src/app/dashboard/sales/page.tsx",
  "src/components/ReviewsSection.tsx",
  "src/lib/ban.ts",
  "src/lib/homepageStats.ts",
  "src/lib/listingSoftDelete.ts",
  "src/lib/localRefundEvidence.ts",
  "src/lib/localRefundEvidenceCore.ts",
  "src/lib/orderPaymentEventLabels.ts",
  "src/lib/quality-score.ts",
  "src/lib/refundLedgerSql.ts",
  "src/lib/refundRouteState.ts",
  "src/lib/site-metrics-snapshot.ts",
].sort();

describe("OrderPaymentEvent pre-RLS domain audit", () => {
  it("pins every current semantic source reference", () => {
    assert.equal(expectedSemanticFiles.length, 26);
    assert.deepEqual(paymentSemanticFiles(), expectedSemanticFiles);
    for (const file of expectedSemanticFiles) {
      assert.match(audit, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("keeps the service ledger policyless and separately released", () => {
    assert.match(audit, /policyless service ledger under `ENABLE` then `FORCE` RLS/);
    assert.match(audit, /zero\s+direct runtime\/PUBLIC table or column privileges/);
    assert.match(audit, /Keep `OrderShippingRateQuote`, `Order` and `OrderItem` separate/);
    assert.match(audit, /contains no policy, function,\s+migration, grant, deployment, provider or production-state change/);
  });

  it("records the payment-domain blockers rather than only RLS mechanics", () => {
    assert.match(audit, /account export crosses the participant privacy boundary/i);
    assert.match(audit, /local provider side effects have an ABA claim gap/i);
    assert.match(audit, /generic duplicate skipping is not replay validation/i);
    assert.match(audit, /dispute current-state logic is inconsistent/i);
    assert.match(audit, /append-only and shape invariants are not database-enforced/i);
    assert.match(audit, /seller self-service partial refund is disabled/);
  });

  it("pins the compatible release and proof boundaries", () => {
    assert.match(audit, /fresh aggregate-only production inspection/);
    assert.match(audit, /separate owner and restricted runtime roles/);
    assert.match(audit, /signed Stripe refund\/dispute/);
    assert.match(audit, /predecessor\s+deployment drain/);
    assert.match(audit, /posture-only FORCE separately/);
    assert.match(audit, /Provider proof is required for this table/);
  });
});
