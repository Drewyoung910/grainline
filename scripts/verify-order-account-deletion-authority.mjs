#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const ORDER_ACCOUNT_DELETION_AUTHORITY_MIGRATION =
  "20260905020000_prepare_order_account_deletion_authority";
export const ORDER_ACCOUNT_DELETION_AUTHORITY_MIGRATION_SHA256 =
  "42847973d67ce2fbc5b8ad449403c96cf46ed1b29fae0cff5004e4390fd17a7f";
export const ORDER_ACCOUNT_DELETION_AUTHORITY_FUNCTIONS = Object.freeze([
  "grainline_order_account_deletion_blockers(text)",
  "grainline_order_account_deletion_scrub(text, text[])",
]);
export const ORDER_ACCOUNT_DELETION_AUTHORITY_FUNCTION_NAMES = Object.freeze([
  "grainline_order_account_deletion_blockers",
  "grainline_order_account_deletion_scrub",
]);

function count(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

export function verifyOrderAccountDeletionAuthority(root = process.cwd()) {
  const migrationPath = path.join(
    root,
    "prisma/migrations",
    ORDER_ACCOUNT_DELETION_AUTHORITY_MIGRATION,
    "migration.sql",
  );
  const migration = readFileSync(migrationPath, "utf8");
  const sha256 = createHash("sha256").update(migration).digest("hex");
  assert.equal(
    sha256,
    ORDER_ACCOUNT_DELETION_AUTHORITY_MIGRATION_SHA256,
    "Order account-deletion authority migration bytes drifted",
  );
  assert.equal(
    count(migration, /^CREATE FUNCTION public\.grainline_order_account_deletion_/gmu),
    2,
  );
  assert.equal(count(migration, /^SECURITY DEFINER$/gmu), 2);
  assert.equal(count(migration, /^SET search_path = pg_catalog$/gmu), 2);
  assert.equal(count(migration, /^REVOKE ALL ON FUNCTION/gmu), 2);
  assert.equal(count(migration, /^GRANT EXECUTE ON FUNCTION/gmu), 2);
  assert.equal(
    count(migration, /current_setting\('app\.user_id', true\)/gu),
    2,
  );
  assert.equal(count(migration, /statement_timestamp\(\) AT TIME ZONE 'UTC'/gu), 2);
  assert.match(migration, /source_order\."buyerId" = p_actor_user_id/u);
  assert.match(migration, /source_order\."sellerProfileId" = source_seller_profile_id/u);
  assert.match(migration, /source_order\."chargedTotalCents"/u);
  assert.match(migration, /source_order\."sellerRefundId" <> 'pending'/u);
  assert.match(migration, /FOR UPDATE OF actor/u);
  assert.match(migration, /WITH review_candidates AS MATERIALIZED/u);
  assert.doesNotMatch(migration, /JOIN public\."(?:OrderItem|Listing)"/u);
  assert.doesNotMatch(migration, /pg_catalog\.(?:coalesce|greatest|nullif)/iu);
  assert.doesNotMatch(migration, /ALTER TABLE|CREATE POLICY|DROP POLICY/iu);
  assert.doesNotMatch(migration, /(?:GRANT|REVOKE)[\s\S]{0,100}ON TABLE/iu);

  return Object.freeze({
    migration: ORDER_ACCOUNT_DELETION_AUTHORITY_MIGRATION,
    sha256,
    functionCount: 2,
    rlsChanged: false,
    runtimeTablePrivilegesChanged: false,
    rowDataChanged: false,
  });
}

export function appendReviewedOrderAccountDeletionAuthority({
  root = process.cwd(),
  laterMigrations,
  reviewedSuccessors,
  expectedPredecessor,
}) {
  if (!laterMigrations.includes(ORDER_ACCOUNT_DELETION_AUTHORITY_MIGRATION)) {
    return false;
  }
  assert.equal(
    reviewedSuccessors.at(-1),
    expectedPredecessor,
    "Order account-deletion authority requires its exact reviewed predecessor",
  );
  verifyOrderAccountDeletionAuthority(root);
  reviewedSuccessors.push(ORDER_ACCOUNT_DELETION_AUTHORITY_MIGRATION);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(
      `${JSON.stringify(verifyOrderAccountDeletionAuthority(), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `Order account-deletion authority verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
