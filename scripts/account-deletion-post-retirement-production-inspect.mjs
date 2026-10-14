#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

import { parseGuardedNeonDatabaseIdentity } from "./guard-saved-search-rls-deploy.mjs";
import {
  assertDeterministicPostgresEnvironment,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";

const { Client } = pg;

export const RETIREMENT_MIGRATION =
  "20261015010000_retire_seller_profile_private_predecessor";
export const RETIREMENT_CHECKSUM =
  "d111e615a40cd0c2936eeb137db23c5fbcc63c7acb81bce27a36d71229963b3a";
export const REPAIR_MIGRATION =
  "20261015013000_repair_account_deletion_after_seller_profile_retirement";
export const REPAIR_CHECKSUM =
  "c2884361016a554b28afebe58776938faf695c39c86fb22c9d40c87949e02368";

const reviewedTarget = Object.freeze({
  endpointId: "ep-plain-river-aaqg8gj4",
  databaseName: "neondb",
  region: "westus3.azure",
  username: "neondb_owner",
});
const expectedStates = new Set(["compatible", "pending", "repaired"]);
const releaseCommitPattern = /^[0-9a-f]{40}$/u;

function required(env, name) {
  const value = env?.[name];
  assert.ok(
    typeof value === "string" && value !== "" && value === value.trim(),
    `${name} is required`,
  );
  return value;
}

export function parsePostRetirementInspectionConfig(env = process.env) {
  assertDeterministicPostgresEnvironment(
    env,
    "account deletion post-retirement production inspection",
  );
  const directUrl = required(env, "DIRECT_URL");
  const releaseCommit = required(env, "ACCOUNT_DELETION_REPAIR_RELEASE_COMMIT");
  const expectedState = required(env, "ACCOUNT_DELETION_REPAIR_EXPECTED_STATE");
  const evidencePath = path.resolve(
    required(env, "ACCOUNT_DELETION_REPAIR_EVIDENCE_PATH"),
  );
  assert.match(releaseCommit, releaseCommitPattern);
  assert.ok(expectedStates.has(expectedState), "unsupported repair expected state");
  const identity = parseGuardedNeonDatabaseIdentity(directUrl, "DIRECT_URL");
  assert.deepEqual(
    {
      endpointId: identity.endpointId,
      databaseName: identity.databaseName,
      region: identity.region,
      username: identity.username,
    },
    reviewedTarget,
  );
  assert.equal(identity.isPooler, false, "repair inspection requires the direct endpoint");
  return Object.freeze({
    directUrl,
    releaseCommit,
    expectedState,
    evidencePath,
    directUrlSha256: createHash("sha256").update(directUrl).digest("hex"),
    channelBinding: postgresChannelBindingClientOptions(new URL(directUrl)),
  });
}

function acceptedMigration(rows, migration, checksum) {
  const attempts = rows.filter((row) => row.migration_name === migration);
  for (const row of attempts) assert.equal(row.checksum, checksum, migration);
  const successes = attempts.filter(
    (row) =>
      row.finished && !row.rolled_back && row.applied_steps_count === 1,
  );
  assert.ok(successes.length <= 1, `${migration} has duplicate successes`);
  for (const row of attempts) {
    if (!successes.includes(row)) {
      assert.equal(row.rolled_back, true, `${migration} has an unresolved failed attempt`);
    }
  }
  return successes.length === 1;
}

function repairedDefinitions(functions) {
  const byIdentity = new Map(functions.map((row) => [row.identity, row]));
  const claim = byIdentity.get(
    "grainline_account_deletion_side_effect_claim(text)",
  );
  const scrub = byIdentity.get(
    "grainline_order_account_deletion_scrub(text,text[])",
  );
  assert.ok(claim && scrub, "required account-deletion functions are missing");
  const repaired =
    /source_effect\."userId"::text/u.test(claim.definition) &&
    /source_effect\.kind::text/u.test(claim.definition) &&
    !/SellerProfile"%ROWTYPE/u.test(scrub.definition) &&
    /SellerProfilePrivate/u.test(scrub.definition);
  return Object.freeze({ repaired, byIdentity, claim, scrub });
}

function functionPosture(row) {
  return Object.freeze({
    identity: row.identity,
    oid: String(row.oid),
    owner: row.owner,
    securityDefiner: row.security_definer,
    volatility: row.volatility,
    parallelSafety: row.parallel_safety,
    config: row.config ?? [],
    runtimeExecute: row.runtime_execute,
    workerExecute: row.worker_execute,
    publicExecute: row.public_execute,
  });
}

export async function inspectPostRetirementState(config) {
  const client = new Client({
    connectionString: config.directUrl,
    ...config.channelBinding,
    application_name: "grainline-account-deletion-post-retirement-inspection",
  });
  let open = false;
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    open = true;
    const ledger = (
      await client.query(
        `SELECT migration_name, checksum,
                finished_at IS NOT NULL AS finished,
                rolled_back_at IS NOT NULL AS rolled_back,
                applied_steps_count::int AS applied_steps_count
           FROM public._prisma_migrations
          WHERE migration_name = ANY($1::text[])
          ORDER BY migration_name, started_at`,
        [[RETIREMENT_MIGRATION, REPAIR_MIGRATION]],
      )
    ).rows;
    assert.equal(
      acceptedMigration(ledger, RETIREMENT_MIGRATION, RETIREMENT_CHECKSUM),
      true,
      "required SellerProfile predecessor retirement is absent",
    );
    const repairApplied = acceptedMigration(
      ledger,
      REPAIR_MIGRATION,
      REPAIR_CHECKSUM,
    );
    const retiredColumnCount = Number(
      (
        await client.query(`SELECT pg_catalog.count(*)::int AS count
          FROM pg_catalog.pg_attribute
         WHERE attrelid = 'public."SellerProfile"'::regclass
           AND attnum > 0 AND NOT attisdropped
           AND attname = ANY(ARRAY['shipFromName','shipFromLine1','stripeAccountId']::name[])`)
      ).rows[0].count,
    );
    assert.equal(retiredColumnCount, 0);
    const functions = (
      await client.query(`SELECT procedure.oid::text AS oid,
          procedure.oid::regprocedure::text AS identity,
          owner.rolname AS owner,
          procedure.prosecdef AS security_definer,
          procedure.provolatile AS volatility,
          procedure.proparallel AS parallel_safety,
          procedure.proconfig AS config,
          pg_catalog.pg_get_functiondef(procedure.oid) AS definition,
          pg_catalog.has_function_privilege('grainline_app_runtime', procedure.oid, 'EXECUTE') AS runtime_execute,
          pg_catalog.has_function_privilege('grainline_account_deletion_runtime', procedure.oid, 'EXECUTE') AS worker_execute,
          pg_catalog.has_function_privilege('public', procedure.oid, 'EXECUTE') AS public_execute
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
       WHERE procedure.oid IN (
         'public.grainline_account_deletion_side_effect_claim(text)'::regprocedure,
         'public.grainline_order_account_deletion_scrub(text,text[])'::regprocedure
       ) ORDER BY identity`)
    ).rows;
    assert.equal(functions.length, 2);
    const definitions = repairedDefinitions(functions);
    assert.equal(
      repairApplied,
      definitions.repaired,
      "repair ledger and function definitions disagree",
    );
    const actualState = repairApplied ? "repaired" : "pending";
    if (config.expectedState !== "compatible") {
      assert.equal(actualState, config.expectedState);
    }

    const backlog = (
      await client.query(`SELECT status, kind,
          pg_catalog.count(*)::int AS count,
          pg_catalog.min("createdAt") AS oldest_created_at,
          pg_catalog.min("nextAttemptAt") FILTER (
            WHERE status IN ('PENDING','FAILED')
          ) AS oldest_next_attempt_at
        FROM public."AccountDeletionSideEffect"
       WHERE status <> 'DONE'
       GROUP BY status, kind
       ORDER BY status, kind`)
    ).rows;
    const claimable = Number(
      (
        await client.query(`SELECT pg_catalog.count(*)::int AS count
          FROM public."AccountDeletionSideEffect"
         WHERE kind = 'LOCAL_ANONYMIZE'
           AND status IN ('PENDING','FAILED')
           AND coalesce("nextAttemptAt", CURRENT_TIMESTAMP) <= CURRENT_TIMESTAMP`)
      ).rows[0].count,
    );
    await client.query("ROLLBACK");
    open = false;
    return Object.freeze({
      generatedAt: new Date().toISOString(),
      status: "passed",
      mode: "production-owner-catalog-and-aggregate-read-only",
      releaseCommit: config.releaseCommit,
      directUrlSha256: config.directUrlSha256,
      result: Object.freeze({
        state: actualState,
        pendingMigration: repairApplied ? "" : REPAIR_MIGRATION,
        retiredColumnCount,
        functionPosture: functions.map(functionPosture),
        backlog: backlog.map((row) => ({
          status: row.status,
          kind: row.kind,
          count: Number(row.count),
          oldestCreatedAt: row.oldest_created_at,
          oldestNextAttemptAt: row.oldest_next_attempt_at,
        })),
        claimableLocalAnonymizeCount: claimable,
      }),
      transaction: Object.freeze({
        isolation: "repeatable read",
        readOnly: true,
        rolledBack: true,
      }),
      retained: Object.freeze({
        aggregateRowsOnly: true,
        identifiers: false,
        credentials: false,
        functionBodies: false,
      }),
      productionChanged: false,
    });
  } finally {
    if (open) await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

export function writePostRetirementEvidence(filePath, evidence) {
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  assert.doesNotMatch(
    serialized,
    /postgres(?:ql)?:\/\/|DIRECT_URL|password|"(?:userId|email|sideEffectId)"\s*:/iu,
  );
  const fd = openSync(filePath, "wx", 0o600);
  try {
    writeFileSync(fd, serialized, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(filePath, 0o600);
  const stat = lstatSync(filePath);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0);
}

export async function main(env = process.env) {
  const config = parsePostRetirementInspectionConfig(env);
  const evidence = await inspectPostRetirementState(config);
  writePostRetirementEvidence(config.evidencePath, evidence);
  process.stdout.write(`${JSON.stringify({ status: evidence.status, result: evidence.result })}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch(() => {
    process.stderr.write("Account deletion post-retirement inspection failed closed\n");
    process.exitCode = 1;
  });
}
