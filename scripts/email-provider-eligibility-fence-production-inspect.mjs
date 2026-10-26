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
  "20261025030000_fence_email_provider_and_eligibility_changes";
export const MIGRATION_SHA256 =
  "969aff03c7d720067d8a2d39057fed5048c12b60d521666aff7bce12ffd762e4";
export const REQUIRED_PREDECESSORS = Object.freeze(
  new Map([
    [
      "20261025020000_fence_email_provider_and_account_deletion",
      "4d30904d8cb094b403ef9adc4d4268f979d408137aeb228b59a95bca7858cace",
    ],
  ]),
);

export const REQUIRED_TABLE_COLUMNS = Object.freeze(
  new Map([
    [
      "EmailOutbox",
      Object.freeze([
        "recipientEmail", "userId", "preferenceKey", "templateName",
        "templateVersion", "sourceType", "sourceId", "subject", "html",
        "dedupKey", "status", "attempts", "claimGeneration", "claimToken",
        "processingStartedAt", "firstProviderAttemptAt",
        "providerAttemptGeneration", "providerMessageId", "nextAttemptAt",
        "sentAt", "lastError", "createdAt", "updatedAt",
      ]),
    ],
    [
      "EmailSuppression",
      Object.freeze([
        "id", "email", "reason", "source", "eventId", "details",
        "createdAt", "updatedAt",
      ]),
    ],
    [
      "NewsletterSubscriber",
      Object.freeze([
        "email", "active", "confirmationTokenHash",
        "confirmationExpiresAt", "confirmationSentAt", "deactivatedAt",
      ]),
    ],
    [
      "User",
      Object.freeze([
        "id", "clerkId", "email", "name", "imageUrl", "role", "banned",
        "bannedAt", "banReason", "bannedBy", "deletedAt",
        "notificationPreferences", "emailPreferenceOptInAt", "updatedAt",
      ]),
    ],
    [
      "OrderStaffCapability",
      Object.freeze([
        "id", "actorUserId", "targetUserId", "operation", "payloadHash",
        "expiresAt",
      ]),
    ],
  ]),
);

export const FUNCTION_EXPECTATIONS = Object.freeze(
  new Map([
    [
      "public.grainline_email_outbox_lock_keys(text[],text[])",
      Object.freeze({
        predecessorMd5: "d2fff79ab3891fe7c80eeb7bcfe93e7f",
        successorMd5: "d2fff79ab3891fe7c80eeb7bcfe93e7f",
        securityDefiner: false,
        volatility: "v",
        runtimeExecute: false,
      }),
    ],
    [
      "public.grainline_user_clerk_identity_ensure(text,text,text,boolean,text,boolean,text,boolean)",
      Object.freeze({
        predecessorMd5: "ddbd40600df8fe58f00661a900e44833",
        successorMd5: "980b4708924b99ce799e776ba5ae53e4",
        securityDefiner: true,
        volatility: "v",
        runtimeExecute: true,
      }),
    ],
    [
      "public.grainline_user_owner_notification_preference_update(text,text,boolean)",
      Object.freeze({
        predecessorMd5: "67a3a4e9ee00076393dd050daf2158b7",
        successorMd5: "8c060b5283d62a66048258b72a010965",
        securityDefiner: true,
        volatility: "v",
        runtimeExecute: true,
      }),
    ],
    [
      "public.grainline_user_unsubscribe_preferences_disable(text[])",
      Object.freeze({
        predecessorMd5: "d8f4e2a60455233fc7da9f19e242b0a9",
        successorMd5: "b4a20fbd4b9e6067390feb3a3a27f1cf",
        securityDefiner: true,
        volatility: "v",
        runtimeExecute: true,
      }),
    ],
    [
      "public.grainline_user_staff_ban_apply(text,text,timestamp without time zone,text)",
      Object.freeze({
        predecessorMd5: "1ad3e2eb194e15d04ff5b8eecfca4ae6",
        successorMd5: "eb9f9b2504e4c82f4c2d70a40fd20470",
        securityDefiner: true,
        volatility: "v",
        runtimeExecute: true,
      }),
    ],
    [
      "public.grainline_email_hard_suppression_apply(text,text,\"EmailSuppressionReason\",text,text,jsonb)",
      Object.freeze({
        predecessorMd5: null,
        successorMd5: "5c7cc8e30af90ba3ca6bc6c3eb3e987d",
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
      })
    ),
  );
}

async function readTableCatalog(client) {
  const rows = [];
  for (const [tableName, requiredColumns] of REQUIRED_TABLE_COLUMNS) {
    const result = await client.query(`
      SELECT $1::text AS table_name,
             pg_catalog.pg_get_userbyid(class.relowner)::text AS owner_name,
             owner.rolsuper AS owner_superuser,
             owner.rolbypassrls AS owner_bypass_rls,
             (SELECT pg_catalog.count(*)::integer
                FROM pg_catalog.pg_attribute AS attribute
               WHERE attribute.attrelid = class.oid
                 AND attribute.attname = ANY($2::text[])
                 AND attribute.attnum > 0
                 AND NOT attribute.attisdropped) AS required_column_count
        FROM pg_catalog.pg_class AS class
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = class.relnamespace
        JOIN pg_catalog.pg_roles AS owner ON owner.oid = class.relowner
       WHERE namespace.nspname = 'public'
         AND class.relname = $1
         AND class.relkind = 'r'
    `, [tableName, requiredColumns]);
    assert.equal(result.rows.length, 1, `${tableName} is missing or ambiguous`);
    rows.push(Object.freeze(result.rows[0]));
  }
  return Object.freeze(rows);
}

export async function readEligibilityFenceCatalog(client) {
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

  const tables = await readTableCatalog(client);
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

  return Object.freeze({
    identity: Object.freeze(identity.rows[0]),
    tables,
    functions: immutableFunctionRows(functions.rows),
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

export function eligibilityFenceSourceFamily(catalog) {
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
    "email provider/eligibility fence functions are mixed or drifted",
  );
  return successor ? "successor" : "predecessor";
}

export function verifyEligibilityFenceCatalog(catalog, ledgerState) {
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
  assert.equal(catalog.tables.length, REQUIRED_TABLE_COLUMNS.size);
  for (const [tableName, requiredColumns] of REQUIRED_TABLE_COLUMNS) {
    const row = catalog.tables.find((candidate) => candidate.table_name === tableName);
    assert.ok(row, `${tableName} inspection row is absent`);
    assert.equal(row.owner_name, "neondb_owner");
    assert.equal(row.owner_superuser || row.owner_bypass_rls, true);
    assert.equal(row.required_column_count, requiredColumns.length);
  }

  const sourceFamily = eligibilityFenceSourceFamily(catalog);
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
  return Object.freeze({
    ledgerState,
    sourceFamily,
    tableCount: catalog.tables.length,
    functionCount: catalog.functions.filter((row) => row.function_exists).length,
    containsRowData: false,
    productionChanged: false,
  });
}

export function eligibilityFenceMigrationLedgerState(candidateRows) {
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
          row.finished_at === null
          && row.rolled_back_at !== null
          && Number(row.applied_steps_count) === 0,
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
  return eligibilityFenceMigrationLedgerState(byName.get(MIGRATION) ?? []);
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
    "email-provider-eligibility-fence-preflight.json",
  );
  const parsedUrl = new URL(process.env.DIRECT_URL);
  const client = new pg.Client({
    connectionString: process.env.DIRECT_URL,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 45_000,
    query_timeout: 50_000,
    application_name: "grainline-email-provider-eligibility-fence-release",
    ...postgresChannelBindingClientOptions(parsedUrl),
  });
  let transactionOpen = false;
  try {
    await client.connect();
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const ledgerState = await inspectLedger(client);
    const catalog = await readEligibilityFenceCatalog(client);
    const result = verifyEligibilityFenceCatalog(catalog, ledgerState);
    const state = releaseState(ledgerState, result.sourceFamily);
    if (mode === "preflight") {
      writeFileSync(beforePath, JSON.stringify({ state, result }, null, 2), {
        mode: 0o600,
        flag: "wx",
      });
      assert.ok(process.env.GITHUB_OUTPUT, "GITHUB_OUTPUT is missing");
      appendFileSync(process.env.GITHUB_OUTPUT, `state=${state}\n`);
    } else {
      assert.equal(state, "applied", "eligibility fence is not fully recorded");
      assert.equal(result.sourceFamily, "successor");
      const before = JSON.parse(readFileSync(beforePath, "utf8"));
      assert.ok(
        ["pending", "applied_unrecorded", "applied"].includes(before.state),
      );
      writeFileSync(
        path.join(
          process.env.RUNNER_TEMP,
          "email-provider-eligibility-fence-result.json",
        ),
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
