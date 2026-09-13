#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  verifyStripeWebhookEventActivationRelease,
} from "./verify-stripe-webhook-event-activation-release.mjs";

const { Client } = pg;
const PROOF_ENV = "STRIPE_WEBHOOK_EVENT_ACTIVATION_ROLLBACK_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const RUNTIME_ROLE = "grainline_app_runtime";
const PREFIX = "evt_grainline_activation_rollback_proof";
const ROLLBACK = "docs/rls-drafts/stripe-webhook-event-activation-rollback.sql";

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/gi, "[redacted-postgres-url]")
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[redacted-credentials]@");
}

export function parseStripeWebhookEventRollbackProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.equal(parsed.protocol, "postgresql:", "rollback proof requires PostgreSQL");
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "rollback proof refuses a non-loopback database",
  );
  assert.equal(parsed.pathname, `/${DATABASE_NAME}`);
  return Object.freeze({ databaseUrl });
}

async function tableState(owner) {
  const result = await owner.query(`
    SELECT
      class.relrowsecurity AS rls_enabled,
      class.relforcerowsecurity AS rls_forced,
      (SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid) AS policy_count,
      pg_catalog.has_table_privilege($1, class.oid, 'SELECT') AS can_select,
      pg_catalog.has_table_privilege($1, class.oid, 'INSERT') AS can_insert,
      pg_catalog.has_table_privilege($1, class.oid, 'UPDATE') AS can_update,
      pg_catalog.has_table_privilege($1, class.oid, 'DELETE') AS can_delete,
      pg_catalog.has_table_privilege(
        $1, class.oid, 'TRUNCATE,REFERENCES,TRIGGER'
      ) AS other_authority,
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
  `, [RUNTIME_ROLE]);
  assert.equal(result.rowCount, 1);
  return result.rows[0];
}

async function proveRollbackRejectsPublicDrift(owner, rollbackSql, grantSql) {
  await owner.query("BEGIN");
  let caught;
  try {
    await owner.query(grantSql);
    await owner.query(rollbackSql);
  } catch (error) {
    caught = error;
  }
  await owner.query("ROLLBACK");
  assert.equal(caught?.code, "P0001");
  assert.match(caught?.message ?? "", /rollback predecessor drifted/);
}

async function restoreActivation(owner) {
  await owner.query("BEGIN");
  try {
    await owner.query(`SELECT pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('grainline.stripe-webhook-event.rls.activation', 0)
    )`);
    await owner.query(`LOCK TABLE public."StripeWebhookEvent" IN ACCESS EXCLUSIVE MODE`);
    await owner.query(`ALTER TABLE public."StripeWebhookEvent" ENABLE ROW LEVEL SECURITY`);
    await owner.query(`ALTER TABLE public."StripeWebhookEvent" NO FORCE ROW LEVEL SECURITY`);
    await owner.query(`REVOKE ALL ON TABLE public."StripeWebhookEvent" FROM PUBLIC, ${RUNTIME_ROLE}`);
    await owner.query("COMMIT");
  } catch (error) {
    await owner.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function proveOldRuntimeCrud(databaseUrl) {
  const runtime = new Client({ connectionString: databaseUrl });
  await runtime.connect();
  try {
    await runtime.query("BEGIN");
    await runtime.query(`SET LOCAL ROLE ${RUNTIME_ROLE}`);
    await runtime.query(
      `INSERT INTO public."StripeWebhookEvent" (id, type) VALUES ($1, 'proof.rollback')`,
      [PREFIX],
    );
    const selected = await runtime.query(
      `SELECT type FROM public."StripeWebhookEvent" WHERE id = $1`,
      [PREFIX],
    );
    assert.deepEqual(selected.rows, [{ type: "proof.rollback" }]);
    await runtime.query(
      `UPDATE public."StripeWebhookEvent" SET type = 'proof.rollback.updated' WHERE id = $1`,
      [PREFIX],
    );
    const deleted = await runtime.query(
      `DELETE FROM public."StripeWebhookEvent" WHERE id = $1 RETURNING id`,
      [PREFIX],
    );
    assert.deepEqual(deleted.rows, [{ id: PREFIX }]);
    await runtime.query("ROLLBACK");
  } finally {
    await runtime.query("ROLLBACK").catch(() => {});
    await runtime.end();
  }
}

export async function runStripeWebhookEventRollbackProof(env = process.env) {
  const { databaseUrl } = parseStripeWebhookEventRollbackProofConfig(env);
  verifyStripeWebhookEventActivationRelease();
  const owner = new Client({ connectionString: databaseUrl });
  await owner.connect();
  let restoreRequired = false;
  try {
    const activatedState = {
      rls_enabled: true,
      rls_forced: false,
      policy_count: 0,
      can_select: false,
      can_insert: false,
      can_update: false,
      can_delete: false,
      other_authority: false,
      runtime_column_authority: false,
      public_table_authority: false,
      public_column_authority: false,
    };
    assert.deepEqual(await tableState(owner), activatedState);
    const rollbackSql = fs.readFileSync(ROLLBACK, "utf8");
    await proveRollbackRejectsPublicDrift(
      owner,
      rollbackSql,
      `GRANT SELECT ON TABLE public."StripeWebhookEvent" TO PUBLIC`,
    );
    assert.deepEqual(await tableState(owner), activatedState);
    await proveRollbackRejectsPublicDrift(
      owner,
      rollbackSql,
      `GRANT SELECT (id) ON TABLE public."StripeWebhookEvent" TO PUBLIC`,
    );
    assert.deepEqual(await tableState(owner), activatedState);
    restoreRequired = true;
    await owner.query(rollbackSql);
    assert.deepEqual(await tableState(owner), {
      rls_enabled: false,
      rls_forced: false,
      policy_count: 0,
      can_select: true,
      can_insert: true,
      can_update: true,
      can_delete: true,
      other_authority: false,
      runtime_column_authority: true,
      public_table_authority: false,
      public_column_authority: false,
    });
    await proveOldRuntimeCrud(databaseUrl);
    await restoreActivation(owner);
    assert.deepEqual(await tableState(owner), activatedState);
    const residue = await owner.query(
      `SELECT pg_catalog.count(*)::integer AS residue_count
         FROM public."StripeWebhookEvent" WHERE id = $1`,
      [PREFIX],
    );
    assert.deepEqual(residue.rows, [{ residue_count: 0 }]);
    return Object.freeze({
      database: DATABASE_NAME,
      predecessorCrudProven: true,
      publicAuthorityDriftRejected: true,
      activationRestored: true,
      rowResidue: 0,
      productionTouched: false,
    });
  } catch (error) {
    await owner.query("ROLLBACK").catch(() => {});
    if (restoreRequired) {
      try {
        await restoreActivation(owner);
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          "rollback proof failed and could not restore activation",
        );
      }
    }
    throw error;
  } finally {
    await owner.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(
      `${JSON.stringify(await runStripeWebhookEventRollbackProof(), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `StripeWebhookEvent activation rollback proof failed: ${safeError(error)}\n`,
    );
    process.exitCode = 1;
  }
}
