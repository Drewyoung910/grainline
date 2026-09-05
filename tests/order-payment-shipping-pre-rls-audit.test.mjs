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

function authorityAccessFiles(delegate, table) {
  const access = new RegExp(
    `\\b(?:prisma|tx|client)\\.${delegate}\\b|`
      + `(?:FROM|JOIN|UPDATE|INTO|TABLE|DELETE\\s+FROM)\\s+`
      + `(?:public\\.)?[\\"\u0060]${table}[\\"\u0060]`
      + (table === "OrderPaymentEvent"
        ? "|latestConversionBlockingDisputeLedgerExistsSql"
          + "|record(?:Seller|BlockedCheckout)OrderRefund"
          + "|grainline_(?:seller|blocked_checkout)_refund_record"
        : ""),
    "i",
  );
  return sourceFiles().filter((file) => access.test(fs.readFileSync(file, "utf8")));
}

const expected = {
  Order: [
    "src/app/admin/cases/[id]/page.tsx",
    "src/app/admin/flagged/page.tsx",
    "src/app/admin/orders/[id]/page.tsx",
    "src/app/admin/orders/page.tsx",
    "src/app/api/stripe/webhook/route.ts",
    "src/lib/accountDeletion.ts",
  ],
  OrderItem: [
    "src/app/api/stripe/webhook/route.ts",
    "src/components/ReviewsSection.tsx",
    "src/lib/accountDeletion.ts",
  ],
  OrderShippingRateQuote: [
    "src/lib/accountDeletion.ts",
  ],
  OrderPaymentEvent: [
    "src/lib/orderRefundFinalization.ts",
    "src/lib/orderRefundRecordAuthority.ts",
  ],
  SellerPayoutEvent: [],
  CheckoutStockReservation: [],
};

const baselineCounts = {
  Order: 31,
  OrderItem: 6,
  OrderShippingRateQuote: 2,
  OrderPaymentEvent: 2,
  SellerPayoutEvent: 3,
  CheckoutStockReservation: 4,
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
  it("pins every current direct or authority-helper source access file", () => {
    for (const [model, files] of Object.entries(expected)) {
      assert.deepEqual(authorityAccessFiles(delegateByModel[model], model), files, model);
    }
  });

  it("records the exact baseline counts and isolated scope", () => {
    for (const [model, count] of Object.entries(baselineCounts)) {
      assert.match(
        audit,
        new RegExp("\\\\| `" + model + "` \\\\| " + count + " \\\\|"),
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
    assert.match(audit, /Stripe webhook lease has an ABA finalizer race/);
    assert.match(audit, /database-derived monotonic claim generation/);
    assert.match(audit, /duplicate event ID with another type is an error/);
    assert.match(audit, /processed-row retention, aggregate ops health, and the synthetic/);
    assert.match(audit, /20260805040000_prepare_stripe_webhook_maintenance_authority/);
    assert.match(audit, /catalog operations 34 through 36/);
    assert.match(audit, /remains unmerged, undeployed and unapplied/);
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

  it("assigns every direct source file to a conversion family", () => {
    const documentedSources = new Set(
      [...audit.matchAll(/`(src\/[A-Za-z0-9_./\[\]-]+)`/g)]
        .map((match) => match[1]),
    );
    for (const files of Object.values(expected)) {
      for (const file of files) {
        assert.equal(documentedSources.has(file), true, file);
      }
    }
    assert.match(audit, /former development-only synthetic creator is retired/);
    assert.match(audit, /does not justify\s+a runtime Order-create function or direct `INSERT`/);
    assert.match(audit, /do not justify restoring runtime\s+base-table SELECT/);
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

  it("records the corrected clean production inspection without widening authority", () => {
    assert.match(audit, /8f22ebe326fa67bc3b71b8998b2f6b440ad7f69b/);
    assert.match(audit, /GitHub Actions run\s+`30963859119`/);
    assert.match(audit, /exact-main CI run `30963597414` passed/);
    assert.match(audit, /Artifact `8913958032`/);
    assert.match(audit, /b469b7d23054194ac48fd9f57ee7ec7789105401c58e3952a6c2990270b4104a/);
    assert.match(audit, /Every structural and integrity inconsistency count was zero/);
    assert.match(audit, /closes the OPS-A10 legacy-data classification gate/);
    assert.match(audit, /does not authorize cleanup, deployment, fixed\s+operation grants, RLS activation, FORCE, provider changes/);
  });

  it("records label privacy redaction before any repair decision", () => {
    assert.match(audit, /32784976638/);
    assert.match(audit, /32785532138/);
    assert.match(audit, /a4c7d40ac292d1fa4c8e43ad95b47630ac40be9ef7b5553f56e0523894cd0bff/);
    assert.match(audit, /Exactly one PURCHASED row lacks both its Shippo\s+transaction reference and label URL/);
    assert.match(audit, /Account deletion intentionally clears those two fields/);
    assert.match(audit, /isolated 78-field\s+successor/);
    assert.match(audit, /does not enumerate the row\s+or authorize restoration/);
  });
});
