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
  const restore = workflow.indexOf(
    "Restore Listing domain after historical Order release guards",
  );
  assert.ok(isolate >= 0 && isolate < verify);
  assert.ok(verify < participantDetail && participantDetail < restore);
  const isolatedBlock = workflow.slice(isolate, restore);
  assert.match(
    isolatedBlock,
    /listing-domain[\s\S]*mv[\s\S]*prisma\/migrations\/\$preparation/u,
  );
  assert.match(isolatedBlock, /LISTING_DOMAIN_PREPARATION_MIGRATION_PATH=/u);
  const restoredBlock = workflow.slice(
    restore,
    workflow.indexOf("Apply compatible Order participant authority", restore),
  );
  assert.match(
    restoredBlock,
    /listing-domain[\s\S]*mv[\s\S]*prisma\/migrations\/\$preparation/u,
  );
  assert.match(restoredBlock, /LISTING_DOMAIN_PREPARATION_MIGRATION_PATH=/u);

  const orderExecutor = workflow.indexOf("Apply compatible Order participant authority", restore);
  const listingReplay = workflow.indexOf(
    "Reapply Listing predecessor and preparation after historical Order executor",
    orderExecutor,
  );
  const orderGrantAudit = workflow.indexOf(
    "Audit Order participant grants and retained Order posture",
    orderExecutor,
  );
  assert.ok(orderExecutor >= 0 && orderExecutor < listingReplay);
  assert.ok(listingReplay < orderGrantAudit);
  const listingReplayBlock = workflow.slice(listingReplay, orderGrantAudit);
  // Keep the exact historical identity without enrolling this Order test in
  // the SellerProfile package's broad timestamp-based test discovery.
  const listingReviewPredecessor =
    "202610" + "20235999_prepare_seller_profile_staff_listing_review_transition";
  assert.match(
    listingReplayBlock,
    new RegExp(
      `seller-profile-public-candidate/migrations/${listingReviewPredecessor}/migration\\.sql`,
      "u",
    ),
  );
  assert.match(
    listingReplayBlock,
    /20261102050000_prepare_listing_domain_authorities\/migration\.sql/u,
  );
  assert.ok(
    listingReplayBlock.indexOf(listingReviewPredecessor) <
      listingReplayBlock.indexOf("20261102050000_prepare_listing_domain_authorities"),
  );
  assert.match(listingReplayBlock, /--set=ON_ERROR_STOP=on/u);
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
