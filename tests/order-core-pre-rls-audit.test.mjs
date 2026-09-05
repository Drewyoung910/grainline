import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const audit = fs.readFileSync("docs/order-core-pre-rls-audit.md", "utf8");

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

function orderAccessFiles() {
  const access = /\b(?:prisma|tx|client)\.order\b|(?:FROM|JOIN|UPDATE|INTO|TABLE|DELETE\s+FROM)\s+(?:public\.)?["`]Order["`]/i;
  return sourceFiles().filter((file) => access.test(fs.readFileSync(file, "utf8")));
}

const expectedOrderAccessFiles = [
  "src/app/admin/actions.ts",
  "src/app/admin/cases/[id]/page.tsx",
  "src/app/admin/flagged/page.tsx",
  "src/app/admin/orders/[id]/page.tsx",
  "src/app/admin/orders/[id]/refundReconciliationActions.ts",
  "src/app/admin/orders/page.tsx",
  "src/app/admin/verification/page.tsx",
  "src/app/api/stripe/webhook/route.ts",
  "src/lib/accountDeletion.ts",
  "src/lib/audit.ts",
  "src/lib/ban.ts",
  "src/lib/caseLifecycleLocks.ts",
  "src/lib/checkoutStockRestore.ts",
];

describe("core Order pre-RLS audit", () => {
  it("pins every current direct Order source access", () => {
    assert.equal(expectedOrderAccessFiles.length, 13);
    assert.deepEqual(orderAccessFiles(), expectedOrderAccessFiles);
    for (const file of expectedOrderAccessFiles) {
      assert.equal(audit.includes(`\`${file}\``), true, file);
    }
  });

  it("selects Order without silently bundling its successors", () => {
    assert.match(audit, /`Order` is the next RLS table/);
    assert.match(audit, /activated separately from\s+`OrderItem` and `OrderShippingRateQuote`/);
    assert.match(audit, /convert and protect `Order`[\s\S]*convert and protect `OrderItem`[\s\S]*convert and protect `OrderShippingRateQuote`/);
    assert.match(audit, /contains no migration, policy, fixed-function implementation, grant change,\s+deployment or production mutation/);
  });

  it("keeps the mixed-column target policyless and projection-based", () => {
    assert.match(audit, /policyless `ENABLE` followed by `FORCE` RLS/);
    assert.match(audit, /zero\s+direct ordinary-runtime\/PUBLIC table or column authority/);
    assert.match(audit, /broad buyer\/seller `SELECT` policy is rejected/);
    assert.match(audit, /separate buyer-list\/detail,\s+seller-list\/detail, staff-list\/detail, export, aggregate and maintenance\s+operations/);
  });

  it("records the fresh authority and historical-data findings", () => {
    assert.match(audit, /durable seller key is live, but consumers still bypass it/);
    assert.match(audit, /historical rendering still prefers live Listing data/);
    assert.match(audit, /fetches an Order by ID and then compares `buyerId`/);
    assert.match(audit, /account export crosses the shipping-quote boundary/);
    assert.match(audit, /development Order creator is retired/);
    assert.match(audit, /without a Stripe Checkout Session, PaymentIntent, Charge, payment-event/);
    assert.match(audit, /nullable seller keys are not the final invariant/);
  });

  it("pins the compatibility and activation gates", () => {
    assert.match(audit, /strict snapshot parsing plus buyer\/seller list\/detail\/count projections/);
    assert.match(audit, /family-specific source-validating functions/);
    assert.match(audit, /exact direct-access inventory reaches zero/);
    assert.match(audit, /compatible app is deployed and predecessor overlap is drained/);
    assert.match(audit, /Phase A and FORCE remain distinct production releases/);
  });

  it("records current foundations without overstating provider trust", () => {
    assert.match(audit, /composite foreign keys bind an item to both the same Order seller/);
    assert.match(audit, /payment\/refund\/dispute service ledgers required by this table are already\s+policyless ENABLE plus FORCE/);
    assert.match(audit, /RLS removes arbitrary table CRUD but\s+does not independently authenticate Stripe or Shippo/);
  });
});
