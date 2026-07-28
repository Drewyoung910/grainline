#!/usr/bin/env node
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes,
} from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  REVIEWED_DATABASE_NAME,
  REVIEWED_DATABASE_REGION,
  REVIEWED_ENDPOINT_ID,
} from "./saved-search-phase-b-owner-rotation.mjs";
import {
  REVIEWED_NEON_BRANCH_ID,
  REVIEWED_NEON_ORG_ID,
  REVIEWED_NEON_PROJECT_ID,
} from "./neon-owner-password-control.mjs";
import {
  DIRECT_UPLOAD_CLEANUP_ROLE,
  hasReviewedDirectUploadCleanupMemberPosture,
} from "./direct-upload-activation-catalog.mjs";
import {
  parseGuardedNeonDatabaseIdentity,
} from "./guard-saved-search-rls-deploy.mjs";
import {
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";

const { Client } = pg;

export const DIRECT_UPLOAD_CLEANUP_PROVIDER_REMEDIATION_CONFIRMATION =
  "replace-rejected-neon-api-cleanup-role";
export const DIRECT_UPLOAD_CLEANUP_PROVIDER_RECOVERY_CONFIRMATION =
  "complete-deleted-neon-api-cleanup-role";
export const DIRECT_UPLOAD_CLEANUP_ENVIRONMENT =
  "Production DirectUpload Cleanup";
export const DIRECT_UPLOAD_CLEANUP_ENVIRONMENT_ID = 18_906_676_825;
export const DIRECT_UPLOAD_CLEANUP_DATABASE_SECRET =
  "DIRECT_UPLOAD_CLEANUP_DATABASE_URL";
export const DIRECT_UPLOAD_CLEANUP_DATABASE_DIGEST_VARIABLE =
  "DIRECT_UPLOAD_CLEANUP_DATABASE_URL_SHA256";
export const REJECTED_CLEANUP_DATABASE_URL_SHA256 =
  "6096b5b751b15fcb036f835bf60d20fddaeb354f94d5b9d492eed120401f731a";
export const REVIEWED_REPOSITORY = "Drewyoung910/grainline";
export const REVIEWED_OWNER_ROLE = "neondb_owner";
export const REVIEWED_NEON_CLI_VERSION = "2.35.1";
export const REVIEWED_NEON_USER_ID =
  "cbe0dc47-5f42-40a9-ba1d-4fd9ddb441ad";

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SAFE_PASSWORD_PATTERN = /^[A-Za-z0-9_-]{64}$/;
const SAFE_OPERATION_ID_PATTERN = /^[A-Za-z0-9-]{8,80}$/;
const EVIDENCE_PREFIX = "direct-upload-cleanup-role-provider-remediation-";
const OPERATION_ATTEMPTS = 20;
const OPERATION_INTERVAL_MS = 2_000;
let remediationFailureStage = "startup";

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

function cleanEnvironment(env = process.env) {
  const child = { ...env };
  for (const [key, value] of Object.entries(child)) {
    if (
      key === "DATABASE_URL"
      || /^PG[A-Z0-9_]*$/.test(key)
      || /(?:^|_)(?:DIRECT_URL|DATABASE_URL|DB_ADMIN_URL)$/.test(key)
      || (
        typeof value === "string"
        && /^postgres(?:ql)?:\/\//i.test(value.trim())
      )
    ) {
      delete child[key];
    }
  }
  return child;
}

function git(args) {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    env: cleanEnvironment(),
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error("reviewed git command failed");
  }
  return result.stdout.trim();
}

export function assertDirectUploadCleanupProviderGitState(releaseCommit) {
  const head = git(["rev-parse", "HEAD"]);
  const originMain = git(["rev-parse", "origin/main"]);
  const status = git(["status", "--porcelain=v1", "--untracked-files=all"]);
  if (
    !COMMIT_PATTERN.test(releaseCommit)
    || head !== releaseCommit
    || originMain !== releaseCommit
    || status !== ""
  ) {
    throw new Error(
      "cleanup-role provider remediation is not the exact clean origin/main commit",
    );
  }
  return Object.freeze({ clean: true, head, originMain });
}

export function discoverReviewedNeonCli(homeDir = process.env.HOME) {
  if (typeof homeDir !== "string" || !path.isAbsolute(homeDir)) {
    throw new Error("reviewed home directory is invalid");
  }
  const npxRoot = path.join(homeDir, ".npm", "_npx");
  const candidates = [];
  for (const entry of readdirSync(npxRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-f0-9]{16}$/.test(entry.name)) continue;
    const packageRoot = path.join(npxRoot, entry.name, "node_modules", "neonctl");
    const packagePath = path.join(packageRoot, "package.json");
    const cliPath = path.join(packageRoot, "dist", "cli.js");
    if (!existsSync(packagePath) || !existsSync(cliPath)) continue;
    const metadata = JSON.parse(readFileSync(packagePath, "utf8"));
    if (
      metadata?.name === "neonctl"
      && metadata.version === REVIEWED_NEON_CLI_VERSION
      && statSync(cliPath).isFile()
    ) {
      candidates.push(cliPath);
    }
  }
  if (candidates.length !== 1) {
    throw new Error("expected exactly one reviewed Neon CLI installation");
  }
  return candidates[0];
}

export function normalizeNeonCredentialExpiry(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error("Neon credential expiry is invalid");
  }
  return numeric > 10_000_000_000 ? numeric : numeric * 1000;
}

export function isReviewedNeonAccessToken(value) {
  return (
    typeof value === "string"
    && value.length >= 64
    && value.length <= 4096
    && /^[A-Za-z0-9._~-]+$/.test(value)
  );
}

export function readReviewedNeonCredentials(
  credentialsPath = path.join(process.env.HOME ?? "", ".config", "neonctl", "credentials.json"),
  now = Date.now(),
) {
  const metadata = statSync(credentialsPath);
  if (
    !metadata.isFile()
    || (metadata.mode & 0o077) !== 0
  ) {
    throw new Error("Neon credential file permissions are not private");
  }
  const credentials = JSON.parse(readFileSync(credentialsPath, "utf8"));
  const expiresAtMillis = normalizeNeonCredentialExpiry(
    credentials.expires_at,
  );
  if (
    !isReviewedNeonAccessToken(credentials.access_token)
    || credentials.user_id !== REVIEWED_NEON_USER_ID
    || !Number.isFinite(expiresAtMillis)
    || expiresAtMillis <= now + 5 * 60_000
  ) {
    throw new Error(
      "reviewed Neon session is missing or expires too soon; refresh it first",
    );
  }
  return Object.freeze({
    path: credentialsPath,
    userId: REVIEWED_NEON_USER_ID,
  });
}

function runNeonCli(cliPath, args, options = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    env: cleanEnvironment(),
    encoding: "utf8",
    input: options.input,
    timeout: options.timeout ?? 60_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(options.failureMessage ?? "reviewed Neon command failed");
  }
  return result.stdout;
}

function runNeonApi(cliPath, pathname, method = "GET") {
  const stdout = runNeonCli(cliPath, [
    "api",
    pathname,
    "--method",
    method,
    "--output",
    "json",
    "--no-color",
    "--no-analytics",
  ], {
    failureMessage: `reviewed Neon ${method} request failed`,
  });
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error("reviewed Neon API response was not valid JSON");
  }
}

export function validateReviewedNeonTarget(
  payloads,
  { expectCleanupRolePresent = true } = {},
) {
  const project = payloads?.project?.project;
  const branch = payloads?.branch?.branch;
  const endpoints = payloads?.endpoints?.endpoints;
  const endpoint = Array.isArray(endpoints)
    ? endpoints.find((candidate) => candidate?.id === REVIEWED_ENDPOINT_ID)
    : null;
  const roles = Array.isArray(payloads?.roles)
    ? payloads.roles
    : payloads?.roles?.roles;
  const matchingRoles = Array.isArray(roles)
    ? roles.filter((candidate) => candidate?.name === DIRECT_UPLOAD_CLEANUP_ROLE)
    : [];
  const role = matchingRoles[0];
  const environment = payloads?.environment;
  if (
    project?.id !== REVIEWED_NEON_PROJECT_ID
    || project.org_id !== REVIEWED_NEON_ORG_ID
    || project.region_id !== "azure-westus3"
    || branch?.id !== REVIEWED_NEON_BRANCH_ID
    || branch.name !== "production"
    || branch.primary !== true
    || branch.default !== true
    || endpoint?.branch_id !== REVIEWED_NEON_BRANCH_ID
    || endpoint.region_id !== "azure-westus3"
    || endpoint.type !== "read_write"
    || endpoint.disabled !== false
    || !Array.isArray(roles)
    || (
      expectCleanupRolePresent
        ? (
          matchingRoles.length !== 1
          || role?.branch_id !== REVIEWED_NEON_BRANCH_ID
          || role.name !== DIRECT_UPLOAD_CLEANUP_ROLE
          || role.authentication_method !== "password"
        )
        : matchingRoles.length !== 0
    )
    || Number(environment?.id) !== DIRECT_UPLOAD_CLEANUP_ENVIRONMENT_ID
    || environment?.name !== DIRECT_UPLOAD_CLEANUP_ENVIRONMENT
  ) {
    throw new Error("provider remediation target metadata drifted");
  }
  return Object.freeze({
    branchId: branch.id,
    endpointId: endpoint.id,
    environmentId: Number(environment.id),
    projectId: project.id,
    roleName: DIRECT_UPLOAD_CLEANUP_ROLE,
    rolePresent: expectCleanupRolePresent,
  });
}

function ghJson(args) {
  const result = spawnSync("gh", args, {
    cwd: process.cwd(),
    env: cleanEnvironment(),
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error("reviewed GitHub metadata command failed");
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("reviewed GitHub metadata response was not JSON");
  }
}

function readNeonRoles(cliPath) {
  const stdout = runNeonCli(cliPath, [
    "roles",
    "list",
    "--project-id",
    REVIEWED_NEON_PROJECT_ID,
    "--branch",
    REVIEWED_NEON_BRANCH_ID,
    "--output",
    "json",
    "--no-color",
    "--no-analytics",
  ], {
    failureMessage: "reviewed Neon role-list command failed",
  });
  try {
    const payload = JSON.parse(stdout);
    return Array.isArray(payload) ? payload : payload?.roles;
  } catch {
    throw new Error("reviewed Neon role-list response was not valid JSON");
  }
}

function readProviderTargets(cliPath, { expectCleanupRolePresent }) {
  const base = `/projects/${REVIEWED_NEON_PROJECT_ID}`;
  const target = validateReviewedNeonTarget({
    project: runNeonApi(cliPath, base),
    branch: runNeonApi(
      cliPath,
      `${base}/branches/${REVIEWED_NEON_BRANCH_ID}`,
    ),
    endpoints: runNeonApi(cliPath, `${base}/endpoints`),
    roles: readNeonRoles(cliPath),
    environment: ghJson([
      "api",
      `repos/${REVIEWED_REPOSITORY}/environments/`
      + encodeURIComponent(DIRECT_UPLOAD_CLEANUP_ENVIRONMENT),
    ]),
  }, {
    expectCleanupRolePresent,
  });
  const secrets = ghJson([
    "secret",
    "list",
    "--env",
    DIRECT_UPLOAD_CLEANUP_ENVIRONMENT,
    "--repo",
    REVIEWED_REPOSITORY,
    "--json",
    "name",
  ]);
  const variables = ghJson([
    "variable",
    "list",
    "--env",
    DIRECT_UPLOAD_CLEANUP_ENVIRONMENT,
    "--repo",
    REVIEWED_REPOSITORY,
    "--json",
    "name,value",
  ]);
  if (
    !Array.isArray(secrets)
    || !secrets.some(
      (entry) => entry?.name === DIRECT_UPLOAD_CLEANUP_DATABASE_SECRET,
    )
    || !Array.isArray(variables)
    || !variables.some(
      (entry) =>
        entry?.name === DIRECT_UPLOAD_CLEANUP_DATABASE_DIGEST_VARIABLE
        && entry.value === REJECTED_CLEANUP_DATABASE_URL_SHA256,
    )
  ) {
    throw new Error("rejected cleanup credential metadata drifted");
  }
  return target;
}

function buildPsqlArgs() {
  return [
    "psql",
    REVIEWED_NEON_BRANCH_ID,
    "--project-id",
    REVIEWED_NEON_PROJECT_ID,
    "--role-name",
    REVIEWED_OWNER_ROLE,
    "--database-name",
    REVIEWED_DATABASE_NAME,
    "--ssl",
    "verify-full",
    "--no-color",
    "--no-analytics",
    "--",
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
  ];
}

function psqlLiteral(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_:+$=/.-]+$/.test(value)) {
    throw new Error("refused unsafe psql variable value");
  }
  return `'${value.replaceAll("'", "''")}'`;
}

export function makeScramVerifier(password, salt = randomBytes(16)) {
  if (
    !SAFE_PASSWORD_PATTERN.test(password)
    || !Buffer.isBuffer(salt)
    || salt.length !== 16
  ) {
    throw new Error("cleanup-role password or SCRAM salt is invalid");
  }
  const iterations = 4096;
  const saltedPassword = pbkdf2Sync(
    Buffer.from(password, "utf8"),
    salt,
    iterations,
    32,
    "sha256",
  );
  const clientKey = createHmac("sha256", saltedPassword)
    .update("Client Key")
    .digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", saltedPassword)
    .update("Server Key")
    .digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}`
    + `$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

function roleAssertionSql(roleExpression) {
  return `
DO $grainline_assert_role$
DECLARE
  candidate record;
  parent_count integer;
  reviewed_member_count integer;
  unexpected_member_count integer;
  unexpected_transitive_member_count integer;
BEGIN
  SELECT *
    INTO candidate
    FROM pg_catalog.pg_roles
   WHERE rolname = ${roleExpression};
  IF candidate IS NULL
     OR candidate.rolsuper
     OR candidate.rolcreatedb
     OR candidate.rolcreaterole
     OR candidate.rolinherit
     OR NOT candidate.rolcanlogin
     OR candidate.rolreplication
     OR candidate.rolbypassrls THEN
    RAISE EXCEPTION 'replacement cleanup role attributes are not exact';
  END IF;
  SELECT pg_catalog.count(*)::integer
    INTO parent_count
    FROM pg_catalog.pg_auth_members AS edge
   WHERE edge.member = candidate.oid;
  SELECT pg_catalog.count(*)::integer
    INTO reviewed_member_count
    FROM pg_catalog.pg_auth_members AS edge
    JOIN pg_catalog.pg_roles AS member ON member.oid = edge.member
    JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = edge.grantor
   WHERE edge.roleid = candidate.oid
     AND member.rolname = 'neondb_owner'
     AND grantor.rolname = 'cloud_admin'
     AND edge.admin_option
     AND NOT edge.inherit_option
     AND NOT edge.set_option;
  SELECT pg_catalog.count(*)::integer
    INTO unexpected_member_count
    FROM pg_catalog.pg_auth_members AS edge
    JOIN pg_catalog.pg_roles AS member ON member.oid = edge.member
    JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = edge.grantor
   WHERE edge.roleid = candidate.oid
     AND NOT (
       member.rolname = 'neondb_owner'
       AND grantor.rolname = 'cloud_admin'
       AND edge.admin_option
       AND NOT edge.inherit_option
       AND NOT edge.set_option
     );
  WITH RECURSIVE members AS (
    SELECT member.oid, member.rolname
      FROM pg_catalog.pg_auth_members AS edge
      JOIN pg_catalog.pg_roles AS member ON member.oid = edge.member
     WHERE edge.roleid = candidate.oid
    UNION
    SELECT member.oid, member.rolname
      FROM members AS parent
      JOIN pg_catalog.pg_auth_members AS edge ON edge.roleid = parent.oid
      JOIN pg_catalog.pg_roles AS member ON member.oid = edge.member
  )
  SELECT pg_catalog.count(*)::integer
    INTO unexpected_transitive_member_count
    FROM members
   WHERE rolname <> 'neondb_owner';
  IF parent_count <> 0
     OR reviewed_member_count > 1
     OR unexpected_member_count <> 0
     OR unexpected_transitive_member_count <> 0 THEN
    RAISE EXCEPTION 'replacement cleanup role membership posture is not exact';
  END IF;
END
$grainline_assert_role$;
`;
}

export function buildRejectedRolePreflightSql() {
  return String.raw`
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;
DO $grainline_rejected_role$
DECLARE
  rejected record;
  direct_parent text;
  active_count integer;
BEGIN
  IF current_user <> 'neondb_owner' OR session_user <> 'neondb_owner' THEN
    RAISE EXCEPTION 'provider-remediation owner identity is not exact';
  END IF;
  SELECT *
    INTO rejected
    FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_direct_upload_cleanup';
  IF rejected IS NULL
     OR rejected.rolsuper
     OR NOT rejected.rolcreatedb
     OR NOT rejected.rolcreaterole
     OR NOT rejected.rolinherit
     OR NOT rejected.rolcanlogin
     OR NOT rejected.rolreplication
     OR NOT rejected.rolbypassrls THEN
    RAISE EXCEPTION 'rejected API cleanup role posture changed';
  END IF;
  SELECT pg_catalog.string_agg(parent.rolname, ',' ORDER BY parent.rolname)
    INTO direct_parent
    FROM pg_catalog.pg_auth_members AS edge
    JOIN pg_catalog.pg_roles AS parent ON parent.oid = edge.roleid
   WHERE edge.member = rejected.oid;
  IF direct_parent IS DISTINCT FROM 'neon_superuser' THEN
    RAISE EXCEPTION 'rejected API cleanup role direct memberships changed';
  END IF;
  SELECT pg_catalog.count(*)::integer
    INTO active_count
    FROM pg_catalog.pg_stat_activity
   WHERE usename = rejected.rolname
     AND pid <> pg_catalog.pg_backend_pid();
  IF active_count <> 0 THEN
    RAISE EXCEPTION 'rejected API cleanup role has active sessions';
  END IF;
END
$grainline_rejected_role$;
ROLLBACK;
\echo grainline_rejected_cleanup_role_preflight_passed
`;
}

export function buildAbsentRolePreflightSql() {
  return String.raw`
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;
DO $grainline_absent_role$
BEGIN
  IF current_user <> 'neondb_owner' OR session_user <> 'neondb_owner' THEN
    RAISE EXCEPTION 'provider-remediation owner identity is not exact';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_roles
     WHERE rolname = 'grainline_direct_upload_cleanup'
  ) THEN
    RAISE EXCEPTION 'deleted API cleanup role is not absent';
  END IF;
END
$grainline_absent_role$;
ROLLBACK;
\echo grainline_deleted_cleanup_role_absence_passed
`;
}

export function buildReplacementProbeSql(scramVerifier) {
  return String.raw`
\set ON_ERROR_STOP on
\set replacement_verifier ${psqlLiteral(scramVerifier)}
BEGIN;
SELECT pg_catalog.format(
  'CREATE ROLE %I LOGIN NOINHERIT PASSWORD %L',
  'grainline_direct_upload_cleanup_replacement_probe',
  :'replacement_verifier'
);
\gexec
${roleAssertionSql("'grainline_direct_upload_cleanup_replacement_probe'")}
ROLLBACK;
\echo grainline_cleanup_role_replacement_probe_passed
`;
}

export function buildRecoveryReplacementProbeSql(scramVerifier) {
  return String.raw`
\set ON_ERROR_STOP on
\set replacement_verifier ${psqlLiteral(scramVerifier)}
BEGIN;
DO $grainline_role_absent$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_roles
     WHERE rolname = 'grainline_direct_upload_cleanup'
  ) THEN
    RAISE EXCEPTION 'deleted API cleanup role is not absent';
  END IF;
END
$grainline_role_absent$;
SELECT pg_catalog.format(
  'CREATE ROLE %I LOGIN NOINHERIT PASSWORD %L',
  'grainline_direct_upload_cleanup',
  :'replacement_verifier'
);
\gexec
${roleAssertionSql("'grainline_direct_upload_cleanup'")}
ROLLBACK;
\echo grainline_cleanup_role_recovery_probe_passed
`;
}

export function buildReplacementSql(scramVerifier) {
  return String.raw`
\set ON_ERROR_STOP on
\set replacement_verifier ${psqlLiteral(scramVerifier)}
BEGIN;
DO $grainline_role_absent$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_roles
     WHERE rolname = 'grainline_direct_upload_cleanup'
  ) THEN
    RAISE EXCEPTION 'rejected API cleanup role still exists';
  END IF;
END
$grainline_role_absent$;
SELECT pg_catalog.format(
  'CREATE ROLE %I LOGIN NOINHERIT PASSWORD %L',
  'grainline_direct_upload_cleanup',
  :'replacement_verifier'
);
\gexec
${roleAssertionSql("'grainline_direct_upload_cleanup'")}
COMMIT;
\echo grainline_cleanup_role_sql_replacement_committed
`;
}

function runOwnerSql(cliPath, sql, marker) {
  const stdout = runNeonCli(cliPath, buildPsqlArgs(), {
    input: sql,
    timeout: 90_000,
    failureMessage: "reviewed owner SQL operation failed",
  });
  if (!stdout.includes(marker)) {
    throw new Error("reviewed owner SQL success marker is absent");
  }
}

export function validateDeleteRoleResponse(payload) {
  const role = payload?.role;
  const operations = payload?.operations;
  if (
    role?.branch_id !== REVIEWED_NEON_BRANCH_ID
    || role.name !== DIRECT_UPLOAD_CLEANUP_ROLE
    || !Array.isArray(operations)
  ) {
    throw new Error("Neon role-delete response did not match the reviewed target");
  }
  return Object.freeze({
    operations: operations.map((operation) => {
      if (
        typeof operation?.id !== "string"
        || !SAFE_OPERATION_ID_PATTERN.test(operation.id)
        || operation.project_id !== REVIEWED_NEON_PROJECT_ID
        || (
          operation.branch_id
          && operation.branch_id !== REVIEWED_NEON_BRANCH_ID
        )
        || typeof operation.status !== "string"
      ) {
        throw new Error("Neon role-delete operation metadata is invalid");
      }
      return Object.freeze({
        id: operation.id,
        status: operation.status,
      });
    }),
    roleName: role.name,
  });
}

async function waitForOperations(cliPath, initialOperations, wait) {
  let operations = initialOperations;
  for (let attempt = 1; attempt <= OPERATION_ATTEMPTS; attempt += 1) {
    if (
      operations.some((operation) =>
        ["failed", "error", "cancelled"].includes(operation.status))
    ) {
      throw new Error("Neon cleanup-role deletion failed");
    }
    if (
      operations.every((operation) =>
        ["finished", "skipped"].includes(operation.status))
    ) {
      return;
    }
    if (attempt < OPERATION_ATTEMPTS) await wait(OPERATION_INTERVAL_MS);
    operations = operations.map((operation) => {
      const payload = runNeonApi(
        cliPath,
        `/projects/${REVIEWED_NEON_PROJECT_ID}/operations/${operation.id}`,
      )?.operation;
      if (
        payload?.id !== operation.id
        || payload.project_id !== REVIEWED_NEON_PROJECT_ID
        || typeof payload.status !== "string"
      ) {
        throw new Error("Neon cleanup-role deletion status drifted");
      }
      return { id: payload.id, status: payload.status };
    });
  }
  throw new Error("Neon cleanup-role deletion did not finish in time");
}

async function waitForCatalogRoleAbsence(cliPath, wait) {
  for (let attempt = 1; attempt <= OPERATION_ATTEMPTS; attempt += 1) {
    try {
      runOwnerSql(
        cliPath,
        buildAbsentRolePreflightSql(),
        "grainline_deleted_cleanup_role_absence_passed",
      );
      return;
    } catch {
      if (attempt < OPERATION_ATTEMPTS) {
        await wait(OPERATION_INTERVAL_MS);
      }
    }
  }
  throw new Error("deleted cleanup role did not leave the PostgreSQL catalog");
}

export function buildDirectUploadCleanupDatabaseUrl(password) {
  if (!SAFE_PASSWORD_PATTERN.test(password)) {
    throw new Error("cleanup-role replacement password is invalid");
  }
  const value = new URL(
    `postgresql://${DIRECT_UPLOAD_CLEANUP_ROLE}:placeholder`
      + `@${REVIEWED_ENDPOINT_ID}.${REVIEWED_DATABASE_REGION}.neon.tech`
      + `:5432/${REVIEWED_DATABASE_NAME}`
      + "?sslmode=verify-full&channel_binding=require",
  );
  value.password = password;
  const rendered = value.toString();
  const identity = parseGuardedNeonDatabaseIdentity(
    rendered,
    "replacement cleanup-role URL",
  );
  if (
    identity.endpointId !== REVIEWED_ENDPOINT_ID
    || identity.databaseName !== REVIEWED_DATABASE_NAME
    || identity.region !== REVIEWED_DATABASE_REGION
    || identity.username !== DIRECT_UPLOAD_CLEANUP_ROLE
    || identity.isPooler
    || identity.port !== "5432"
  ) {
    throw new Error("replacement cleanup-role URL identity is invalid");
  }
  return rendered;
}

async function verifyReplacementConnection(connectionString) {
  const parsed = new URL(connectionString);
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000,
    query_timeout: 25_000,
    application_name: "grainline-cleanup-role-provider-remediation",
    ...postgresChannelBindingClientOptions(parsed),
  });
  try {
    await client.connect();
    const role = (await client.query(`
      SELECT
        current_user AS current_user,
        session_user AS session_user,
        rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolcanlogin,
        rolreplication, rolbypassrls
      FROM pg_catalog.pg_roles
      WHERE rolname = current_user
    `)).rows[0];
    const parentMemberships = (await client.query(`
      SELECT
        parent.rolname
      FROM pg_catalog.pg_auth_members AS edge
      JOIN pg_catalog.pg_roles AS child ON child.oid = edge.member
      JOIN pg_catalog.pg_roles AS parent ON parent.oid = edge.roleid
      WHERE child.rolname = current_user
      ORDER BY parent.rolname
    `)).rows.map((row) => row.rolname);
    const memberRoleEdges = (await client.query(`
      SELECT
        member.rolname AS member_role,
        grantor.rolname AS grantor_role,
        edge.admin_option,
        edge.inherit_option,
        edge.set_option
      FROM pg_catalog.pg_auth_members AS edge
      JOIN pg_catalog.pg_roles AS parent ON parent.oid = edge.roleid
      JOIN pg_catalog.pg_roles AS member ON member.oid = edge.member
      JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = edge.grantor
      WHERE parent.rolname = current_user
      ORDER BY member.rolname, grantor.rolname
    `)).rows;
    const memberRoles = (await client.query(`
      WITH RECURSIVE members AS (
        SELECT member.oid, member.rolname
        FROM pg_catalog.pg_auth_members AS edge
        JOIN pg_catalog.pg_roles AS parent ON parent.oid = edge.roleid
        JOIN pg_catalog.pg_roles AS member ON member.oid = edge.member
        WHERE parent.rolname = current_user
        UNION
        SELECT member.oid, member.rolname
        FROM members AS parent
        JOIN pg_catalog.pg_auth_members AS edge ON edge.roleid = parent.oid
        JOIN pg_catalog.pg_roles AS member ON member.oid = edge.member
      )
      SELECT DISTINCT rolname FROM members ORDER BY rolname
    `)).rows.map((row) => row.rolname);
    if (
      role?.current_user !== DIRECT_UPLOAD_CLEANUP_ROLE
      || role?.session_user !== DIRECT_UPLOAD_CLEANUP_ROLE
      || role.rolsuper
      || role.rolcreatedb
      || role.rolcreaterole
      || role.rolinherit
      || !role.rolcanlogin
      || role.rolreplication
      || role.rolbypassrls
      || parentMemberships.length !== 0
      || !hasReviewedDirectUploadCleanupMemberPosture({
        memberRoleEdges,
        memberRoles,
      })
    ) {
      throw new Error("replacement cleanup-role connection posture is not exact");
    }
    return Object.freeze({
      hasReviewedBootstrapAdminEdge: memberRoleEdges.length === 1,
    });
  } finally {
    await client.end().catch(() => {});
  }
}

function setGitHubEnvironmentValue(kind, name, value) {
  const command = kind === "secret" ? ["secret", "set"] : ["variable", "set"];
  const result = spawnSync("gh", [
    ...command,
    name,
    "--env",
    DIRECT_UPLOAD_CLEANUP_ENVIRONMENT,
    "--repo",
    REVIEWED_REPOSITORY,
  ], {
    cwd: process.cwd(),
    env: cleanEnvironment(),
    encoding: "utf8",
    input: value,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`failed to update reviewed GitHub environment ${kind}`);
  }
}

function writeEvidence(pathname, evidence) {
  const descriptor = openSync(pathname, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(pathname, 0o600);
  if (
    !lstatSync(pathname).isFile()
    || (lstatSync(pathname).mode & 0o777) !== 0o600
  ) {
    throw new Error("provider-remediation evidence mode is not 0600");
  }
}

export function parseProviderRemediationConfig(env = process.env) {
  const confirmation =
    env.DIRECT_UPLOAD_CLEANUP_PROVIDER_REMEDIATION_CONFIRM;
  const recoveryAfterDelete =
    confirmation === DIRECT_UPLOAD_CLEANUP_PROVIDER_RECOVERY_CONFIRMATION;
  if (
    confirmation !== DIRECT_UPLOAD_CLEANUP_PROVIDER_REMEDIATION_CONFIRMATION
    && !recoveryAfterDelete
  ) {
    throw new Error("cleanup-role provider-remediation confirmation is invalid");
  }
  const releaseCommit = required(
    env,
    "DIRECT_UPLOAD_CLEANUP_PROVIDER_RELEASE_COMMIT",
  );
  const evidencePath = path.resolve(required(
    env,
    "DIRECT_UPLOAD_CLEANUP_PROVIDER_EVIDENCE_PATH",
  ));
  const expected = path.join(
    process.cwd(),
    ".codex",
    "evidence",
    `${EVIDENCE_PREFIX}${releaseCommit}.json`,
  );
  if (evidencePath !== expected || existsSync(evidencePath)) {
    throw new Error("cleanup-role provider evidence path is not fresh and exact");
  }
  return Object.freeze({
    evidencePath,
    recoveryAfterDelete,
    releaseCommit,
  });
}

async function defaultWait(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function run() {
  remediationFailureStage = "configuration";
  const config = parseProviderRemediationConfig();
  remediationFailureStage = "git-state";
  const gitState = assertDirectUploadCleanupProviderGitState(
    config.releaseCommit,
  );
  remediationFailureStage = "provider-credential";
  readReviewedNeonCredentials();
  const cliPath = discoverReviewedNeonCli();
  remediationFailureStage = "provider-targets";
  const target = readProviderTargets(cliPath, {
    expectCleanupRolePresent: !config.recoveryAfterDelete,
  });
  remediationFailureStage = config.recoveryAfterDelete
    ? "deleted-role-absence"
    : "rejected-role-preflight";
  runOwnerSql(
    cliPath,
    config.recoveryAfterDelete
      ? buildAbsentRolePreflightSql()
      : buildRejectedRolePreflightSql(),
    config.recoveryAfterDelete
      ? "grainline_deleted_cleanup_role_absence_passed"
      : "grainline_rejected_cleanup_role_preflight_passed",
  );

  const password = randomBytes(48).toString("base64url");
  const scramVerifier = makeScramVerifier(password);
  remediationFailureStage = config.recoveryAfterDelete
    ? "recovery-replacement-probe"
    : "replacement-probe";
  runOwnerSql(
    cliPath,
    config.recoveryAfterDelete
      ? buildRecoveryReplacementProbeSql(scramVerifier)
      : buildReplacementProbeSql(scramVerifier),
    config.recoveryAfterDelete
      ? "grainline_cleanup_role_recovery_probe_passed"
      : "grainline_cleanup_role_replacement_probe_passed",
  );
  if (process.argv.includes("--preflight")) {
    process.stdout.write(`${JSON.stringify({
      status: "preflight-passed",
      releaseCommit: config.releaseCommit,
      cleanupRole: DIRECT_UPLOAD_CLEANUP_ROLE,
      providerTargetExact: true,
      providerRoleState: config.recoveryAfterDelete
        ? "api-role-already-deleted"
        : "rejected-api-role-present",
      rejectedRolePostureExact: !config.recoveryAfterDelete,
      deletedRoleAbsenceExact: config.recoveryAfterDelete,
      replacementProbeRolledBack: true,
      productionChanged: false,
    })}\n`);
    return;
  }

  if (!config.recoveryAfterDelete) {
    const base = `/projects/${REVIEWED_NEON_PROJECT_ID}`
      + `/branches/${REVIEWED_NEON_BRANCH_ID}`;
    remediationFailureStage = "provider-role-delete";
    const deleted = validateDeleteRoleResponse(runNeonApi(
      cliPath,
      `${base}/roles/${DIRECT_UPLOAD_CLEANUP_ROLE}`,
      "DELETE",
    ));
    remediationFailureStage = "provider-role-delete-wait";
    await waitForOperations(cliPath, deleted.operations, defaultWait);
    remediationFailureStage = "provider-role-catalog-absence-wait";
    await waitForCatalogRoleAbsence(cliPath, defaultWait);
  }

  remediationFailureStage = "replacement-create";
  runOwnerSql(
    cliPath,
    buildReplacementSql(scramVerifier),
    "grainline_cleanup_role_sql_replacement_committed",
  );
  const connectionString = buildDirectUploadCleanupDatabaseUrl(password);
  remediationFailureStage = "replacement-connection-proof";
  const replacementProof = await verifyReplacementConnection(connectionString);
  const digest = createHash("sha256").update(connectionString).digest("hex");
  remediationFailureStage = "github-secret-update";
  setGitHubEnvironmentValue(
    "secret",
    DIRECT_UPLOAD_CLEANUP_DATABASE_SECRET,
    connectionString,
  );
  remediationFailureStage = "github-digest-update";
  setGitHubEnvironmentValue(
    "variable",
    DIRECT_UPLOAD_CLEANUP_DATABASE_DIGEST_VARIABLE,
    digest,
  );

  const completedAt = new Date().toISOString();
  remediationFailureStage = "evidence-write";
  writeEvidence(config.evidencePath, {
    schemaVersion: 1,
    operation: "direct-upload-cleanup-role-provider-remediation",
    source: {
      clean: gitState.clean,
      commit: gitState.head,
    },
    target,
    run: { completedAt },
    proof: {
      apiCreatedRoleRejected: true,
      apiRoleAlreadyDeleted: config.recoveryAfterDelete,
      apiRoleDeleted: !config.recoveryAfterDelete,
      replacementAuthenticated: true,
      replacementHasParentMemberships: false,
      replacementHasReviewedBootstrapAdminEdge:
        replacementProof.hasReviewedBootstrapAdminEdge,
      replacementHasUnexpectedMemberEdges: false,
      replacementHasPrivilegedAttributes: false,
      replacementPasswordRotated: true,
      cleanupDatabaseUrlSha256: digest,
      githubEnvironmentSecretUpdated: true,
      githubEnvironmentDigestUpdated: true,
    },
    productionDataChanged: false,
    directUploadRlsChanged: false,
    cleanupExecuted: false,
  });
  remediationFailureStage = "complete";
  process.stdout.write(`${JSON.stringify({
    status: "passed",
    releaseCommit: config.releaseCommit,
    cleanupRole: DIRECT_UPLOAD_CLEANUP_ROLE,
    cleanupDatabaseUrlSha256: digest,
    productionDataChanged: false,
    directUploadRlsChanged: false,
    cleanupExecuted: false,
  })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await run();
  } catch {
    process.stderr.write(
      "DirectUpload cleanup-role provider remediation failed closed "
        + `at stage ${remediationFailureStage}.\n`,
    );
    process.exitCode = 1;
  }
}
