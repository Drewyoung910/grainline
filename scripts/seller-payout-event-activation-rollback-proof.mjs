#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION,
} from "./stage-seller-payout-event-activation-migration.mjs";
import {
  proveSellerPayoutEventActivatedCatalog,
} from "./seller-payout-event-activation-postgres-proof.mjs";
import {
  verifySellerPayoutEventActivationRelease,
} from "./verify-seller-payout-event-activation-release.mjs";

const { Client } = pg;
const OWNER_ENV =
  "SELLER_PAYOUT_EVENT_ACTIVATION_ROLLBACK_PROOF_DATABASE_URL";
const RUNTIME_ENV =
  "SELLER_PAYOUT_EVENT_ACTIVATION_ROLLBACK_PROOF_RUNTIME_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const OWNER_ROLE = "ci";
const RUNTIME_ROLE = "grainline_app_runtime";
const PREFIX = "seller-payout-activation-rollback-proof";
const ROLLBACK =
  "docs/rls-drafts/seller-payout-event-activation-rollback.sql";

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/giu, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/giu,
      "$1[redacted-credentials]@",
    );
}

function parseLoopbackUrl(raw, label, expectedRole) {
  assert.ok(raw, `${label} is required`);
  const parsed = new URL(raw);
  assert.equal(parsed.protocol, "postgresql:");
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    `${label} refuses a non-loopback database`,
  );
  assert.equal(parsed.pathname, `/${DATABASE_NAME}`);
  assert.equal(decodeURIComponent(parsed.username), expectedRole);
  return raw;
}

export function parseSellerPayoutEventActivationRollbackProofConfig(
  env = process.env,
) {
  return Object.freeze({
    ownerUrl: parseLoopbackUrl(env[OWNER_ENV], OWNER_ENV, OWNER_ROLE),
    runtimeUrl: parseLoopbackUrl(
      env[RUNTIME_ENV],
      RUNTIME_ENV,
      RUNTIME_ROLE,
    ),
  });
}

async function tableState(owner) {
  const result = await owner.query(`
    SELECT
      class.relrowsecurity AS rls_enabled,
      class.relforcerowsecurity AS rls_forced,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.pg_policy AS policy
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
         WHERE acl.grantee NOT IN (
                 class.relowner,
                 (SELECT role.oid FROM pg_catalog.pg_roles AS role
                   WHERE role.rolname = $1)
               )
            OR (
              acl.grantee = (
                SELECT role.oid FROM pg_catalog.pg_roles AS role
                 WHERE role.rolname = $1
              )
              AND (
                acl.privilege_type NOT IN (
                  'SELECT', 'INSERT', 'UPDATE', 'DELETE'
                )
                OR acl.grantor <> class.relowner
                OR acl.is_grantable
              )
            )
      ) AS unexpected_table_acl,
      EXISTS (
        SELECT 1
          FROM pg_catalog.pg_attribute AS attribute
          CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
         WHERE attribute.attrelid = class.oid
           AND attribute.attnum > 0
           AND NOT attribute.attisdropped
           AND acl.privilege_type IN (
             'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
           )
      ) AS direct_column_acl,
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
      ) AS public_column_authority,
      EXISTS (
        SELECT 1
          FROM pg_catalog.pg_attribute AS attribute
         WHERE attribute.attrelid = class.oid
           AND attribute.attname = 'stripeEventCreatedSeconds'
           AND attribute.attnum > 0
           AND NOT attribute.attisdropped
           AND attribute.attnotnull
      ) AS provider_time_not_null
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'SellerPayoutEvent'
  `, [RUNTIME_ROLE]);
  assert.equal(result.rowCount, 1);
  return result.rows[0];
}

const activatedState = Object.freeze({
  rls_enabled: true,
  rls_forced: false,
  policy_count: 0,
  can_select: false,
  can_insert: false,
  can_update: false,
  can_delete: false,
  other_authority: false,
  runtime_column_authority: false,
  unexpected_table_acl: false,
  direct_column_acl: false,
  public_table_authority: false,
  public_column_authority: false,
  provider_time_not_null: true,
});

const predecessorState = Object.freeze({
  rls_enabled: false,
  rls_forced: false,
  policy_count: 0,
  can_select: true,
  can_insert: true,
  can_update: true,
  can_delete: true,
  other_authority: false,
  runtime_column_authority: true,
  unexpected_table_acl: false,
  direct_column_acl: false,
  public_table_authority: false,
  public_column_authority: false,
  provider_time_not_null: false,
});

async function proveRollbackRejectsDrift(owner, rollbackSql, grantSql) {
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
  assert.match(caught?.message ?? "", /rollback predecessor drifted/u);
}

async function seedOwnerFixture(owner) {
  await owner.query(`
    INSERT INTO public."User" (
      id, "clerkId", email, name, role, "createdAt", "updatedAt"
    ) VALUES (
      $1, $2, $3, 'Rollback proof', 'USER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT (id) DO NOTHING
  `, [
    `${PREFIX}-user`,
    `clerk-${PREFIX}-user`,
    `${PREFIX}@example.invalid`,
  ]);
  await owner.query(`
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "displayNameNormalized",
      "createdAt", "updatedAt"
    ) VALUES (
      $1, $2, 'Rollback proof', 'rollback proof',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT (id) DO NOTHING
  `, [`${PREFIX}-seller`, `${PREFIX}-user`]);
}

async function cleanOwnerFixture(owner) {
  await owner.query(
    'DELETE FROM public."SellerPayoutEvent" WHERE id = $1',
    [`${PREFIX}-row`],
  );
  await owner.query(
    'DELETE FROM public."SellerProfile" WHERE id = $1',
    [`${PREFIX}-seller`],
  );
  await owner.query(
    'DELETE FROM public."User" WHERE id = $1',
    [`${PREFIX}-user`],
  );
}

async function provePredecessorCrud(runtime) {
  await runtime.query("BEGIN");
  try {
    await runtime.query(`
      INSERT INTO public."SellerPayoutEvent" (
        id, "sellerProfileId", "stripePayoutId", status,
        "amountCents", currency, "stripeEventId",
        "stripeEventCreatedSeconds", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, 'failed', 100, 'usd', $4,
        NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `, [
      `${PREFIX}-row`,
      `${PREFIX}-seller`,
      `po_${PREFIX}`,
      `evt_${PREFIX}`,
    ]);
    const selected = await runtime.query(
      'SELECT status FROM public."SellerPayoutEvent" WHERE id = $1',
      [`${PREFIX}-row`],
    );
    assert.deepEqual(selected.rows, [{ status: "failed" }]);
    await runtime.query(
      'UPDATE public."SellerPayoutEvent" SET "amountCents" = 125 WHERE id = $1',
      [`${PREFIX}-row`],
    );
    const deleted = await runtime.query(
      'DELETE FROM public."SellerPayoutEvent" WHERE id = $1 RETURNING id',
      [`${PREFIX}-row`],
    );
    assert.deepEqual(deleted.rows, [{ id: `${PREFIX}-row` }]);
    await runtime.query("COMMIT");
  } catch (error) {
    await runtime.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

export async function runSellerPayoutEventActivationRollbackProof(
  env = process.env,
) {
  const { ownerUrl, runtimeUrl } =
    parseSellerPayoutEventActivationRollbackProofConfig(env);
  verifySellerPayoutEventActivationRelease();
  const owner = new Client({ connectionString: ownerUrl });
  const runtime = new Client({ connectionString: runtimeUrl });
  const rollbackSql = fs.readFileSync(ROLLBACK, "utf8");
  const activationSql = fs.readFileSync(
    `prisma/migrations/${SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION}/migration.sql`,
    "utf8",
  );
  await owner.connect();
  await runtime.connect();
  let restoreRequired = false;
  try {
    await proveSellerPayoutEventActivatedCatalog(owner);
    assert.deepEqual(await tableState(owner), activatedState);
    await proveRollbackRejectsDrift(
      owner,
      rollbackSql,
      'GRANT SELECT ON TABLE public."SellerPayoutEvent" TO PUBLIC',
    );
    assert.deepEqual(await tableState(owner), activatedState);
    await proveRollbackRejectsDrift(
      owner,
      rollbackSql,
      'GRANT SELECT (id) ON TABLE public."SellerPayoutEvent" TO PUBLIC',
    );
    assert.deepEqual(await tableState(owner), activatedState);

    restoreRequired = true;
    await owner.query(rollbackSql);
    assert.deepEqual(await tableState(owner), predecessorState);
    await seedOwnerFixture(owner);
    await provePredecessorCrud(runtime);
    await cleanOwnerFixture(owner);

    await owner.query(activationSql);
    restoreRequired = false;
    await proveSellerPayoutEventActivatedCatalog(owner);
    assert.deepEqual(await tableState(owner), activatedState);
    return Object.freeze({
      database: DATABASE_NAME,
      directRuntimeLogin: true,
      predecessorCrudProven: true,
      nullableCompatibilityRestored: true,
      publicAuthorityDriftRejected: true,
      activationRestored: true,
      rowResidue: 0,
      productionTouched: false,
    });
  } catch (error) {
    await owner.query("ROLLBACK").catch(() => {});
    await cleanOwnerFixture(owner).catch(() => {});
    if (restoreRequired) {
      try {
        await owner.query(activationSql);
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          "rollback proof failed and could not restore activation",
        );
      }
    }
    throw error;
  } finally {
    await cleanOwnerFixture(owner).catch(() => {});
    await runtime.end().catch(() => {});
    await owner.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(
      await runSellerPayoutEventActivationRollbackProof(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(
      `SellerPayoutEvent activation rollback proof failed: ${safeError(error)}\n`,
    );
    process.exitCode = 1;
  }
}
