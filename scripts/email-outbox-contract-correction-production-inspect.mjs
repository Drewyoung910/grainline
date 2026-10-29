#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
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

export const MIGRATION = "20261027020000_correct_email_outbox_contracts";
export const MIGRATION_SHA256 =
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
    "grainline_email_outbox_enqueue_legacy",
    Object.freeze({
      signature: "public.grainline_email_outbox_enqueue_legacy(text,text,text,text,text,integer,text,text,text,text,text)",
      before: "c175b462cf5427e2f15dddbcc9a4ec1a",
      after: "f6ca99becfbc71f48f629ef008a012c6",
    }),
  ],
  [
    "grainline_email_outbox_account_deletion_fence",
    Object.freeze({
      signature: "public.grainline_email_outbox_account_deletion_fence(text,text[])",
      before: "508a22265993fde9d14c062a76630d76",
      after: "2f40c6c4dacfca2f786dff06424d717e",
    }),
  ],
  [
    "grainline_email_outbox_fail",
    Object.freeze({
      signature: "public.grainline_email_outbox_fail(text,bigint,uuid,text,text)",
      before: "cdfdfc38a37e4f7eda3df91fc1e98021",
      after: "ab04f794d057ed823ffe1e47ffb9e25e",
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
    "email outbox correction schema is partially applied",
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
  assert.equal(sha256(migrationSql(MIGRATION)), MIGRATION_SHA256);
  assert.equal(
    sha256(migrationSql(RESEND_RECOVERY_MIGRATION)),
    RESEND_RECOVERY_SHA256,
  );
  assert.equal(
    sha256(migrationSql(STOCK_NOTIFICATION_MIGRATION)),
    STOCK_NOTIFICATION_SHA256,
  );
  const names = [
    MIGRATION,
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
  return Object.freeze({
    candidateState: migrationState(ledger.rows, MIGRATION, MIGRATION_SHA256),
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

async function proveRuntimeContracts(client) {
  const runId = process.env.GITHUB_RUN_ID;
  assert.match(runId ?? "", /^[1-9][0-9]{0,19}$/u);
  const prefix = `c1185_${runId}`;
  const sources = [
    ["order_payment", "refund_issued"],
    ["order_fulfillment", "order_shipped"],
    ["case", "case_resolved"],
  ];
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE grainline_app_runtime");
    for (const [sourceType, templateName] of sources) {
      const result = await client.query(`
        SELECT * FROM public.grainline_email_outbox_enqueue_legacy(
          $1, $2, NULL, NULL, $3, 1, $4, $5,
          'Contract proof', '<p>Contract proof</p>', $6
        )
      `, [
        `${prefix}_${sourceType}`,
        `${prefix}@example.test`,
        templateName,
        sourceType,
        `${prefix}_source_${sourceType}`,
        `${prefix}_dedup_${sourceType}`,
      ]);
      assert.deepEqual(result.rows, [{
        jobId: `${prefix}_${sourceType}`,
        created: true,
        outcome: "ready",
      }]);
    }
    await client.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, true)",
      [`${prefix}_user`],
    );
    const deletion = await client.query(`
      SELECT public.grainline_email_outbox_account_deletion_fence(
        $1, $2::text[]
      )::integer AS count
    `, [
      `${prefix}_user`,
      Array.from({ length: 24 }, (_, index) =>
        `${prefix}.historical.${index}@example.test`),
    ]);
    assert.equal(deletion.rows[0]?.count, 0);

    const retryJobId = `${prefix}_retry`;
    await client.query(`
      SELECT * FROM public.grainline_email_outbox_enqueue_legacy(
        $1, $2, NULL, NULL, 'welcome', 1, NULL, NULL,
        'Contract proof', '<p>Contract proof</p>', $3
      )
    `, [retryJobId, `${prefix}.retry@example.test`, `${prefix}_retry_dedup`]);
    await client.query("RESET ROLE");
    await client.query(
      `UPDATE public."EmailOutbox" SET attempts = 8 WHERE id = $1`,
      [retryJobId],
    );
    await client.query("SET LOCAL ROLE grainline_app_runtime");
    const claim = (await client.query(
      "SELECT * FROM public.grainline_email_outbox_claim_one($1)",
      [retryJobId],
    )).rows[0];
    assert.ok(claim);
    assert.equal((await client.query(`
      SELECT public.grainline_email_outbox_begin_provider_attempt(
        $1, $2::bigint, $3::uuid
      ) AS result
    `, [retryJobId, claim.claimGeneration, claim.claimToken])).rows[0]?.result, "ready");
    assert.equal((await client.query(`
      SELECT public.grainline_email_outbox_fail(
        $1, $2::bigint, $3::uuid, 'provider_retryable', 'contract proof'
      ) AS result
    `, [retryJobId, claim.claimGeneration, claim.claimToken])).rows[0]?.result, "applied");
    const retry = (await client.query(`
      SELECT EXTRACT(
        EPOCH FROM ("nextAttemptAt" - "updatedAt")
      )::integer AS delay_seconds
        FROM public."EmailOutbox"
       WHERE id = $1
    `, [retryJobId])).rows[0];
    assert.equal(retry?.delay_seconds, 256 * 60);
  } finally {
    await client.query("ROLLBACK");
  }
  return Object.freeze({
    applicationSourceTypes: sources.map(([sourceType]) => sourceType),
    deletionKeyCount: 24,
    retryAttempt: 9,
    retryDelayMinutes: 256,
    writesRolledBack: true,
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
    assert.equal(
      ledger.candidateState,
      mode === "preflight" ? ledger.candidateState : "applied",
    );
    const verified = verifyCatalog(catalog, ledger);
    const runtime = mode === "postflight"
      ? await proveRuntimeContracts(client)
      : null;
    return Object.freeze({
      mode,
      ...ledger,
      ...verified,
      runtime,
    });
  } finally {
    await client.end();
  }
}

function evidencePath(mode) {
  return path.join(
    process.env.RUNNER_TEMP ?? "/tmp",
    `email-outbox-contract-correction-${mode}.json`,
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
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    appendFileSync(outputPath, `state=${result.candidateState}\n`);
    appendFileSync(outputPath, `schema_state=${result.schemaState}\n`);
    appendFileSync(outputPath, `expected_pending=${expectedPending}\n`);
    appendFileSync(outputPath, `expected_after=${expectedAfter}\n`);
  }
  writeEvidence(mode, result);
  process.stdout.write(`Email outbox contract correction ${mode} accepted.\n`);
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
