#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import pg from "pg";

import { assertReviewedPeerMigrationLedger } from "./order-refund-immutable-event-production-ledger.mjs";
import { postgresChannelBindingClientOptions } from "./postgres-url-safety.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const MIGRATION =
  "20261023040000_repair_resend_failed_event_suppressions";
export const MIGRATION_SHA256 =
  "7f438ca723b05cf2e91a581f48223c0a577fc58715e22ff7176de4206ad8a2c8";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function migrationPath(name) {
  return path.join(ROOT, "prisma/migrations", name, "migration.sql");
}

function migrationDirectories() {
  return readdirSync(path.join(ROOT, "prisma/migrations"), {
    withFileTypes: true,
  })
    .filter(
      (entry) =>
        entry.isDirectory() && /^[0-9]{14}_[a-z0-9_]+$/u.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
}

function repositoryChecksum(name) {
  return sha256(readFileSync(migrationPath(name)));
}

export async function readRecoveryCatalog(client) {
  const identity = await client.query(`
    SELECT CURRENT_USER::text AS current_user,
           SESSION_USER::text AS session_user,
           pg_catalog.current_database()::text AS database_name,
           pg_catalog.current_setting('transaction_read_only') AS read_only,
           pg_catalog.current_setting('transaction_isolation') AS isolation,
           owner_role.rolsuper AS owner_superuser,
           owner_role.rolbypassrls AS owner_bypass_rls,
           runtime_role.rolsuper AS runtime_superuser,
           runtime_role.rolbypassrls AS runtime_bypass_rls,
           runtime_role.rolinherit AS runtime_inherit
      FROM pg_catalog.pg_roles AS owner_role
      JOIN pg_catalog.pg_roles AS runtime_role
        ON runtime_role.rolname = 'grainline_app_runtime'
     WHERE owner_role.rolname = CURRENT_USER
  `);
  assert.equal(identity.rows.length, 1, "database roles are missing or ambiguous");

  const tables = await client.query(`
    SELECT class.relname AS table_name,
           pg_catalog.pg_get_userbyid(class.relowner)::text AS owner_name
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname = ANY($1::text[])
       AND class.relkind = 'r'
     ORDER BY class.relname
  `, [["EmailFailureCount", "EmailSuppression"]]);
  assert.equal(tables.rows.length, 2, "email suppression tables are missing");

  const counts = await client.query(`
    SELECT
      (SELECT pg_catalog.count(*)::integer
         FROM public."EmailSuppression"
        WHERE source = 'resend_transient_failure'
          AND reason = 'BOUNCE'::public."EmailSuppressionReason")
        AS incorrect_suppression_count,
      (SELECT pg_catalog.count(*)::integer
         FROM public."EmailSuppression"
        WHERE source = 'resend_transient_failure'
          AND reason <> 'BOUNCE'::public."EmailSuppressionReason")
        AS unexpected_legacy_source_count,
      (SELECT pg_catalog.count(*)::integer
         FROM public."EmailFailureCount") AS obsolete_counter_count
  `);
  assert.equal(counts.rows.length, 1, "email suppression counts are ambiguous");

  return Object.freeze({
    identity: Object.freeze(identity.rows[0]),
    tables: Object.freeze(tables.rows.map((row) => Object.freeze(row))),
    counts: Object.freeze(counts.rows[0]),
  });
}

export function verifyRecoveryCatalog(catalog, state) {
  assert.ok(state === "pending" || state === "applied", "state is invalid");
  assert.deepEqual(catalog.identity, {
    current_user: "neondb_owner",
    session_user: "neondb_owner",
    database_name: "neondb",
    read_only: "on",
    isolation: "repeatable read",
    owner_superuser: false,
    owner_bypass_rls: true,
    runtime_superuser: false,
    runtime_bypass_rls: false,
    runtime_inherit: false,
  });
  assert.deepEqual(catalog.tables, [
    { table_name: "EmailFailureCount", owner_name: "neondb_owner" },
    { table_name: "EmailSuppression", owner_name: "neondb_owner" },
  ]);
  assert.equal(
    Number(catalog.counts.unexpected_legacy_source_count),
    0,
    "legacy source contains an unreviewed suppression reason",
  );
  if (state === "applied") {
    assert.equal(Number(catalog.counts.incorrect_suppression_count), 0);
    assert.equal(Number(catalog.counts.obsolete_counter_count), 0);
  }
  return Object.freeze({
    state,
    incorrectSuppressionCount: Number(
      catalog.counts.incorrect_suppression_count,
    ),
    unexpectedLegacySourceCount: Number(
      catalog.counts.unexpected_legacy_source_count,
    ),
    obsoleteCounterCount: Number(catalog.counts.obsolete_counter_count),
    rowDataRead: false,
    productionChanged: false,
  });
}

async function inspectLedger(client) {
  const directories = migrationDirectories();
  assert.ok(directories.includes(MIGRATION), "candidate migration is missing");
  assert.equal(repositoryChecksum(MIGRATION), MIGRATION_SHA256);
  const ledger = await client.query(`
    SELECT migration_name, checksum, finished_at, rolled_back_at,
           applied_steps_count
      FROM public._prisma_migrations
     WHERE migration_name = ANY($1::text[])
     ORDER BY migration_name, started_at
  `, [directories]);
  const byName = new Map();
  for (const row of ledger.rows) {
    const rows = byName.get(row.migration_name) ?? [];
    rows.push(row);
    byName.set(row.migration_name, rows);
  }
  for (const peer of directories.filter((name) => name !== MIGRATION)) {
    assertReviewedPeerMigrationLedger({
      migrationName: peer,
      repositoryChecksum: repositoryChecksum(peer),
      rows: byName.get(peer) ?? [],
    });
  }
  const candidateRows = byName.get(MIGRATION) ?? [];
  if (candidateRows.length === 0) return "pending";
  assertReviewedPeerMigrationLedger({
    migrationName: MIGRATION,
    repositoryChecksum: MIGRATION_SHA256,
    rows: candidateRows,
  });
  return "applied";
}

async function main() {
  const mode = process.argv[2];
  assert.ok(mode === "preflight" || mode === "postflight", "mode is invalid");
  assert.ok(process.env.DIRECT_URL, "DIRECT_URL is missing");
  assert.ok(process.env.RUNNER_TEMP, "RUNNER_TEMP is missing");
  assert.equal(
    Object.hasOwn(process.env, "DATABASE_URL"),
    false,
    "DATABASE_URL must remain absent from owner inspection",
  );
  const snapshotPath = path.join(
    process.env.RUNNER_TEMP,
    "email-suppression-recovery-preflight.json",
  );
  const parsedUrl = new URL(process.env.DIRECT_URL);
  const client = new pg.Client({
    connectionString: process.env.DIRECT_URL,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 45_000,
    query_timeout: 50_000,
    application_name: "grainline-email-suppression-recovery-release",
    ...postgresChannelBindingClientOptions(parsedUrl),
  });
  let transactionOpen = false;
  try {
    await client.connect();
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    transactionOpen = true;
    const state = await inspectLedger(client);
    const catalog = await readRecoveryCatalog(client);
    const result = verifyRecoveryCatalog(catalog, state);
    if (mode === "preflight") {
      writeFileSync(snapshotPath, JSON.stringify({ state, result }), {
        mode: 0o600,
        flag: "wx",
      });
      assert.ok(process.env.GITHUB_OUTPUT, "GITHUB_OUTPUT is missing");
      appendFileSync(process.env.GITHUB_OUTPUT, `state=${state}\n`);
    } else {
      assert.equal(state, "applied", "recovery migration is not applied");
      const before = JSON.parse(readFileSync(snapshotPath, "utf8"));
      assert.ok(before.state === "pending" || before.state === "applied");
      writeFileSync(
        path.join(process.env.RUNNER_TEMP, "email-suppression-recovery.json"),
        JSON.stringify(
          {
            status: "passed",
            migration: MIGRATION,
            before: before.result,
            after: result,
            containsRowData: false,
          },
          null,
          2,
        ),
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
