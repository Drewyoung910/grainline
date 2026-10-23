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
  "20261023030000_correct_user_unsubscribe_optional_email_preferences";
export const MIGRATION_SHA256 =
  "996378ebae18adffe66dedab3ca9f02f80b0a1907eee162db1f9692d040d65c7";
export const PREDECESSOR_SOURCE_MD5 = "11485f55b3bec34f2091430245a4a2cf";
export const CORRECTED_SOURCE_MD5 = "d8f4e2a60455233fc7da9f19e242b0a9";
export const FUNCTION_IDENTITY =
  "public.grainline_user_unsubscribe_preferences_disable(text[])";

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

export async function readCorrectionCatalog(client) {
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

  const table = await client.query(`
    SELECT pg_catalog.pg_get_userbyid(class.relowner)::text AS owner_name,
           class.relrowsecurity AS rls_enabled,
           class.relforcerowsecurity AS rls_forced,
           (SELECT pg_catalog.count(*)::integer
              FROM pg_catalog.pg_policy AS policy
             WHERE policy.polrelid = class.oid) AS policy_count
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname = 'User'
       AND class.relkind = 'r'
  `);
  assert.equal(table.rows.length, 1, "User table is missing or ambiguous");

  const functions = await client.query(`
    WITH requested AS (
      SELECT $1::text AS identity,
             pg_catalog.to_regprocedure($1) AS oid
    )
    SELECT requested.identity,
           pg_catalog.pg_get_userbyid(procedure.proowner)::text AS owner_name,
           owner_role.rolsuper AS owner_superuser,
           owner_role.rolbypassrls AS owner_bypass_rls,
           language.lanname::text AS language_name,
           procedure.prokind AS function_kind,
           procedure.prosecdef AS security_definer,
           procedure.proleakproof AS leakproof,
           procedure.provolatile AS volatility,
           procedure.proparallel AS parallel_safety,
           COALESCE(procedure.proconfig, ARRAY[]::text[]) AS function_config,
           pg_catalog.md5(procedure.prosrc) AS source_md5,
           pg_catalog.strpos(pg_catalog.upper(procedure.prosrc), 'EXECUTE') > 0
             AS contains_dynamic_execute,
           ARRAY(
             SELECT pg_catalog.format(
               '%s:%s:%s',
               CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
                    ELSE pg_catalog.pg_get_userbyid(acl.grantee) END,
               acl.privilege_type,
               CASE WHEN acl.is_grantable THEN 'true' ELSE 'false' END
             )
               FROM pg_catalog.aclexplode(
                 COALESCE(
                   procedure.proacl,
                   pg_catalog.acldefault('f', procedure.proowner)
                 )
               ) AS acl
              WHERE acl.grantee <> procedure.proowner
              ORDER BY 1
           ) AS nonowner_acl
      FROM requested
      JOIN pg_catalog.pg_proc AS procedure
        ON procedure.oid = requested.oid
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      JOIN pg_catalog.pg_roles AS owner_role
        ON owner_role.oid = procedure.proowner
      JOIN pg_catalog.pg_language AS language
        ON language.oid = procedure.prolang
  `, [FUNCTION_IDENTITY]);
  assert.equal(functions.rows.length, 1, "unsubscribe function is missing");

  return Object.freeze({
    identity: Object.freeze(identity.rows[0]),
    table: Object.freeze(table.rows[0]),
    function: Object.freeze({
      ...functions.rows[0],
      function_config: Object.freeze([
        ...(functions.rows[0].function_config ?? []),
      ]),
      nonowner_acl: Object.freeze([
        ...(functions.rows[0].nonowner_acl ?? []),
      ]),
    }),
  });
}

export function verifyCorrectionCatalog(catalog, state) {
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
  assert.deepEqual(catalog.table, {
    owner_name: "neondb_owner",
    rls_enabled: true,
    rls_forced: true,
    policy_count: 0,
  });
  assert.equal(catalog.function.identity, FUNCTION_IDENTITY);
  assert.equal(catalog.function.owner_name, "neondb_owner");
  assert.equal(
    catalog.function.owner_superuser || catalog.function.owner_bypass_rls,
    true,
  );
  assert.equal(catalog.function.language_name, "plpgsql");
  assert.equal(catalog.function.function_kind, "f");
  assert.equal(catalog.function.security_definer, true);
  assert.equal(catalog.function.leakproof, false);
  assert.equal(catalog.function.volatility, "v");
  assert.equal(catalog.function.parallel_safety, "u");
  assert.deepEqual(catalog.function.function_config, ["search_path=pg_catalog"]);
  assert.equal(catalog.function.contains_dynamic_execute, false);
  assert.deepEqual(
    catalog.function.nonowner_acl,
    ["grainline_app_runtime:EXECUTE:false"],
  );
  assert.equal(
    catalog.function.source_md5,
    state === "pending" ? PREDECESSOR_SOURCE_MD5 : CORRECTED_SOURCE_MD5,
  );
  return Object.freeze({
    state,
    sourceMd5: catalog.function.source_md5,
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
  assert.ok(candidateRows.length <= 1, "candidate ledger is duplicated");
  const candidate = candidateRows[0] ?? null;
  if (candidate) {
    assert.equal(candidate.checksum, MIGRATION_SHA256);
    assert.ok(candidate.finished_at);
    assert.equal(candidate.rolled_back_at, null);
    assert.equal(Number(candidate.applied_steps_count), 1);
  }
  return candidate ? "applied" : "pending";
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
    "user-unsubscribe-optional-preferences-preflight.json",
  );
  const parsedUrl = new URL(process.env.DIRECT_URL);
  const client = new pg.Client({
    connectionString: process.env.DIRECT_URL,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 45_000,
    query_timeout: 50_000,
    application_name: "grainline-user-unsubscribe-optional-preferences-release",
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
    const catalog = await readCorrectionCatalog(client);
    const result = verifyCorrectionCatalog(catalog, state);
    if (mode === "preflight") {
      writeFileSync(snapshotPath, JSON.stringify({ state, catalog }), {
        mode: 0o600,
        flag: "wx",
      });
      assert.ok(process.env.GITHUB_OUTPUT, "GITHUB_OUTPUT is missing");
      appendFileSync(process.env.GITHUB_OUTPUT, `state=${state}\n`);
    } else {
      assert.equal(state, "applied", "correction is not applied");
      const before = JSON.parse(readFileSync(snapshotPath, "utf8"));
      assert.ok(before.state === "pending" || before.state === "applied");
      assert.equal(
        before.catalog.function.source_md5,
        before.state === "pending"
          ? PREDECESSOR_SOURCE_MD5
          : CORRECTED_SOURCE_MD5,
      );
      writeFileSync(
        path.join(
          process.env.RUNNER_TEMP,
          "user-unsubscribe-optional-preferences.json",
        ),
        JSON.stringify({ status: "passed", migration: MIGRATION, result }, null, 2),
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
