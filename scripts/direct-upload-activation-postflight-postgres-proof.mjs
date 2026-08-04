#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  DIRECT_UPLOAD_ACTIVATION_FUNCTIONS,
} from "./direct-upload-activation-catalog.mjs";
import {
  DIRECT_UPLOAD_ACTIVATION_ACCEPTED_COMMIT,
  DIRECT_UPLOAD_ACTIVATION_RECOVERY_RUN_ID,
  readDirectUploadActivationPostflightGitState,
  runDirectUploadActivationPostflight,
} from "./direct-upload-activation-production-postflight.mjs";

const { Client } = pg;
const DATABASE_ENV = "DIRECT_UPLOAD_ACTIVATION_POSTFLIGHT_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const FIXTURE_OWNER = "ci";
const PRODUCTION_OWNER = "neondb_owner";

function connect(databaseUrl, applicationName) {
  return new Client({
    connectionString: databaseUrl,
    application_name: applicationName,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
  });
}

export function parseDirectUploadActivationPostflightProofConfig(
  env = process.env,
) {
  const databaseUrl = env[DATABASE_ENV];
  assert.ok(databaseUrl, `${DATABASE_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "DirectUpload activation postflight proof refuses a non-loopback database",
  );
  assert.equal(parsed.pathname, `/${DATABASE_NAME}`);
  assert.equal(decodeURIComponent(parsed.username), FIXTURE_OWNER);
  return Object.freeze({ databaseUrl });
}

function restrictedRoleUrl(databaseUrl, role) {
  const parsed = new URL(databaseUrl);
  parsed.username = role;
  parsed.password = "ci";
  return parsed.toString();
}

function functionIdentity(entry) {
  return `public."${entry.name}"(${entry.identityArguments})`;
}

async function readFunctionOwners(client) {
  return (await client.query(`
    SELECT
      procedure.proname AS function_name,
      pg_catalog.oidvectortypes(procedure.proargtypes) AS identity_arguments,
      pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname = ANY($1::text[])
    ORDER BY procedure.proname
  `, [DIRECT_UPLOAD_ACTIVATION_FUNCTIONS.map((entry) => entry.name)])).rows;
}

function assertFunctionOwners(rows, expectedOwner) {
  const expected = DIRECT_UPLOAD_ACTIVATION_FUNCTIONS
    .map((entry) => ({
      function_name: entry.name,
      identity_arguments: entry.identityArguments,
      owner_name: expectedOwner,
    }))
    .sort((left, right) =>
      left.function_name.localeCompare(right.function_name));
  assert.deepEqual(rows, expected);
}

async function changeFunctionOwners(client, expectedOwner, nextOwner) {
  assertFunctionOwners(await readFunctionOwners(client), expectedOwner);
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    for (const entry of DIRECT_UPLOAD_ACTIVATION_FUNCTIONS) {
      await client.query(
        `ALTER FUNCTION ${functionIdentity(entry)} OWNER TO "${nextOwner}"`,
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
  assertFunctionOwners(await readFunctionOwners(client), nextOwner);
}

async function assertMigrationLedgerDenied(databaseUrl, expectedRole) {
  const client = connect(
    databaseUrl,
    `grainline-direct-upload-postflight-ledger-denial-${expectedRole}`,
  );
  try {
    await client.connect();
    const identity = (await client.query(`
      SELECT
        current_user AS current_user,
        session_user AS session_user,
        pg_catalog.has_table_privilege(
          current_user,
          'public._prisma_migrations',
          'SELECT'
        ) AS can_select_migration_ledger
    `)).rows[0];
    assert.deepEqual(identity, {
      can_select_migration_ledger: false,
      current_user: expectedRole,
      session_user: expectedRole,
    });
    let caught;
    try {
      await client.query(`SELECT 1 FROM public._prisma_migrations LIMIT 1`);
    } catch (error) {
      caught = error;
    }
    assert.equal(
      caught?.code,
      "42501",
      `${expectedRole} migration-ledger read did not fail closed`,
    );
  } finally {
    await client.end().catch(() => {});
  }
}

export async function proveDirectUploadActivationPostflights(config) {
  const releaseCommit = readDirectUploadActivationPostflightGitState().head;
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "direct-upload-restricted-postflights-"),
  );
  const owner = connect(
    config.databaseUrl,
    "grainline-direct-upload-postflight-owner-fixture",
  );
  let ownerChanged = false;
  try {
    await owner.connect();
    const ownerIdentity = (await owner.query(`
      SELECT current_database() AS database_name, current_user AS current_user
    `)).rows[0];
    assert.deepEqual(ownerIdentity, {
      current_user: FIXTURE_OWNER,
      database_name: DATABASE_NAME,
    });
    await changeFunctionOwners(owner, FIXTURE_OWNER, PRODUCTION_OWNER);
    ownerChanged = true;

    const results = [];
    for (const selected of [
      { mode: "runtime", role: "grainline_app_runtime", runId: null },
      {
        mode: "cleanup",
        role: "grainline_direct_upload_cleanup_v2",
        runId: "1",
      },
    ]) {
      const roleDatabaseUrl = restrictedRoleUrl(
        config.databaseUrl,
        selected.role,
      );
      await assertMigrationLedgerDenied(roleDatabaseUrl, selected.role);
      const evidencePath = path.join(
        directory,
        `direct-upload-activation-${selected.mode}-postflight-${releaseCommit}.json`,
      );
      const evidence = await runDirectUploadActivationPostflight({
        activationCommit: DIRECT_UPLOAD_ACTIVATION_ACCEPTED_COMMIT,
        databaseUrl: roleDatabaseUrl,
        databaseUrlSha256: createHash("sha256")
          .update(roleDatabaseUrl, "utf8")
          .digest("hex"),
        evidencePath,
        mainCiRunId: 1,
        mode: selected.mode,
        recoveryRunId: DIRECT_UPLOAD_ACTIVATION_RECOVERY_RUN_ID,
        releaseCommit,
        runId: selected.runId,
      });
      assert.equal(evidence.status, "passed");
      assert.equal(evidence.target.mode, selected.mode);
      assert.equal(evidence.target.role, selected.role);
      assert.equal(evidence.proof.postflightReadOnly, true);
      assert.equal(evidence.productionChangedByPostflight, false);
      assert.equal(statSync(evidencePath).mode & 0o777, 0o600);
      assert.deepEqual(
        JSON.parse(readFileSync(evidencePath, "utf8")),
        evidence,
      );
      results.push(Object.freeze({
        ledgerSelectDenied: true,
        mode: selected.mode,
        postflightReadOnly: true,
      }));
    }
    return Object.freeze({
      fixtureOwnerRestored: true,
      persistentEnvironmentChanged: false,
      productionChanged: false,
      restrictedRolePostflights: Object.freeze(results),
      status: "passed",
    });
  } finally {
    if (ownerChanged) {
      await changeFunctionOwners(owner, PRODUCTION_OWNER, FIXTURE_OWNER);
    }
    await owner.end().catch(() => {});
    rmSync(directory, { recursive: true, force: true });
  }
}

async function main() {
  try {
    const config = parseDirectUploadActivationPostflightProofConfig();
    const result = await proveDirectUploadActivationPostflights(config);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `DirectUpload activation postflight PostgreSQL proof failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
