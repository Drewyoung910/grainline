#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  SELLER_PAYOUT_EVENT_AUTHORITY_FUNCTIONS,
  sellerPayoutEventAuthorityFunctionSourceSha256,
} from "./verify-seller-payout-event-authority-production-scope.mjs";
import {
  verifySellerPayoutEventActivationRelease,
} from "./verify-seller-payout-event-activation-release.mjs";

const { Client } = pg;
const OWNER_ENV = "SELLER_PAYOUT_EVENT_ACTIVATION_PROOF_DATABASE_URL";
const RUNTIME_ENV =
  "SELLER_PAYOUT_EVENT_ACTIVATION_PROOF_RUNTIME_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const OWNER_ROLE = "ci";
const RUNTIME_ROLE = "grainline_app_runtime";
const PREFIX = "seller-payout-activation-proof";

const ids = Object.freeze({
  userOne: `${PREFIX}-user-1`,
  userTwo: `${PREFIX}-user-2`,
  sellerOne: `${PREFIX}-seller-1`,
  sellerTwo: `${PREFIX}-seller-2`,
  accountOne: `acct_${PREFIX}_1`,
  accountTwo: `acct_${PREFIX}_2`,
  payout: `po_${PREFIX}_1`,
  event: `evt_${PREFIX}_1`,
  forgedEvent: `evt_${PREFIX}_forged`,
  readOnlyEvent: `evt_${PREFIX}_read_only`,
  readOnlyPayout: `po_${PREFIX}_read_only`,
});

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
  assert.equal(parsed.protocol, "postgresql:", `${label} requires PostgreSQL`);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    `${label} refuses a non-loopback database`,
  );
  assert.equal(parsed.pathname, `/${DATABASE_NAME}`);
  assert.equal(decodeURIComponent(parsed.username), expectedRole);
  return raw;
}

export function parseSellerPayoutEventActivationProofConfig(
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

function createClient(connectionString, applicationName) {
  return new Client({
    application_name: applicationName,
    connectionString,
    connectionTimeoutMillis: 10_000,
    query_timeout: 30_000,
    statement_timeout: 25_000,
  });
}

async function expectSqlState(client, label, sql, params, expectedCode) {
  await client.query("BEGIN");
  let caught;
  try {
    await client.query(sql, params);
  } catch (error) {
    caught = error;
  }
  await client.query("ROLLBACK");
  assert.ok(caught, `${label} unexpectedly succeeded`);
  assert.equal(caught.code, expectedCode, `${label} returned wrong SQLSTATE`);
}

async function cleanFixtures(owner) {
  await owner.query(
    'DELETE FROM public."SellerPayoutEvent" WHERE "stripePayoutId" LIKE $1',
    [`po_${PREFIX}%`],
  );
  await owner.query(
    'DELETE FROM public."StripeWebhookEvent" WHERE id LIKE $1',
    [`evt_${PREFIX}%`],
  );
  await owner.query(
    'DELETE FROM public."SellerProfile" WHERE id IN ($1, $2)',
    [ids.sellerOne, ids.sellerTwo],
  );
  await owner.query(
    'DELETE FROM public."User" WHERE id IN ($1, $2)',
    [ids.userOne, ids.userTwo],
  );
}

async function seedFixtures(owner) {
  await cleanFixtures(owner);
  await owner.query(`
    INSERT INTO public."User" (
      id, "clerkId", email, name, role, "createdAt", "updatedAt"
    ) VALUES
      ($1, $2, $3, 'Activation proof one', 'USER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($4, $5, $6, 'Activation proof two', 'USER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [
    ids.userOne,
    `clerk-${ids.userOne}`,
    `${ids.userOne}@example.invalid`,
    ids.userTwo,
    `clerk-${ids.userTwo}`,
    `${ids.userTwo}@example.invalid`,
  ]);
  await owner.query(`
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "displayNameNormalized",
      "stripeAccountId", "createdAt", "updatedAt"
    ) VALUES
      ($1, $2, 'Activation proof one', 'activation proof one', $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($4, $5, 'Activation proof two', 'activation proof two', $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [
    ids.sellerOne,
    ids.userOne,
    ids.accountOne,
    ids.sellerTwo,
    ids.userTwo,
    ids.accountTwo,
  ]);
  await owner.query(`
    INSERT INTO public."StripeWebhookEvent" (
      id, type, "sourceObjectId", "claimGeneration", "processingStartedAt"
    ) VALUES
      ($1, 'payout.failed', $2, 1, CURRENT_TIMESTAMP),
      ($3, 'payout.failed', 'po_${PREFIX}_real', 1, CURRENT_TIMESTAMP),
      ($4, 'payout.failed', $5, 1, CURRENT_TIMESTAMP)
  `, [
    ids.event,
    ids.payout,
    ids.forgedEvent,
    ids.readOnlyEvent,
    ids.readOnlyPayout,
  ]);
}

export async function proveSellerPayoutEventActivatedCatalog(
  owner,
  expectedOwner = OWNER_ROLE,
  expectedForced = false,
) {
  const table = await owner.query(`
    SELECT
      class.relrowsecurity AS rls_enabled,
      class.relforcerowsecurity AS rls_forced,
      pg_catalog.pg_get_userbyid(class.relowner) AS owner_name,
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
         WHERE acl.grantee <> class.relowner
           AND acl.privilege_type IN (
             'SELECT', 'INSERT', 'UPDATE', 'DELETE',
             'TRUNCATE', 'REFERENCES', 'TRIGGER'
           )
      ) AS unexpected_table_authority,
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
     AND class.relkind = 'r'
  `, [RUNTIME_ROLE]);
  assert.deepEqual(table.rows, [{
    rls_enabled: true,
    rls_forced: expectedForced,
    owner_name: expectedOwner,
    policy_count: 0,
    runtime_table_authority: false,
    runtime_column_authority: false,
    unexpected_table_authority: false,
    direct_column_acl: false,
    public_table_authority: false,
    public_column_authority: false,
    provider_time_not_null: true,
  }]);

  const functions = await owner.query(`
    SELECT
      procedure.proname || '(' || pg_catalog.replace(
        pg_catalog.oidvectortypes(procedure.proargtypes), ', ', ','
      ) || ')' AS identity,
      procedure.prosrc AS function_source,
      pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
      procedure.prosecdef AS security_definer,
      procedure.proconfig AS config,
      procedure.provolatile AS volatility,
      procedure.proparallel AS parallel,
      language.lanname AS language_name,
      pg_catalog.has_function_privilege(
        $1, procedure.oid, 'EXECUTE'
      ) AS runtime_execute,
      EXISTS (
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
               AND (acl.grantor <> procedure.proowner OR acl.is_grantable)
             )
           )
      ) AS invalid_execute_acl
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    JOIN pg_catalog.pg_language AS language
      ON language.oid = procedure.prolang
   WHERE namespace.nspname = 'public'
     AND procedure.proname = ANY($2::text[])
   ORDER BY identity
  `, [
    RUNTIME_ROLE,
    SELLER_PAYOUT_EVENT_AUTHORITY_FUNCTIONS.map(
      (entry) => entry.identity.slice(0, entry.identity.indexOf("(")),
    ),
  ]);
  const expectedByIdentity = new Map(
    SELLER_PAYOUT_EVENT_AUTHORITY_FUNCTIONS.map((entry) => [entry.identity, entry]),
  );
  const sourceHashes = sellerPayoutEventAuthorityFunctionSourceSha256();
  assert.equal(functions.rows.length, expectedByIdentity.size);
  for (const row of functions.rows) {
    const expected = expectedByIdentity.get(row.identity);
    assert.ok(expected, row.identity);
    assert.equal(row.owner_name, expectedOwner, row.identity);
    assert.equal(row.security_definer, true, row.identity);
    assert.deepEqual(row.config, ["search_path=pg_catalog"], row.identity);
    assert.equal(row.volatility, expected.volatility, row.identity);
    assert.equal(row.parallel, expected.parallel, row.identity);
    assert.equal(row.language_name, expected.language, row.identity);
    assert.equal(row.runtime_execute, true, row.identity);
    assert.equal(row.invalid_execute_acl, false, row.identity);
    assert.equal(
      createHash("sha256").update(row.function_source).digest("hex"),
      sourceHashes[row.identity],
      `${row.identity} source drifted`,
    );
  }
}

async function proveRuntimeBoundary(runtime, nowSeconds) {
  const identity = await runtime.query(`
    SELECT current_database() AS database_name,
           CURRENT_USER AS current_user,
           SESSION_USER AS session_user
  `);
  assert.deepEqual(identity.rows, [{
    database_name: DATABASE_NAME,
    current_user: RUNTIME_ROLE,
    session_user: RUNTIME_ROLE,
  }]);

  for (const [label, sql, params = []] of [
    ["direct_select", 'SELECT id FROM public."SellerPayoutEvent" LIMIT 1'],
    [
      "direct_insert",
      `INSERT INTO public."SellerPayoutEvent" (
         id, "sellerProfileId", "stripePayoutId", status,
         currency, "stripeEventId", "stripeEventCreatedSeconds"
       ) VALUES ('forged', $1, 'po_forged', 'failed', 'usd', 'evt_forged', 1)`,
      [ids.sellerOne],
    ],
    [
      "direct_update",
      'UPDATE public."SellerPayoutEvent" SET status = \'failed\' WHERE id = \'forged\'',
    ],
    [
      "direct_delete",
      'DELETE FROM public."SellerPayoutEvent" WHERE id = \'forged\'',
    ],
  ]) {
    await expectSqlState(runtime, label, sql, params, "42501");
  }

  await expectSqlState(
    runtime,
    "forged_source",
    `SELECT * FROM public.grainline_seller_payout_event_apply(
      $1, 1, $2, $3, 'po_${PREFIX}_forged', 100,
      'usd', 'proof', 'Forged source proof'
    )`,
    [ids.forgedEvent, nowSeconds, ids.accountOne],
    "23514",
  );

  const inserted = await runtime.query(`
    SELECT action, payout_event_id, seller_user_id
      FROM public.grainline_seller_payout_event_apply(
        $1, 1, $2, $3, $4, 100, 'usd', 'proof', 'Activation proof'
      )
  `, [ids.event, nowSeconds, ids.accountOne, ids.payout]);
  assert.equal(inserted.rows[0]?.action, "inserted");
  assert.equal(inserted.rows[0]?.seller_user_id, ids.userOne);

  const replay = await runtime.query(`
    SELECT action, payout_event_id, seller_user_id
      FROM public.grainline_seller_payout_event_apply(
        $1, 1, $2, $3, $4, 100, 'usd', 'proof', 'Activation proof'
      )
  `, [ids.event, nowSeconds, ids.accountOne, ids.payout]);
  assert.deepEqual(replay.rows, [{
    action: "already_applied",
    payout_event_id: inserted.rows[0].payout_event_id,
    seller_user_id: ids.userOne,
  }]);

  const latest = await runtime.query(
    "SELECT * FROM public.grainline_seller_payout_latest_failure($1)",
    [ids.userOne],
  );
  assert.equal(latest.rowCount, 1);
  assert.equal(latest.rows[0].payout_event_id, inserted.rows[0].payout_event_id);
  const foreign = await runtime.query(
    "SELECT * FROM public.grainline_seller_payout_latest_failure($1)",
    [ids.userTwo],
  );
  assert.equal(foreign.rowCount, 0);
  const exported = await runtime.query(`
    SELECT * FROM public.grainline_seller_payout_export_page(
      $1, 10000, NULL, NULL
    )
  `, [ids.userOne]);
  assert.equal(exported.rowCount, 1);
  assert.equal(exported.rows[0].seller_profile_id, ids.sellerOne);

  await runtime.query("BEGIN TRANSACTION READ ONLY");
  let readOnlyError;
  try {
    await runtime.query(`
      SELECT * FROM public.grainline_seller_payout_event_apply(
        $1, 1, $2, $3, $4, 100, 'usd', 'proof', 'Activation proof'
      )
    `, [
      ids.readOnlyEvent,
      nowSeconds,
      ids.accountOne,
      ids.readOnlyPayout,
    ]);
  } catch (error) {
    readOnlyError = error;
  }
  await runtime.query("ROLLBACK");
  assert.equal(readOnlyError?.code, "25006");
}

export async function runSellerPayoutEventActivationProof(env = process.env) {
  const { ownerUrl, runtimeUrl } =
    parseSellerPayoutEventActivationProofConfig(env);
  verifySellerPayoutEventActivationRelease();
  const owner = createClient(ownerUrl, `${PREFIX}-owner`);
  const runtime = createClient(runtimeUrl, `${PREFIX}-runtime`);
  await owner.connect();
  await runtime.connect();
  try {
    await proveSellerPayoutEventActivatedCatalog(owner);
    await seedFixtures(owner);
    const now = Number((await owner.query(`
      SELECT pg_catalog.floor(
        EXTRACT(EPOCH FROM pg_catalog.clock_timestamp())
      )::bigint AS now_seconds
    `)).rows[0].now_seconds);
    await proveRuntimeBoundary(runtime, now);
    await cleanFixtures(owner);
    const residue = await owner.query(`
      SELECT
        (SELECT pg_catalog.count(*)::integer
           FROM public."SellerPayoutEvent"
          WHERE "stripePayoutId" LIKE $1) AS payouts,
        (SELECT pg_catalog.count(*)::integer
           FROM public."StripeWebhookEvent"
          WHERE id LIKE $2) AS events,
        (SELECT pg_catalog.count(*)::integer
           FROM public."SellerProfile"
          WHERE id IN ($3, $4)) AS sellers,
        (SELECT pg_catalog.count(*)::integer
           FROM public."User"
          WHERE id IN ($5, $6)) AS users
    `, [
      `po_${PREFIX}%`,
      `evt_${PREFIX}%`,
      ids.sellerOne,
      ids.sellerTwo,
      ids.userOne,
      ids.userTwo,
    ]);
    assert.deepEqual(residue.rows, [{
      payouts: 0,
      events: 0,
      sellers: 0,
      users: 0,
    }]);
    return Object.freeze({
      database: DATABASE_NAME,
      directRuntimeLogin: true,
      directTableOperationsDenied: 4,
      sourcePinnedFunctions: 3,
      forgedSourceRejected: true,
      sellerProjectionIsolated: true,
      exactReplayIdempotent: true,
      writeFunctionReadOnlyFence: true,
      policyCount: 0,
      rlsEnabled: true,
      rlsForced: false,
      residue: 0,
      productionTouched: false,
    });
  } finally {
    await cleanFixtures(owner).catch(() => {});
    await runtime.end().catch(() => {});
    await owner.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(
      await runSellerPayoutEventActivationProof(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(
      `SellerPayoutEvent activation PostgreSQL proof failed: ${safeError(error)}\n`,
    );
    process.exitCode = 1;
  }
}
