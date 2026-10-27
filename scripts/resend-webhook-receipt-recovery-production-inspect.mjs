#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import pg from "pg";

import { postgresChannelBindingClientOptions } from "./postgres-url-safety.mjs";
import { isReviewedSuccessfulMigration } from "./reviewed-manually-applied-migrations.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const MIGRATION = "20261027010000_restore_resend_webhook_receipts";
export const MIGRATION_SHA256 =
  "a765482bfdeca66a82aaa912c5bfc2c6f7bc44b033fea4ace2e5bc40243ad2ba";
export const STOCK_NOTIFICATION_MIGRATION =
  "20261026010000_prepare_stock_notification_authorities";
export const STOCK_NOTIFICATION_SHA256 =
  "3c77aed31571f7e4adb942bea15611ee97d75e8183f76899cc634749ab2955ce";
export const REQUIRED_EMAIL_MIGRATIONS = Object.freeze(new Map([
  [
    "20261025010000_prepare_email_delivery_ledger",
    "4d30e75337b9713bca643b4b4c5db1a247e913995448ea89e09929e4fba0405d",
  ],
  [
    "20261025020000_fence_email_provider_and_account_deletion",
    "4d30904d8cb094b403ef9adc4d4268f979d408137aeb228b59a95bca7858cace",
  ],
  [
    "20261025030000_fence_email_provider_and_eligibility_changes",
    "969aff03c7d720067d8a2d39057fed5048c12b60d521666aff7bce12ffd762e4",
  ],
]));

const RETAINED_CONSTRAINTS = Object.freeze(new Map([
  ["ResendWebhookEvent_claimGeneration_chk", 'CHECK ("claimGeneration" >= 0)'],
  ["ResendWebhookEvent_attempts_nonnegative_chk", "CHECK (attempts >= 0)"],
  [
    "ResendWebhookEvent_acknowledgement_pair_chk",
    'CHECK ("acknowledgedAt" IS NULL AND "acknowledgedById" IS NULL AND acknowledgement IS NULL OR "acknowledgedAt" IS NOT NULL AND "acknowledgedById" IS NOT NULL AND acknowledgement IS NOT NULL)',
  ],
]));
const CLAIM_PAIR_CONSTRAINT = "ResendWebhookEvent_claim_pair_chk";
const PREDECESSOR_CLAIM_PAIR_DEFINITION =
  'CHECK (("claimToken" IS NULL) = ("processingStartedAt" IS NULL))';
const RECOVERED_CLAIM_PAIR_DEFINITION =
  'CHECK ("claimToken" IS NULL OR "processingStartedAt" IS NOT NULL)';

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function migrationSql(name) {
  return readFileSync(
    path.join(ROOT, "prisma/migrations", name, "migration.sql"),
  );
}

function migrationState(rows, name, checksum, { required = false } = {}) {
  const named = rows.filter((row) => row.migration_name === name);
  const successful = named.filter(isReviewedSuccessfulMigration);
  assert.ok(successful.length <= 1, `${name} has duplicate successful rows`);
  if (successful.length === 1) {
    assert.equal(successful[0].checksum, checksum, `${name} checksum drifted`);
  }
  const accepted = successful[0];
  const otherRows = named.filter((row) => row !== accepted);
  assert.ok(
    otherRows.every((row) =>
      row.finished_at === null &&
      row.rolled_back_at !== null &&
      Number(row.applied_steps_count) === 0),
    `${name} has an unresolved or partial failed attempt`,
  );
  if (required) assert.equal(successful.length, 1, `${name} is not applied`);
  return successful.length === 1 ? "applied" : "pending";
}

export function verifyCatalog(
  catalog,
  { candidateState, stockState },
  { readOnly = true } = {},
) {
  assert.deepEqual(catalog.identity, {
    current_user: "neondb_owner",
    session_user: "neondb_owner",
    database_name: "neondb",
    read_only: readOnly ? "on" : "off",
    isolation: "repeatable read",
    owner_superuser: false,
    owner_bypass_rls: true,
    runtime_superuser: false,
    runtime_bypass_rls: false,
    runtime_inherit: false,
  });
  assert.deepEqual(catalog.table, {
    owner_name: "neondb_owner",
    owner_superuser: false,
    owner_bypass_rls: true,
    rls_enabled: false,
    rls_forced: false,
    policy_count: 0,
    runtime_select: true,
    runtime_insert: true,
    runtime_update: true,
    runtime_delete: true,
  });
  const constraints = new Map(
    catalog.constraints.map((row) => [row.name, row]),
  );
  assert.equal(constraints.size, RETAINED_CONSTRAINTS.size + 1);
  for (const [name, definition] of RETAINED_CONSTRAINTS) {
    assert.deepEqual(constraints.get(name), {
      name,
      validated: true,
      definition,
    });
  }
  const claimPair = constraints.get(CLAIM_PAIR_CONSTRAINT);
  assert.equal(claimPair?.name, CLAIM_PAIR_CONSTRAINT);
  assert.equal(claimPair?.validated, true);
  const schemaState = claimPair.definition === PREDECESSOR_CLAIM_PAIR_DEFINITION
    ? "predecessor"
    : claimPair.definition === RECOVERED_CLAIM_PAIR_DEFINITION
      ? "recovered"
      : assert.fail(
        `Resend webhook claim-pair constraint drifted: ${claimPair.definition}`,
      );
  if (candidateState === "applied") {
    assert.equal(
      schemaState,
      "recovered",
      "applied recovery ledger requires the recovered constraint",
    );
  }
  assert.ok(stockState === "pending" || stockState === "applied");
  return Object.freeze({
    candidateState,
    stockState,
    schemaState,
    predecessorConstraintPresent: schemaState === "predecessor",
    recoveredConstraintPresent: schemaState === "recovered",
    retainedConstraintCount: RETAINED_CONSTRAINTS.size,
    runtimeReceiptAuthority: true,
    containsRowData: false,
    productionChanged: false,
  });
}

async function readCatalog(client) {
  const identity = await client.query(`
    SELECT CURRENT_USER::text AS current_user,
           SESSION_USER::text AS session_user,
           pg_catalog.current_database()::text AS database_name,
           pg_catalog.current_setting('transaction_read_only') AS read_only,
           pg_catalog.current_setting('transaction_isolation') AS isolation,
           owner.rolsuper AS owner_superuser,
           owner.rolbypassrls AS owner_bypass_rls,
           runtime.rolsuper AS runtime_superuser,
           runtime.rolbypassrls AS runtime_bypass_rls,
           runtime.rolinherit AS runtime_inherit
      FROM pg_catalog.pg_roles AS owner
      JOIN pg_catalog.pg_roles AS runtime
        ON runtime.rolname = 'grainline_app_runtime'
     WHERE owner.rolname = CURRENT_USER
  `);
  assert.equal(identity.rows.length, 1, "database roles are missing or ambiguous");
  const table = await client.query(`
    SELECT pg_catalog.pg_get_userbyid(class.relowner)::text AS owner_name,
           owner.rolsuper AS owner_superuser,
           owner.rolbypassrls AS owner_bypass_rls,
           class.relrowsecurity AS rls_enabled,
           class.relforcerowsecurity AS rls_forced,
           (SELECT pg_catalog.count(*)::integer
              FROM pg_catalog.pg_policy AS policy
             WHERE policy.polrelid = class.oid) AS policy_count,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', class.oid, 'SELECT'
           ) AS runtime_select,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', class.oid, 'INSERT'
           ) AS runtime_insert,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', class.oid, 'UPDATE'
           ) AS runtime_update,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', class.oid, 'DELETE'
           ) AS runtime_delete
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
      JOIN pg_catalog.pg_roles AS owner ON owner.oid = class.relowner
     WHERE namespace.nspname = 'public'
       AND class.relname = 'ResendWebhookEvent'
       AND class.relkind = 'r'
  `);
  assert.equal(table.rows.length, 1, "ResendWebhookEvent is missing or ambiguous");
  const constraints = await client.query(`
    SELECT constraint_row.conname::text AS name,
           constraint_row.convalidated AS validated,
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true)::text
             AS definition
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid =
             'public."ResendWebhookEvent"'::pg_catalog.regclass
       AND constraint_row.conname = ANY($1::text[])
     ORDER BY constraint_row.conname
  `, [[...RETAINED_CONSTRAINTS.keys(), CLAIM_PAIR_CONSTRAINT]]);
  return Object.freeze({
    identity: Object.freeze(identity.rows[0]),
    table: Object.freeze(table.rows[0]),
    constraints: Object.freeze(
      constraints.rows.map((row) => Object.freeze(row)),
    ),
  });
}

async function readLedger(client) {
  assert.equal(sha256(migrationSql(MIGRATION)), MIGRATION_SHA256);
  assert.equal(
    sha256(migrationSql(STOCK_NOTIFICATION_MIGRATION)),
    STOCK_NOTIFICATION_SHA256,
  );
  for (const [name, checksum] of REQUIRED_EMAIL_MIGRATIONS) {
    assert.equal(sha256(migrationSql(name)), checksum, `${name} bytes drifted`);
  }
  const names = [
    ...REQUIRED_EMAIL_MIGRATIONS.keys(),
    STOCK_NOTIFICATION_MIGRATION,
    MIGRATION,
  ];
  const ledger = await client.query(`
    SELECT migration_name, checksum, finished_at, rolled_back_at,
           applied_steps_count
      FROM public._prisma_migrations
     WHERE migration_name = ANY($1::text[])
     ORDER BY migration_name, started_at
  `, [names]);
  for (const [name, checksum] of REQUIRED_EMAIL_MIGRATIONS) {
    migrationState(ledger.rows, name, checksum, { required: true });
  }
  return Object.freeze({
    candidateState: migrationState(
      ledger.rows,
      MIGRATION,
      MIGRATION_SHA256,
    ),
    stockState: migrationState(
      ledger.rows,
      STOCK_NOTIFICATION_MIGRATION,
      STOCK_NOTIFICATION_SHA256,
    ),
  });
}

export function expectedPendingMigrations({ candidateState, stockState }) {
  return [
    ...(stockState === "pending" ? [STOCK_NOTIFICATION_MIGRATION] : []),
    ...(candidateState === "pending" ? [MIGRATION] : []),
  ].join(",");
}

async function proveReceiptConstraintCompatibility(client) {
  const smokeId = `grainline-c1180-${process.env.GITHUB_RUN_ID}`;
  await client.query(
    `INSERT INTO public."ResendWebhookEvent" (
       "svixId", type, "processingStartedAt", "createdAt", "updatedAt"
     ) VALUES ($1, 'email.bounced', now(), now(), now())`,
    [smokeId],
  );
  const processed = await client.query(
    `UPDATE public."ResendWebhookEvent"
        SET "processedAt" = now(), "lastError" = NULL, "updatedAt" = now()
      WHERE "svixId" = $1
      RETURNING "svixId", "processedAt" IS NOT NULL AS processed`,
    [smokeId],
  );
  assert.deepEqual(processed.rows, [{ svixId: smokeId, processed: true }]);
  return true;
}

async function main() {
  const mode = process.argv[2];
  assert.ok(mode === "preflight" || mode === "postflight", "mode is invalid");
  assert.ok(process.env.DIRECT_URL, "DIRECT_URL is missing");
  assert.ok(process.env.RUNNER_TEMP, "RUNNER_TEMP is missing");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.GITHUB_EVENT_NAME, "workflow_dispatch");
  assert.match(
    process.env.PRODUCTION_MIGRATION_RELEASE_COMMIT ?? "",
    /^[0-9a-f]{40}$/u,
  );
  assert.equal(Object.hasOwn(process.env, "DATABASE_URL"), false);

  const snapshotPath = path.join(
    process.env.RUNNER_TEMP,
    "resend-webhook-receipt-recovery-preflight.json",
  );
  const parsedUrl = new URL(process.env.DIRECT_URL);
  const client = new pg.Client({
    connectionString: process.env.DIRECT_URL,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 45_000,
    query_timeout: 50_000,
    application_name: "grainline-resend-webhook-receipt-recovery",
    ...postgresChannelBindingClientOptions(parsedUrl),
  });
  let transactionOpen = false;
  try {
    await client.connect();
    await client.query(
      mode === "preflight"
        ? "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"
        : "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ",
    );
    transactionOpen = true;
    const states = await readLedger(client);
    const result = verifyCatalog(await readCatalog(client), states, {
      readOnly: mode === "preflight",
    });
    if (mode === "preflight") {
      writeFileSync(snapshotPath, JSON.stringify({ states, result }), {
        mode: 0o600,
        flag: "wx",
      });
      assert.ok(process.env.GITHUB_OUTPUT, "GITHUB_OUTPUT is missing");
      appendFileSync(process.env.GITHUB_OUTPUT, `state=${states.candidateState}\n`);
      appendFileSync(process.env.GITHUB_OUTPUT, `schema_state=${result.schemaState}\n`);
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `expected_pending=${expectedPendingMigrations(states)}\n`,
      );
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `expected_after=${
          states.stockState === "pending" ? STOCK_NOTIFICATION_MIGRATION : ""
        }\n`,
      );
    } else {
      assert.equal(states.candidateState, "applied");
      assert.equal(result.schemaState, "recovered");
      const routeConstraintProof = await proveReceiptConstraintCompatibility(client);
      const before = JSON.parse(readFileSync(snapshotPath, "utf8"));
      assert.ok(before.states.candidateState === "pending" ||
        before.states.candidateState === "applied");
      writeFileSync(
        path.join(process.env.RUNNER_TEMP, "resend-webhook-receipt-recovery.json"),
        JSON.stringify({
          status: "passed",
          migration: MIGRATION,
          migrationSha256: MIGRATION_SHA256,
          releaseCommit: process.env.PRODUCTION_MIGRATION_RELEASE_COMMIT,
          before: before.result,
          after: result,
          routeConstraintProof,
          containsRowData: false,
        }, null, 2),
        { mode: 0o600, flag: "wx" },
      );
    }
    await client.query("ROLLBACK");
    transactionOpen = false;
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
