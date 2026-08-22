#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  proveSellerPayoutEventActivatedCatalog,
} from "./seller-payout-event-activation-postgres-proof.mjs";
import {
  verifySellerPayoutEventActivationRuntimeIdentity,
} from "./seller-payout-event-activation-production-postflight.mjs";

const { Client } = pg;
const DATABASE_ENV =
  "SELLER_PAYOUT_EVENT_ACTIVATION_POSTFLIGHT_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const OWNER_ROLE = "ci";
const RUNTIME_ROLE = "grainline_app_runtime";

export function parseSellerPayoutEventActivationPostflightProofConfig(
  env = process.env,
) {
  const databaseUrl = env[DATABASE_ENV];
  assert.ok(databaseUrl, `${DATABASE_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.equal(parsed.protocol, "postgresql:");
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "SellerPayoutEvent activation postflight proof refuses a non-loopback database",
  );
  assert.equal(parsed.pathname, `/${DATABASE_NAME}`);
  assert.equal(decodeURIComponent(parsed.username), RUNTIME_ROLE);
  assert.ok(
    parsed.password,
    "SellerPayoutEvent activation postflight proof requires direct login",
  );
  return Object.freeze({ databaseUrl });
}

async function expectedFailure(client, operation, code, label) {
  await client.query("SAVEPOINT seller_payout_postflight_expected_failure");
  let caught;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  await client.query(
    "ROLLBACK TO SAVEPOINT seller_payout_postflight_expected_failure",
  );
  await client.query(
    "RELEASE SAVEPOINT seller_payout_postflight_expected_failure",
  );
  assert.equal(caught?.code, code, `${label} returned the wrong SQLSTATE`);
}

export async function runSellerPayoutEventActivationPostflightProof(
  env = process.env,
) {
  const { databaseUrl } =
    parseSellerPayoutEventActivationPostflightProofConfig(env);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const transaction = await client.query(`
      SELECT
        pg_catalog.current_setting('transaction_isolation') AS isolation,
        pg_catalog.current_setting('transaction_read_only') AS read_only
    `);
    assert.deepEqual(transaction.rows, [{
      isolation: "repeatable read",
      read_only: "on",
    }]);
    await verifySellerPayoutEventActivationRuntimeIdentity(
      client,
      { databaseName: DATABASE_NAME, runtimeRole: RUNTIME_ROLE },
      OWNER_ROLE,
    );
    await proveSellerPayoutEventActivatedCatalog(client, OWNER_ROLE);
    await expectedFailure(
      client,
      () => client.query(
        'SELECT id FROM public."SellerPayoutEvent" LIMIT 1',
      ),
      "42501",
      "direct runtime read",
    );

    const absentActor = "seller-payout-postflight-proof-absent-user";
    const latest = await client.query(`
      SELECT pg_catalog.count(*)::integer AS count
        FROM public.grainline_seller_payout_latest_failure($1)
    `, [absentActor]);
    assert.deepEqual(latest.rows, [{ count: 0 }]);
    const exported = await client.query(`
      SELECT pg_catalog.count(*)::integer AS count
        FROM public.grainline_seller_payout_export_page($1, 1, NULL, NULL)
    `, [absentActor]);
    assert.deepEqual(exported.rows, [{ count: 0 }]);

    const now = await client.query(`
      SELECT pg_catalog.floor(
        EXTRACT(EPOCH FROM pg_catalog.clock_timestamp())
      )::bigint AS seconds
    `);
    await expectedFailure(
      client,
      () => client.query(`
        SELECT * FROM public.grainline_seller_payout_event_apply(
          'seller-payout-postflight-proof-absent-event',
          1,
          $1,
          'acct_seller_payout_postflight_proof_absent',
          'po_seller_payout_postflight_proof_absent',
          0,
          'usd',
          'postflight-proof',
          'Read-only fence'
        )
      `, [now.rows[0]?.seconds]),
      "25006",
      "fixed write read-only fence",
    );
    await client.query("ROLLBACK");
    transactionOpen = false;
    return Object.freeze({
      database: DATABASE_NAME,
      runtimeRole: RUNTIME_ROLE,
      directRuntimeLogin: true,
      sourcePinnedFunctions: 3,
      postflightReadOnly: true,
      residue: 0,
      productionTouched: false,
    });
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(
      `${JSON.stringify(
        await runSellerPayoutEventActivationPostflightProof(),
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `SellerPayoutEvent activation postflight PostgreSQL proof failed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
