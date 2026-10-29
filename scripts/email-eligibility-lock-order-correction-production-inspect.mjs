#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import pg from "pg";

import {
  parseExactPostgresUrl,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";
import { isReviewedSuccessfulMigration } from "./reviewed-manually-applied-migrations.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const MIGRATION =
  "20261027030000_correct_email_eligibility_lock_order";
export const MIGRATION_SHA256 =
  "1c813a247b869b69f02b234e61c4177a4c15a18c941b123a94cf75324e3881aa";
export const OUTBOX_CORRECTION_MIGRATION =
  "20261027020000_correct_email_outbox_contracts";
export const OUTBOX_CORRECTION_SHA256 =
  "b4b036b2a405be02706bf3506efdd29798851abe02a87d72ff3e78d1e4cc24d1";
export const RESEND_RECOVERY_MIGRATION =
  "20261027010000_restore_resend_webhook_receipts";
export const RESEND_RECOVERY_SHA256 =
  "c4ccc1d97c42a586e824adbbc575f0c0112fbb3896f169d29a184dfde0eed567";
export const STOCK_NOTIFICATION_MIGRATION =
  "20261026010000_prepare_stock_notification_authorities";
export const STOCK_NOTIFICATION_SHA256 =
  "3c77aed31571f7e4adb942bea15611ee97d75e8183f76899cc634749ab2955ce";

const ROUTINES = Object.freeze(new Map([
  [
    "grainline_user_clerk_identity_ensure",
    Object.freeze({
      signature:
        "public.grainline_user_clerk_identity_ensure(text,text,text,boolean,text,boolean,text,boolean)",
      before: "980b4708924b99ce799e776ba5ae53e4",
      after: "a67fca98de5a426d9445db667f2c03f3",
    }),
  ],
  [
    "grainline_user_owner_notification_preference_update",
    Object.freeze({
      signature:
        "public.grainline_user_owner_notification_preference_update(text,text,boolean)",
      before: "8c060b5283d62a66048258b72a010965",
      after: "25721b79b417d5b9f248acb176e4874d",
    }),
  ],
  [
    "grainline_user_staff_ban_apply",
    Object.freeze({
      signature:
        "public.grainline_user_staff_ban_apply(text,text,timestamp without time zone,text)",
      before: "eb9f9b2504e4c82f4c2d70a40fd20470",
      after: "f137c30966d4db1711aa0d16eaf3295c",
    }),
  ],
  [
    "grainline_user_unsubscribe_preferences_disable",
    Object.freeze({
      signature:
        "public.grainline_user_unsubscribe_preferences_disable(text[])",
      before: "b4a20fbd4b9e6067390feb3a3a27f1cf",
      after: "0d7f3956b5171f1008edd01b45002dc3",
    }),
  ],
]));

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
  assert.ok(named.filter((row) => row !== accepted).every((row) =>
    row.finished_at === null
      && row.rolled_back_at !== null
      && Number(row.applied_steps_count) === 0
  ), `${name} has an unresolved or partial failed attempt`);
  if (required) assert.equal(successful.length, 1, `${name} is not applied`);
  return successful.length === 1 ? "applied" : "pending";
}

export function expectedPendingMigrations({ candidateState, stockState }) {
  return [
    ...(stockState === "pending" ? [STOCK_NOTIFICATION_MIGRATION] : []),
    ...(candidateState === "pending" ? [MIGRATION] : []),
  ].join(",");
}

export function databaseClientOptions(connectionString) {
  const parsed = parseExactPostgresUrl(connectionString, "DIRECT_URL");
  return Object.freeze({
    connectionString,
    ...postgresChannelBindingClientOptions(parsed),
  });
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
  assert.equal(catalog.routines.length, ROUTINES.size);
  const routines = new Map(catalog.routines.map((routine) => [routine.name, routine]));
  for (const [name, expectation] of ROUTINES) {
    const routine = routines.get(name);
    assert.deepEqual(routine && { ...routine, source_hash: undefined }, {
      name,
      owner_name: "neondb_owner",
      security_definer: true,
      volatility: "v",
      parallel: "u",
      config: ["search_path=pg_catalog"],
      source_hash: undefined,
      runtime_execute: true,
      public_execute: false,
    });
    assert.ok(
      routine.source_hash === expectation.before ||
        routine.source_hash === expectation.after,
      `${name} source drifted`,
    );
  }
  const predecessor = [...ROUTINES].every(([name, expectation]) =>
    routines.get(name).source_hash === expectation.before
  );
  const corrected = [...ROUTINES].every(([name, expectation]) =>
    routines.get(name).source_hash === expectation.after
  );
  assert.ok(
    predecessor || corrected,
    "email eligibility lock-order schema is partially applied",
  );
  const schemaState = predecessor ? "predecessor" : "corrected";
  if (candidateState === "applied") {
    assert.equal(
      schemaState,
      "corrected",
      "applied correction ledger requires the corrected schema",
    );
  }
  assert.ok(stockState === "pending" || stockState === "applied");
  return Object.freeze({
    candidateState,
    stockState,
    schemaState,
    routineCount: ROUTINES.size,
    containsRowData: false,
    productionChanged: false,
  });
}

async function readLedger(client) {
  for (const [name, checksum] of [
    [MIGRATION, MIGRATION_SHA256],
    [OUTBOX_CORRECTION_MIGRATION, OUTBOX_CORRECTION_SHA256],
    [RESEND_RECOVERY_MIGRATION, RESEND_RECOVERY_SHA256],
    [STOCK_NOTIFICATION_MIGRATION, STOCK_NOTIFICATION_SHA256],
  ]) {
    assert.equal(sha256(migrationSql(name)), checksum, `${name} file drifted`);
  }
  const names = [
    MIGRATION,
    OUTBOX_CORRECTION_MIGRATION,
    RESEND_RECOVERY_MIGRATION,
    STOCK_NOTIFICATION_MIGRATION,
  ];
  const ledger = await client.query(`
    SELECT migration_name, checksum, finished_at, rolled_back_at,
           applied_steps_count
      FROM public._prisma_migrations
     WHERE migration_name = ANY($1::text[])
     ORDER BY migration_name, started_at
  `, [names]);
  migrationState(
    ledger.rows,
    RESEND_RECOVERY_MIGRATION,
    RESEND_RECOVERY_SHA256,
    { required: true },
  );
  migrationState(
    ledger.rows,
    OUTBOX_CORRECTION_MIGRATION,
    OUTBOX_CORRECTION_SHA256,
    { required: true },
  );
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
  const routines = await client.query(`
    SELECT routine.proname::text AS name,
           pg_catalog.pg_get_userbyid(routine.proowner)::text AS owner_name,
           routine.prosecdef AS security_definer,
           routine.provolatile::text AS volatility,
           routine.proparallel::text AS parallel,
           routine.proconfig AS config,
           pg_catalog.md5(routine.prosrc)::text AS source_hash,
           pg_catalog.has_function_privilege(
             'grainline_app_runtime', routine.oid, 'EXECUTE'
           ) AS runtime_execute,
           pg_catalog.has_function_privilege('public', routine.oid, 'EXECUTE')
             AS public_execute
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = ANY($1::regprocedure[])
     ORDER BY routine.proname
  `, [[...ROUTINES.values()].map(({ signature }) => signature)]);
  return Object.freeze({
    identity: Object.freeze(identity.rows[0]),
    routines: Object.freeze(routines.rows.map((row) => Object.freeze(row))),
  });
}

export async function inspect(mode, connectionString) {
  assert.ok(mode === "preflight" || mode === "postflight");
  const client = new pg.Client(databaseClientOptions(connectionString));
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const ledger = await readLedger(client);
    const catalog = await readCatalog(client);
    await client.query("COMMIT");
    if (mode === "postflight") assert.equal(ledger.candidateState, "applied");
    return Object.freeze({
      mode,
      ...ledger,
      ...verifyCatalog(catalog, ledger),
      runtimeProof: "full-chain PostgreSQL 17 CI",
    });
  } finally {
    await client.end();
  }
}

function evidencePath(mode) {
  return path.join(
    process.env.RUNNER_TEMP ?? "/tmp",
    `email-eligibility-lock-order-correction-${mode}.json`,
  );
}

function writeEvidence(mode, value) {
  writeFileSync(evidencePath(mode), `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
}

async function main() {
  const mode = process.argv[2];
  assert.ok(mode === "preflight" || mode === "postflight", "mode is invalid");
  const connectionString = process.env.DIRECT_URL;
  assert.ok(connectionString, "DIRECT_URL is required");
  const result = await inspect(mode, connectionString);
  const expectedPending = expectedPendingMigrations(result);
  const expectedAfter = expectedPendingMigrations({
    ...result,
    candidateState: "applied",
  });
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `state=${result.candidateState}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `schema_state=${result.schemaState}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `expected_pending=${expectedPending}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `expected_after=${expectedAfter}\n`);
  }
  writeEvidence(mode, result);
  process.stdout.write(`Email eligibility lock-order ${mode} accepted.\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    const mode = process.argv[2];
    if (mode === "preflight" || mode === "postflight") {
      writeEvidence(mode, {
        mode,
        inspectionAccepted: false,
        containsRowData: false,
        productionChanged: false,
      });
    }
    process.stderr.write(`${error instanceof Error ? error.message : "inspection failed"}\n`);
    process.exitCode = 1;
  });
}
