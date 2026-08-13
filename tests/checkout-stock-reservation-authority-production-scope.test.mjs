import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  RESERVATION_ACTIVATION_MIGRATION,
  RESERVATION_FORCE_MIGRATION,
  SCHEMA_NUMERIC_GUARDS_CURRENT_SHA256,
  SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256,
  SCHEMA_NUMERIC_GUARDS_MIGRATION,
  assertReservationAuthorityProductionScope,
  parseReservationAuthorityScopeEnvironment,
  readReservationAuthorityMigrationCatalog,
  verifyReservationAuthorityProductionScope,
} from "../scripts/verify-checkout-stock-reservation-authority-production-scope.mjs";
import {
  LISTING_VARIANTS_HISTORICAL_LEDGER_ALIAS,
  LISTING_VARIANTS_REVIEWED_MIGRATION,
} from "../scripts/direct-upload-activation-failure-inspect.mjs";
import {
  CHECKOUT_STOCK_RESERVATION_AUTHORITY_MIGRATION,
  STRIPE_WEBHOOK_EVENT_FORCE_MIGRATION,
} from "../scripts/guard-saved-search-rls-deploy.mjs";
import {
  DIRECT_UPLOAD_ACTIVATION_RELEASE,
  FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
} from "../scripts/verify-direct-upload-activation-release.mjs";

const URL = "postgresql://neondb_owner:owner@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const CHECKSUMS = Object.freeze({
  [LISTING_VARIANTS_REVIEWED_MIGRATION]: "1".repeat(64),
  [SCHEMA_NUMERIC_GUARDS_MIGRATION]: SCHEMA_NUMERIC_GUARDS_CURRENT_SHA256,
  [DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName]:
    DIRECT_UPLOAD_ACTIVATION_RELEASE.sha256,
  [STRIPE_WEBHOOK_EVENT_FORCE_MIGRATION]: "2".repeat(64),
  [CHECKOUT_STOCK_RESERVATION_AUTHORITY_MIGRATION]: "3".repeat(64),
});
const catalog = Object.entries(CHECKSUMS).map(([migration_name, checksum]) => ({
  migration_name,
  checksum,
}));
const applied = (migration_name, checksum = CHECKSUMS[migration_name]) => ({
  migration_name,
  checksum,
  finished_at: new Date(),
  rolled_back_at: null,
  applied_steps_count: 1,
});
const rolledBack = (migration_name, checksum) => ({
  migration_name,
  checksum,
  finished_at: null,
  rolled_back_at: new Date(),
  applied_steps_count: 0,
});
const predecessor = [
  applied(LISTING_VARIANTS_REVIEWED_MIGRATION),
  rolledBack(
    LISTING_VARIANTS_HISTORICAL_LEDGER_ALIAS,
    CHECKSUMS[LISTING_VARIANTS_REVIEWED_MIGRATION],
  ),
  applied(
    SCHEMA_NUMERIC_GUARDS_MIGRATION,
    SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256,
  ),
  applied(DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName),
  rolledBack(
    DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName,
    FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
  ),
  applied(STRIPE_WEBHOOK_EVENT_FORCE_MIGRATION),
];
const accepted = [
  ...predecessor,
  applied(CHECKOUT_STOCK_RESERVATION_AUTHORITY_MIGRATION),
];

test("scope parser accepts only manual main and the direct owner", () => {
  const env = {
    DIRECT_URL: URL,
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    CHECKOUT_STOCK_RESERVATION_AUTHORITY_SCOPE_STAGE: "after",
  };
  assert.equal(parseReservationAuthorityScopeEnvironment(env).identity.username, "neondb_owner");
  for (const drift of [
    { GITHUB_ACTIONS: "false" },
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_REF: "refs/heads/feature" },
    { DIRECT_URL: URL.replace("neondb_owner", "grainline_app_runtime") },
    { DIRECT_URL: URL.replace(".westus3", "-pooler.westus3") },
    { CHECKOUT_STOCK_RESERVATION_AUTHORITY_SCOPE_STAGE: "during" },
  ]) assert.throws(() => parseReservationAuthorityScopeEnvironment({ ...env, ...drift }));
});

test("scope accepts only the complete reviewed tree plus compatible authority", async () => {
  assert.deepEqual(assertReservationAuthorityProductionScope(accepted, "after", catalog), {
    stripeForceApplied: true,
    reservationAuthorityApplied: true,
    reservationActivationRows: 0,
    reservationForceRows: 0,
    reviewedMigrationCount: 5,
    historicalLedgerExceptionCount: 3,
    state: "prepared",
    productionChangedByProof: false,
  });
  const result = await verifyReservationAuthorityProductionScope(
    { directUrl: URL, stage: "after" },
    {
      readRows: async (url) => (assert.equal(url, URL), accepted),
      readCatalog: () => catalog,
    },
  );
  assert.equal(result.reservationAuthorityApplied, true);
});

test("scope accepts the exact predecessor before application", () => {
  assert.deepEqual(
    assertReservationAuthorityProductionScope(predecessor, "before", catalog),
    {
      stripeForceApplied: true,
      reservationAuthorityApplied: false,
      reservationActivationRows: 0,
      reservationForceRows: 0,
      reviewedMigrationCount: 5,
      historicalLedgerExceptionCount: 3,
      state: "predecessor",
      productionChangedByProof: false,
    },
  );
  assert.throws(() =>
    assertReservationAuthorityProductionScope(accepted, "before", catalog)
  );
});

test("restart scope accepts only the exact predecessor or completed authority", () => {
  assert.equal(
    assertReservationAuthorityProductionScope(predecessor, "restart", catalog).state,
    "predecessor",
  );
  assert.equal(
    assertReservationAuthorityProductionScope(accepted, "restart", catalog).state,
    "prepared",
  );
  assert.throws(() => assertReservationAuthorityProductionScope([
    ...predecessor,
    { ...accepted.at(-1), finished_at: null, applied_steps_count: 0 },
  ], "restart", catalog));
});

test("scope rejects missing, failed, duplicate, unknown, activation, and FORCE rows", () => {
  const replace = (rows, migrationName, occurrence, patch) => {
    let seen = 0;
    return rows.map((row) => {
      if (row.migration_name !== migrationName) return row;
      seen += 1;
      return seen === occurrence ? { ...row, ...patch } : row;
    });
  };
  for (const rows of [
    [], predecessor.slice(1),
    [{ ...accepted[0], finished_at: null }, ...accepted.slice(1)],
    accepted.map((row, index) => index === 1 ? { ...row, checksum: "9".repeat(64) } : row),
    accepted.map((row, index) => index === 1 ? { ...row, finished_at: new Date() } : row),
    replace(
      accepted,
      SCHEMA_NUMERIC_GUARDS_MIGRATION,
      1,
      { checksum: CHECKSUMS[SCHEMA_NUMERIC_GUARDS_MIGRATION] },
    ),
    replace(
      accepted,
      SCHEMA_NUMERIC_GUARDS_MIGRATION,
      1,
      { checksum: "8".repeat(64) },
    ),
    replace(
      accepted,
      SCHEMA_NUMERIC_GUARDS_MIGRATION,
      1,
      { finished_at: null },
    ),
    replace(
      accepted,
      SCHEMA_NUMERIC_GUARDS_MIGRATION,
      1,
      { rolled_back_at: new Date() },
    ),
    replace(
      accepted,
      SCHEMA_NUMERIC_GUARDS_MIGRATION,
      1,
      { applied_steps_count: 0 },
    ),
    replace(
      accepted,
      DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName,
      2,
      { applied_steps_count: 1 },
    ),
    replace(
      accepted,
      DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName,
      2,
      { finished_at: new Date() },
    ),
    replace(
      accepted,
      DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName,
      1,
      { checksum: "8".repeat(64) },
    ),
    [...accepted, applied(
      SCHEMA_NUMERIC_GUARDS_MIGRATION,
      SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256,
    )],
    [...accepted, accepted.at(-1)],
    [...accepted, rolledBack("20260811000000_unknown", "4".repeat(64))],
    [...accepted, applied(RESERVATION_ACTIVATION_MIGRATION)],
    [...accepted, applied(RESERVATION_FORCE_MIGRATION)],
  ]) assert.throws(() => assertReservationAuthorityProductionScope(rows, "after", catalog));
  assert.throws(() => assertReservationAuthorityProductionScope(accepted, "during", catalog));
});

test("scope catalog byte-pins the complete tree and the authority is last", () => {
  const reviewed = readReservationAuthorityMigrationCatalog();
  assert.equal(
    reviewed.at(-1)?.migration_name,
    CHECKOUT_STOCK_RESERVATION_AUTHORITY_MIGRATION,
  );
  assert.ok(reviewed.length > 190);
  assert.ok(reviewed.every((entry) => /^[0-9a-f]{64}$/u.test(entry.checksum)));
  assert.equal(
    reviewed.find((entry) =>
      entry.migration_name === SCHEMA_NUMERIC_GUARDS_MIGRATION
    )?.checksum,
    SCHEMA_NUMERIC_GUARDS_CURRENT_SHA256,
  );
  assert.notEqual(
    SCHEMA_NUMERIC_GUARDS_CURRENT_SHA256,
    SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256,
  );
  assert.throws(() => assertReservationAuthorityProductionScope(
    predecessor,
    "before",
    catalog.map((entry) => entry.migration_name === SCHEMA_NUMERIC_GUARDS_MIGRATION
      ? {
          ...entry,
          checksum: SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256,
        }
      : entry),
  ));
});

test("scope reader is engine-attested read-only", () => {
  const source = fs.readFileSync("scripts/verify-checkout-stock-reservation-authority-production-scope.mjs", "utf8");
  assert.match(source, /BEGIN TRANSACTION READ ONLY/);
  assert.match(source, /transaction_read_only/);
  assert.match(source, /ROLLBACK/);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
});
