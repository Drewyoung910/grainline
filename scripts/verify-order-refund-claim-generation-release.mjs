#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  ORDER_REFUND_CLAIM_GENERATION_MIGRATION,
  verifyOrderRefundClaimGenerationMigrationBytes,
} from "./order-refund-claim-generation-catalog.mjs";
import {
  verifySellerPayoutEventForceRelease,
} from "./verify-seller-payout-event-force-release.mjs";

export const ORDER_REFUND_CLAIM_GENERATION_PHASE =
  "order-refund-claim-generation-prepared";

export function verifyOrderRefundClaimGenerationRelease(
  rootDirectory = process.cwd(),
) {
  const predecessor = verifySellerPayoutEventForceRelease(rootDirectory, {
    allowReviewedRefundClaimSuccessor: true,
  });
  const { migrationPath, migrationSha256 } =
    verifyOrderRefundClaimGenerationMigrationBytes(rootDirectory);
  const migration = fs.readFileSync(migrationPath, "utf8");
  const laterMigrations = fs.readdirSync(
    path.join(rootDirectory, "prisma/migrations"),
    { withFileTypes: true },
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name > ORDER_REFUND_CLAIM_GENERATION_MIGRATION);
  assert.deepEqual(
    laterMigrations,
    [],
    "Order refund claim generation release has an unreviewed successor",
  );
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path = pg_catalog/);
  assert.match(migration, /"refundClaimGeneration" = claim_generation/);
  assert.match(migration, /"refundClaimProviderAuthorizedAt" = transition_at/);
  assert.match(migration, /FROM PUBLIC, grainline_app_runtime/);
  assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /REVOKE ALL ON TABLE/);

  return Object.freeze({
    phase: ORDER_REFUND_CLAIM_GENERATION_PHASE,
    migration: ORDER_REFUND_CLAIM_GENERATION_MIGRATION,
    migrationSha256,
    predecessorMigration: predecessor.migration,
    runtimeFunctions: 2,
    rlsChanged: false,
    runtimeTablePrivilegesChanged: false,
    productionTouched: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(
      verifyOrderRefundClaimGenerationRelease(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(
      `Order refund claim generation release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
