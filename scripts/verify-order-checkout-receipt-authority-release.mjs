#!/usr/bin/env node

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { computeMigrationTreeSha256 } from "./guard-saved-search-rls-deploy.mjs";
import {
  ORDER_CHECKOUT_RECEIPT_AUTHORITY_FUNCTIONS,
  ORDER_CHECKOUT_RECEIPT_AUTHORITY_MIGRATION,
  ORDER_CHECKOUT_RECEIPT_AUTHORITY_MIGRATION_TREE_SHA256,
  ORDER_PARTICIPANT_DETAIL_PROJECTION_MIGRATION,
  ORDER_PARTICIPANT_SNAPSHOT_CORRECTION_FUNCTIONS,
  ORDER_PARTICIPANT_SNAPSHOT_CORRECTION_MIGRATION,
  ORDER_PARTICIPANT_SNAPSHOT_CORRECTION_MIGRATION_TREE_SHA256,
  verifyOrderCheckoutReceiptAuthorityMigrationBytes,
  verifyOrderParticipantSnapshotCorrectionMigrationBytes,
} from "./order-participant-list-authority-catalog.mjs";
import { verifyOrderParticipantDetailProjectionRelease } from "./verify-order-participant-detail-projection-release.mjs";

export const ORDER_CHECKOUT_RECEIPT_AUTHORITY_PHASE =
  "order-checkout-receipt-authority-reviewed";

function count(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

function migrationTree(root, throughMigration) {
  const migrationDirectory = path.join(root, "prisma/migrations");
  const migrationNames = readdirSync(migrationDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name <= throughMigration);
  return computeMigrationTreeSha256(migrationDirectory, migrationNames);
}

export function verifyOrderCheckoutReceiptAuthorityRelease(root = process.cwd()) {
  const predecessor = verifyOrderParticipantDetailProjectionRelease(root);
  assert.equal(
    predecessor.migration,
    ORDER_PARTICIPANT_DETAIL_PROJECTION_MIGRATION,
    "Order checkout receipt authority requires the exact detail-projection predecessor",
  );

  const snapshot = verifyOrderParticipantSnapshotCorrectionMigrationBytes(root);
  const snapshotTreeSha256 = migrationTree(root, ORDER_PARTICIPANT_SNAPSHOT_CORRECTION_MIGRATION);
  assert.equal(
    snapshotTreeSha256,
    ORDER_PARTICIPANT_SNAPSHOT_CORRECTION_MIGRATION_TREE_SHA256,
    "Order participant snapshot-correction migration tree drifted",
  );
  assert.equal(count(snapshot.migration, /^CREATE FUNCTION public\./gmu), 2);
  assert.equal(count(snapshot.migration, /^SECURITY DEFINER$/gmu), 2);
  assert.equal(count(snapshot.migration, /^SET search_path = pg_catalog$/gmu), 2);
  assert.equal(count(snapshot.migration, /^GRANT EXECUTE ON FUNCTION/gmu), 2);
  assert.equal(count(snapshot.migration, /^REVOKE ALL ON FUNCTION/gmu), 2);
  for (const identity of ORDER_PARTICIPANT_SNAPSHOT_CORRECTION_FUNCTIONS) {
    const functionName = identity.slice(0, identity.indexOf("("));
    assert.match(snapshot.migration, new RegExp(`FUNCTION public\\.${functionName}\\(`, "u"));
  }
  for (const key of [
    "title",
    "description",
    "priceCents",
    "imageUrls",
    "category",
    "tags",
    "sellerName",
    "capturedAt",
    "listingType",
    "processingTimeMinDays",
    "processingTimeMaxDays",
    "shipsWithinDays",
  ]) {
    assert.equal(count(snapshot.migration, new RegExp(`'${key}'`, "gu")), 4, key);
  }
  assert.doesNotMatch(snapshot.migration, /ALTER TABLE|CREATE POLICY|DROP POLICY/iu);
  assert.doesNotMatch(snapshot.migration, /(?:INSERT|UPDATE)\s+(?:INTO|public\.)/iu);

  const receipt = verifyOrderCheckoutReceiptAuthorityMigrationBytes(root);
  const receiptTreeSha256 = migrationTree(root, ORDER_CHECKOUT_RECEIPT_AUTHORITY_MIGRATION);
  assert.equal(
    receiptTreeSha256,
    ORDER_CHECKOUT_RECEIPT_AUTHORITY_MIGRATION_TREE_SHA256,
    "Order checkout receipt-authority migration tree drifted",
  );
  assert.equal(count(receipt.migration, /^CREATE FUNCTION public\./gmu), 1);
  assert.equal(count(receipt.migration, /^SECURITY DEFINER$/gmu), 1);
  assert.equal(count(receipt.migration, /^SET search_path = pg_catalog$/gmu), 1);
  assert.equal(count(receipt.migration, /^GRANT EXECUTE ON FUNCTION/gmu), 1);
  assert.equal(count(receipt.migration, /^REVOKE ALL ON FUNCTION/gmu), 1);
  for (const identity of ORDER_CHECKOUT_RECEIPT_AUTHORITY_FUNCTIONS) {
    const functionName = identity.slice(0, identity.indexOf("("));
    assert.match(receipt.migration, new RegExp(`FUNCTION public\\.${functionName}\\(`, "u"));
  }
  assert.match(receipt.migration, /pg_catalog\.cardinality\(p_session_ids\) NOT BETWEEN 1 AND 50/u);
  assert.match(receipt.migration, /requested\.session_id <> pg_catalog\.btrim\(requested\.session_id\)/u);
  assert.match(receipt.migration, /source_order\."buyerId" = p_actor_user_id/u);
  assert.match(receipt.migration, /source_order\."paidAt" IS NOT NULL/u);
  assert.match(receipt.migration, /source_order\."buyerDataPurgedAt" IS NULL/u);
  assert.match(receipt.migration, /grainline_order_buyer_detail_v3/u);
  assert.doesNotMatch(receipt.migration, /stripe_session_id\s+text/iu);
  assert.doesNotMatch(receipt.migration, /ALTER TABLE|CREATE POLICY|DROP POLICY/iu);
  assert.doesNotMatch(receipt.migration, /(?:INSERT|UPDATE)\s+(?:INTO|public\.)/iu);

  const page = readFileSync(path.join(root, "src/app/checkout/success/page.tsx"), "utf8");
  assert.match(page, /readBuyerCheckoutReceipts\(me\.id, sessionIds\)/u);
  assert.match(page, /readBuyerCheckoutReceipts\(me\.id, \[sessionId\]\)/u);
  assert.doesNotMatch(page, /\b(?:prisma|tx|client)\.order\b/u);
  assert.doesNotMatch(page, /readHistoricalOrderItemSnapshot|order\.buyer\?\./u);

  return Object.freeze({
    phase: ORDER_CHECKOUT_RECEIPT_AUTHORITY_PHASE,
    migration: ORDER_CHECKOUT_RECEIPT_AUTHORITY_MIGRATION,
    migrationSha256: receipt.migrationSha256,
    migrationTreeSha256: receiptTreeSha256,
    snapshotCorrectionMigration: ORDER_PARTICIPANT_SNAPSHOT_CORRECTION_MIGRATION,
    snapshotCorrectionMigrationSha256: snapshot.migrationSha256,
    snapshotCorrectionMigrationTreeSha256: snapshotTreeSha256,
    predecessorMigration: ORDER_PARTICIPANT_DETAIL_PROJECTION_MIGRATION,
    functionCount: 3,
    convertedOrderSourceCount: 1,
    directOrderSourceCount: 21,
    rlsChanged: false,
    runtimeTablePrivilegesChanged: false,
    rowDataChanged: false,
    productionTouched: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(
      `${JSON.stringify(verifyOrderCheckoutReceiptAuthorityRelease(), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `Order checkout receipt-authority release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
