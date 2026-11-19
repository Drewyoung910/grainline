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

test("CI isolates Listing for the historical Order release chain and restores it", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const isolate = workflow.indexOf(
    "Temporarily isolate Listing domain from historical Order release guards",
  );
  const verify = workflow.indexOf(
    "Verify compatible Order checkout receipt authority release",
  );
  const participantDetail = workflow.indexOf(
    "Verify compatible Order participant detail projection release",
  );
  const zeroDirect = workflow.indexOf(
    "Prove exact zero-direct release catalog with the native PostgreSQL driver",
  );
  const zeroDirectStructure = workflow.indexOf(
    "Prove zero-direct schema and role drift rejection with exact rollback",
  );
  const correctionPackage = workflow.indexOf(
    "Prove correction release ledger and body restart states",
  );
  const participantAuthority = workflow.indexOf(
    "Prove compatible Order participant authority",
  );
  const historicalGrantBoundary = workflow.indexOf(
    "Admit re-applied User helper during historical grant audits",
  );
  const restore = workflow.indexOf(
    "Restore Listing domain after historical Order release guards",
  );
  const currentTreeTypecheck = workflow.indexOf(
    "      - run: npx tsc --noEmit",
  );
  assert.ok(isolate >= 0 && isolate < verify);
  assert.ok(verify < participantDetail && participantDetail < restore);
  assert.ok(
    participantDetail < zeroDirect
      && zeroDirect < zeroDirectStructure
      && zeroDirectStructure < correctionPackage
      && correctionPackage < participantAuthority
      && participantAuthority < historicalGrantBoundary
      && historicalGrantBoundary < restore,
  );
  assert.ok(restore < currentTreeTypecheck);
  const isolatedBlock = workflow.slice(isolate, restore);
  assert.match(
    isolatedBlock,
    /listing-domain[\s\S]*mv[\s\S]*prisma\/migrations\/\$preparation/u,
  );
  assert.match(isolatedBlock, /LISTING_DOMAIN_PREPARATION_MIGRATION_PATH=/u);
  const restoredBlock = workflow.slice(
    restore,
    currentTreeTypecheck,
  );
  assert.match(
    restoredBlock,
    /listing-domain[\s\S]*mv[\s\S]*prisma\/migrations\/\$preparation/u,
  );
  assert.match(restoredBlock, /LISTING_DOMAIN_PREPARATION_MIGRATION_PATH=/u);

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
