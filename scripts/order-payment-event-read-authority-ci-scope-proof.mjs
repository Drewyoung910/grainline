#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  assertOrderPaymentEventReadAuthorityProductionScope,
  readOrderPaymentEventReadAuthorityProductionSnapshotFromClient,
} from "./verify-order-payment-event-read-authority-production-scope.mjs";

const { Client } = pg;
const CI_MIGRATION_ROLE = "ci";
const RUNTIME_ROLE = "grainline_app_runtime";

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

export function parseOrderPaymentEventReadAuthorityCiScopeEnvironment(
  env = process.env,
) {
  if (
    env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_WORKFLOW !== "CI"
    || !["pull_request", "push"].includes(env.GITHUB_EVENT_NAME)
  ) {
    throw new Error("read-authority CI scope proof requires the CI workflow");
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

export async function runOrderPaymentEventReadAuthorityCiScopeProof(
  config,
  { root = process.cwd() } = {},
) {
  const client = new Client({
    connectionString: config.directUrl,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-order-payment-read-authority-ci-scope-proof",
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
      await readOrderPaymentEventReadAuthorityProductionSnapshotFromClient(
        client,
        { runtimeRole: RUNTIME_ROLE, root },
      );
    const result = assertOrderPaymentEventReadAuthorityProductionScope(
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
  const result = await runOrderPaymentEventReadAuthorityCiScopeProof(
    parseOrderPaymentEventReadAuthorityCiScopeEnvironment(),
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(
      `OrderPaymentEvent read-authority CI scope proof failed [${error?.code ?? "UNCLASSIFIED"}]\n`,
    );
    process.exitCode = 1;
  });
}
