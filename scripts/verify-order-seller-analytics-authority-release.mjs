#!/usr/bin/env node

import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { computeMigrationTreeSha256 } from "./guard-saved-search-rls-deploy.mjs";
import {
  ORDER_PUBLIC_AGGREGATE_AUTHORITY_MIGRATION,
  ORDER_SELLER_ANALYTICS_AUTHORITY_FUNCTIONS,
  ORDER_SELLER_ANALYTICS_AUTHORITY_MIGRATION,
  ORDER_SELLER_ANALYTICS_AUTHORITY_MIGRATION_TREE_SHA256,
  verifyOrderSellerAnalyticsAuthorityMigrationBytes,
} from "./order-participant-list-authority-catalog.mjs";
import { verifyOrderPublicAggregateAuthorityRelease } from "./verify-order-public-aggregate-authority-release.mjs";

export const ORDER_SELLER_ANALYTICS_AUTHORITY_PHASE =
  "order-seller-analytics-authority-reviewed";

function count(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

export function verifyOrderSellerAnalyticsAuthorityRelease(root = process.cwd()) {
  const predecessor = verifyOrderPublicAggregateAuthorityRelease(root);
  assert.equal(
    predecessor.migration,
    ORDER_PUBLIC_AGGREGATE_AUTHORITY_MIGRATION,
    "Order seller analytics authority requires the public-aggregate predecessor",
  );
  const { migration, migrationSha256 } =
    verifyOrderSellerAnalyticsAuthorityMigrationBytes(root);
  const migrationDirectory = path.join(root, "prisma/migrations");
  const migrationNames = readdirSync(migrationDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name <= ORDER_SELLER_ANALYTICS_AUTHORITY_MIGRATION);
  const migrationTreeSha256 = computeMigrationTreeSha256(
    migrationDirectory,
    migrationNames,
  );
  assert.equal(
    migrationTreeSha256,
    ORDER_SELLER_ANALYTICS_AUTHORITY_MIGRATION_TREE_SHA256,
    "Order seller analytics-authority migration tree drifted",
  );
  assert.equal(count(migration, /^CREATE FUNCTION public\./gmu), 5);
  assert.equal(count(migration, /^SECURITY DEFINER$/gmu), 5);
  assert.equal(count(migration, /^SET search_path = pg_catalog$/gmu), 5);
  assert.equal(count(migration, /^GRANT EXECUTE ON FUNCTION/gmu), 5);
  assert.equal(count(migration, /^REVOKE ALL ON FUNCTION/gmu), 5);
  for (const identity of ORDER_SELLER_ANALYTICS_AUTHORITY_FUNCTIONS) {
    const name = identity.slice(0, identity.indexOf("("));
    assert.match(migration, new RegExp(`FUNCTION public\\.${name}\\(`, "u"));
  }
  assert.match(migration, /seller\."userId" = p_actor_user_id/u);
  assert.match(migration, /p_grouping NOT IN \('hour', 'day', 'month', 'year'\)/u);
  assert.match(migration, /cart_item\."createdAt" <=[\s\S]*INTERVAL '24 hours'/u);
  assert.match(migration, /purchased_order\."createdAt" >= cart_item\."createdAt"/u);
  assert.match(migration, /ORDER BY source_item\."createdAt" ASC, source_item\.id ASC/u);
  assert.doesNotMatch(migration, /ALTER TABLE|CREATE POLICY|DROP POLICY/iu);
  assert.doesNotMatch(migration, /(?:INSERT|UPDATE|DELETE)\s+(?:INTO|public\.)/iu);
  assert.doesNotMatch(migration, /EXECUTE\s+[^;]*(?:format|quote_ident)/iu);

  return Object.freeze({
    phase: ORDER_SELLER_ANALYTICS_AUTHORITY_PHASE,
    migration: ORDER_SELLER_ANALYTICS_AUTHORITY_MIGRATION,
    migrationSha256,
    migrationTreeSha256,
    predecessorMigration: ORDER_PUBLIC_AGGREGATE_AUTHORITY_MIGRATION,
    functionCount: 5,
    directOrderSourceCount: 29,
    directOrderItemSourceCount: 5,
    actorBound: true,
    abandonedCartMinimumAgeHours: 24,
    recentSalesDeterministic: true,
    rlsChanged: false,
    runtimeTablePrivilegesChanged: false,
    rowDataChanged: false,
    productionTouched: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(
      `${JSON.stringify(verifyOrderSellerAnalyticsAuthorityRelease(), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `Order seller analytics-authority release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
