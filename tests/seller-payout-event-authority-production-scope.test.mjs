import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  SCHEMA_NUMERIC_GUARDS_CURRENT_SHA256,
  SCHEMA_NUMERIC_GUARDS_HISTORICAL_LEDGER_SHA256,
  SCHEMA_NUMERIC_GUARDS_MIGRATION,
  SELLER_PAYOUT_EVENT_AUTHORITY_FUNCTIONS,
  assertSellerPayoutEventAuthorityProductionScope,
  parseSellerPayoutEventAuthorityScopeEnvironment,
  readSellerPayoutEventAuthorityMigrationCatalog,
  sellerPayoutEventAuthorityFunctionSources,
  verifySellerPayoutEventAuthorityProductionScope,
} from "../scripts/verify-seller-payout-event-authority-production-scope.mjs";
import {
  LISTING_VARIANTS_HISTORICAL_LEDGER_ALIAS,
  LISTING_VARIANTS_REVIEWED_MIGRATION,
} from "../scripts/direct-upload-activation-failure-inspect.mjs";
import {
  CHECKOUT_STOCK_RESERVATION_FORCE_MIGRATION,
} from "../scripts/guard-saved-search-rls-deploy.mjs";
import {
  DIRECT_UPLOAD_ACTIVATION_RELEASE,
  FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
} from "../scripts/verify-direct-upload-activation-release.mjs";
import {
  SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION,
  SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION_SHA256,
} from "../scripts/verify-seller-payout-event-authority-release.mjs";

const URL = "postgresql://neondb_owner:owner@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const CHECKSUMS = Object.freeze({
  [LISTING_VARIANTS_REVIEWED_MIGRATION]: "1".repeat(64),
  [SCHEMA_NUMERIC_GUARDS_MIGRATION]: SCHEMA_NUMERIC_GUARDS_CURRENT_SHA256,
  [DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName]:
    DIRECT_UPLOAD_ACTIVATION_RELEASE.sha256,
  [CHECKOUT_STOCK_RESERVATION_FORCE_MIGRATION]: "2".repeat(64),
  [SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION]:
    SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION_SHA256,
});
const CATALOG = Object.entries(CHECKSUMS)
  .map(([migration_name, checksum]) => ({ migration_name, checksum }))
  .sort((left, right) => left.migration_name.localeCompare(right.migration_name));
const FUNCTION_SOURCES = sellerPayoutEventAuthorityFunctionSources();
const applied = (migration_name, checksum = CHECKSUMS[migration_name]) => ({
  migration_name,
  checksum,
  finished_at: "2026-08-15T00:00:00.000Z",
  rolled_back_at: null,
  applied_steps_count: 1,
});
const rolledBack = (migration_name, checksum) => ({
  migration_name,
  checksum,
  finished_at: null,
  rolled_back_at: "2026-08-15T00:00:00.000Z",
  applied_steps_count: 0,
});
const predecessorRows = [
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
  applied(CHECKOUT_STOCK_RESERVATION_FORCE_MIGRATION),
];
const table = Object.freeze({
  owner_name: "neondb_owner",
  rls_enabled: false,
  rls_forced: false,
  policy_count: 0,
  runtime_can_select: true,
  runtime_can_insert: true,
  runtime_can_update: true,
  runtime_can_delete: true,
  public_has_crud: false,
  invalid_table_acl_count: 0,
  column_acl_count: 0,
});
const predecessorState = Object.freeze({
  table,
  columns: [],
  constraints: [],
  indexes: [],
  functions: [],
});
const preparedState = Object.freeze({
  table,
  columns: [{
    column_name: "stripeEventCreatedSeconds",
    data_type: "bigint",
    is_nullable: "YES",
  }],
  constraints: [
    "SellerPayoutEvent_amount_nonnegative_chk",
    "SellerPayoutEvent_currency_chk",
    "SellerPayoutEvent_event_created_seconds_chk",
    "SellerPayoutEvent_failed_status_chk",
    "SellerPayoutEvent_source_event_chk",
  ].map((constraint_name) => ({
    constraint_name,
    constraint_type: "c",
    validated: true,
    definition: ({
      SellerPayoutEvent_amount_nonnegative_chk:
        'CHECK (("amountCents" IS NULL) OR ("amountCents" >= 0))',
      SellerPayoutEvent_currency_chk:
        "CHECK ((currency ~ '^[a-z]{3}$'::text))",
      SellerPayoutEvent_event_created_seconds_chk:
        'CHECK (("stripeEventCreatedSeconds" IS NULL) OR ("stripeEventCreatedSeconds" BETWEEN 1 AND 253402300799))',
      SellerPayoutEvent_failed_status_chk:
        "CHECK ((status = 'failed'::text))",
      SellerPayoutEvent_source_event_chk:
        'CHECK (("stripeEventId" IS NOT NULL) AND (char_length(btrim("stripeEventId")) BETWEEN 1 AND 255))',
    })[constraint_name],
  })),
  indexes: [
    {
      index_name: "SellerPayoutEvent_seller_event_time_idx",
      is_unique: false,
      is_valid: true,
      is_ready: true,
      definition:
        "CREATE INDEX ... (\"sellerProfileId\", \"stripeEventCreatedSeconds\" DESC, id DESC)",
    },
    {
      index_name: "SellerPayoutEvent_stripeEventId_key",
      is_unique: true,
      is_valid: true,
      is_ready: true,
      definition: "CREATE UNIQUE INDEX ... (\"stripeEventId\")",
    },
  ],
  functions: SELLER_PAYOUT_EVENT_AUTHORITY_FUNCTIONS.map((entry) => ({
    identity: entry.identity,
    owner_name: "neondb_owner",
    function_kind: "f",
    language_name: entry.language,
    security_definer: true,
    leakproof: false,
    config: ["search_path=pg_catalog"],
    runtime_can_execute: true,
    public_can_execute: false,
    invalid_acl_count: 0,
    volatility: entry.volatility,
    parallel: entry.parallel,
    function_source: FUNCTION_SOURCES[entry.identity],
  })),
});
const predecessor = Object.freeze({
  ledgerRows: predecessorRows,
  catalogState: predecessorState,
});
const prepared = Object.freeze({
  ledgerRows: [
    ...predecessorRows,
    applied(SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION),
  ],
  catalogState: preparedState,
});

function clone(value) {
  return structuredClone(value);
}

test("scope parser accepts only manual main and the direct owner", () => {
  const env = {
    DIRECT_URL: URL,
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    SELLER_PAYOUT_EVENT_AUTHORITY_SCOPE_STAGE: "after",
  };
  assert.equal(
    parseSellerPayoutEventAuthorityScopeEnvironment(env).identity.username,
    "neondb_owner",
  );
  for (const drift of [
    { GITHUB_ACTIONS: "false" },
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_REF: "refs/heads/feature" },
    { DIRECT_URL: URL.replace("neondb_owner", "grainline_app_runtime") },
    { DIRECT_URL: URL.replace(".westus3", "-pooler.westus3") },
    { SELLER_PAYOUT_EVENT_AUTHORITY_SCOPE_STAGE: "during" },
  ]) {
    assert.throws(() =>
      parseSellerPayoutEventAuthorityScopeEnvironment({ ...env, ...drift })
    );
  }
});

test("scope accepts only the exact predecessor and prepared restart states", async () => {
  assert.deepEqual(
    assertSellerPayoutEventAuthorityProductionScope(
      predecessor,
      "before",
      CATALOG,
    ),
    {
      checkoutStockReservationForceApplied: true,
      historicalLedgerExceptionCount: 3,
      payoutAuthorityApplied: false,
      payoutRlsEnabled: false,
      payoutRlsForced: false,
      predecessorRuntimeCrudRetained: true,
      reviewedMigrationCount: CATALOG.length,
      runtimeFunctionCount: 0,
      state: "predecessor",
      productionChangedByProof: false,
    },
  );
  assert.equal(
    assertSellerPayoutEventAuthorityProductionScope(
      predecessor,
      "restart",
      CATALOG,
    ).state,
    "predecessor",
  );
  assert.equal(
    assertSellerPayoutEventAuthorityProductionScope(
      prepared,
      "restart",
      CATALOG,
    ).state,
    "prepared",
  );
  assert.equal(
    assertSellerPayoutEventAuthorityProductionScope(
      prepared,
      "after",
      CATALOG,
    ).runtimeFunctionCount,
    3,
  );
  const result = await verifySellerPayoutEventAuthorityProductionScope(
    { directUrl: URL, stage: "after" },
    {
      readSnapshot: async (url) => (assert.equal(url, URL), prepared),
      readCatalog: () => CATALOG,
    },
  );
  assert.equal(result.payoutAuthorityApplied, true);
});

test("scope rejects ledger, table, schema, index, and function drift", () => {
  const cases = [];
  const add = (change) => cases.push(change);

  const missing = clone(prepared);
  missing.ledgerRows.splice(0, 1);
  add(missing);
  const unknown = clone(prepared);
  unknown.ledgerRows.push(applied("20260816000000_unknown", "9".repeat(64)));
  add(unknown);
  const targetFailed = clone(prepared);
  Object.assign(targetFailed.ledgerRows.at(-1), {
    finished_at: null,
    applied_steps_count: 0,
  });
  add(targetFailed);
  const aliasApplied = clone(prepared);
  Object.assign(
    aliasApplied.ledgerRows.find((row) =>
      row.migration_name === LISTING_VARIANTS_HISTORICAL_LEDGER_ALIAS
    ),
    { finished_at: "2026-08-15T00:00:00.000Z" },
  );
  add(aliasApplied);
  const numericDrift = clone(prepared);
  Object.assign(
    numericDrift.ledgerRows.find((row) =>
      row.migration_name === SCHEMA_NUMERIC_GUARDS_MIGRATION
    ),
    { checksum: SCHEMA_NUMERIC_GUARDS_CURRENT_SHA256 },
  );
  add(numericDrift);
  const rlsDrift = clone(prepared);
  rlsDrift.catalogState.table.rls_enabled = true;
  add(rlsDrift);
  const privilegeDrift = clone(prepared);
  privilegeDrift.catalogState.table.runtime_can_update = false;
  add(privilegeDrift);
  const publicTableDrift = clone(prepared);
  publicTableDrift.catalogState.table.public_has_crud = true;
  add(publicTableDrift);
  const tableAclDrift = clone(prepared);
  tableAclDrift.catalogState.table.invalid_table_acl_count = 1;
  add(tableAclDrift);
  const columnAclDrift = clone(prepared);
  columnAclDrift.catalogState.table.column_acl_count = 1;
  add(columnAclDrift);
  const columnDrift = clone(prepared);
  columnDrift.catalogState.columns[0].is_nullable = "NO";
  add(columnDrift);
  const constraintDrift = clone(prepared);
  constraintDrift.catalogState.constraints[0].validated = false;
  add(constraintDrift);
  const indexDrift = clone(prepared);
  indexDrift.catalogState.indexes[1].is_unique = false;
  add(indexDrift);
  const functionOwnerDrift = clone(prepared);
  functionOwnerDrift.catalogState.functions[0].owner_name = "grainline_app_runtime";
  add(functionOwnerDrift);
  const publicExecute = clone(prepared);
  publicExecute.catalogState.functions[1].public_can_execute = true;
  add(publicExecute);
  const functionAclDrift = clone(prepared);
  functionAclDrift.catalogState.functions[1].invalid_acl_count = 1;
  add(functionAclDrift);
  const searchPathDrift = clone(prepared);
  searchPathDrift.catalogState.functions[2].config = ["search_path=public"];
  add(searchPathDrift);
  const functionSourceDrift = clone(prepared);
  functionSourceDrift.catalogState.functions[0].function_source += "\n-- drift";
  add(functionSourceDrift);
  const partialCatalog = clone(predecessor);
  partialCatalog.catalogState.columns = clone(preparedState.columns);
  add(partialCatalog);

  for (const snapshot of cases) {
    assert.throws(() =>
      assertSellerPayoutEventAuthorityProductionScope(
        snapshot,
        "restart",
        CATALOG,
      )
    );
  }
  assert.throws(() =>
    assertSellerPayoutEventAuthorityProductionScope(predecessor, "after", CATALOG)
  );
  assert.throws(() =>
    assertSellerPayoutEventAuthorityProductionScope(prepared, "before", CATALOG)
  );
});

test("scope catalog byte-pins the complete tree and payout authority is last", () => {
  const reviewed = readSellerPayoutEventAuthorityMigrationCatalog();
  assert.equal(
    reviewed.at(-1)?.migration_name,
    SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION,
  );
  assert.equal(
    reviewed.at(-1)?.checksum,
    SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION_SHA256,
  );
  assert.ok(reviewed.length > 190);
  assert.ok(reviewed.every((entry) => /^[0-9a-f]{64}$/u.test(entry.checksum)));
});

test("scope reader is engine-attested repeatable-read and read-only", () => {
  const source = fs.readFileSync(
    "scripts/verify-seller-payout-event-authority-production-scope.mjs",
    "utf8",
  );
  assert.match(
    source,
    /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/,
  );
  assert.match(source, /transaction_read_only/);
  assert.match(source, /ROLLBACK/);
  assert.match(source, /oidvectortypes\(procedure\.proargtypes\)/);
  assert.doesNotMatch(source, /client\.query\(\s*`?(?:INSERT|UPDATE|DELETE|TRUNCATE)/i);
});

test("production scope proof has an explicit package entrypoint", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(
    pkg.scripts["audit:rls-seller-payout-event-authority-production-scope"],
    "node scripts/verify-seller-payout-event-authority-production-scope.mjs",
  );
});
