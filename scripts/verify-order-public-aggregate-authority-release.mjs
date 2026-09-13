#!/usr/bin/env node

import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { computeMigrationTreeSha256 } from "./guard-saved-search-rls-deploy.mjs";
import {
  ORDER_ELIGIBILITY_AUTHORITY_MIGRATION,
  ORDER_PUBLIC_AGGREGATE_AUTHORITY_FUNCTIONS,
  ORDER_PUBLIC_AGGREGATE_AUTHORITY_MIGRATION,
  ORDER_PUBLIC_AGGREGATE_AUTHORITY_MIGRATION_TREE_SHA256,
  verifyOrderPublicAggregateAuthorityMigrationBytes,
} from "./order-participant-list-authority-catalog.mjs";
import { verifyOrderEligibilityAuthorityRelease } from "./verify-order-eligibility-authority-release.mjs";

export const ORDER_PUBLIC_AGGREGATE_AUTHORITY_PHASE =
  "order-public-aggregate-authority-reviewed";

function count(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

export function verifyOrderPublicAggregateAuthorityRelease(root = process.cwd()) {
  const predecessor = verifyOrderEligibilityAuthorityRelease(root);
  assert.equal(
    predecessor.migration,
    ORDER_ELIGIBILITY_AUTHORITY_MIGRATION,
    "Order public aggregate authority requires the eligibility-authority predecessor",
  );
  const { migration, migrationSha256 } =
    verifyOrderPublicAggregateAuthorityMigrationBytes(root);
  const migrationDirectory = path.join(root, "prisma/migrations");
  const migrationNames = readdirSync(migrationDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name <= ORDER_PUBLIC_AGGREGATE_AUTHORITY_MIGRATION);
  const migrationTreeSha256 = computeMigrationTreeSha256(
    migrationDirectory,
    migrationNames,
  );
  assert.equal(
    migrationTreeSha256,
    ORDER_PUBLIC_AGGREGATE_AUTHORITY_MIGRATION_TREE_SHA256,
    "Order public aggregate-authority migration tree drifted",
  );
  assert.equal(count(migration, /^CREATE FUNCTION public\./gmu), 4);
  assert.equal(count(migration, /^SECURITY DEFINER$/gmu), 4);
  assert.equal(count(migration, /^SET search_path = pg_catalog$/gmu), 4);
  assert.equal(count(migration, /^GRANT EXECUTE ON FUNCTION/gmu), 4);
  assert.equal(count(migration, /^REVOKE ALL ON FUNCTION/gmu), 4);
  for (const identity of ORDER_PUBLIC_AGGREGATE_AUTHORITY_FUNCTIONS) {
    const name = identity.slice(0, identity.indexOf("("));
    assert.match(migration, new RegExp(`FUNCTION public\\.${name}\\(`, "u"));
  }
  assert.match(migration, /pg_catalog\.cardinality\(p_listing_ids\) NOT BETWEEN 1 AND 200/u);
  assert.match(migration, /pg_catalog\.count\(DISTINCT requested\.id\)/u);
  assert.match(migration, /listing\.status = 'ACTIVE'::public\."ListingStatus"/u);
  assert.match(migration, /seller_user\.banned = false/u);
  assert.match(migration, /seller_user\."deletedAt" IS NULL/u);
  assert.match(migration, /source_order\."sellerProfileId" = visible_seller\.id/u);
  assert.doesNotMatch(migration, /"buyerId"|"buyerEmail"|"shipTo"|"stripeChargeId"\s+AS/iu);
  assert.doesNotMatch(migration, /ALTER TABLE|CREATE POLICY|DROP POLICY/iu);
  assert.doesNotMatch(migration, /(?:INSERT|UPDATE|DELETE)\s+(?:INTO|public\.)/iu);
  assert.doesNotMatch(migration, /EXECUTE\s+[^;]*(?:format|quote_ident)/iu);

  return Object.freeze({
    phase: ORDER_PUBLIC_AGGREGATE_AUTHORITY_PHASE,
    migration: ORDER_PUBLIC_AGGREGATE_AUTHORITY_MIGRATION,
    migrationSha256,
    migrationTreeSha256,
    predecessorMigration: ORDER_ELIGIBILITY_AUTHORITY_MIGRATION,
    functionCount: 4,
    directOrderSourceCount: 31,
    directOrderItemSourceCount: 6,
    publicAggregateOnly: true,
    rowProjectionExposed: false,
    rlsChanged: false,
    runtimeTablePrivilegesChanged: false,
    rowDataChanged: false,
    productionTouched: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(
      `${JSON.stringify(verifyOrderPublicAggregateAuthorityRelease(), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `Order public aggregate-authority release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
