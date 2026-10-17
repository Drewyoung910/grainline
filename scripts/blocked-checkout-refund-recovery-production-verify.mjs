import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

import {
  BLOCKED_CHECKOUT_REFUND_RECOVERY_MIGRATION,
  blockedCheckoutRefundRecoveryDefinitions,
} from "./build-blocked-checkout-refund-recovery-migration.mjs";
import {
  assertReviewedPeerMigrationLedger,
} from "./order-refund-immutable-event-production-ledger.mjs";

const MIGRATION_SHA256 =
  "9e9f3456787832e6b89ee10d4de0a446047679c886d400c6dd5d164f44734111";
const IDENTITIES = [
  "public.grainline_blocked_checkout_refund_reconciliation_record(text,text,bigint,text,text,text,integer)",
  "public.grainline_stripe_checkout_order_existing(text,bigint,text)",
];

function migrationDirectories(root) {
  return fs.readdirSync(path.join(root, "prisma", "migrations"), {
    withFileTypes: true,
  })
    .filter(
      (entry) =>
        entry.isDirectory() && /^[0-9]{14}_[a-z0-9_]+$/u.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
}

function migrationDigest(root, migration) {
  return createHash("sha256").update(fs.readFileSync(path.join(
    root,
    "prisma",
    "migrations",
    migration,
    "migration.sql",
  ))).digest("hex");
}

async function readLedger(client, directories) {
  const { rows } = await client.query(
    `SELECT migration_name, checksum, finished_at, rolled_back_at,
            applied_steps_count
       FROM public._prisma_migrations
      WHERE migration_name = ANY($1::text[])
      ORDER BY migration_name, started_at`,
    [directories],
  );
  const byName = new Map();
  for (const row of rows) {
    const values = byName.get(row.migration_name) ?? [];
    values.push(row);
    byName.set(row.migration_name, values);
  }
  return byName;
}

async function readFunctionCatalog(client) {
  const { rows } = await client.query(
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
            pg_catalog.has_function_privilege(
              'grainline_staff_read_runtime', routine.oid, 'EXECUTE'
            ) AS staff_execute,
            pg_catalog.has_function_privilege(
              0, routine.oid, 'EXECUTE'
            ) AS public_execute
       FROM requested
       LEFT JOIN pg_catalog.pg_proc AS routine ON routine.oid = requested.oid
      ORDER BY requested.identity`,
    [IDENTITIES],
  );
  return rows;
}

async function readFunctionAcl(client) {
  const { rows } = await client.query(
    `WITH requested AS (
       SELECT identity, pg_catalog.to_regprocedure(identity) AS oid
         FROM pg_catalog.unnest($1::text[]) AS identity
     )
     SELECT requested.identity,
            CASE WHEN expanded.grantee = 0 THEN 'PUBLIC'
                 ELSE pg_catalog.pg_get_userbyid(expanded.grantee) END AS grantee,
            pg_catalog.pg_get_userbyid(expanded.grantor) AS grantor,
            expanded.privilege_type, expanded.is_grantable
       FROM requested
       JOIN pg_catalog.pg_proc AS routine ON routine.oid = requested.oid
       CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
         routine.proacl,
         pg_catalog.acldefault('f', routine.proowner)
       )) AS expanded
      ORDER BY requested.identity, grantee, grantor,
               expanded.privilege_type, expanded.is_grantable`,
    [IDENTITIES],
  );
  return rows;
}

async function readPaymentEventPosture(client) {
  const { rows } = await client.query(
    `SELECT table_class.relrowsecurity, table_class.relforcerowsecurity,
            table_class.relacl::text,
            trigger.tgname, trigger.tgenabled,
            pg_catalog.pg_get_triggerdef(trigger.oid) AS trigger_definition,
            trigger_function.prosrc AS trigger_source
       FROM pg_catalog.pg_class AS table_class
       JOIN pg_catalog.pg_trigger AS trigger
         ON trigger.tgrelid = table_class.oid AND NOT trigger.tgisinternal
       JOIN pg_catalog.pg_proc AS trigger_function
         ON trigger_function.oid = trigger.tgfoid
      WHERE table_class.oid = 'public."OrderPaymentEvent"'::regclass
        AND trigger.tgname = 'grainline_order_payment_event_immutable'`,
  );
  assert.equal(rows.length, 1, "immutable OrderPaymentEvent trigger is missing");
  return rows;
}

function expectedSources(state, root) {
  const definitions = blockedCheckoutRefundRecoveryDefinitions(root);
  return new Map([
    [
      IDENTITIES[0],
      state === "applied"
        ? definitions.reconciliationSuccessor
        : definitions.reconciliationPredecessor,
    ],
    [
      IDENTITIES[1],
      state === "applied"
        ? definitions.checkoutSuccessor
        : definitions.checkoutPredecessor,
    ],
  ].map(([identity, statement]) => {
    const delimiter = statement.match(/\nAS\s+(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/u)?.[1];
    assert.ok(delimiter, `missing source delimiter for ${identity}`);
    const start = statement.indexOf(delimiter) + delimiter.length;
    const end = statement.lastIndexOf(delimiter);
    return [identity, statement.slice(start, end)];
  }));
}

function assertFunctionCatalog(rows, state, root) {
  const expected = expectedSources(state, root);
  assert.equal(rows.length, IDENTITIES.length);
  for (const row of rows) {
    assert.ok(row.resolved, `missing ${row.identity}`);
    assert.equal(row.owner, "neondb_owner");
    assert.equal(row.prosrc, expected.get(row.identity));
    assert.equal(row.prosecdef, true);
    assert.equal(row.proleakproof, false);
    assert.equal(row.provolatile, "v");
    assert.equal(row.proparallel, "u");
    assert.deepEqual(row.proconfig, ["search_path=pg_catalog"]);
    assert.equal(row.runtime_execute, true);
    assert.equal(row.staff_execute, false);
    assert.equal(row.public_execute, false);
  }
}

function writePrivateJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
}

function candidateState(rows) {
  if (rows.length === 0) return "pending";
  assert.equal(rows.length, 1, "candidate migration ledger is duplicated");
  const [row] = rows;
  assert.equal(row.checksum, MIGRATION_SHA256);
  assert.ok(row.finished_at, "candidate migration is unfinished");
  assert.equal(row.rolled_back_at, null);
  assert.equal(Number(row.applied_steps_count), 1);
  return "applied";
}

async function verify(mode) {
  assert.ok(["preflight", "postflight"].includes(mode), "mode is invalid");
  const root = process.cwd();
  const databaseUrl = process.env.DIRECT_URL;
  const runnerTemp = process.env.RUNNER_TEMP;
  assert.ok(databaseUrl, "DIRECT_URL is required");
  assert.ok(runnerTemp, "RUNNER_TEMP is required");
  assert.equal(
    migrationDigest(root, BLOCKED_CHECKOUT_REFUND_RECOVERY_MIGRATION),
    MIGRATION_SHA256,
    "candidate migration bytes drifted",
  );
  const directories = migrationDirectories(root);
  assert.ok(directories.includes(BLOCKED_CHECKOUT_REFUND_RECOVERY_MIGRATION));
  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const ledger = await readLedger(client, directories);
    for (const peer of directories) {
      if (peer === BLOCKED_CHECKOUT_REFUND_RECOVERY_MIGRATION) continue;
      assertReviewedPeerMigrationLedger({
        migrationName: peer,
        repositoryChecksum: migrationDigest(root, peer),
        rows: ledger.get(peer) ?? [],
      });
    }
    const state = candidateState(
      ledger.get(BLOCKED_CHECKOUT_REFUND_RECOVERY_MIGRATION) ?? [],
    );
    if (mode === "postflight") assert.equal(state, "applied");
    const functions = await readFunctionCatalog(client);
    assertFunctionCatalog(functions, state, root);
    const acl = await readFunctionAcl(client);
    const paymentEvent = await readPaymentEventPosture(client);
    if (mode === "preflight") {
      writePrivateJson(path.join(
        runnerTemp,
        "blocked-checkout-refund-recovery-preflight.json",
      ), { acl, paymentEvent });
      assert.ok(process.env.GITHUB_OUTPUT, "GITHUB_OUTPUT is required");
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `state=${state}\n`);
    } else {
      const before = JSON.parse(fs.readFileSync(path.join(
        runnerTemp,
        "blocked-checkout-refund-recovery-preflight.json",
      ), "utf8"));
      assert.deepEqual(acl, before.acl);
      assert.deepEqual(paymentEvent, before.paymentEvent);
      writePrivateJson(path.join(
        runnerTemp,
        "blocked-checkout-refund-recovery-postflight.json",
      ), {
        status: "passed",
        releaseCommit: process.env.GITHUB_SHA,
        migration: BLOCKED_CHECKOUT_REFUND_RECOVERY_MIGRATION,
        migrationSha256: MIGRATION_SHA256,
        functionCount: functions.length,
        issueCount: 0,
      });
    }
    await client.query("COMMIT");
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {}
    await client.end();
  }
}

await verify(process.argv[2]);
