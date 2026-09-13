#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  verifySellerPayoutEventForceRelease,
} from "./verify-seller-payout-event-force-release.mjs";

const { Client } = pg;
const DATABASE_ENV = "SELLER_PAYOUT_EVENT_FORCE_ROLLBACK_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";

export function parseSellerPayoutEventForceRollbackProofConfig(
  env = process.env,
) {
  const databaseUrl = env[DATABASE_ENV];
  assert.ok(databaseUrl, `${DATABASE_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.equal(parsed.protocol, "postgresql:");
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "SellerPayoutEvent FORCE rollback proof refuses a non-loopback database",
  );
  assert.equal(parsed.pathname, `/${DATABASE_NAME}`);
  assert.equal(decodeURIComponent(parsed.username), "ci");
  assert.ok(parsed.password, "FORCE rollback proof requires owner login");
  return Object.freeze({ databaseUrl });
}

async function verifyOwnerTablePosture(owner, expectedForced) {
  const result = await owner.query(`
    SELECT
      class.relrowsecurity AS rls_enabled,
      class.relforcerowsecurity AS rls_forced,
      pg_catalog.pg_get_userbyid(class.relowner) AS owner_name,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid) AS policy_count,
      pg_catalog.has_table_privilege(
        'grainline_app_runtime', class.oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
      ) AS runtime_table_authority,
      pg_catalog.has_any_column_privilege(
        'grainline_app_runtime', class.oid,
        'SELECT,INSERT,UPDATE,REFERENCES'
      ) AS runtime_column_authority
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'SellerPayoutEvent'
     AND class.relkind = 'r'
  `);
  assert.deepEqual(result.rows, [{
    rls_enabled: true,
    rls_forced: expectedForced,
    owner_name: "ci",
    policy_count: 0,
    runtime_table_authority: false,
    runtime_column_authority: false,
  }]);
}

export async function runSellerPayoutEventForceRollbackProof(
  env = process.env,
) {
  const { databaseUrl } = parseSellerPayoutEventForceRollbackProofConfig(env);
  verifySellerPayoutEventForceRelease();
  const rollback = fs.readFileSync(
    "docs/rls-drafts/seller-payout-event-force-rollback.sql",
    "utf8",
  );
  const owner = new Client({ connectionString: databaseUrl });
  await owner.connect();
  let rollbackProven = false;
  try {
    await verifyOwnerTablePosture(owner, true);
    await owner.query(rollback);
    await verifyOwnerTablePosture(owner, false);
    rollbackProven = true;
  } finally {
    try {
      const force = await owner.query(`
        SELECT class.relforcerowsecurity AS force_enabled
          FROM pg_catalog.pg_class AS class
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = class.relnamespace
         WHERE namespace.nspname = 'public'
           AND class.relname = 'SellerPayoutEvent'
           AND class.relkind = 'r'
      `);
      if (force.rows[0]?.force_enabled === false) {
        await owner.query(
          'ALTER TABLE public."SellerPayoutEvent" FORCE ROW LEVEL SECURITY',
        );
      }
      await verifyOwnerTablePosture(owner, true);
    } finally {
      await owner.end().catch(() => {});
    }
  }
  return Object.freeze({
    database: DATABASE_NAME,
    rollbackProven,
    phaseARestoredDuringProof: true,
    forceRestored: true,
    rowDataChanged: false,
    productionTouched: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(
      await runSellerPayoutEventForceRollbackProof(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(
      `SellerPayoutEvent FORCE rollback proof failed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
