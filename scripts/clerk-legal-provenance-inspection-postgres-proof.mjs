#!/usr/bin/env node
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  CLERK_LEGAL_PROVENANCE_PROOF_SQL,
  normalizeClerkLegalProvenanceCounts,
} from "./clerk-legal-provenance-inspect.mjs";

const { Client } = pg;
const DATABASE_NAME = "grainline_ci";
const PROOF_ENV = "CLERK_LEGAL_PROVENANCE_PROOF_DATABASE_URL";

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
    "grainline-clerk-legal-provenance-proof",
  );
  return parsed.toString();
}

export function parseClerkLegalProvenanceProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.equal(
    parsed.protocol,
    "postgresql:",
    "Clerk legal provenance proof requires PostgreSQL",
  );
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "Clerk legal provenance proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `Clerk legal provenance proof requires the ${DATABASE_NAME} database`,
  );
  return Object.freeze({ databaseUrl });
}

export async function runClerkLegalProvenanceProof(databaseUrl) {
  const client = new Client({
    connectionString: applicationUrl(databaseUrl),
    connectionTimeoutMillis: 5_000,
    statement_timeout: 20_000,
    query_timeout: 25_000,
  });
  let transactionOpen = false;
  try {
    await client.connect();
    const identity = await client.query(`
      SELECT
        CURRENT_USER AS current_user,
        pg_catalog.current_database() AS database_name
    `);
    assert.deepEqual(identity.rows, [
      { current_user: "ci", database_name: DATABASE_NAME },
    ]);

    await client.query(`
      CREATE TEMP TABLE pg_temp.clerk_legal_user_fixture (
        id text PRIMARY KEY,
        "deletedAt" timestamp(3),
        "termsAcceptedAt" timestamp(3),
        "termsVersion" varchar(50),
        "ageAttestedAt" timestamp(3)
      ) ON COMMIT PRESERVE ROWS
    `);
    await client.query(`
      CREATE TEMP TABLE pg_temp.clerk_legal_audit_fixture (
        "adminId" text NOT NULL,
        action varchar(100) NOT NULL,
        "targetType" varchar(100) NOT NULL,
        "targetId" varchar(255) NOT NULL,
        metadata jsonb NOT NULL,
        undone boolean NOT NULL
      ) ON COMMIT PRESERVE ROWS
    `);
    await client.query(`
      INSERT INTO pg_temp.clerk_legal_user_fixture (
        id,
        "deletedAt",
        "termsAcceptedAt",
        "termsVersion",
        "ageAttestedAt"
      )
      VALUES
        (
          'trusted-current', NULL,
          TIMESTAMP '2026-09-03 12:00:00.000', '2026-06-14',
          TIMESTAMP '2026-09-03 12:00:00.000'
        ),
        (
          'untrusted-current', NULL,
          TIMESTAMP '2026-09-03 12:01:00.000', '2026-06-14',
          TIMESTAMP '2026-09-03 12:01:00.000'
        ),
        (
          'partial-state', NULL,
          TIMESTAMP '2026-09-03 12:02:00.000', 'older-version', NULL
        ),
        ('empty-state', NULL, NULL, NULL, NULL),
        (
          'deleted-current', TIMESTAMP '2026-09-03 12:03:00.000',
          TIMESTAMP '2026-09-03 12:03:00.000', '2026-06-14',
          TIMESTAMP '2026-09-03 12:03:00.000'
        )
    `);
    await client.query(`
      INSERT INTO pg_temp.clerk_legal_audit_fixture (
        "adminId",
        action,
        "targetType",
        "targetId",
        metadata,
        undone
      )
      VALUES
        (
          'trusted-current',
          'TERMS_ACCEPTED',
          'USER',
          'trusted-current',
          '{"actorKind":"user","route":"/api/account/accept-terms","termsVersion":"2026-06-14"}'::jsonb,
          false
        ),
        (
          'untrusted-current',
          'TERMS_ACCEPTED',
          'USER',
          'untrusted-current',
          '{"actorKind":"staff","route":"/api/account/accept-terms","termsVersion":"2026-06-14"}'::jsonb,
          false
        ),
        (
          'deleted-current',
          'TERMS_ACCEPTED',
          'USER',
          'deleted-current',
          '{"actorKind":"user","route":"/api/account/accept-terms","termsVersion":"2026-06-14"}'::jsonb,
          false
        )
    `);

    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    transactionOpen = true;
    const transaction = await client.query(`
      SELECT
        pg_catalog.current_setting('transaction_read_only') AS read_only,
        pg_catalog.current_setting('transaction_isolation') AS isolation
    `);
    assert.deepEqual(transaction.rows, [
      { read_only: "on", isolation: "repeatable read" },
    ]);
    const result = await client.query(CLERK_LEGAL_PROVENANCE_PROOF_SQL);
    assert.equal(result.rows.length, 1);
    const counts = normalizeClerkLegalProvenanceCounts(result.rows[0]);
    assert.deepEqual(counts, {
      totalUsers: 5,
      activeUsers: 4,
      deletedUsers: 1,
      activeCurrentAccepted: 2,
      activeTrustedCurrentAccepted: 1,
      activeUntrustedCurrentAccepted: 1,
      activePartialOrStaleLegalState: 1,
      activeNoLegalState: 1,
      deletedCurrentAccepted: 1,
    });
    await client.query("ROLLBACK");
    transactionOpen = false;
    return Object.freeze({
      status: "passed",
      counts,
      transactionReadOnly: true,
      productionChanged: false,
    });
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  try {
    const config = parseClerkLegalProvenanceProofConfig(process.env);
    const result = await runClerkLegalProvenanceProof(config.databaseUrl);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `Clerk legal provenance PostgreSQL proof failed: ${safeError(error)}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
