import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ORDER_CHECKOUT_RECEIPT_AUTHORITY_PHASE,
  verifyOrderCheckoutReceiptAuthorityRelease,
} from "../scripts/verify-order-checkout-receipt-authority-release.mjs";
import {
  verifyOrderCheckoutReceiptAuthorityMigrationBytes,
} from "../scripts/order-participant-list-authority-catalog.mjs";

test("Order checkout receipt authority is one exact compatible successor pair", () => {
  const result = verifyOrderCheckoutReceiptAuthorityRelease();
  assert.equal(result.phase, ORDER_CHECKOUT_RECEIPT_AUTHORITY_PHASE);
  assert.equal(result.functionCount, 3);
  assert.equal(result.convertedOrderSourceCount, 1);
  assert.equal(result.directOrderSourceCount, 21);
  assert.equal(result.rlsChanged, false);
  assert.equal(result.runtimeTablePrivilegesChanged, false);
  assert.equal(result.rowDataChanged, false);
  assert.equal(result.productionTouched, false);
});

test("Order checkout receipt authority fails closed on migration byte drift", () => {
  const root = mkdtempSync(path.join(tmpdir(), "grainline-order-receipt-release-"));
  try {
    cpSync("prisma/migrations", path.join(root, "prisma/migrations"), { recursive: true });
    mkdirSync(path.join(root, "src/app/checkout/success"), { recursive: true });
    cpSync("src/app/checkout/success/page.tsx", path.join(root, "src/app/checkout/success/page.tsx"), {
      recursive: false,
    });
    const migrationPath = path.join(
      root,
      "prisma/migrations/20260901110000_prepare_order_checkout_receipt_authority/migration.sql",
    );
    writeFileSync(migrationPath, `${readFileSync(migrationPath, "utf8")}\n-- drift\n`);
    assert.throws(
      () => verifyOrderCheckoutReceiptAuthorityMigrationBytes(root),
      /migration bytes drifted/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
