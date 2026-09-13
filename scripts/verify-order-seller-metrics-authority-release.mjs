#!/usr/bin/env node

import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { computeMigrationTreeSha256 } from "./guard-saved-search-rls-deploy.mjs";
import {
  ORDER_SELLER_ANALYTICS_AUTHORITY_MIGRATION,
  ORDER_SELLER_METRICS_AUTHORITY_FUNCTIONS,
  ORDER_SELLER_METRICS_AUTHORITY_MIGRATION,
  ORDER_SELLER_METRICS_AUTHORITY_MIGRATION_TREE_SHA256,
  verifyOrderSellerMetricsAuthorityMigrationBytes,
} from "./order-participant-list-authority-catalog.mjs";
import { verifyOrderSellerAnalyticsAuthorityRelease } from "./verify-order-seller-analytics-authority-release.mjs";

export const ORDER_SELLER_METRICS_AUTHORITY_PHASE =
  "order-seller-metrics-authority-reviewed";

function count(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

export function verifyOrderSellerMetricsAuthorityRelease(root = process.cwd()) {
  const predecessor = verifyOrderSellerAnalyticsAuthorityRelease(root);
  assert.equal(
    predecessor.migration,
    ORDER_SELLER_ANALYTICS_AUTHORITY_MIGRATION,
    "Order seller metrics authority requires the seller-analytics predecessor",
  );
  const { migration, migrationSha256 } =
    verifyOrderSellerMetricsAuthorityMigrationBytes(root);
  const migrationDirectory = path.join(root, "prisma/migrations");
  const migrationNames = readdirSync(migrationDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name <= ORDER_SELLER_METRICS_AUTHORITY_MIGRATION);
  const migrationTreeSha256 = computeMigrationTreeSha256(
    migrationDirectory,
    migrationNames,
  );
  assert.equal(
    migrationTreeSha256,
    ORDER_SELLER_METRICS_AUTHORITY_MIGRATION_TREE_SHA256,
    "Order seller metrics-authority migration tree drifted",
  );
  assert.equal(count(migration, /^CREATE FUNCTION public\./gmu), 1);
  assert.equal(count(migration, /^SECURITY DEFINER$/gmu), 1);
  assert.equal(count(migration, /^SET search_path = pg_catalog$/gmu), 1);
  assert.equal(count(migration, /^GRANT EXECUTE ON FUNCTION/gmu), 1);
  assert.equal(count(migration, /^REVOKE ALL ON FUNCTION/gmu), 1);
  for (const identity of ORDER_SELLER_METRICS_AUTHORITY_FUNCTIONS) {
    const name = identity.slice(0, identity.indexOf("("));
    assert.match(migration, new RegExp(`FUNCTION public\\.${name}\\(`, "u"));
  }
  assert.match(migration, /source_order\."sellerProfileId" = p_seller_profile_id/u);
  assert.match(migration, /source_item\."sellerProfileId" = p_seller_profile_id/u);
  assert.match(migration, /source_order\."paidAt" IS NOT NULL/u);
  assert.match(migration, /source_order\."sellerRefundId" IS NULL/u);
  assert.match(migration, /source_order\."paymentRefundBlocked" = false/u);
  assert.match(migration, /source_order\."shippedAt" <= source_order\."processingDeadline"/u);
  assert.match(migration, /INTERVAL '400 days'/u);
  assert.doesNotMatch(migration, /JOIN public\."Listing"/u);
  assert.doesNotMatch(migration, /"buyerId"|"buyerEmail"|"shipTo"/u);
  assert.doesNotMatch(migration, /ALTER TABLE|CREATE POLICY|DROP POLICY/iu);
  assert.doesNotMatch(migration, /(?:INSERT|UPDATE|DELETE)\s+(?:INTO|public\.)/iu);
  assert.doesNotMatch(migration, /EXECUTE\s+[^;]*(?:format|quote_ident)/iu);

  return Object.freeze({
    phase: ORDER_SELLER_METRICS_AUTHORITY_PHASE,
    migration: ORDER_SELLER_METRICS_AUTHORITY_MIGRATION,
    migrationSha256,
    migrationTreeSha256,
    predecessorMigration: ORDER_SELLER_ANALYTICS_AUTHORITY_MIGRATION,
    functionCount: 1,
    directOrderSourceCount: 28,
    directOrderItemSourceCount: 4,
    durableSellerKeys: true,
    aggregateOnly: true,
    rlsChanged: false,
    runtimeTablePrivilegesChanged: false,
    rowDataChanged: false,
    productionTouched: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(
      `${JSON.stringify(verifyOrderSellerMetricsAuthorityRelease(), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `Order seller metrics-authority release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
