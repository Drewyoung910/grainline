import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
  assertReviewedPeerMigrationLedger,
} from "./order-refund-immutable-event-production-ledger.mjs";

export const CASE_REFUND_RECOVERY_CORE_MIGRATION =
  "20261016010000_correct_case_refund_recovery_core";
export const CASE_REFUND_FOLLOWUP_MIGRATION =
  "20261016011000_correct_case_refund_followup_deadends";
export const CASE_REFUND_RECOVERY_CORE_SHA256 =
  "c7e3e7f259c9f721ca7f46e20f7af92a12c302e496b2c37a130f3be3004a3f27";
export const CASE_REFUND_FOLLOWUP_SHA256 =
  "71ae9d866d67b181b28cb0eca1ede74e032ac7c57de398bde95a9e6d95b7619e";

const CASE_REFUND_OPS_HEALTH_IDENTITY =
  "public.grainline_order_ops_health_summary()";

const summaryKeys = [
  "repairable_claims",
  "repairable_refund_amount_cents",
  "unrepairable_claims",
  "unrepairable_refund_amount_cents",
].sort();

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function caseRefundMigrationPath(root, migration) {
  const isolated = new Map([
    [
      CASE_REFUND_RECOVERY_CORE_MIGRATION,
      process.env.CASE_REFUND_RECOVERY_CORE_MIGRATION_PATH?.trim(),
    ],
    [
      CASE_REFUND_FOLLOWUP_MIGRATION,
      process.env.CASE_REFUND_FOLLOWUP_MIGRATION_PATH?.trim(),
    ],
  ]).get(migration);
  if (isolated) return isolated;
  return path.join(root, "prisma", "migrations", migration, "migration.sql");
}

function migrationDigest(root, migration) {
  return sha256(fs.readFileSync(caseRefundMigrationPath(root, migration)));
}

function migrationDirectories(root) {
  return fs.readdirSync(path.join(root, "prisma", "migrations"), {
    withFileTypes: true,
  })
    .filter((entry) =>
      entry.isDirectory() && /^[0-9]{14}_[a-z0-9_]+$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export function extractCaseRefundInventoryQuery(source) {
  const marker = "-- @query summary";
  const start = source.indexOf(marker);
  const end = source.indexOf("ROLLBACK;", start + marker.length);
  assert.ok(start >= 0 && end > start, "aggregate Case-refund query must exist");
  return source.slice(start + marker.length, end).trim().replace(/;$/u, "");
}

function assertAggregateInteger(value, label) {
  assert.match(String(value), /^(0|[1-9][0-9]*)$/u, `${label} must be nonnegative`);
}

export function assertPrivateSafeCaseRefundInventory(summary) {
  assert.ok(summary && typeof summary === "object" && !Array.isArray(summary));
  assert.deepEqual(Object.keys(summary).sort(), summaryKeys);
  for (const key of summaryKeys) assertAggregateInteger(summary[key], key);
}

export async function executeCaseRefundInventory(database, repositoryRoot) {
  const source = fs.readFileSync(
    path.join(repositoryRoot, "scripts/case-refund-710-production-inventory.sql"),
    "utf8",
  );
  const rows = (await database.query(extractCaseRefundInventoryQuery(source))).rows;
  assert.equal(rows.length, 1, "Case-refund inventory must emit one aggregate row");
  assertPrivateSafeCaseRefundInventory(rows[0]);
  return rows[0];
}

function expectedMaps(source, label) {
  const values = [...source.matchAll(
    /expected jsonb := '([^']+)'::jsonb;/gu,
  )].map((match) => JSON.parse(match[1]));
  assert.equal(values.length, 2, `${label} must pin predecessor and successor maps`);
  return values;
}

function normalizedHashes(value) {
  return new Map(Object.entries(value).map(([identity, spec]) => [
    identity,
    typeof spec === "string" ? spec : spec.sha,
  ]));
}

function runtimeExecuteMap(corePredecessor, followupPredecessor) {
  const result = new Map(Object.keys(corePredecessor).map((identity) => [identity, true]));
  for (const [identity, spec] of Object.entries(followupPredecessor)) {
    result.set(identity, spec.runtime);
  }
  return result;
}

function functionExecutionPostureMap(identities) {
  const result = new Map([...identities].map((identity) => [
    identity,
    { parallel: "u", volatility: "v" },
  ]));
  assert.ok(
    result.has(CASE_REFUND_OPS_HEALTH_IDENTITY),
    "Case refund ops-health function must be present",
  );
  result.set(CASE_REFUND_OPS_HEALTH_IDENTITY, {
    parallel: "s",
    volatility: "s",
  });
  return result;
}

export function caseRefundReleaseSpecs(root) {
  const coreSource = fs.readFileSync(
    caseRefundMigrationPath(root, CASE_REFUND_RECOVERY_CORE_MIGRATION),
    "utf8",
  );
  const followupSource = fs.readFileSync(
    caseRefundMigrationPath(root, CASE_REFUND_FOLLOWUP_MIGRATION),
    "utf8",
  );
  const [corePredecessorRaw, coreSuccessorRaw] = expectedMaps(coreSource, "core");
  const [followupPredecessorRaw, followupSuccessorRaw] = expectedMaps(
    followupSource,
    "follow-up",
  );
  const corePredecessor = normalizedHashes(corePredecessorRaw);
  const coreSuccessor = normalizedHashes(coreSuccessorRaw);
  const followupPredecessor = normalizedHashes(followupPredecessorRaw);
  const followupSuccessor = normalizedHashes(followupSuccessorRaw);
  for (const [identity, hash] of followupPredecessor) {
    if (coreSuccessor.has(identity)) {
      assert.equal(
        hash,
        coreSuccessor.get(identity),
        `follow-up predecessor does not equal core successor for ${identity}`,
      );
    }
  }
  const beforeCore = new Map(followupPredecessor);
  for (const [identity, hash] of corePredecessor) beforeCore.set(identity, hash);
  const afterCore = new Map(followupPredecessor);
  for (const [identity, hash] of coreSuccessor) afterCore.set(identity, hash);
  const finalSuccessor = new Map(afterCore);
  for (const [identity, hash] of followupSuccessor) {
    finalSuccessor.set(identity, hash);
  }
  return {
    beforeCore,
    executionPosture: functionExecutionPostureMap(finalSuccessor.keys()),
    afterCore,
    finalSuccessor,
    runtimeExecute: runtimeExecuteMap(corePredecessorRaw, followupPredecessorRaw),
  };
}

async function readLedger(client, directories) {
  const rows = (await client.query(
    `SELECT migration_name, checksum, finished_at, rolled_back_at,
            applied_steps_count
       FROM public._prisma_migrations
      WHERE migration_name = ANY($1::text[])
      ORDER BY migration_name, started_at`,
    [directories],
  )).rows;
  const byName = new Map();
  for (const row of rows) {
    const values = byName.get(row.migration_name) ?? [];
    values.push(row);
    byName.set(row.migration_name, values);
  }
  return byName;
}

function candidateState(rows, checksum, label) {
  if (rows.length === 0) return "pending";
  assert.equal(rows.length, 1, `${label} migration ledger is duplicated`);
  const [row] = rows;
  assert.equal(row.checksum, checksum, `${label} migration checksum drifted`);
  assert.ok(row.finished_at, `${label} migration is unfinished`);
  assert.equal(row.rolled_back_at, null, `${label} migration was rolled back`);
  assert.equal(Number(row.applied_steps_count), 1);
  return "applied";
}

async function readFunctionCatalog(client, identities) {
  return (await client.query(
    `WITH requested AS (
       SELECT identity, pg_catalog.to_regprocedure(identity) AS oid
         FROM pg_catalog.unnest($1::text[]) AS identity
     )
     SELECT requested.identity, requested.oid::text AS resolved,
            pg_catalog.pg_get_userbyid(routine.proowner) AS owner,
            routine.prosrc, routine.prosecdef, routine.proleakproof,
            routine.provolatile, routine.proparallel, routine.proconfig,
            pg_catalog.has_function_privilege(
              'grainline_app_runtime', routine.oid, 'EXECUTE'
            ) AS runtime_execute,
            EXISTS (
              SELECT 1
                FROM pg_catalog.aclexplode(COALESCE(
                  routine.proacl,
                  pg_catalog.acldefault('f', routine.proowner)
                )) AS acl
               WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
            ) AS public_execute
       FROM requested
       LEFT JOIN pg_catalog.pg_proc AS routine ON routine.oid = requested.oid
      ORDER BY requested.identity`,
    [identities],
  )).rows;
}

async function readFunctionAcl(client, identities) {
  return (await client.query(
    `WITH requested AS (
       SELECT identity, pg_catalog.to_regprocedure(identity) AS oid
         FROM pg_catalog.unnest($1::text[]) AS identity
     )
     SELECT requested.identity,
            CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
                 ELSE pg_catalog.pg_get_userbyid(acl.grantee) END AS grantee,
            pg_catalog.pg_get_userbyid(acl.grantor) AS grantor,
            acl.privilege_type, acl.is_grantable
       FROM requested
       JOIN pg_catalog.pg_proc AS routine ON routine.oid = requested.oid
       CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
         routine.proacl,
         pg_catalog.acldefault('f', routine.proowner)
       )) AS acl
      ORDER BY requested.identity, grantee, grantor,
               acl.privilege_type, acl.is_grantable`,
    [identities],
  )).rows;
}

function expectedSourcesForState(specs, coreState, followupState) {
  if (coreState === "pending" && followupState === "pending") {
    return specs.beforeCore;
  }
  if (coreState === "applied" && followupState === "pending") {
    return specs.afterCore;
  }
  assert.equal(coreState, "applied", "follow-up cannot precede core");
  assert.equal(followupState, "applied", "invalid Case-refund release state");
  return specs.finalSuccessor;
}

function assertFunctionCatalog(
  rows,
  expectedSources,
  runtimeExecute,
  expectedExecutionPosture,
) {
  assert.equal(rows.length, expectedSources.size);
  for (const row of rows) {
    const executionPosture = expectedExecutionPosture.get(row.identity);
    assert.ok(row.resolved, `missing ${row.identity}`);
    assert.ok(executionPosture, `missing catalog posture for ${row.identity}`);
    assert.equal(
      sha256(row.prosrc),
      expectedSources.get(row.identity),
      `${row.identity} source drifted`,
    );
    assert.equal(row.owner, "neondb_owner");
    assert.equal(row.prosecdef, true);
    assert.equal(row.proleakproof, false);
    assert.equal(
      row.provolatile,
      executionPosture.volatility,
      `${row.identity} volatility drifted`,
    );
    assert.equal(
      row.proparallel,
      executionPosture.parallel,
      `${row.identity} parallel posture drifted`,
    );
    assert.deepEqual(row.proconfig, ["search_path=pg_catalog"]);
    assert.equal(row.runtime_execute, runtimeExecute.get(row.identity));
    assert.equal(row.public_execute, false);
  }
}

function catalogPosture(rows) {
  return rows.map(({ prosrc: _prosrc, ...row }) => row);
}

function writePrivateJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
}

async function verify(mode) {
  assert.ok(["preflight", "postflight"].includes(mode), "mode is invalid");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const databaseUrl = process.env.DIRECT_URL;
  const runnerTemp = process.env.RUNNER_TEMP;
  assert.ok(databaseUrl, "DIRECT_URL is required");
  assert.ok(runnerTemp, "RUNNER_TEMP is required");
  assert.equal(
    migrationDigest(root, CASE_REFUND_RECOVERY_CORE_MIGRATION),
    CASE_REFUND_RECOVERY_CORE_SHA256,
    "core migration bytes drifted",
  );
  assert.equal(
    migrationDigest(root, CASE_REFUND_FOLLOWUP_MIGRATION),
    CASE_REFUND_FOLLOWUP_SHA256,
    "follow-up migration bytes drifted",
  );
  const specs = caseRefundReleaseSpecs(root);
  const identities = [...specs.finalSuccessor.keys()].sort();
  const directories = migrationDirectories(root);
  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const ledger = await readLedger(client, directories);
    for (const peer of directories) {
      if ([
        CASE_REFUND_RECOVERY_CORE_MIGRATION,
        CASE_REFUND_FOLLOWUP_MIGRATION,
      ].includes(peer)) continue;
      assertReviewedPeerMigrationLedger({
        migrationName: peer,
        repositoryChecksum: migrationDigest(root, peer),
        rows: ledger.get(peer) ?? [],
      });
    }
    const coreState = candidateState(
      ledger.get(CASE_REFUND_RECOVERY_CORE_MIGRATION) ?? [],
      CASE_REFUND_RECOVERY_CORE_SHA256,
      "core",
    );
    const followupState = candidateState(
      ledger.get(CASE_REFUND_FOLLOWUP_MIGRATION) ?? [],
      CASE_REFUND_FOLLOWUP_SHA256,
      "follow-up",
    );
    if (followupState === "applied") assert.equal(coreState, "applied");
    if (mode === "postflight") {
      assert.equal(coreState, "applied");
      assert.equal(followupState, "applied");
    }
    const functions = await readFunctionCatalog(client, identities);
    assertFunctionCatalog(
      functions,
      expectedSourcesForState(specs, coreState, followupState),
      specs.runtimeExecute,
      specs.executionPosture,
    );
    const acl = await readFunctionAcl(client, identities);
    if (mode === "preflight") {
      const inventory = await executeCaseRefundInventory(client, root);
      writePrivateJson(
        path.join(runnerTemp, "case-refund-recovery-preflight.json"),
        { acl, inventory, posture: catalogPosture(functions) },
      );
      assert.ok(process.env.GITHUB_OUTPUT, "GITHUB_OUTPUT is required");
      fs.appendFileSync(
        process.env.GITHUB_OUTPUT,
        [
          `core_state=${coreState}`,
          `followup_state=${followupState}`,
          `repairable_claims=${inventory.repairable_claims}`,
          `unrepairable_claims=${inventory.unrepairable_claims}`,
          "",
        ].join("\n"),
      );
    } else {
      const before = JSON.parse(fs.readFileSync(
        path.join(runnerTemp, "case-refund-recovery-preflight.json"),
        "utf8",
      ));
      assert.deepEqual(acl, before.acl, "function ACLs changed");
      assert.deepEqual(
        catalogPosture(functions),
        before.posture,
        "function catalog posture changed",
      );
      writePrivateJson(
        path.join(runnerTemp, "case-refund-recovery-postflight.json"),
        {
          status: "passed",
          releaseCommit: process.env.GITHUB_SHA,
          migrations: [
            {
              name: CASE_REFUND_RECOVERY_CORE_MIGRATION,
              sha256: CASE_REFUND_RECOVERY_CORE_SHA256,
            },
            {
              name: CASE_REFUND_FOLLOWUP_MIGRATION,
              sha256: CASE_REFUND_FOLLOWUP_SHA256,
            },
          ],
          functionCount: functions.length,
          inventory: before.inventory,
          issueCount: 0,
        },
      );
    }
    await client.query("COMMIT");
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {}
    await client.end();
  }
}

if (process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verify(process.argv[2]);
}
