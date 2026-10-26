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
import { isReviewedSuccessfulMigration } from "./reviewed-manually-applied-migrations.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const MIGRATION =
  "20261025020000_fence_email_provider_and_account_deletion";
export const MIGRATION_SHA256 =
  "4d30904d8cb094b403ef9adc4d4268f979d408137aeb228b59a95bca7858cace";
export const REQUIRED_PREDECESSORS = Object.freeze(
  new Map([
    [
      "20261025010000_prepare_email_delivery_ledger",
      "4d30e75337b9713bca643b4b4c5db1a247e913995448ea89e09929e4fba0405d",
    ],
  ]),
);

export const FUNCTION_EXPECTATIONS = Object.freeze(
  new Map([
    [
      "public.grainline_email_outbox_source_owner(text,text)",
      Object.freeze({
        predecessorMd5: null,
        successorMd5: "f32d2865aba66aab667b098998cdb53d",
        securityDefiner: true,
        volatility: "s",
        runtimeExecute: false,
      }),
    ],
    [
      "public.grainline_email_outbox_lock_keys(text[],text[])",
      Object.freeze({
        predecessorMd5: null,
        successorMd5: "d2fff79ab3891fe7c80eeb7bcfe93e7f",
        securityDefiner: false,
        volatility: "v",
        runtimeExecute: false,
      }),
    ],
    [
      "public.grainline_email_outbox_enqueue_legacy(text,text,text,text,text,integer,text,text,text,text,text)",
      Object.freeze({
        predecessorMd5: null,
        successorMd5: "c175b462cf5427e2f15dddbcc9a4ec1a",
        securityDefiner: true,
        volatility: "v",
        runtimeExecute: true,
      }),
    ],
    [
      "public.grainline_email_outbox_begin_provider_attempt(text,bigint,uuid)",
      Object.freeze({
        predecessorMd5: "b0abfa8d5e33ad55edd0ab3e10362c38",
        successorMd5: "c1c8e556ba5a5da2c4cf176fc4397060",
        securityDefiner: true,
        volatility: "v",
        runtimeExecute: true,
      }),
    ],
    [
      "public.grainline_email_outbox_account_deletion_fence(text,text[])",
      Object.freeze({
        predecessorMd5: null,
        successorMd5: "508a22265993fde9d14c062a76630d76",
        securityDefiner: true,
        volatility: "v",
        runtimeExecute: true,
      }),
    ],
    [
      "public.grainline_email_outbox_fail(text,bigint,uuid,text,text)",
      Object.freeze({
        predecessorMd5: "c53166b8966de15f7f110cdbc46dd728",
        successorMd5: "cdfdfc38a37e4f7eda3df91fc1e98021",
        securityDefiner: true,
        volatility: "v",
        runtimeExecute: true,
      }),
    ],
  ]),
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function migrationPath(name) {
  return path.join(ROOT, "prisma/migrations", name, "migration.sql");
}

function repositoryChecksum(name) {
  return sha256(readFileSync(migrationPath(name)));
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

function immutableFunctionRows(rows) {
  return Object.freeze(
    rows.map((row) =>
      Object.freeze({
        ...row,
        function_config: Object.freeze([...(row.function_config ?? [])]),
        nonowner_acl: Object.freeze([...(row.nonowner_acl ?? [])]),
      }),
    ),
  );
}

export async function readFenceCatalog(client) {
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
              FROM pg_catalog.pg_attribute AS attribute
             WHERE attribute.attrelid = class.oid
               AND attribute.attname = ANY($1::text[])
               AND attribute.attnum > 0
               AND NOT attribute.attisdropped) AS required_column_count
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
      JOIN pg_catalog.pg_roles AS owner ON owner.oid = class.relowner
     WHERE namespace.nspname = 'public'
       AND class.relname = 'EmailOutbox'
       AND class.relkind = 'r'
  `, [[
    "recipientEmail", "userId", "preferenceKey", "templateName",
    "templateVersion", "sourceType", "sourceId", "subject", "html",
    "dedupKey", "status", "attempts", "claimGeneration", "claimToken",
    "processingStartedAt", "firstProviderAttemptAt",
    "providerAttemptGeneration", "providerMessageId", "nextAttemptAt",
    "sentAt", "lastError", "createdAt", "updatedAt",
  ]]);
  assert.equal(table.rows.length, 1, "EmailOutbox is missing or ambiguous");

  const identities = [...FUNCTION_EXPECTATIONS.keys()];
  const functions = await client.query(`
    WITH requested AS (
      SELECT identity, ordinal,
             pg_catalog.to_regprocedure(identity) AS oid
        FROM pg_catalog.unnest($1::text[]) WITH ORDINALITY AS item(identity, ordinal)
    )
    SELECT requested.identity,
           procedure.oid IS NOT NULL AS function_exists,
           pg_catalog.pg_get_userbyid(procedure.proowner)::text AS owner_name,
           owner.rolsuper AS owner_superuser,
           owner.rolbypassrls AS owner_bypass_rls,
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
           pg_catalog.has_function_privilege(
             'grainline_app_runtime', procedure.oid, 'EXECUTE'
           ) AS runtime_execute,
           pg_catalog.has_function_privilege('public', procedure.oid, 'EXECUTE')
             AS public_execute,
           ARRAY(
             SELECT pg_catalog.format(
               '%s:%s:%s',
               CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
                    ELSE pg_catalog.pg_get_userbyid(acl.grantee) END,
               acl.privilege_type,
               CASE WHEN acl.is_grantable THEN 'true' ELSE 'false' END
             )
               FROM pg_catalog.aclexplode(
                 COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
               ) AS acl
              WHERE acl.grantee <> procedure.proowner
              ORDER BY 1
           ) AS nonowner_acl
      FROM requested
      LEFT JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = requested.oid
      LEFT JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
      LEFT JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
     ORDER BY requested.ordinal
  `, [identities]);
  assert.equal(functions.rows.length, identities.length);

  const posture = await client.query(`
    WITH candidates AS (
      SELECT outbox.*,
             (
               (outbox."templateName" = 'seller_broadcast'
                AND outbox."preferenceKey" = 'EMAIL_SELLER_BROADCAST'
                AND outbox."sourceType" = 'seller_broadcast'
                AND EXISTS (
                  SELECT 1 FROM public."SellerBroadcast" AS broadcast
                   WHERE broadcast.id = outbox."sourceId"
                ))
               OR
               (outbox."templateName" = 'followed_maker_new_listing'
                AND outbox."preferenceKey" = 'EMAIL_FOLLOWED_MAKER_NEW_LISTING'
                AND outbox."sourceType" = 'followed_maker_new_listing'
                AND EXISTS (
                  SELECT 1 FROM public."Listing" AS listing
                   WHERE listing.id = outbox."sourceId"
                ))
             ) AS valid_source,
             (
               outbox."providerAttemptGeneration" IS NOT NULL
               AND outbox."providerMessageId" IS NULL
               AND (
                 outbox."firstProviderAttemptAt" IS NULL
                 OR outbox."firstProviderAttemptAt" >
                    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3)
                      - INTERVAL '23 hours'
               )
             ) AS provider_ambiguous
        FROM public."EmailOutbox" AS outbox
       WHERE (
         (outbox."templateName" = 'seller_broadcast'
          AND outbox."preferenceKey" = 'EMAIL_SELLER_BROADCAST')
         OR
         (outbox."templateName" = 'followed_maker_new_listing'
          AND outbox."preferenceKey" = 'EMAIL_FOLLOWED_MAKER_NEW_LISTING')
       )
    )
    SELECT pg_catalog.count(*) FILTER (
             WHERE (status IN ('PENDING', 'PROCESSING', 'FAILED') OR provider_ambiguous)
               AND NOT valid_source
           )::integer AS active_unresolved_source_count,
           pg_catalog.count(*) FILTER (
             WHERE provider_ambiguous AND NOT valid_source
           )::integer AS ambiguous_unresolved_source_count
      FROM candidates
  `);
  assert.equal(posture.rows.length, 1);

  return Object.freeze({
    identity: Object.freeze(identity.rows[0]),
    table: Object.freeze(table.rows[0]),
    functions: immutableFunctionRows(functions.rows),
    posture: Object.freeze(posture.rows[0]),
  });
}

function verifyExistingFunction(row, expected, sourceMd5) {
  assert.equal(row.function_exists, true, `${row.identity} is absent`);
  assert.equal(row.owner_name, "neondb_owner");
  assert.equal(
    row.owner_superuser || row.owner_bypass_rls,
    true,
    `${row.identity} owner cannot bypass RLS`,
  );
  assert.equal(row.language_name, "plpgsql");
  assert.equal(row.function_kind, "f");
  assert.equal(row.security_definer, expected.securityDefiner);
  assert.equal(row.leakproof, false);
  assert.equal(row.volatility, expected.volatility);
  assert.equal(row.parallel_safety, "u");
  assert.deepEqual(row.function_config, ["search_path=pg_catalog"]);
  assert.equal(row.source_md5, sourceMd5, `${row.identity} body drifted`);
  assert.equal(row.contains_dynamic_execute, false);
  assert.equal(row.runtime_execute, expected.runtimeExecute);
  assert.equal(row.public_execute, false);
  assert.deepEqual(
    row.nonowner_acl,
    expected.runtimeExecute
      ? ["grainline_app_runtime:EXECUTE:false"]
      : [],
  );
}

export function fenceSourceFamily(catalog) {
  const rows = new Map(catalog.functions.map((row) => [row.identity, row]));
  assert.equal(rows.size, FUNCTION_EXPECTATIONS.size);
  let predecessor = true;
  let successor = true;
  for (const [identity, expected] of FUNCTION_EXPECTATIONS) {
    const row = rows.get(identity);
    assert.ok(row, `${identity} inspection row is absent`);
    if (expected.predecessorMd5 === null) {
      predecessor &&= row.function_exists === false;
    } else {
      predecessor &&=
        row.function_exists === true && row.source_md5 === expected.predecessorMd5;
    }
    successor &&=
      row.function_exists === true && row.source_md5 === expected.successorMd5;
  }
  assert.equal(
    predecessor || successor,
    true,
    "email provider/deletion fence functions are mixed or drifted",
  );
  return successor ? "successor" : "predecessor";
}

export function verifyFenceCatalog(catalog, ledgerState) {
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
  assert.equal(catalog.table.owner_name, "neondb_owner");
  assert.equal(
    catalog.table.owner_superuser || catalog.table.owner_bypass_rls,
    true,
  );
  assert.equal(catalog.table.required_column_count, 23);
  const sourceFamily = fenceSourceFamily(catalog);
  for (const [identity, expected] of FUNCTION_EXPECTATIONS) {
    const row = catalog.functions.find((candidate) => candidate.identity === identity);
    if (sourceFamily === "predecessor" && expected.predecessorMd5 === null) {
      assert.equal(row.function_exists, false, `${identity} exists before release`);
      continue;
    }
    verifyExistingFunction(
      row,
      expected,
      sourceFamily === "successor"
        ? expected.successorMd5
        : expected.predecessorMd5,
    );
  }
  assert.ok(
    ledgerState === "pending" || ledgerState === "applied",
    "ledger state is invalid",
  );
  if (ledgerState === "applied") {
    assert.equal(sourceFamily, "successor", "applied ledger has predecessor functions");
  }
  if (sourceFamily === "successor") {
    assert.equal(catalog.posture.active_unresolved_source_count, 0);
    assert.equal(catalog.posture.ambiguous_unresolved_source_count, 0);
  }
  return Object.freeze({
    ledgerState,
    sourceFamily,
    rlsEnabled: catalog.table.rls_enabled,
    rlsForced: catalog.table.rls_forced,
    requiredColumnCount: catalog.table.required_column_count,
    activeUnresolvedSourceCount: catalog.posture.active_unresolved_source_count,
    ambiguousUnresolvedSourceCount:
      catalog.posture.ambiguous_unresolved_source_count,
    functionCount: catalog.functions.filter((row) => row.function_exists).length,
    containsRowData: false,
    productionChanged: false,
  });
}

export function fenceMigrationLedgerState(candidateRows) {
  assert.ok(Array.isArray(candidateRows), "candidate ledger rows are invalid");
  const successful = candidateRows.filter(isReviewedSuccessfulMigration);
  assert.ok(successful.length <= 1, "candidate has duplicate successful rows");
  if (successful.length === 1) {
    assert.equal(successful[0].migration_name, MIGRATION);
    assert.equal(successful[0].checksum, MIGRATION_SHA256);
  }
  const accepted = successful[0];
  assert.ok(
    candidateRows
      .filter((row) => row !== accepted)
      .every(
        (row) =>
          row.finished_at === null &&
          row.rolled_back_at !== null &&
          Number(row.applied_steps_count) === 0,
      ),
    "candidate has an unresolved or partial failed attempt",
  );
  return successful.length === 1 ? "applied" : "pending";
}

async function inspectLedger(client) {
  const directories = migrationDirectories();
  assert.equal(directories.at(-1), MIGRATION, "candidate is not the latest migration");
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
  for (const [name, checksum] of REQUIRED_PREDECESSORS) {
    assert.equal(repositoryChecksum(name), checksum, `${name} bytes drifted`);
  }
  return fenceMigrationLedgerState(byName.get(MIGRATION) ?? []);
}

function releaseState(ledgerState, sourceFamily) {
  if (ledgerState === "applied") return "applied";
  return sourceFamily === "successor" ? "applied_unrecorded" : "pending";
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

  const beforePath = path.join(
    process.env.RUNNER_TEMP,
    "email-provider-deletion-fence-preflight.json",
  );
  const parsedUrl = new URL(process.env.DIRECT_URL);
  const client = new pg.Client({
    connectionString: process.env.DIRECT_URL,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 45_000,
    query_timeout: 50_000,
    application_name: "grainline-email-provider-deletion-fence-release",
    ...postgresChannelBindingClientOptions(parsedUrl),
  });
  let transactionOpen = false;
  try {
    await client.connect();
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const ledgerState = await inspectLedger(client);
    const catalog = await readFenceCatalog(client);
    const result = verifyFenceCatalog(catalog, ledgerState);
    const state = releaseState(ledgerState, result.sourceFamily);
    if (mode === "preflight") {
      writeFileSync(beforePath, JSON.stringify({ state, result }, null, 2), {
        mode: 0o600,
        flag: "wx",
      });
      assert.ok(process.env.GITHUB_OUTPUT, "GITHUB_OUTPUT is missing");
      appendFileSync(process.env.GITHUB_OUTPUT, `state=${state}\n`);
    } else {
      assert.equal(state, "applied", "fence migration is not fully recorded");
      assert.equal(result.sourceFamily, "successor");
      const before = JSON.parse(readFileSync(beforePath, "utf8"));
      assert.ok(
        ["pending", "applied_unrecorded", "applied"].includes(before.state),
      );
      writeFileSync(
        path.join(process.env.RUNNER_TEMP, "email-provider-deletion-fence-result.json"),
        JSON.stringify(
          {
            status: "passed",
            migration: MIGRATION,
            migrationSha256: MIGRATION_SHA256,
            releaseCommit: process.env.PRODUCTION_MIGRATION_RELEASE_COMMIT,
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
