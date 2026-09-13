#!/usr/bin/env node
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  CASE_LEGACY_COUNTS_SQL,
  normalizeCaseLegacyResult,
} from "./case-case-message-legacy-inspect.mjs";

const { Client } = pg;

const DATABASE_NAME = "grainline_ci";
const PROOF_ENV = "CASE_LEGACY_INSPECTION_PROOF_DATABASE_URL";

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/gi, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[redacted-credentials]@",
    );
}

function applicationUrl(databaseUrl) {
  const parsed = new URL(databaseUrl);
  parsed.searchParams.set(
    "application_name",
    "grainline-case-legacy-inspection-proof",
  );
  return parsed.toString();
}

export function parseCaseLegacyInspectionProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.equal(
    parsed.protocol,
    "postgresql:",
    "Case legacy inspection proof requires PostgreSQL",
  );
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "Case legacy inspection proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `Case legacy inspection proof requires the ${DATABASE_NAME} database`,
  );
  return Object.freeze({ databaseUrl });
}

export async function runCaseLegacyInspectionProof(databaseUrl) {
  const client = new Client({
    connectionString: applicationUrl(databaseUrl),
    connectionTimeoutMillis: 5_000,
    query_timeout: 30_000,
    statement_timeout: 25_000,
  });
  let inventory;
  try {
    await client.connect();
    const identity = await client.query(`
      SELECT
        CURRENT_USER AS current_user,
        pg_catalog.current_database() AS database_name
    `);
    assert.deepEqual(identity.rows, [
      {
        current_user: "ci",
        database_name: DATABASE_NAME,
      },
    ]);
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    const readOnly = await client.query(
      "SELECT pg_catalog.current_setting('transaction_read_only') AS value",
    );
    assert.equal(
      readOnly.rows[0]?.value,
      "on",
      "Case legacy inspection proof transaction is not read-only",
    );
    const result = await client.query(CASE_LEGACY_COUNTS_SQL);
    assert.equal(
      result.rows.length,
      1,
      "Case legacy inspection proof returned an unexpected row count",
    );
    inventory = normalizeCaseLegacyResult(result.rows[0]);
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
  return Object.freeze({
    database: "loopback/grainline_ci",
    productionChanged: false,
    queryExecuted: true,
    schemaAccepted: true,
    tableCounts: Object.freeze({
      attachments: inventory.counts.attachmentCount,
      cases: inventory.counts.caseCount,
      messages: inventory.counts.caseMessageCount,
    }),
  });
}

async function main() {
  const config = parseCaseLegacyInspectionProofConfig(process.env);
  const result = await runCaseLegacyInspectionProof(config.databaseUrl);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${safeError(error)}\n`);
    process.exitCode = 1;
  });
}
