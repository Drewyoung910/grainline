import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const AUDIT_PATH = "docs/order-payment-event-pre-rls-audit.md";
const audit = fs.readFileSync(AUDIT_PATH, "utf8");
const invariantInspection = fs.readFileSync(
  "docs/order-payment-event-invariant-inspection.md",
  "utf8",
);

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
    /orderPaymentEvent|paymentEvents|OrderPaymentEvent|blockingRefundLedgerWhere|BLOCKING_REFUND_LEDGER_SQL|latest[A-Za-z]*DisputeLedger[A-Za-z]*Sql/;
  return sourceFiles().filter((file) => reference.test(fs.readFileSync(file, "utf8")));
}

const expectedSemanticFiles = [
  "src/app/account/orders/page.tsx",
  "src/app/account/page.tsx",
  "src/app/admin/orders/[id]/page.tsx",
  "src/app/admin/verification/page.tsx",
  "src/app/api/account/export/route.ts",
  "src/app/api/orders/[id]/confirm-delivery/route.ts",
  "src/app/api/orders/[id]/fulfillment/route.ts",
  "src/app/api/orders/[id]/label/route.ts",
  "src/app/api/orders/[id]/refund/route.ts",
  "src/app/api/reviews/route.ts",
  "src/app/api/seller/analytics/recent-sales/route.ts",
  "src/app/api/seller/analytics/route.ts",
  "src/app/api/stripe/webhook/route.ts",
  "src/app/api/verification/apply/route.ts",
  "src/app/dashboard/orders/[id]/page.tsx",
  "src/app/dashboard/orders/page.tsx",
  "src/app/dashboard/sales/[orderId]/page.tsx",
  "src/app/dashboard/sales/page.tsx",
  "src/app/dashboard/verification/page.tsx",
  "src/components/ReviewsSection.tsx",
  "src/lib/ban.ts",
  "src/lib/homepageStats.ts",
  "src/lib/listingSoftDelete.ts",
  "src/lib/localRefundEvidence.ts",
  "src/lib/localRefundEvidenceCore.ts",
  "src/lib/metrics.ts",
  "src/lib/orderPaymentEventLabels.ts",
  "src/lib/orderPaymentEventReadAuthority.ts",
  "src/lib/publicSellerStats.ts",
  "src/lib/quality-score.ts",
  "src/lib/refundLedgerSql.ts",
  "src/lib/refundRouteState.ts",
  "src/lib/site-metrics-snapshot.ts",
].sort();

describe("OrderPaymentEvent pre-RLS domain audit", () => {
  it("pins every current semantic source reference", () => {
    assert.equal(expectedSemanticFiles.length, 33);
    assert.deepEqual(paymentSemanticFiles(), expectedSemanticFiles);
    for (const file of expectedSemanticFiles) {
      assert.match(audit, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("keeps the service ledger policyless and separately released", () => {
    assert.match(audit, /policyless service ledger under `ENABLE` then `FORCE` RLS/);
    assert.match(audit, /zero\s+direct runtime\/PUBLIC table or column privileges/);
    assert.match(audit, /Keep `OrderShippingRateQuote`, `Order` and `OrderItem` separate/);
    assert.match(
      audit,
      /Exact main[\s\S]*is live as deployment[\s\S]*staff Case full-refund provider and\s+replay proof is accepted[\s\S]*`OrderPaymentEvent` RLS remains off/,
    );
    assert.match(audit, /4b2d4693ac03db773b766ca4c4c53c072ac0fdbe/);
    assert.match(audit, /dpl_2WkGbkiDdD8ySQYnCTur7ND3n2kd/);
    assert.match(audit, /e55993b6e76f11a8aa48b0d5aefde588695944436ec7c5474655e1a43d8f18fb/);
    assert.match(audit, /Live provider\/replay proof remains required/);
  });

  it("records the payment-domain blockers rather than only RLS mechanics", () => {
    assert.match(audit, /account export crosses the participant privacy boundary/i);
    assert.match(audit, /local provider side effects have an ABA claim gap/i);
    assert.match(audit, /generic duplicate skipping is not replay validation/i);
    assert.match(audit, /dispute current-state logic is inconsistent/i);
    assert.match(audit, /append-only and shape invariants are not database-enforced/i);
    assert.match(audit, /seller self-service partial refund is disabled/);
    assert.match(audit, /semantic inventory omitted six aggregate consumers/i);
  });

  it("pins the compatible release and proof boundaries", () => {
    assert.match(audit, /fresh aggregate-only production inspection/);
    assert.match(audit, /separate owner and restricted runtime roles/);
    assert.match(audit, /signed Stripe refund\/dispute/);
    assert.match(audit, /predecessor\s+deployment drain/);
    assert.match(audit, /posture-only FORCE separately/);
    assert.match(audit, /Provider proof is required for this table/);
  });

  it("records the additive inspection boundary without rewriting history", () => {
    assert.match(invariantInspection, /exactly 66 aggregate fields/);
    assert.match(invariantInspection, /extends the same single aggregate `SELECT` to exactly 76 fields/);
    assert.match(invariantInspection, /prior 54-count evidence remains historically accurate/);
    assert.match(
      invariantInspection,
      /counts and retain\s+no row, Order, user, provider-object or event identity/,
    );
    assert.match(invariantInspection, /not permission to delete, rewrite\s+or weaken a constraint/);
    assert.match(invariantInspection, /does not:[\s\S]*change `OrderPaymentEvent` grants or RLS/);
    assert.match(invariantInspection, /label_state_coherence_count = 1/);
    assert.match(invariantInspection, /does not block the separately empty\s+OrderPaymentEvent invariant design/);
    assert.match(invariantInspection, /32784976638/);
    assert.match(invariantInspection, /32785532138/);
    assert.match(invariantInspection, /a4c7d40ac292d1fa4c8e43ad95b47630ac40be9ef7b5553f56e0523894cd0bff/);
    assert.match(invariantInspection, /exact\s+76-field query/);
    assert.match(invariantInspection, /isolated 78-field successor/);
    assert.match(invariantInspection, /account deletion intentionally produces that\s+shape/);
    assert.match(invariantInspection, /privacy-redacted missing references/);
  });
});
