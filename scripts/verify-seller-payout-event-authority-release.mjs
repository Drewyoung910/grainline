#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION =
  "20260815210000_prepare_seller_payout_event_authority";
export const SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION_SHA256 =
  "9aca2449c229d0c393e41e3b63c938b6ac80c3a3bbfcda5fc68198fbc94ec146";
const SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION =
  "20260822180000_enable_seller_payout_event_rls";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function verifySellerPayoutEventAuthorityRelease(
  rootDirectory = process.cwd(),
  { allowReviewedActivationSuccessor = false } = {},
) {
  const migrationDirectory = path.join(
    rootDirectory,
    "prisma/migrations",
    SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION,
  );
  const migrationPath = path.join(migrationDirectory, "migration.sql");
  assert.ok(
    fs.existsSync(migrationPath),
    `missing ${SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION}`,
  );
  const migration = fs.readFileSync(migrationPath);
  const migrationSha256 = sha256(migration);
  assert.equal(
    migrationSha256,
    SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION_SHA256,
    "SellerPayoutEvent compatible authority migration bytes drifted",
  );

  const migrationNames = fs.readdirSync(
    path.join(rootDirectory, "prisma/migrations"),
    { withFileTypes: true },
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const later = migrationNames.filter(
    (name) => name > SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION,
  );
  assert.deepEqual(
    later,
    allowReviewedActivationSuccessor
      ? [SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION]
      : [],
    "SellerPayoutEvent compatible authority has an unreviewed successor",
  );

  const text = migration.toString("utf8");
  assert.doesNotMatch(text, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(text, /FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(text, /REVOKE ALL ON (?:TABLE|ALL TABLES)/);
  assert.match(text, /pg_catalog\.pg_advisory_xact_lock/);
  assert.match(text, /FROM PUBLIC, grainline_app_runtime/);

  return Object.freeze({
    migration: SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION,
    migrationSha256,
    rlsEnabled: false,
    rlsForced: false,
    runtimeTablePrivilegesChanged: false,
    runtimeFunctions: 3,
    productionTouched: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(
      verifySellerPayoutEventAuthorityRelease(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(
      `SellerPayoutEvent compatible release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
