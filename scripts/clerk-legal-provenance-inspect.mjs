#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

import { parseGuardedNeonDatabaseIdentity } from "./guard-saved-search-rls-deploy.mjs";
import {
  assertDeterministicPostgresEnvironment,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";

const { Client } = pg;

export const CLERK_LEGAL_PROVENANCE_INSPECTION_CONFIRMATION =
  "inspect-clerk-legal-acceptance-provenance";
export const REVIEWED_CURRENT_TERMS_VERSION = "2026-06-14";

export const REVIEWED_CLERK_LEGAL_INSPECTION_TARGET = Object.freeze({
  endpointId: "ep-plain-river-aaqg8gj4",
  databaseName: "neondb",
  region: "westus3.azure",
  ownerRole: "neondb_owner",
  runtimeRole: "grainline_app_runtime",
});

const REVIEWED_MAIN_REF = "refs/heads/main";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PRODUCTION_RELATIONS = Object.freeze({
  user: 'public."User"',
  audit: 'public."AdminAuditLog"',
});
const PROOF_RELATIONS = Object.freeze({
  user: "pg_temp.clerk_legal_user_fixture",
  audit: "pg_temp.clerk_legal_audit_fixture",
});

function required(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${name} is required without surrounding whitespace`);
  }
  return value;
}

function assertReviewedRelations(relations) {
  const matchesProduction =
    relations?.user === PRODUCTION_RELATIONS.user
    && relations?.audit === PRODUCTION_RELATIONS.audit;
  const matchesProof =
    relations?.user === PROOF_RELATIONS.user
    && relations?.audit === PROOF_RELATIONS.audit;
  if (!matchesProduction && !matchesProof) {
    throw new Error("Clerk legal provenance inspection relations are not reviewed");
  }
  return relations;
}

export function buildClerkLegalProvenanceInspectionSql(
  relations = PRODUCTION_RELATIONS,
) {
  const reviewed = assertReviewedRelations(relations);
  return `
    WITH user_state AS (
      SELECT
        subject.id,
        subject."deletedAt" IS NULL AS is_active,
        (
          subject."termsAcceptedAt" IS NOT NULL
          AND subject."ageAttestedAt" IS NOT NULL
          AND subject."termsVersion" IS NOT DISTINCT FROM '${REVIEWED_CURRENT_TERMS_VERSION}'
        ) AS is_currently_accepted,
        (
          subject."termsAcceptedAt" IS NULL
          AND subject."ageAttestedAt" IS NULL
          AND subject."termsVersion" IS NULL
        ) AS has_no_legal_state,
        EXISTS (
          SELECT 1
          FROM ${reviewed.audit} AS audit
          WHERE audit."adminId" = subject.id
            AND audit.action = 'TERMS_ACCEPTED'
            AND audit."targetType" = 'USER'
            AND audit."targetId" = subject.id
            AND audit.undone = false
            AND audit.metadata->>'actorKind' = 'user'
            AND audit.metadata->>'route' = '/api/account/accept-terms'
            AND audit.metadata->>'termsVersion' = '${REVIEWED_CURRENT_TERMS_VERSION}'
        ) AS has_trusted_current_audit
      FROM ${reviewed.user} AS subject
    )
    SELECT
      pg_catalog.count(*) AS total_user_count,
      pg_catalog.count(*) FILTER (WHERE is_active) AS active_user_count,
      pg_catalog.count(*) FILTER (WHERE NOT is_active) AS deleted_user_count,
      pg_catalog.count(*) FILTER (
        WHERE is_active AND is_currently_accepted
      ) AS active_current_accepted_count,
      pg_catalog.count(*) FILTER (
        WHERE is_active
          AND is_currently_accepted
          AND has_trusted_current_audit
      ) AS active_trusted_current_accepted_count,
      pg_catalog.count(*) FILTER (
        WHERE is_active
          AND is_currently_accepted
          AND NOT has_trusted_current_audit
      ) AS active_untrusted_current_accepted_count,
      pg_catalog.count(*) FILTER (
        WHERE is_active
          AND NOT is_currently_accepted
          AND NOT has_no_legal_state
      ) AS active_partial_or_stale_legal_state_count,
      pg_catalog.count(*) FILTER (
        WHERE is_active AND has_no_legal_state
      ) AS active_no_legal_state_count,
      pg_catalog.count(*) FILTER (
        WHERE NOT is_active AND is_currently_accepted
      ) AS deleted_current_accepted_count
    FROM user_state
  `;
}

export const CLERK_LEGAL_PROVENANCE_INSPECTION_SQL =
  buildClerkLegalProvenanceInspectionSql();
export const CLERK_LEGAL_PROVENANCE_PROOF_SQL =
  buildClerkLegalProvenanceInspectionSql(PROOF_RELATIONS);

export function normalizeClerkLegalProvenanceCounts(row) {
  const rawCounts = {
    totalUsers: row?.total_user_count,
    activeUsers: row?.active_user_count,
    deletedUsers: row?.deleted_user_count,
    activeCurrentAccepted: row?.active_current_accepted_count,
    activeTrustedCurrentAccepted: row?.active_trusted_current_accepted_count,
    activeUntrustedCurrentAccepted: row?.active_untrusted_current_accepted_count,
    activePartialOrStaleLegalState:
      row?.active_partial_or_stale_legal_state_count,
    activeNoLegalState: row?.active_no_legal_state_count,
    deletedCurrentAccepted: row?.deleted_current_accepted_count,
  };
  if (
    Object.values(rawCounts).some(
      (value) => typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value),
    )
  ) {
    throw new TypeError("Clerk legal provenance inspection returned invalid counts");
  }
  const counts = Object.fromEntries(
    Object.entries(rawCounts).map(([key, value]) => [key, Number(value)]),
  );
  if (
    Object.values(counts).some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    )
  ) {
    throw new TypeError("Clerk legal provenance inspection returned invalid counts");
  }
  if (counts.totalUsers !== counts.activeUsers + counts.deletedUsers) {
    throw new Error("Clerk legal provenance total-user partition is inconsistent");
  }
  if (
    counts.activeUsers
    !== counts.activeCurrentAccepted
      + counts.activePartialOrStaleLegalState
      + counts.activeNoLegalState
  ) {
    throw new Error("Clerk legal provenance active-user partition is inconsistent");
  }
  if (
    counts.activeCurrentAccepted
    !== counts.activeTrustedCurrentAccepted
      + counts.activeUntrustedCurrentAccepted
  ) {
    throw new Error("Clerk legal provenance acceptance partition is inconsistent");
  }
  return Object.freeze(counts);
}

export function parseClerkLegalProvenanceInspectionConfig(env = process.env) {
  assertDeterministicPostgresEnvironment(env, "Clerk legal provenance inspection");
  if (
    env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_REF !== REVIEWED_MAIN_REF
  ) {
    throw new Error(
      "Clerk legal provenance inspection requires a manual main-branch GitHub Actions dispatch",
    );
  }
  const releaseCommit = required(
    env,
    "CLERK_LEGAL_PROVENANCE_INSPECT_RELEASE_COMMIT",
  );
  const githubCommit = required(env, "GITHUB_SHA");
  if (!COMMIT_PATTERN.test(releaseCommit) || releaseCommit !== githubCommit) {
    throw new Error(
      "Clerk legal provenance inspection commit must match the dispatched main commit",
    );
  }
  if (
    env.CLERK_LEGAL_PROVENANCE_INSPECT_CONFIRM
    !== CLERK_LEGAL_PROVENANCE_INSPECTION_CONFIRMATION
  ) {
    throw new Error("Clerk legal provenance inspection confirmation is not exact");
  }
  if (Object.hasOwn(env, "DATABASE_URL")) {
    throw new Error("DATABASE_URL must remain absent from the owner-only inspection job");
  }
  if (Object.hasOwn(env, "GRANT_AUDIT_DATABASE_URL")) {
    throw new Error(
      "GRANT_AUDIT_DATABASE_URL must remain absent during the inspection",
    );
  }

  const directUrl = required(env, "DIRECT_URL");
  const expectedDirectUrlSha256 = required(
    env,
    "PRODUCTION_MIGRATION_DIRECT_URL_SHA256",
  );
  const directUrlSha256 = createHash("sha256")
    .update(directUrl, "utf8")
    .digest("hex");
  if (
    !SHA256_PATTERN.test(expectedDirectUrlSha256)
    || expectedDirectUrlSha256 !== directUrlSha256
  ) {
    throw new Error("DIRECT_URL does not match the protected environment digest");
  }
  const migrationRole = required(env, "MIGRATION_DB_ROLE");
  const runtimeRole = required(env, "RUNTIME_DB_ROLE");
  const identity = parseGuardedNeonDatabaseIdentity(directUrl, "DIRECT_URL");
  const target = REVIEWED_CLERK_LEGAL_INSPECTION_TARGET;
  if (
    identity.isPooler
    || identity.endpointId !== target.endpointId
    || identity.databaseName !== target.databaseName
    || identity.region !== target.region
    || identity.username !== target.ownerRole
    || migrationRole !== target.ownerRole
    || runtimeRole !== target.runtimeRole
  ) {
    throw new Error("DIRECT_URL is not the reviewed direct production owner target");
  }

  const runnerTemp = path.resolve(required(env, "RUNNER_TEMP"));
  const evidencePath = path.resolve(
    required(env, "CLERK_LEGAL_PROVENANCE_INSPECT_EVIDENCE_PATH"),
  );
  const expectedEvidencePath = path.join(
    runnerTemp,
    `clerk-legal-provenance-inspection-${releaseCommit}.json`,
  );
  if (evidencePath !== expectedEvidencePath || existsSync(evidencePath)) {
    throw new Error(
      "Clerk legal provenance evidence path is not the fresh reviewed runner path",
    );
  }

  return Object.freeze({
    mode: "inspect",
    directUrl,
    directUrlSha256,
    evidencePath,
    identity,
    releaseCommit,
  });
}

export function readClerkLegalProvenanceGitState(cwd = process.cwd()) {
  const run = (args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  return Object.freeze({
    head: run(["rev-parse", "HEAD"]),
    status: run(["status", "--porcelain=v1", "--untracked-files=all"]),
  });
}

export function assertClerkLegalProvenanceGitState(state, releaseCommit) {
  if (state?.head !== releaseCommit || state.status !== "") {
    throw new Error(
      "Clerk legal provenance checkout is not the exact clean dispatched commit",
    );
  }
  return Object.freeze({ head: state.head, clean: true });
}

async function readPosture(client) {
  const result = await client.query(`
    SELECT
      CURRENT_USER AS current_user,
      pg_catalog.current_database() AS database_name,
      owner_role.rolbypassrls AS owner_bypass_rls,
      runtime_role.rolbypassrls AS runtime_bypass_rls,
      runtime_role.rolsuper AS runtime_superuser,
      runtime_role.rolinherit AS runtime_inherit,
      pg_catalog.to_regclass('public."User"') IS NOT NULL AS user_table_present,
      pg_catalog.to_regclass('public."AdminAuditLog"') IS NOT NULL AS audit_table_present
    FROM pg_catalog.pg_roles AS owner_role
    JOIN pg_catalog.pg_roles AS runtime_role
      ON runtime_role.rolname = 'grainline_app_runtime'
    WHERE owner_role.rolname = 'neondb_owner'
  `);
  const row = result.rows[0];
  if (
    result.rows.length !== 1
    || row.current_user !== REVIEWED_CLERK_LEGAL_INSPECTION_TARGET.ownerRole
    || row.database_name
      !== REVIEWED_CLERK_LEGAL_INSPECTION_TARGET.databaseName
    || row.owner_bypass_rls !== true
    || row.runtime_bypass_rls !== false
    || row.runtime_superuser !== false
    || row.runtime_inherit !== false
    || row.user_table_present !== true
    || row.audit_table_present !== true
  ) {
    throw new Error(
      "Clerk legal provenance database posture is not the reviewed production target",
    );
  }
  return Object.freeze({
    currentUser: row.current_user,
    databaseName: row.database_name,
    runtimeNoBypassRls: true,
    runtimeNoInherit: true,
    requiredTablesPresent: true,
  });
}

export async function runClerkLegalProvenanceInspection(config) {
  const parsedUrl = new URL(config.directUrl);
  const client = new Client({
    connectionString: config.directUrl,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-clerk-legal-provenance-inspection",
    ...postgresChannelBindingClientOptions(parsedUrl),
  });
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    transactionOpen = true;
    const transaction = await client.query(`
      SELECT
        pg_catalog.current_setting('transaction_read_only') AS read_only,
        pg_catalog.current_setting('transaction_isolation') AS isolation
    `);
    if (
      transaction.rows[0]?.read_only !== "on"
      || transaction.rows[0]?.isolation !== "repeatable read"
    ) {
      throw new Error(
        "Clerk legal provenance inspection transaction is not engine-read-only",
      );
    }
    const posture = await readPosture(client);
    const result = await client.query(CLERK_LEGAL_PROVENANCE_INSPECTION_SQL);
    if (result.rows.length !== 1) {
      throw new Error(
        "Clerk legal provenance inspection did not return one aggregate row",
      );
    }
    const counts = normalizeClerkLegalProvenanceCounts(result.rows[0]);
    await client.query("ROLLBACK");
    transactionOpen = false;
    return Object.freeze({
      mode: config.mode,
      releaseCommit: config.releaseCommit,
      directUrlSha256: config.directUrlSha256,
      termsVersion: REVIEWED_CURRENT_TERMS_VERSION,
      posture,
      counts,
      transaction: Object.freeze({
        isolation: "repeatable read",
        readOnly: true,
        rolledBack: true,
      }),
      retained: Object.freeze({
        aggregateCountsOnly: true,
        rawRows: false,
        identifiers: false,
        credentials: false,
      }),
      productionChanged: false,
    });
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

export function writeClerkLegalProvenanceEvidence(filePath, evidence) {
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (
    /postgres(?:ql)?:\/\/|DIRECT_URL|password|"(?:clerkId|email|targetId|adminId)"\s*:/i.test(
      serialized,
    )
  ) {
    throw new Error("Clerk legal provenance evidence contains private data");
  }
  const fd = openSync(filePath, "wx", 0o600);
  try {
    writeFileSync(fd, serialized, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(filePath, 0o600);
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error(
      "Clerk legal provenance evidence is not a private regular file",
    );
  }
}

async function main() {
  try {
    const config = parseClerkLegalProvenanceInspectionConfig(process.env);
    const git = assertClerkLegalProvenanceGitState(
      readClerkLegalProvenanceGitState(),
      config.releaseCommit,
    );
    const result = await runClerkLegalProvenanceInspection(config);
    const evidence = Object.freeze({
      generatedAt: new Date().toISOString(),
      status: "passed",
      git,
      ...result,
    });
    writeClerkLegalProvenanceEvidence(config.evidencePath, evidence);
    process.stdout.write(
      `${JSON.stringify({
        status: evidence.status,
        releaseCommit: evidence.releaseCommit,
        termsVersion: evidence.termsVersion,
        posture: evidence.posture,
        counts: evidence.counts,
        transaction: evidence.transaction,
        retained: evidence.retained,
        productionChanged: evidence.productionChanged,
        evidenceWritten: true,
      })}\n`,
    );
  } catch {
    process.stderr.write("Clerk legal provenance inspection failed closed.\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
