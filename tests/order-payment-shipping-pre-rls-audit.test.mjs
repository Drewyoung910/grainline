import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const AUDIT_PATH = "docs/order-payment-shipping-pre-rls-audit.md";
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

function directAccessFiles(delegate, table) {
  const access = new RegExp(
    `\\b(?:prisma|tx|client)\\.${delegate}\\b|`
      + `(?:FROM|JOIN|UPDATE|INTO|TABLE|DELETE\\s+FROM)\\s+`
      + `(?:public\\.)?[\\"\u0060]${table}[\\"\u0060]`,
    "i",
  );
  return sourceFiles().filter((file) => access.test(fs.readFileSync(file, "utf8")));
}

const expected = {
  Order: [
    "src/app/account/orders/page.tsx",
    "src/app/account/page.tsx",
    "src/app/admin/actions.ts",
    "src/app/admin/cases/[id]/page.tsx",
    "src/app/admin/flagged/page.tsx",
    "src/app/admin/orders/[id]/page.tsx",
    "src/app/admin/orders/page.tsx",
    "src/app/admin/verification/page.tsx",
    "src/app/api/account/export/route.ts",
    "src/app/api/dev/make-order/route.ts",
    "src/app/api/orders/[id]/confirm-delivery/route.ts",
    "src/app/api/orders/[id]/fulfillment/route.ts",
    "src/app/api/orders/[id]/label/route.ts",
    "src/app/api/orders/[id]/refund/route.ts",
    "src/app/api/seller/analytics/recent-sales/route.ts",
    "src/app/api/seller/analytics/route.ts",
    "src/app/api/stripe/webhook/route.ts",
    "src/app/api/users/[id]/report/route.ts",
    "src/app/api/verification/apply/route.ts",
    "src/app/checkout/success/page.tsx",
    "src/app/dashboard/orders/[id]/page.tsx",
    "src/app/dashboard/orders/page.tsx",
    "src/app/dashboard/sales/[orderId]/page.tsx",
    "src/app/dashboard/sales/page.tsx",
    "src/app/dashboard/verification/page.tsx",
    "src/lib/accountDeletion.ts",
    "src/lib/audit.ts",
    "src/lib/ban.ts",
    "src/lib/caseLifecycleLocks.ts",
    "src/lib/checkoutStockRestore.ts",
    "src/lib/homepageStats.ts",
    "src/lib/labelClawbackRetry.ts",
    "src/lib/listingSoftDelete.ts",
    "src/lib/metrics.ts",
    "src/lib/publicSellerStats.ts",
    "src/lib/quality-score.ts",
    "src/lib/refundLocks.ts",
    "src/lib/site-metrics-snapshot.ts",
  ],
  OrderItem: [
    "src/app/admin/verification/page.tsx",
    "src/app/api/reviews/route.ts",
    "src/app/api/seller/analytics/route.ts",
    "src/app/api/stripe/webhook/route.ts",
    "src/app/api/verification/apply/route.ts",
    "src/app/dashboard/verification/page.tsx",
    "src/components/ReviewsSection.tsx",
    "src/lib/accountDeletion.ts",
    "src/lib/metrics.ts",
    "src/lib/publicSellerStats.ts",
    "src/lib/quality-score.ts",
    "src/lib/site-metrics-snapshot.ts",
  ],
  OrderShippingRateQuote: [
    "src/app/api/orders/[id]/label/route.ts",
    "src/lib/accountDeletion.ts",
  ],
  OrderPaymentEvent: [
    "src/app/api/orders/[id]/label/route.ts",
    "src/app/api/orders/[id]/refund/route.ts",
    "src/app/api/stripe/webhook/route.ts",
    "src/lib/localRefundEvidence.ts",
    "src/lib/quality-score.ts",
    "src/lib/refundLedgerSql.ts",
    "src/lib/site-metrics-snapshot.ts",
  ],
  SellerPayoutEvent: [
    "src/app/api/account/export/route.ts",
    "src/app/api/stripe/webhook/route.ts",
    "src/app/dashboard/seller/page.tsx",
  ],
  CheckoutStockReservation: [
    "src/app/api/account/export/route.ts",
    "src/app/api/cart/checkout/resume/route.ts",
    "src/lib/accountDeletion.ts",
    "src/lib/checkoutStockRestore.ts",
  ],
};

const delegateByModel = {
  Order: "order",
  OrderItem: "orderItem",
  OrderShippingRateQuote: "orderShippingRateQuote",
  OrderPaymentEvent: "orderPaymentEvent",
  SellerPayoutEvent: "sellerPayoutEvent",
  CheckoutStockReservation: "checkoutStockReservation",
};

describe("order/payment/shipping pre-RLS audit", () => {
  it("pins every current direct source access file", () => {
    for (const [model, files] of Object.entries(expected)) {
      assert.deepEqual(directAccessFiles(delegateByModel[model], model), files, model);
    }
  });

  it("records the exact baseline counts and isolated scope", () => {
    for (const [model, files] of Object.entries(expected)) {
      assert.match(
        audit,
        new RegExp("\\\\| `" + model + "` \\\\| " + files.length + " \\\\|"),
      );
    }
    assert.match(audit, /StripeWebhookEvent` is a required service-ledger prerequisite/);
    assert.match(audit, /Do not silently bundle `Cart`\/`CartItem`/);
    assert.match(audit, /contains no migration, RLS policy, function,\s+grant change, deployment or production mutation/i);
  });

  it("keeps the target policyless and source-validating", () => {
    const strategy = fs.readFileSync("STRATEGY.md", "utf8");
    assert.match(audit, /policyless `ENABLE` plus `FORCE` RLS with zero\s+direct runtime\/PUBLIC table or column grants/);
    assert.match(audit, /derive seller, buyer,\s+target row, provider identity, clocks, replay identity and state transitions/);
    assert.match(audit, /RLS removes arbitrary table CRUD[\s\S]*does not independently authenticate/);
    assert.match(strategy, /Case FORCE completion and Order\/payment\/shipping start/);
    assert.match(strategy, /StripeWebhookEvent` isolation is a\s+hard service-ledger prerequisite/);
    assert.match(strategy, /Finish the complete group before\s+moving to the next sensitive-data family/);
  });

  it("pins the durable seller, snapshot, legacy and lock prerequisites", () => {
    assert.match(audit, /Neither `Order` nor `OrderItem` stores a durable seller/);
    assert.match(audit, /primary scale bottleneck/);
    assert.match(audit, /historical item rendering and authority still use live Listings/);
    assert.match(audit, /positive `OrderItem\.quantity`/);
    assert.match(audit, /aggregate-only production inspector/);
    assert.match(audit, /shared Order lock coverage must be completed/);
    assert.match(audit, /cart UI can prepare several Stripe sessions[\s\S]*do not authorize a multi-seller `Order`/);
    assert.match(audit, /nullable `sellerProfileId` on both `Order` and\s+`OrderItem`/);
    assert.match(audit, /\(OrderItem\.orderId, OrderItem\.sellerProfileId\)[\s\S]*\(Listing\.id, Listing\.sellerId\)/);
  });

  it("keeps provider authentication and state-table semantics honest", () => {
    assert.match(audit, /PostgreSQL cannot authenticate a Stripe signature by itself/);
    assert.match(audit, /application-held Stripe secrets authenticate the\s+provider/);
    assert.match(audit, /`OrderPaymentEvent` is append-only/);
    assert.match(audit, /`StripeWebhookEvent` is a mutable processing lease\/state row/);
    assert.match(audit, /`SellerPayoutEvent` is a mutable latest-state row/);
    assert.match(audit, /durable claim derived under the shared Order lock/);
    assert.match(audit, /success\/ambiguous\/failure finalizer/);
  });

  it("classifies the first complete write-authority families", () => {
    for (const source of [
      "src/lib/stripeWebhookEvents.ts",
      "src/app/api/stripe/webhook/route.ts",
      "src/app/api/orders/[id]/refund/route.ts",
      "src/app/api/orders/[id]/fulfillment/route.ts",
      "src/app/api/orders/[id]/confirm-delivery/route.ts",
      "src/app/api/orders/[id]/label/route.ts",
      "src/lib/labelClawbackRetry.ts",
      "src/lib/checkoutStockRestore.ts",
      "src/lib/accountDeletion.ts",
      "src/app/admin/actions.ts",
    ]) {
      assert.match(audit, new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("confirms broad runtime CRUD is still the predecessor", () => {
    const grants = fs.readFileSync("scripts/provision-runtime-db-role.sql", "utf8");
    for (const model of Object.keys(expected)) {
      assert.match(
        grants,
        new RegExp(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE[\\s\\S]*public\\.\\"${model}\\"`),
        model,
      );
    }
  });
});
