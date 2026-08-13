#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  verifyStripeWebhookEventActivationRelease,
} from "./verify-stripe-webhook-event-activation-release.mjs";
import {
  STRIPE_WEBHOOK_EVENT_RUNTIME_FUNCTIONS,
  stripeWebhookEventFunctionSourceSha256,
} from "./stripe-webhook-event-function-source-catalog.mjs";

const { Client } = pg;
const PROOF_ENV = "STRIPE_WEBHOOK_EVENT_ACTIVATION_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const RUNTIME_ROLE = "grainline_app_runtime";
const PREFIX = "evt_grainline_activation_proof";
export const LEGACY_CLAIM_SESSION_ID = "cs_test_grainlineactivationproof";

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/gi, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[redacted-credentials]@",
    );
}

export function parseStripeWebhookEventActivationProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.equal(parsed.protocol, "postgresql:", "activation proof requires PostgreSQL");
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "activation proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `activation proof requires the ${DATABASE_NAME} database`,
  );
  return Object.freeze({ databaseUrl });
}

async function expectSqlState(client, label, sql, values = []) {
  const savepoint = `proof_${label.replace(/[^a-z0-9_]/gi, "_")}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  let caught;
  try {
    await client.query(sql, values);
  } catch (error) {
    caught = error;
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  assert.ok(caught, `${label} unexpectedly succeeded`);
  assert.equal(caught.code, "42501", `${label} returned the wrong SQLSTATE`);
}

export async function proveStripeWebhookEventCatalog(
  owner,
  { expectedForced = false } = {},
) {
  const table = await owner.query(`
    SELECT
      class.relrowsecurity AS rls_enabled,
      class.relforcerowsecurity AS rls_forced,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid) AS policy_count,
      pg_catalog.has_table_privilege(
        $1, class.oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
      ) AS runtime_table_authority,
      pg_catalog.has_any_column_privilege(
        $1, class.oid, 'SELECT,INSERT,UPDATE,REFERENCES'
      ) AS runtime_column_authority,
      EXISTS (
        SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
          ) AS acl
         WHERE acl.grantee = 0
           AND acl.privilege_type IN (
             'SELECT', 'INSERT', 'UPDATE', 'DELETE',
             'TRUNCATE', 'REFERENCES', 'TRIGGER'
           )
      ) AS public_table_authority,
      EXISTS (
        SELECT 1
          FROM pg_catalog.pg_attribute AS attribute
          CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
         WHERE attribute.attrelid = class.oid
           AND attribute.attnum > 0
           AND NOT attribute.attisdropped
           AND acl.grantee = 0
           AND acl.privilege_type IN (
             'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
           )
      ) AS public_column_authority
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'StripeWebhookEvent'
     AND class.relkind = 'r'
  `, [RUNTIME_ROLE]);
  assert.deepEqual(table.rows, [{
    rls_enabled: true,
    rls_forced: expectedForced,
    policy_count: 0,
    runtime_table_authority: false,
    runtime_column_authority: false,
    public_table_authority: false,
    public_column_authority: false,
  }]);

  const functions = await owner.query(`
    WITH expected(proname, identity_arguments) AS (
      VALUES
        ('grainline_stripe_webhook_begin', 'text, text'),
        ('grainline_stripe_webhook_complete', 'text, bigint'),
        ('grainline_stripe_webhook_fail', 'text, bigint, text'),
        ('grainline_stripe_webhook_prune_batch', 'integer'),
        ('grainline_stripe_webhook_health_summary', ''),
        ('grainline_legacy_stock_restore_claim', 'text')
    )
    SELECT
      procedure.proname AS function_name,
      pg_catalog.oidvectortypes(procedure.proargtypes) AS identity_arguments,
      procedure.prosrc AS function_source
      FROM expected
      JOIN pg_catalog.pg_proc AS procedure
        ON procedure.proname = expected.proname
       AND pg_catalog.oidvectortypes(procedure.proargtypes) =
           expected.identity_arguments
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.prosecdef
       AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND procedure.proowner = (
         SELECT class.relowner
           FROM pg_catalog.pg_class AS class
          WHERE class.oid = 'public."StripeWebhookEvent"'::pg_catalog.regclass
       )
       AND pg_catalog.has_function_privilege($1, procedure.oid, 'EXECUTE')
       AND NOT EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
             COALESCE(
               procedure.proacl,
               pg_catalog.acldefault('f', procedure.proowner)
             )
          ) AS acl
         WHERE acl.privilege_type = 'EXECUTE'
            AND (
              acl.grantee NOT IN (
                procedure.proowner,
                (SELECT role.oid FROM pg_catalog.pg_roles AS role
                  WHERE role.rolname = $1)
              )
              OR (
                acl.grantee = (
                  SELECT role.oid FROM pg_catalog.pg_roles AS role
                   WHERE role.rolname = $1
                )
                AND (
                  acl.grantor <> procedure.proowner
                  OR acl.is_grantable
                )
              )
            )
       )
     ORDER BY procedure.proname
  `, [RUNTIME_ROLE]);
  assert.equal(
    functions.rows.length,
    STRIPE_WEBHOOK_EVENT_RUNTIME_FUNCTIONS.length,
  );
  const expectedByName = new Map(
    STRIPE_WEBHOOK_EVENT_RUNTIME_FUNCTIONS.map((entry) => [entry.name, entry]),
  );
  const sourceHashes = stripeWebhookEventFunctionSourceSha256();
  for (const row of functions.rows) {
    const expected = expectedByName.get(row.function_name);
    assert.ok(expected, row.function_name);
    assert.equal(row.identity_arguments, expected.identityArguments);
    assert.equal(
      createHash("sha256").update(row.function_source, "utf8").digest("hex"),
      sourceHashes[row.function_name],
      `${row.function_name} source drifted`,
    );
  }
}

export async function proveStripeWebhookEventRuntimeBoundary(
  owner,
  {
    prefix = PREFIX,
    legacyClaimSessionId = LEGACY_CLAIM_SESSION_ID,
  } = {},
) {
  await owner.query("BEGIN");
  try {
    await owner.query(`SET LOCAL ROLE ${RUNTIME_ROLE}`);
    for (const [label, sql, values = []] of [
      ["direct_select", `SELECT id FROM public."StripeWebhookEvent" LIMIT 1`],
      ["direct_insert", `INSERT INTO public."StripeWebhookEvent" (id, type) VALUES ($1, 'proof.forged')`, [`${prefix}-forged`]],
      ["direct_update", `UPDATE public."StripeWebhookEvent" SET type = 'proof.forged' WHERE id = $1`, [`${prefix}-forged`]],
      ["direct_delete", `DELETE FROM public."StripeWebhookEvent" WHERE id = $1`, [`${prefix}-forged`]],
    ]) {
      await expectSqlState(owner, label, sql, values);
    }

    const begin = await owner.query(
      "SELECT action, claim_generation::text FROM public.grainline_stripe_webhook_begin($1, $2)",
      [`${prefix}-lease`, "checkout.session.completed"],
    );
    assert.deepEqual(begin.rows, [{ action: "process", claim_generation: "1" }]);
    const failed = await owner.query(
      "SELECT public.grainline_stripe_webhook_fail($1, 1, 'sanitized proof') AS result",
      [`${prefix}-lease`],
    );
    assert.deepEqual(failed.rows, [{ result: "failed" }]);
    const reclaimed = await owner.query(
      "SELECT action, claim_generation::text FROM public.grainline_stripe_webhook_begin($1, $2)",
      [`${prefix}-lease`, "checkout.session.completed"],
    );
    assert.deepEqual(reclaimed.rows, [{ action: "process", claim_generation: "2" }]);
    const completed = await owner.query(
      "SELECT public.grainline_stripe_webhook_complete($1, 2) AS result",
      [`${prefix}-lease`],
    );
    assert.deepEqual(completed.rows, [{ result: "completed" }]);
    const claimed = await owner.query(
      "SELECT public.grainline_legacy_stock_restore_claim($1) AS claimed",
      [legacyClaimSessionId],
    );
    assert.deepEqual(claimed.rows, [{ claimed: true }]);
    const health = await owner.query(
      "SELECT issue_count::text FROM public.grainline_stripe_webhook_health_summary()",
    );
    assert.equal(health.rowCount, 1);
    const prune = await owner.query(
      "SELECT public.grainline_stripe_webhook_prune_batch(1)::text AS deleted",
    );
    assert.match(prune.rows[0]?.deleted ?? "", /^\d+$/);
    await owner.query("ROLLBACK");
  } catch (error) {
    await owner.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

export async function runStripeWebhookEventActivationProof(env = process.env) {
  const { databaseUrl } = parseStripeWebhookEventActivationProofConfig(env);
  verifyStripeWebhookEventActivationRelease(undefined, {
    allowReviewedSuccessor: true,
  });
  const owner = new Client({ connectionString: databaseUrl });
  await owner.connect();
  try {
    await proveStripeWebhookEventCatalog(owner);
    await proveStripeWebhookEventRuntimeBoundary(owner);
    const residue = await owner.query(`
      SELECT pg_catalog.count(*)::integer AS residue_count
        FROM public."StripeWebhookEvent"
       WHERE id LIKE $1
          OR id = $2
    `, [`${PREFIX}%`, `checkout-stock-restore:${LEGACY_CLAIM_SESSION_ID}`]);
    assert.deepEqual(residue.rows, [{ residue_count: 0 }]);
    return Object.freeze({
      database: DATABASE_NAME,
      checks: 12,
      directTablePrivileges: 0,
      runtimeFunctions: 6,
      rlsEnabled: true,
      rlsForced: false,
      policyCount: 0,
      rolledBack: true,
      productionTouched: false,
    });
  } finally {
    await owner.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(
      `${JSON.stringify(await runStripeWebhookEventActivationProof(), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `StripeWebhookEvent activation proof failed: ${safeError(error)}\n`,
    );
    process.exitCode = 1;
  }
}
