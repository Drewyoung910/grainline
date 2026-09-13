#!/usr/bin/env node
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  CLERK_LEGAL_PROVENANCE_CLEANUP_PROOF_CLEAR_SQL,
  CLERK_LEGAL_PROVENANCE_CLEANUP_PROOF_COUNTS_SQL,
  CLERK_LEGAL_PROVENANCE_CLEANUP_PROOF_TARGET_SQL,
  runClerkLegalProvenanceCleanupTransaction,
} from "./clerk-legal-provenance-cleanup.mjs";
import { normalizeClerkLegalProvenanceCounts } from "./clerk-legal-provenance-inspect.mjs";

const { Client } = pg;
const DATABASE_NAME = "grainline_ci";
const PROOF_ENV = "CLERK_LEGAL_PROVENANCE_CLEANUP_PROOF_DATABASE_URL";

const EXPECTED = Object.freeze({
  inspected: Object.freeze({
    totalUsers: 5,
    activeUsers: 4,
    deletedUsers: 1,
    activeCurrentAccepted: 2,
    activeTrustedCurrentAccepted: 1,
    activeUntrustedCurrentAccepted: 1,
    activePartialOrStaleLegalState: 1,
    activeNoLegalState: 1,
    deletedCurrentAccepted: 1,
  }),
  cleared: Object.freeze({
    totalUsers: 5,
    activeUsers: 4,
    deletedUsers: 1,
    activeCurrentAccepted: 1,
    activeTrustedCurrentAccepted: 1,
    activeUntrustedCurrentAccepted: 0,
    activePartialOrStaleLegalState: 1,
    activeNoLegalState: 2,
    deletedCurrentAccepted: 1,
  }),
  reaccepted: Object.freeze({
    totalUsers: 5,
    activeUsers: 4,
    deletedUsers: 1,
    activeCurrentAccepted: 2,
    activeTrustedCurrentAccepted: 2,
    activeUntrustedCurrentAccepted: 0,
    activePartialOrStaleLegalState: 1,
    activeNoLegalState: 1,
    deletedCurrentAccepted: 1,
  }),
});

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
    "grainline-clerk-legal-provenance-cleanup-proof",
  );
  return parsed.toString();
}

export function parseClerkLegalProvenanceCleanupProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.equal(
    parsed.protocol,
    "postgresql:",
    "Clerk legal provenance cleanup proof requires PostgreSQL",
  );
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "Clerk legal provenance cleanup proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `Clerk legal provenance cleanup proof requires the ${DATABASE_NAME} database`,
  );
  return Object.freeze({ databaseUrl });
}

async function createFixtures(client) {
  await client.query(`
    CREATE TEMP TABLE pg_temp.clerk_legal_user_fixture (
      id text PRIMARY KEY,
      "deletedAt" timestamp(3),
      "termsAcceptedAt" timestamp(3),
      "termsVersion" varchar(50),
      "ageAttestedAt" timestamp(3),
      "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
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
}

async function seedReviewedFixture(client) {
  await client.query("TRUNCATE pg_temp.clerk_legal_user_fixture, pg_temp.clerk_legal_audit_fixture");
  await client.query(`
    INSERT INTO pg_temp.clerk_legal_user_fixture (
      id, "deletedAt", "termsAcceptedAt", "termsVersion", "ageAttestedAt"
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
      "adminId", action, "targetType", "targetId", metadata, undone
    )
    VALUES
      (
        'trusted-current', 'TERMS_ACCEPTED', 'USER', 'trusted-current',
        '{"actorKind":"user","route":"/api/account/accept-terms","termsVersion":"2026-06-14"}'::jsonb,
        false
      ),
      (
        'deleted-current', 'TERMS_ACCEPTED', 'USER', 'deleted-current',
        '{"actorKind":"user","route":"/api/account/accept-terms","termsVersion":"2026-06-14"}'::jsonb,
        false
      )
  `);
}

async function readCounts(client) {
  const result = await client.query(
    CLERK_LEGAL_PROVENANCE_CLEANUP_PROOF_COUNTS_SQL,
  );
  return normalizeClerkLegalProvenanceCounts(result.rows[0]);
}

function cleanupOptions(client, expectedCounts = EXPECTED) {
  return {
    client,
    countsSql: CLERK_LEGAL_PROVENANCE_CLEANUP_PROOF_COUNTS_SQL,
    targetSql: CLERK_LEGAL_PROVENANCE_CLEANUP_PROOF_TARGET_SQL,
    clearSql: CLERK_LEGAL_PROVENANCE_CLEANUP_PROOF_CLEAR_SQL,
    expectedCounts,
    verifyPosture: false,
  };
}

export async function runClerkLegalProvenanceCleanupProof(databaseUrl) {
  const client = new Client({
    connectionString: applicationUrl(databaseUrl),
    connectionTimeoutMillis: 5_000,
    statement_timeout: 20_000,
    query_timeout: 25_000,
  });
  try {
    await client.connect();
    const identity = await client.query(`
      SELECT CURRENT_USER AS current_user, pg_catalog.current_database() AS database_name
    `);
    assert.deepEqual(identity.rows, [
      { current_user: "ci", database_name: DATABASE_NAME },
    ]);
    await createFixtures(client);
    await seedReviewedFixture(client);

    const first = await runClerkLegalProvenanceCleanupTransaction(
      cleanupOptions(client),
    );
    assert.equal(first.beforeState, "cleanup-required");
    assert.equal(first.changedRows, 1);
    assert.deepEqual(first.beforeCounts, EXPECTED.inspected);
    assert.deepEqual(first.transactionAfterCounts, EXPECTED.cleared);

    const rows = await client.query(`
      SELECT id, "termsAcceptedAt", "termsVersion", "ageAttestedAt"
      FROM pg_temp.clerk_legal_user_fixture
      ORDER BY id
    `);
    const untrusted = rows.rows.find((row) => row.id === "untrusted-current");
    const trusted = rows.rows.find((row) => row.id === "trusted-current");
    assert.deepEqual(untrusted, {
      id: "untrusted-current",
      termsAcceptedAt: null,
      termsVersion: null,
      ageAttestedAt: null,
    });
    assert.ok(trusted?.termsAcceptedAt instanceof Date);
    assert.equal(trusted?.termsVersion, "2026-06-14");
    assert.ok(trusted?.ageAttestedAt instanceof Date);

    const second = await runClerkLegalProvenanceCleanupTransaction(
      cleanupOptions(client),
    );
    assert.equal(second.beforeState, "already-cleared");
    assert.equal(second.changedRows, 0);
    assert.deepEqual(second.transactionAfterCounts, EXPECTED.cleared);

    await seedReviewedFixture(client);
    await client.query(`
      INSERT INTO pg_temp.clerk_legal_user_fixture (
        id, "deletedAt", "termsAcceptedAt", "termsVersion", "ageAttestedAt"
      ) VALUES (
        'second-untrusted', NULL,
        TIMESTAMP '2026-09-03 12:04:00.000', '2026-06-14',
        TIMESTAMP '2026-09-03 12:04:00.000'
      )
    `);
    const twoTargets = Object.freeze({
      inspected: Object.freeze({
        ...EXPECTED.inspected,
        totalUsers: 6,
        activeUsers: 5,
        activeCurrentAccepted: 3,
        activeUntrustedCurrentAccepted: 2,
      }),
      cleared: EXPECTED.cleared,
      reaccepted: EXPECTED.reaccepted,
    });
    await assert.rejects(
      runClerkLegalProvenanceCleanupTransaction(
        cleanupOptions(client, twoTargets),
      ),
      /target is not exactly one row/,
    );
    const afterRejected = await readCounts(client);
    assert.equal(afterRejected.activeUntrustedCurrentAccepted, 2);

    return Object.freeze({
      status: "passed",
      firstDisposition: first.beforeState,
      firstChangedRows: first.changedRows,
      restartDisposition: second.beforeState,
      restartChangedRows: second.changedRows,
      twoTargetFailureRolledBack: true,
      productionChanged: false,
    });
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  try {
    const config = parseClerkLegalProvenanceCleanupProofConfig(process.env);
    const result = await runClerkLegalProvenanceCleanupProof(config.databaseUrl);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `Clerk legal provenance cleanup PostgreSQL proof failed: ${safeError(error)}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
