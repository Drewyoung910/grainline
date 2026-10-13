#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { proofServerHostAccepted } from "./disposable-postgres-proof-host.mjs";

const PROOF_ENV = "SELLER_PROFILE_PRIVATE_BOUNDARY_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const RUNTIME_ROLE = "grainline_app_runtime";

export function parseSellerProfilePrivateBoundaryProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "SellerProfile private-boundary proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `SellerProfile private-boundary proof requires the ${DATABASE_NAME} database`,
  );
  const allowDockerBridge = env.GITHUB_ACTIONS === "true"
    || env.SELLER_PROFILE_PRIVATE_BOUNDARY_ALLOW_DOCKER_BRIDGE === "true";
  assert.ok(
    env.SELLER_PROFILE_PRIVATE_BOUNDARY_ALLOW_DOCKER_BRIDGE === undefined
      || env.SELLER_PROFILE_PRIVATE_BOUNDARY_ALLOW_DOCKER_BRIDGE === "true",
    "Docker bridge proof opt-in must be absent or exactly true",
  );
  return Object.freeze({ databaseUrl, allowDockerBridge });
}

function qualified(schema, object) {
  assert.match(schema, /^seller_profile_private_proof_[a-f0-9]{32}$/);
  assert.match(object, /^[A-Za-z_][A-Za-z0-9_]*$/);
  return `"${schema}"."${object}"`;
}

export function qualifySellerProfilePrivateBoundaryMigration(sql, schema) {
  assert.match(schema, /^seller_profile_private_proof_[a-f0-9]{32}$/);
  assert.match(sql, /CREATE TABLE public\."SellerProfilePrivate"/);
  assert.doesNotMatch(sql, new RegExp(`"${schema}"`, "u"));
  return sql.replaceAll("public.", `"${schema}".`);
}

async function expectSqlState(client, sql, code) {
  await client.query("SAVEPOINT expected_failure");
  try {
    await client.query(sql);
    assert.fail(`expected PostgreSQL SQLSTATE ${code}`);
  } catch (error) {
    assert.equal(error?.code, code);
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT expected_failure");
    await client.query("RELEASE SAVEPOINT expected_failure");
  }
}

export async function runSellerProfilePrivateBoundaryPostgresProof(
  env = process.env,
  onPhase = () => {},
) {
  const { databaseUrl, allowDockerBridge } =
    parseSellerProfilePrivateBoundaryProofConfig(env);
  const schema = `seller_profile_private_proof_${randomUUID().replaceAll("-", "")}`;
  const client = new pg.Client({
    application_name: "grainline-seller-profile-private-boundary-proof",
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
    query_timeout: 30_000,
    statement_timeout: 25_000,
  });
  let connected = false;
  let began = false;
  let roleExisted = true;

  try {
    onPhase("identity");
    await client.connect();
    connected = true;
    const { rows: [identity] } = await client.query(`
      SELECT current_database() AS db,
             CURRENT_USER AS actor,
             SESSION_USER AS login,
             current_setting('server_version_num')::int AS version,
             pg_catalog.host(pg_catalog.inet_server_addr()) AS host
    `);
    assert.equal(identity.db, DATABASE_NAME);
    assert.equal(identity.actor, "ci");
    assert.equal(identity.login, "ci");
    assert.ok(identity.version >= 160000 && identity.version < 170000);
    assert.ok(proofServerHostAccepted(identity.host, allowDockerBridge));

    await client.query("BEGIN");
    began = true;
    roleExisted = (await client.query(
      "SELECT pg_catalog.to_regrole($1) IS NOT NULL AS present",
      [RUNTIME_ROLE],
    )).rows[0].present;
    if (!roleExisted) await client.query(`CREATE ROLE ${RUNTIME_ROLE} NOLOGIN`);

    onPhase("predecessor-fixture");
    const sellerProfile = qualified(schema, "SellerProfile");
    const privateProfile = qualified(schema, "SellerProfilePrivate");
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`GRANT USAGE ON SCHEMA "${schema}" TO ${RUNTIME_ROLE}`);
    await client.query(`
      CREATE TABLE ${sellerProfile} (
        id text PRIMARY KEY,
        "stripeAccountId" varchar(255) UNIQUE,
        "stripeAccountVersion" varchar(20),
        "stripeControllerType" varchar(100),
        "manualStripeReconciliationNeeded" boolean NOT NULL DEFAULT false,
        "manualStripeReconciliationNote" varchar(1000),
        "shipFromName" varchar(100),
        "shipFromLine1" varchar(200),
        "shipFromLine2" varchar(200),
        "shipFromCity" varchar(100),
        "shipFromState" varchar(50),
        "shipFromPostal" varchar(20),
        "shipFromCountry" varchar(2) DEFAULT 'US',
        "shipFromPhone" varchar(30),
        "defaultPkgWeightGrams" integer,
        "defaultPkgLengthCm" double precision,
        "defaultPkgWidthCm" double precision,
        "defaultPkgHeightCm" double precision,
        "useCalculatedShipping" boolean NOT NULL DEFAULT false,
        "preferredCarriers" text[] NOT NULL DEFAULT ARRAY[]::text[],
        "onboardingStep" integer NOT NULL DEFAULT 0,
        "onboardingComplete" boolean NOT NULL DEFAULT false,
        "guildMemberApprovedAt" timestamp(3) without time zone,
        "guildMasterApprovedAt" timestamp(3) without time zone,
        "guildMasterAppliedAt" timestamp(3) without time zone,
        "guildMasterReviewNotes" varchar(2000),
        "consecutiveMetricFailures" integer NOT NULL DEFAULT 0,
        "lastMetricCheckAt" timestamp(3) without time zone,
        "metricWarningSentAt" timestamp(3) without time zone,
        "listingsBelowThresholdSince" timestamp(3) without time zone,
        "profileViews" integer NOT NULL DEFAULT 0,
        "displayName" text NOT NULL,
        "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      INSERT INTO ${sellerProfile} (
        id, "stripeAccountId", "stripeAccountVersion", "stripeControllerType",
        "shipFromLine1", "shipFromCity", "shipFromState", "shipFromPostal",
        "preferredCarriers", "onboardingStep", "onboardingComplete",
        "guildMemberApprovedAt", "guildMasterApprovedAt", "guildMasterAppliedAt",
        "guildMasterReviewNotes", "profileViews", "displayName"
      ) VALUES
        ('seller-v2', 'acct_v2', 'v2', 'application', '12 Studio Way',
         'Chicago', 'IL', '60601', ARRAY['usps'], 4, true,
         TIMESTAMP '2026-01-01', TIMESTAMP '2026-02-01', TIMESTAMP '2025-12-15',
         'reviewed', 17, 'V2 Maker'),
        ('seller-legacy', 'acct_legacy', 'v1', 'account', '88 Old Road',
         'Madison', 'WI', '53703', ARRAY['ups'], 2, false,
         NULL, NULL, TIMESTAMP '2026-03-01', 'legacy', 9, 'Legacy Maker'),
        ('seller-unlinked', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
         ARRAY[]::text[], 0, false, NULL, NULL, NULL, NULL, 0, 'Unlinked Maker')
    `);

    onPhase("exact-migration");
    const migration = qualifySellerProfilePrivateBoundaryMigration(
      readFileSync(
        "prisma/migrations/20261013120000_prepare_seller_profile_private_boundary/migration.sql",
        "utf8",
      ),
      schema,
    );
    await client.query(migration);

    onPhase("backfill-and-snapshot");
    assert.deepEqual(
      (await client.query(`
        SELECT p."sellerProfileId" AS id,
               s."stripeAccountSupported" AS supported,
               p."shipFromLine1" AS line1,
               p."preferredCarriers" AS carriers,
               pg_catalog.to_char(p."guildMasterAppliedAt", 'YYYY-MM-DD') AS applied,
               p."guildMasterReviewNotes" AS notes
        FROM ${privateProfile} p
        JOIN ${sellerProfile} s ON s.id = p."sellerProfileId"
        ORDER BY p."sellerProfileId"
      `)).rows,
      [
        { id: "seller-legacy", supported: false, line1: "88 Old Road", carriers: ["ups"], applied: "2026-03-01", notes: "legacy" },
        { id: "seller-unlinked", supported: true, line1: null, carriers: [], applied: null, notes: null },
        { id: "seller-v2", supported: true, line1: "12 Studio Way", carriers: ["usps"], applied: "2025-12-15", notes: "reviewed" },
      ],
    );

    onPhase("mirror-and-constraint");
    await client.query(`
      INSERT INTO ${sellerProfile} (
        id, "stripeAccountId", "stripeAccountVersion", "stripeAccountSupported",
        "shipFromName", "shipFromPhone", "defaultPkgWeightGrams",
        "preferredCarriers", "onboardingStep", "profileViews", "displayName"
      ) VALUES (
        'seller-new', 'acct_new', 'v2', false,
        'New Maker', '+13125550100', 1200,
        ARRAY['usps', 'ups'], 1, 3, 'New Maker'
      )
    `);
    assert.deepEqual(
      (await client.query(`
        SELECT s."stripeAccountSupported" AS supported,
               p."stripeAccountVersion" AS version,
               p."shipFromPhone" AS phone,
               p."defaultPkgWeightGrams" AS grams,
               p."preferredCarriers" AS carriers
        FROM ${sellerProfile} s
        JOIN ${privateProfile} p ON p."sellerProfileId" = s.id
        WHERE s.id = 'seller-new'
      `)).rows[0],
      {
        supported: true,
        version: "v2",
        phone: "+13125550100",
        grams: 1200,
        carriers: ["usps", "ups"],
      },
    );
    const beforePublicOnlyUpdate = (await client.query(
      `SELECT "updatedAt" FROM ${privateProfile} WHERE "sellerProfileId" = 'seller-new'`,
    )).rows[0].updatedAt;
    await client.query(
      `UPDATE ${sellerProfile} SET "displayName" = 'Renamed Maker' WHERE id = 'seller-new'`,
    );
    assert.equal(
      +(await client.query(
        `SELECT "updatedAt" FROM ${privateProfile} WHERE "sellerProfileId" = 'seller-new'`,
      )).rows[0].updatedAt,
      +beforePublicOnlyUpdate,
    );
    await client.query(`
      UPDATE ${sellerProfile}
      SET "stripeAccountVersion" = 'v1',
          "stripeAccountSupported" = true,
          "shipFromLine1" = '99 Changed Lane',
          "manualStripeReconciliationNeeded" = true
      WHERE id = 'seller-new'
    `);
    assert.deepEqual(
      (await client.query(`
        SELECT s."stripeAccountSupported" AS supported,
               p."stripeAccountVersion" AS version,
               p."shipFromLine1" AS line1,
               p."manualStripeReconciliationNeeded" AS reconciliation
        FROM ${sellerProfile} s
        JOIN ${privateProfile} p ON p."sellerProfileId" = s.id
        WHERE s.id = 'seller-new'
      `)).rows[0],
      { supported: false, version: "v1", line1: "99 Changed Lane", reconciliation: true },
    );
    await expectSqlState(
      client,
      `UPDATE ${sellerProfile} SET "defaultPkgWeightGrams" = -1 WHERE id = 'seller-new'`,
      "23514",
    );

    onPhase("zero-direct-runtime");
    const functionPrivileges = (await client.query(`
      SELECT
        pg_catalog.has_function_privilege(
          $1,
          '"${schema}".grainline_seller_profile_supported_snapshot()',
          'EXECUTE'
        ) AS supported_snapshot,
        pg_catalog.has_function_privilege(
          $1,
          '"${schema}".grainline_seller_profile_private_mirror()',
          'EXECUTE'
        ) AS private_mirror
    `, [RUNTIME_ROLE])).rows[0];
    assert.deepEqual(functionPrivileges, {
      supported_snapshot: false,
      private_mirror: false,
    });
    await client.query("SAVEPOINT runtime_denial");
    await client.query(`SET LOCAL ROLE ${RUNTIME_ROLE}`);
    try {
      await client.query(`SELECT * FROM ${privateProfile}`);
      assert.fail("runtime role unexpectedly read SellerProfilePrivate");
    } catch (error) {
      assert.equal(error?.code, "42501");
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT runtime_denial");
      await client.query("RELEASE SAVEPOINT runtime_denial");
    }

    onPhase("cascade-and-cleanup");
    await client.query(`DELETE FROM ${sellerProfile} WHERE id = 'seller-new'`);
    assert.equal(
      (await client.query(
        `SELECT count(*)::int AS count FROM ${privateProfile} WHERE "sellerProfileId" = 'seller-new'`,
      )).rows[0].count,
      0,
    );
    await client.query("ROLLBACK");
    began = false;
    assert.equal(
      (await client.query(
        "SELECT count(*)::int AS count FROM pg_catalog.pg_namespace WHERE nspname = $1",
        [schema],
      )).rows[0].count,
      0,
    );
    if (!roleExisted) {
      assert.equal(
        (await client.query(
          "SELECT pg_catalog.to_regrole($1) IS NULL AS absent",
          [RUNTIME_ROLE],
        )).rows[0].absent,
        true,
      );
    }

    return Object.freeze({
      status: "passed",
      exactMigration: true,
      backfillRows: 3,
      mirroredInsertAndUpdate: true,
      runtimeDirectReadDenied: true,
      cleanup: "transaction-rollback-confirmed",
    });
  } finally {
    if (connected) {
      if (began) await client.query("ROLLBACK").catch(() => {});
      await client.end();
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let phase = "configuration";
  try {
    const result = await runSellerProfilePrivateBoundaryPostgresProof(
      process.env,
      (value) => { phase = value; },
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const code = /^[A-Z0-9]{5}$/u.test(error?.code ?? "")
      ? error.code
      : "ASSERTION_OR_CONNECTION";
    process.stderr.write(
      `Disposable SellerProfile private-boundary proof failed closed at ${phase} [${code}].\n`,
    );
    process.exitCode = 1;
  }
}
