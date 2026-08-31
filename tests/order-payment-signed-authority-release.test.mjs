import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { repositoryBeforeRefundReconciliation } from "./helpers/release-verifier-root.mjs";

import {
  ORDER_PAYMENT_SIGNED_AUTHORITY_MIGRATION,
  ORDER_PAYMENT_SIGNED_AUTHORITY_MIGRATION_SHA256,
  verifyOrderPaymentSignedAuthorityMigrationBytes,
} from "../scripts/order-payment-signed-authority-catalog.mjs";
import {
  ORDER_PAYMENT_SIGNED_AUTHORITY_PHASE,
  verifyOrderPaymentSignedAuthorityRelease,
} from "../scripts/verify-order-payment-signed-authority-release.mjs";

test("release byte-pins one compatible signed payment authority successor", () => {
  const release = verifyOrderPaymentSignedAuthorityRelease(
    repositoryBeforeRefundReconciliation(),
  );
  assert.equal(release.phase, ORDER_PAYMENT_SIGNED_AUTHORITY_PHASE);
  assert.equal(release.migration, ORDER_PAYMENT_SIGNED_AUTHORITY_MIGRATION);
  assert.equal(
    release.migrationSha256,
    ORDER_PAYMENT_SIGNED_AUTHORITY_MIGRATION_SHA256,
  );
  assert.equal(
    release.predecessorMigration,
    "20260824020000_prepare_order_refund_record_authority",
  );
  assert.equal(release.runtimeFunctions, 2);
  assert.equal(release.rlsChanged, false);
  assert.equal(release.runtimeTablePrivilegesChanged, false);
  assert.equal(release.productionTouched, false);
});

test("signed payment migration byte verifier rejects a near match", () => {
  const root = mkdtempSync(path.join(tmpdir(), "grainline-payment-signed-release-"));
  const directory = path.join(
    root,
    "prisma/migrations",
    ORDER_PAYMENT_SIGNED_AUTHORITY_MIGRATION,
  );
  mkdirSync(directory, { recursive: true });
  const source = readFileSync(
    `prisma/migrations/${ORDER_PAYMENT_SIGNED_AUTHORITY_MIGRATION}/migration.sql`,
    "utf8",
  );
  writeFileSync(path.join(directory, "migration.sql"), `${source}\n`);
  assert.throws(
    () => verifyOrderPaymentSignedAuthorityMigrationBytes(root),
    /migration bytes drifted/,
  );
});

test("production activation runner stages signed payment authority without reapplying it", () => {
  const production = readFileSync(
    ".github/workflows/production-migrations.yml",
    "utf8",
  );
  const migrationPath = `prisma/migrations/${ORDER_PAYMENT_SIGNED_AUTHORITY_MIGRATION}`;
  const verify = production.indexOf("Verify Order payment signed authority release");
  const isolate = production.indexOf(migrationPath);
  const restore = production.lastIndexOf(migrationPath);
  const apply = production.indexOf("Apply production migrations");
  assert.equal(production.split(migrationPath).length - 1, 2);
  assert.ok(verify >= 0 && verify < isolate);
  assert.ok(isolate < restore && restore < apply);
});
