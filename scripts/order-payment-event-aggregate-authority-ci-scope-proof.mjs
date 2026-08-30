#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  assertOrderPaymentEventAggregateAuthorityProductionScope,
  readOrderPaymentEventAggregateAuthorityProductionSnapshotFromClient,
} from "./verify-order-payment-event-aggregate-authority-production-scope.mjs";

const { Client } = pg;
const CI_MIGRATION_ROLE = "ci";
const RUNTIME_ROLE = "grainline_app_runtime";

const SAFE_FAILURE_CODES = Object.freeze([
  [/migration checksum drifted/iu, "MIGRATION_BYTES"],
  [/CI scope transaction is not read-only/iu, "READ_ONLY_TRANSACTION"],
  [/read-authority|invariant/iu, "PREDECESSOR_SCOPE"],
  [/aggregate-authority ledger/iu, "CANDIDATE_LEDGER"],
  [/projection column/iu, "COLUMN_CATALOG"],
  [/projection function/iu, "FUNCTION_CATALOG"],
  [/projection trigger/iu, "TRIGGER_CATALOG"],
  [/projections do not match/iu, "PROJECTION_MISMATCH"],
]);

export function orderPaymentEventAggregateAuthorityCiScopeFailureCode(error) {
  const postgresCode = typeof error?.code === "string" ? error.code : "";
  if (/^[0-9A-Z]{5}$/u.test(postgresCode)) return postgresCode;
  const message = typeof error?.message === "string" ? error.message : "";
  return SAFE_FAILURE_CODES.find(([pattern]) => pattern.test(message))?.[1]
    ?? "UNCLASSIFIED";
}

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

export function parseOrderPaymentEventAggregateAuthorityCiScopeEnvironment(
  env = process.env,
) {
  if (
    env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_WORKFLOW !== "CI"
    || !["pull_request", "push"].includes(env.GITHUB_EVENT_NAME)
  ) {
    throw new Error("aggregate-authority CI scope proof requires the CI workflow");
  }
  const directUrl = required(env, "DIRECT_URL");
  const parsed = new URL(directUrl);
  if (
    parsed.protocol !== "postgresql:"
    || !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
    || decodeURIComponent(parsed.username) !== CI_MIGRATION_ROLE
    || !parsed.password
    || decodeURIComponent(parsed.pathname) !== "/grainline_ci"
    || parsed.searchParams.get("sslmode") !== "disable"
  ) {
    throw new Error("DIRECT_URL is not the disposable loopback CI database");
  }
  return Object.freeze({ directUrl });
}

export async function runOrderPaymentEventAggregateAuthorityCiScopeProof(
  config,
  { root = process.cwd() } = {},
) {
  const client = new Client({
    connectionString: config.directUrl,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-order-payment-aggregate-authority-ci-scope",
  });
  await client.connect();
  let transactionOpen = false;
  try {
    const identity = (await client.query(
      "SELECT current_user AS role, current_database() AS database",
    )).rows[0];
    assert.deepEqual(identity, {
      role: CI_MIGRATION_ROLE,
      database: "grainline_ci",
    });

    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    transactionOpen = true;
    const readOnly = (await client.query(
      "SELECT pg_catalog.current_setting('transaction_read_only') AS read_only",
    )).rows[0]?.read_only;
    assert.equal(readOnly, "on", "CI scope transaction is not read-only");

    const snapshot =
      await readOrderPaymentEventAggregateAuthorityProductionSnapshotFromClient(
        client,
        { runtimeRole: RUNTIME_ROLE, root },
      );
    const result = assertOrderPaymentEventAggregateAuthorityProductionScope(
      snapshot,
      "after",
      {
        migrationRole: CI_MIGRATION_ROLE,
        runtimeRole: RUNTIME_ROLE,
        root,
      },
    );
    await client.query("ROLLBACK");
    transactionOpen = false;
    return Object.freeze({
      ...result,
      ciMigrationRoleProven: true,
      engineReadOnlyProven: true,
    });
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

async function main() {
  const result = await runOrderPaymentEventAggregateAuthorityCiScopeProof(
    parseOrderPaymentEventAggregateAuthorityCiScopeEnvironment(),
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(
      `OrderPaymentEvent aggregate-authority CI scope proof failed [${
        orderPaymentEventAggregateAuthorityCiScopeFailureCode(error)
      }]\n`,
    );
    process.exitCode = 1;
  });
}
