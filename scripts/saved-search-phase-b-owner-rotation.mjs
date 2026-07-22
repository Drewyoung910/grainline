#!/usr/bin/env node
import {
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes,
} from "node:crypto";
import {
  chmodSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";
import {
  parseGuardedNeonDatabaseIdentity,
} from "./guard-saved-search-rls-deploy.mjs";
import {
  assertDeterministicPostgresEnvironment,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";

const { Client } = pg;

export const PHASE_B_EARLIEST_PROMOTION_AT = "2026-07-20T06:25:00.000Z";
export const PHASE_B_CANARY_BUCKET = "2026-07-20T06";
export const PHASE_B_CANARY_NOT_BEFORE = "2026-07-20T06:20:00.000Z";
export const PHASE_B_RELEASE_COMMIT = "17bf93dc8837fd6c5e6988569f993781800b6318";
export const PHASE_A_DEPLOYMENT_ID = "dpl_H5tnmGyL8fK3oriwawjHBhg2Yomz";
export const REVIEWED_ENDPOINT_ID = "ep-plain-river-aaqg8gj4";
export const REVIEWED_DATABASE_NAME = "neondb";
export const REVIEWED_DATABASE_REGION = "westus3.azure";
export const REVIEWED_OWNER_ROLE = "neondb_owner";
export const REVIEWED_RUNTIME_ROLE = "grainline_app_runtime";
export const PHASE_B_CANARY_QUERY = `
      SELECT bucket, status,
             "startedAt" AT TIME ZONE 'UTC' AS started_at,
             "completedAt" AT TIME ZONE 'UTC' AS completed_at,
             result
        FROM public."CronRun"
       WHERE "jobName" = 'ops-health' AND bucket = $1
       ORDER BY "startedAt" DESC
       LIMIT 1
    `;
export const REVIEWED_VERCEL_CLI_PATH = "/Users/drewyoung/.npm/_npx/69f9afb961c37556/node_modules/vercel/dist/vc.js";
export const REVIEWED_VERCEL_PROJECT_DIRECTORY = "/Users/drewyoung/grainline";
export const REVIEWED_VERCEL_PROJECT = Object.freeze({
  projectId: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp",
  orgId: "team_wvQeQHZGwCSwinC1uB7xbpjr",
  projectName: "grainline",
});

const MODE_CONFIRMATIONS = Object.freeze({
  "preflight-only": "verify-production-phase-b-after-post-skew-canary",
  rotate: "rotate-production-owner-after-post-skew-canary",
});
const EVIDENCE_DIRECTORY = "/Users/drewyoung/grainline-rollout-evidence";
const REVIEWED_LOCAL_CREDENTIAL_PATH = "/Users/drewyoung/grainline/.env.local";
const LOCAL_CREDENTIAL_TEMP_PATH = "/Users/drewyoung/grainline/.env.local.phase-b-owner-rotation.tmp";
const CONNECTION_TIMEOUT_MS = 10_000;
const STATEMENT_TIMEOUT_MS = 30_000;
const QUERY_TIMEOUT_MS = 35_000;
const DRAIN_ATTEMPTS = 7;
const DRAIN_INTERVAL_MS = 5_000;
const GENERATED_PASSWORD_PATTERN = /^[A-Za-z0-9_-]{40,}$/;
const SCRAM_PASSWORD_INPUT_PATTERN = /^[\x21-\x7e]+$/;
const SCRAM_ITERATIONS = 4096;
const SCRAM_VERIFIER_PATTERN = /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/;
const REVIEWED_VERCEL_CLI_VERSION = "56.4.1";
const REVIEWED_VERCEL_CLI_INTEGRITY =
  "sha512-+CIEa0qcKm1RNBRhOvpo2l/yz28LMKSDuGeAYGx4/EkYyR5VOrXJZYV52WvqVARcxBAbH3Un2RRin8YGXMlcNg==";
const REVIEWED_OWNER_MEMBERSHIPS = Object.freeze([
  REVIEWED_RUNTIME_ROLE,
  "neon_superuser",
]);
const REVIEWED_OWNER_MEMBERSHIP_OPTIONS = Object.freeze([
  Object.freeze({
    role: REVIEWED_RUNTIME_ROLE,
    adminOption: true,
    inheritOption: false,
    setOption: false,
  }),
  Object.freeze({
    role: "neon_superuser",
    adminOption: false,
    inheritOption: true,
    setOption: true,
  }),
]);

function required(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${name} is required without surrounding whitespace`);
  }
  return value;
}

function sortedMemberships(row) {
  return Array.isArray(row?.memberships)
    ? [...row.memberships].sort((left, right) => left.localeCompare(right))
    : [];
}

function exactMembershipOptions(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((membership, index) => {
      const reviewed = expected[index];
      return membership?.role === reviewed.role
        && membership.adminOption === reviewed.adminOption
        && membership.inheritOption === reviewed.inheritOption
        && membership.setOption === reviewed.setOption;
    });
}

function exactOwnerRoleState(row) {
  return row?.rolname === REVIEWED_OWNER_ROLE
    && row.rolsuper === false
    && row.rolcreatedb === true
    && row.rolcreaterole === true
    && row.rolinherit === true
    && row.rolcanlogin === true
    && row.rolreplication === true
    && row.rolbypassrls === true
    && JSON.stringify(sortedMemberships(row))
      === JSON.stringify(REVIEWED_OWNER_MEMBERSHIPS)
    && exactMembershipOptions(
      row.membership_options,
      REVIEWED_OWNER_MEMBERSHIP_OPTIONS,
    );
}

function exactRuntimeRoleState(row) {
  return row?.rolname === REVIEWED_RUNTIME_ROLE
    && row.rolsuper === false
    && row.rolcreatedb === false
    && row.rolcreaterole === false
    && row.rolinherit === false
    && row.rolcanlogin === true
    && row.rolreplication === false
    && row.rolbypassrls === false
    && sortedMemberships(row).length === 0
    && Array.isArray(row.membership_options)
    && row.membership_options.length === 0;
}

function exactPhaseAState(row) {
  return row?.rls_enabled === true
    && row.rls_forced === false
    && row.owner_name === REVIEWED_OWNER_ROLE
    && Number(row.policy_count) === 3;
}

function parseIsoTimestamp(value, label) {
  const timestamp = typeof value === "string" || value instanceof Date
    ? new Date(value).getTime()
    : Number.NaN;
  if (!Number.isFinite(timestamp)) throw new Error(`${label} is invalid`);
  return timestamp;
}

export function assertExactPostSkewCanary(canary, now = new Date()) {
  if (!canary || typeof canary !== "object") {
    throw new Error("post-skew canary row is missing");
  }
  const nowMs = now.getTime();
  const completedAtMs = parseIsoTimestamp(canary.completed_at, "canary completedAt");
  const startedAtMs = parseIsoTimestamp(canary.started_at, "canary startedAt");
  const result = canary.result;
  if (
    canary.bucket !== PHASE_B_CANARY_BUCKET
    || canary.status !== "COMPLETED"
    || startedAtMs < Date.parse(PHASE_B_CANARY_NOT_BEFORE)
    || completedAtMs < startedAtMs
    || completedAtMs > nowMs
    || !result
    || result.ok !== true
    || result.savedSearchRlsCanaryStatus !== "healthy"
    || Number(result.savedSearchRlsCanaryIssueCount) !== 0
  ) {
    throw new Error("exact 06:20 UTC post-skew canary is not healthy and complete");
  }
  for (const [key, value] of Object.entries(result)) {
    if (key.endsWith("Count") && Number(value) !== 0) {
      throw new Error("post-skew ops-health result contains an actionable count");
    }
  }
  return Object.freeze({
    bucket: canary.bucket,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: new Date(completedAtMs).toISOString(),
    status: canary.status,
    savedSearchRlsCanaryStatus: result.savedSearchRlsCanaryStatus,
    savedSearchRlsCanaryIssueCount: Number(result.savedSearchRlsCanaryIssueCount),
  });
}

export function buildRotatedDirectUrl(currentDirectUrl, password) {
  if (!GENERATED_PASSWORD_PATTERN.test(password)) {
    throw new Error("generated owner password does not meet the reviewed shape");
  }
  const currentIdentity = parseGuardedNeonDatabaseIdentity(currentDirectUrl, "DIRECT_URL");
  if (currentIdentity.isPooler || currentIdentity.username !== REVIEWED_OWNER_ROLE) {
    throw new Error("DIRECT_URL is not the reviewed direct owner URL");
  }
  const rotated = new URL(currentDirectUrl);
  rotated.password = password;
  const rotatedUrl = rotated.toString();
  const rotatedIdentity = parseGuardedNeonDatabaseIdentity(rotatedUrl, "rotated DIRECT_URL");
  if (JSON.stringify(rotatedIdentity) !== JSON.stringify(currentIdentity)) {
    throw new Error("rotated DIRECT_URL changed database identity");
  }
  return rotatedUrl;
}

export function buildScramSha256Verifier(
  password,
  salt = randomBytes(16),
  iterations = SCRAM_ITERATIONS,
) {
  if (
    typeof password !== "string"
    || !SCRAM_PASSWORD_INPUT_PATTERN.test(password)
    || !Buffer.isBuffer(salt)
    || salt.length < 16
    || iterations !== SCRAM_ITERATIONS
  ) {
    throw new Error("SCRAM verifier input does not match the reviewed shape");
  }
  const saltedPassword = pbkdf2Sync(
    Buffer.from(password, "utf8"),
    salt,
    iterations,
    32,
    "sha256",
  );
  const clientKey = createHmac("sha256", saltedPassword)
    .update("Client Key", "utf8")
    .digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", saltedPassword)
    .update("Server Key", "utf8")
    .digest();
  const verifier = `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}`
    + `$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
  if (!SCRAM_VERIFIER_PATTERN.test(verifier)) {
    throw new Error("generated SCRAM verifier does not match PostgreSQL format");
  }
  return verifier;
}

function defaultPasswordGenerator() {
  return randomBytes(32).toString("base64url");
}

export function parseOwnerRotationConfig(env = process.env, now = new Date()) {
  const mode = required(env, "PHASE_B_OWNER_ROTATION_MODE");
  if (!Object.hasOwn(MODE_CONFIRMATIONS, mode)) {
    throw new Error("PHASE_B_OWNER_ROTATION_MODE must be preflight-only or rotate");
  }
  if (env.PHASE_B_OWNER_ROTATION_CONFIRM !== MODE_CONFIRMATIONS[mode]) {
    throw new Error(`PHASE_B_OWNER_ROTATION_CONFIRM must match the reviewed ${mode} value`);
  }
  if (env.PHASE_B_OWNER_ROTATION_RELEASE_COMMIT !== PHASE_B_RELEASE_COMMIT) {
    throw new Error("PHASE_B_OWNER_ROTATION_RELEASE_COMMIT must match the sealed release");
  }
  if (now.getTime() < Date.parse(PHASE_B_EARLIEST_PROMOTION_AT)) {
    throw new Error("Phase B owner rotation is barred before the reviewed promotion time");
  }
  if (env.SAVED_SEARCH_RLS_DEPLOY_PHASE) {
    throw new Error("SAVED_SEARCH_RLS_DEPLOY_PHASE must remain absent during owner rotation");
  }
  assertDeterministicPostgresEnvironment(env, "Phase B owner rotation");
  if (
    env.RUNTIME_DB_ROLE !== REVIEWED_RUNTIME_ROLE
    || env.MIGRATION_DB_ROLE !== REVIEWED_OWNER_ROLE
  ) {
    throw new Error("operator database role names do not match the reviewed roles");
  }
  const ownerIdentity = parseGuardedNeonDatabaseIdentity(env.DIRECT_URL, "DIRECT_URL");
  if (
    ownerIdentity.endpointId !== REVIEWED_ENDPOINT_ID
    || ownerIdentity.databaseName !== REVIEWED_DATABASE_NAME
    || ownerIdentity.region !== REVIEWED_DATABASE_REGION
    || ownerIdentity.isPooler
    || ownerIdentity.username !== REVIEWED_OWNER_ROLE
  ) {
    throw new Error("DIRECT_URL does not match the independently reviewed production owner identity");
  }
  const evidencePath = required(env, "PHASE_B_OWNER_ROTATION_EVIDENCE_PATH");
  if (
    !path.isAbsolute(evidencePath)
    || path.dirname(evidencePath) !== EVIDENCE_DIRECTORY
    || path.extname(evidencePath) !== ".json"
  ) {
    throw new Error("rotation evidence must be one JSON file in the rollout-evidence directory");
  }
  const vercelProjectDirectory = required(env, "PHASE_B_VERCEL_PROJECT_DIRECTORY");
  if (vercelProjectDirectory !== REVIEWED_VERCEL_PROJECT_DIRECTORY) {
    throw new Error("PHASE_B_VERCEL_PROJECT_DIRECTORY is not the reviewed linked project directory");
  }
  return Object.freeze({
    mode,
    now,
    currentDirectUrl: env.DIRECT_URL,
    ownerIdentity,
    evidencePath,
    vercelProjectDirectory,
  });
}

export function assertReviewedVercelProject(projectDirectory) {
  const projectPath = path.join(projectDirectory, ".vercel", "project.json");
  const project = JSON.parse(readFileSync(projectPath, "utf8"));
  for (const [key, value] of Object.entries(REVIEWED_VERCEL_PROJECT)) {
    if (project?.[key] !== value) {
      throw new Error("linked Vercel project does not match the reviewed Grainline project");
    }
  }
  return REVIEWED_VERCEL_PROJECT;
}

export function assertReviewedVercelCli() {
  const packagePath = path.resolve(
    path.dirname(REVIEWED_VERCEL_CLI_PATH),
    "..",
    "package.json",
  );
  const packageMetadata = JSON.parse(readFileSync(packagePath, "utf8"));
  const cacheLockPath = path.resolve(
    path.dirname(packagePath),
    "..",
    "..",
    "package-lock.json",
  );
  const cacheLock = JSON.parse(readFileSync(cacheLockPath, "utf8"));
  const lockedPackage = cacheLock?.packages?.["node_modules/vercel"];
  if (
    packageMetadata?.name !== "vercel"
    || packageMetadata.version !== REVIEWED_VERCEL_CLI_VERSION
    || packageMetadata?.bin?.vercel !== "./dist/vc.js"
    || lockedPackage?.version !== REVIEWED_VERCEL_CLI_VERSION
    || lockedPackage?.resolved
      !== `https://registry.npmjs.org/vercel/-/vercel-${REVIEWED_VERCEL_CLI_VERSION}.tgz`
    || lockedPackage?.integrity !== REVIEWED_VERCEL_CLI_INTEGRITY
  ) {
    throw new Error("Vercel CLI package does not match the reviewed operator version");
  }
  return Object.freeze({ name: packageMetadata.name, version: packageMetadata.version });
}

function createClient(connectionString, applicationName) {
  return new Client({
    connectionString,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
    application_name: applicationName,
    ...postgresChannelBindingClientOptions(new URL(connectionString)),
  });
}

async function withClient(connectionString, applicationName, operation) {
  const client = createClient(connectionString, applicationName);
  await client.connect();
  try {
    return await operation(client);
  } finally {
    await client.end();
  }
}

async function readRole(client, roleName) {
  return (await client.query(`
    SELECT r.rolname, r.rolsuper, r.rolcreatedb, r.rolcreaterole,
           r.rolinherit, r.rolcanlogin, r.rolreplication, r.rolbypassrls,
           (SELECT COALESCE(array_agg(parent.rolname::text ORDER BY parent.rolname),
                            ARRAY[]::text[])
              FROM pg_auth_members m
              JOIN pg_roles parent ON parent.oid = m.roleid
             WHERE m.member = r.oid) AS memberships,
           (SELECT COALESCE(
                     jsonb_agg(
                       jsonb_build_object(
                         'role', parent.rolname,
                         'adminOption', m.admin_option,
                         'inheritOption', m.inherit_option,
                         'setOption', m.set_option
                       ) ORDER BY parent.rolname
                     ),
                     '[]'::jsonb
                   )
              FROM pg_auth_members m
              JOIN pg_roles parent ON parent.oid = m.roleid
             WHERE m.member = r.oid) AS membership_options
      FROM pg_roles r
     WHERE r.rolname = $1
  `, [roleName])).rows[0];
}

async function readOwnerState(connectionString) {
  return withClient(connectionString, "grainline-phase-b-owner-proof", async (client) => {
    const identity = (await client.query(`
      SELECT current_database() AS database_name,
             current_user AS current_user_name,
             session_user AS session_user_name
    `)).rows[0];
    const ownerRole = await readRole(client, REVIEWED_OWNER_ROLE);
    const runtimeRole = await readRole(client, REVIEWED_RUNTIME_ROLE);
    const savedSearch = (await client.query(`
      SELECT c.relrowsecurity AS rls_enabled,
             c.relforcerowsecurity AS rls_forced,
             pg_get_userbyid(c.relowner) AS owner_name,
             (SELECT COUNT(*)::integer FROM pg_policy p WHERE p.polrelid = c.oid)
               AS policy_count
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = 'SavedSearch'
         AND c.relkind IN ('r', 'p')
    `)).rows[0];
    // Prisma stores DateTime as timestamp without time zone while Grainline's
    // application convention is UTC. Convert at the SQL boundary so node-pg
    // cannot reinterpret 06:20 as America/Chicago and emit 11:20Z evidence.
    const canary = (await client.query(
      PHASE_B_CANARY_QUERY,
      [PHASE_B_CANARY_BUCKET],
    )).rows[0];
    return { identity, ownerRole, runtimeRole, savedSearch, canary };
  });
}

function assertOwnerState(state, now) {
  if (
    state?.identity?.database_name !== REVIEWED_DATABASE_NAME
    || state.identity.current_user_name !== REVIEWED_OWNER_ROLE
    || state.identity.session_user_name !== REVIEWED_OWNER_ROLE
    || !exactOwnerRoleState(state.ownerRole)
    || !exactRuntimeRoleState(state.runtimeRole)
    || !exactPhaseAState(state.savedSearch)
  ) {
    throw new Error("production owner, runtime role, or SavedSearch Phase-A state drifted");
  }
  return assertExactPostSkewCanary(state.canary, now);
}

async function alterCurrentOwnerPasswordWithScram(connectionString, verifier) {
  if (!SCRAM_VERIFIER_PATTERN.test(verifier)) {
    throw new Error("refusing to use an unreviewed SCRAM verifier");
  }
  await withClient(connectionString, "grainline-phase-b-owner-rotate", async (client) => {
    const identity = (await client.query(`
      SELECT current_user AS current_user_name,
             session_user AS session_user_name,
             current_setting('password_encryption') AS password_encryption
    `)).rows[0];
    if (
      identity?.current_user_name !== REVIEWED_OWNER_ROLE
      || identity.session_user_name !== REVIEWED_OWNER_ROLE
      || identity.password_encryption !== "scram-sha-256"
    ) {
      throw new Error("password rotation connection or encryption setting is not reviewed");
    }
    // PostgreSQL stores a valid pre-encrypted SCRAM verifier as-is. Only this
    // one-way verifier can reach SQL text, server activity, or query logs.
    await client.query(`ALTER ROLE CURRENT_USER WITH PASSWORD '${verifier}'`);
  });
}

async function proveOldCredentialRejected(connectionString) {
  const client = createClient(connectionString, "grainline-phase-b-old-owner-rejection");
  try {
    await client.connect();
  } catch (error) {
    if (error?.code === "28P01") return true;
    throw new Error("old owner credential failed for a reason other than password rejection");
  }
  try {
    throw new Error("old owner credential still authenticates after rotation");
  } finally {
    await client.end();
  }
}

async function readOtherOwnerSessionCount(connectionString) {
  return withClient(connectionString, "grainline-phase-b-owner-drain", async (client) => Number(
    (await client.query(`
      SELECT COUNT(*)::integer AS count
        FROM pg_stat_activity
       WHERE datname = current_database()
         AND usename = current_user
         AND backend_type = 'client backend'
         AND pid <> pg_backend_pid()
    `)).rows[0]?.count,
  ));
}

export const realDatabaseOperations = Object.freeze({
  readOwnerState,
  alterCurrentOwnerPassword: alterCurrentOwnerPasswordWithScram,
  proveOldCredentialRejected,
  readOtherOwnerSessionCount,
});

function vercelCliEnvironment(env = process.env) {
  const childEnvironment = { ...env };
  for (const key of ["DATABASE_URL", "DIRECT_URL", "GRANT_AUDIT_DATABASE_URL"]) {
    delete childEnvironment[key];
  }
  return childEnvironment;
}

export function updateProductionDirectUrlWithVercel(newDirectUrl, projectDirectory) {
  assertReviewedVercelCli();
  const result = spawnSync(
    process.execPath,
    [
      REVIEWED_VERCEL_CLI_PATH,
      "env",
      "update",
      "DIRECT_URL",
      "production",
      "--sensitive",
      "--yes",
      "--no-color",
    ],
    {
      cwd: projectDirectory,
      env: vercelCliEnvironment(process.env),
      input: `${newDirectUrl}\n`,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error("Vercel production DIRECT_URL update failed");
  }
  return true;
}

export function readProductionDatabaseMetadataWithVercel(projectDirectory) {
  assertReviewedVercelCli();
  const result = spawnSync(
    process.execPath,
    [
      REVIEWED_VERCEL_CLI_PATH,
      "env",
      "ls",
      "production",
      "--format",
      "json",
      "--no-color",
    ],
    {
      cwd: projectDirectory,
      env: vercelCliEnvironment(process.env),
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error("Vercel production environment metadata read failed");
  }
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    throw new Error("Vercel production environment metadata was not valid JSON");
  }
  const readOne = (key) => {
    const matches = payload?.envs?.filter((entry) => entry?.key === key) ?? [];
    const entry = matches[0];
    if (
      matches.length !== 1
      || entry.type !== "sensitive"
      || !Array.isArray(entry.target)
      || entry.target.length !== 1
      || entry.target[0] !== "production"
      || Object.hasOwn(entry, "value")
      || !Number.isFinite(entry.createdAt)
      || !Number.isFinite(entry.updatedAt)
    ) {
      throw new Error(`Vercel production ${key} metadata does not match the reviewed sensitive shape`);
    }
    return Object.freeze({
      type: entry.type,
      target: [...entry.target],
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    });
  };
  return Object.freeze({
    directUrl: readOne("DIRECT_URL"),
    databaseUrl: readOne("DATABASE_URL"),
  });
}

export function loadReviewedLocalDatabaseEnvironment(env = process.env) {
  const credentialStat = statSync(REVIEWED_LOCAL_CREDENTIAL_PATH);
  if (!credentialStat.isFile() || (credentialStat.mode & 0o077) !== 0) {
    throw new Error("reviewed local database credential file must be a mode-0600 regular file");
  }
  const parsed = dotenv.parse(readFileSync(REVIEWED_LOCAL_CREDENTIAL_PATH));
  const normalizePostgresUrl = (value, label) => {
    let url;
    try {
      url = new URL(required(parsed, value));
    } catch {
      throw new Error(`${label} in the reviewed local credential file is not a valid URL`);
    }
    for (const key of url.searchParams.keys()) {
      if (key !== "sslmode" && key !== "channel_binding") {
        throw new Error(`${label} in the reviewed local credential file has an unreviewed parameter`);
      }
    }
    if (url.port === "") url.port = "5432";
    url.searchParams.set("sslmode", "verify-full");
    url.searchParams.set("channel_binding", "require");
    return url.toString();
  };
  const loaded = {
    ...env,
    DIRECT_URL: normalizePostgresUrl("DIRECT_URL", "DIRECT_URL"),
    RUNTIME_DB_ROLE: REVIEWED_RUNTIME_ROLE,
    MIGRATION_DB_ROLE: REVIEWED_OWNER_ROLE,
  };
  delete loaded.DATABASE_URL;
  delete loaded.GRANT_AUDIT_DATABASE_URL;
  return loaded;
}

export function replaceReviewedLocalDirectUrl(source, rotatedDirectUrl) {
  const matches = source.match(/^DIRECT_URL=.*$/gm) ?? [];
  if (matches.length !== 1) {
    throw new Error("reviewed local credential file must contain exactly one DIRECT_URL assignment");
  }
  return source.replace(/^DIRECT_URL=.*$/m, `DIRECT_URL="${rotatedDirectUrl}"`);
}

export function updateReviewedLocalDirectUrl(rotatedDirectUrl) {
  const identity = parseGuardedNeonDatabaseIdentity(
    rotatedDirectUrl,
    "rotated local DIRECT_URL",
  );
  if (
    identity.endpointId !== REVIEWED_ENDPOINT_ID
    || identity.databaseName !== REVIEWED_DATABASE_NAME
    || identity.region !== REVIEWED_DATABASE_REGION
    || identity.isPooler
    || identity.username !== REVIEWED_OWNER_ROLE
  ) {
    throw new Error("refusing to persist an unreviewed local DIRECT_URL");
  }
  const credentialStat = statSync(REVIEWED_LOCAL_CREDENTIAL_PATH);
  if (!credentialStat.isFile() || (credentialStat.mode & 0o077) !== 0) {
    throw new Error("reviewed local database credential file must remain mode 0600");
  }
  const source = readFileSync(REVIEWED_LOCAL_CREDENTIAL_PATH, "utf8");
  const updated = replaceReviewedLocalDirectUrl(source, rotatedDirectUrl);
  writeFileSync(LOCAL_CREDENTIAL_TEMP_PATH, updated, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  chmodSync(LOCAL_CREDENTIAL_TEMP_PATH, 0o600);
  renameSync(LOCAL_CREDENTIAL_TEMP_PATH, REVIEWED_LOCAL_CREDENTIAL_PATH);
  const persisted = dotenv.parse(readFileSync(REVIEWED_LOCAL_CREDENTIAL_PATH));
  if (persisted.DIRECT_URL !== rotatedDirectUrl) {
    throw new Error("local DIRECT_URL persistence verification failed");
  }
  return true;
}

function defaultWait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function runOwnerRotation(
  config,
  {
    database = realDatabaseOperations,
    updateLocalDirectUrl = updateReviewedLocalDirectUrl,
    updateProductionDirectUrl = updateProductionDirectUrlWithVercel,
    readProductionDatabaseMetadata = readProductionDatabaseMetadataWithVercel,
    verifyVercelProject = assertReviewedVercelProject,
    generatePassword = defaultPasswordGenerator,
    buildVerifier = buildScramSha256Verifier,
    wait = defaultWait,
  } = {},
) {
  const state = {
    vercelProjectVerified: false,
    vercelDatabaseSensitiveMetadataVerified: false,
    localDirectUrlUpdated: false,
    vercelDirectUrlUpdated: false,
    vercelDirectUrlUpdateVerified: false,
    runtimeDatabaseUrlMetadataUnchanged: false,
    databaseCredentialRotationAttempted: false,
    databaseCredentialRotated: false,
    newCredentialVerified: false,
    oldCredentialRejected: false,
    runtimeRolePostureUnchanged: false,
    ownerSessionsDrained: false,
  };
  try {
    verifyVercelProject(config.vercelProjectDirectory);
    state.vercelProjectVerified = true;
    const beforeVercelMetadata = await readProductionDatabaseMetadata(
      config.vercelProjectDirectory,
    );
    state.vercelDatabaseSensitiveMetadataVerified = true;
    const before = await database.readOwnerState(config.currentDirectUrl);
    const canary = assertOwnerState(before, config.now);
    if (config.mode === "preflight-only") {
      return {
        mode: config.mode,
        acceptanceEligible: false,
        state,
        canary,
        vercelDatabaseMetadata: {
          directUrlBeforeUpdatedAt: beforeVercelMetadata.directUrl.updatedAt,
          directUrlAfterUpdatedAt: null,
          databaseUrlBeforeUpdatedAt: beforeVercelMetadata.databaseUrl.updatedAt,
          databaseUrlAfterUpdatedAt: null,
        },
        ownerSessionCount: null,
      };
    }

    const password = generatePassword();
    const rotatedDirectUrl = buildRotatedDirectUrl(config.currentDirectUrl, password);
    const scramVerifier = buildVerifier(password);
    updateLocalDirectUrl(rotatedDirectUrl);
    state.localDirectUrlUpdated = true;

    await updateProductionDirectUrl(rotatedDirectUrl, config.vercelProjectDirectory);
    state.vercelDirectUrlUpdated = true;
    const afterVercelMetadata = await readProductionDatabaseMetadata(
      config.vercelProjectDirectory,
    );
    if (
      afterVercelMetadata.directUrl.updatedAt
        <= beforeVercelMetadata.directUrl.updatedAt
      || afterVercelMetadata.databaseUrl.updatedAt
        !== beforeVercelMetadata.databaseUrl.updatedAt
    ) {
      throw new Error("Vercel production database metadata did not match the bounded DIRECT_URL-only update");
    }
    state.vercelDirectUrlUpdateVerified = true;
    state.runtimeDatabaseUrlMetadataUnchanged = true;

    state.databaseCredentialRotationAttempted = true;
    try {
      await database.alterCurrentOwnerPassword(config.currentDirectUrl, scramVerifier);
    } catch {
      // A connection failure can occur after PostgreSQL commits the ALTER ROLE.
      // Authentication with the new credential below resolves that ambiguity.
    }
    try {
      const after = await database.readOwnerState(rotatedDirectUrl);
      assertOwnerState(after, config.now);
    } catch {
      throw new Error("new owner credential did not authenticate after SCRAM rotation");
    }
    state.databaseCredentialRotated = true;
    state.newCredentialVerified = true;
    state.runtimeRolePostureUnchanged = true;

    await database.proveOldCredentialRejected(config.currentDirectUrl);
    state.oldCredentialRejected = true;

    let ownerSessionCount = null;
    for (let attempt = 1; attempt <= DRAIN_ATTEMPTS; attempt += 1) {
      ownerSessionCount = await database.readOtherOwnerSessionCount(rotatedDirectUrl);
      if (ownerSessionCount === 0) break;
      if (attempt < DRAIN_ATTEMPTS) await wait(DRAIN_INTERVAL_MS);
    }
    if (ownerSessionCount !== 0) {
      throw new Error("owner session drain did not reach zero");
    }
    state.ownerSessionsDrained = true;
    return {
      mode: config.mode,
      acceptanceEligible: true,
      state,
      canary,
      vercelDatabaseMetadata: {
        directUrlBeforeUpdatedAt: beforeVercelMetadata.directUrl.updatedAt,
        directUrlAfterUpdatedAt: afterVercelMetadata.directUrl.updatedAt,
        databaseUrlBeforeUpdatedAt: beforeVercelMetadata.databaseUrl.updatedAt,
        databaseUrlAfterUpdatedAt: afterVercelMetadata.databaseUrl.updatedAt,
      },
      ownerSessionCount,
    };
  } catch (error) {
    error.rotationState = { ...state };
    throw error;
  }
}

export function buildEvidence(config, result, status = "passed") {
  const passed = status === "passed";
  const issues = passed ? [] : [
    "Phase B owner rotation or preflight failed; inspect live state without reusing the old credential",
    ...(result?.rotationState?.localDirectUrlUpdated
      && !result.rotationState.newCredentialVerified
      ? ["Local .env.local holds the proposed new owner secret, but database acceptance is unproved"]
      : []),
    ...(result?.rotationState?.vercelDirectUrlUpdateVerified
      && !result.rotationState.newCredentialVerified
      ? ["Vercel holds the new owner secret, but database acceptance is unproved; reconcile before deployment"]
      : []),
  ];
  return {
    generatedAt: new Date().toISOString(),
    status,
    acceptanceEligible: passed && result?.acceptanceEligible === true,
    issueCount: issues.length,
    phase: "phase-b-owner-rotation",
    mode: config?.mode ?? null,
    releaseCommit: PHASE_B_RELEASE_COMMIT,
    priorDeploymentId: PHASE_A_DEPLOYMENT_ID,
    target: {
      endpointId: REVIEWED_ENDPOINT_ID,
      databaseName: REVIEWED_DATABASE_NAME,
      region: REVIEWED_DATABASE_REGION,
      ownerRole: REVIEWED_OWNER_ROLE,
      runtimeRole: REVIEWED_RUNTIME_ROLE,
    },
    canary: result?.canary ?? null,
    vercelDatabaseMetadata: result?.vercelDatabaseMetadata ?? null,
    checks: result?.state ?? result?.rotationState ?? null,
    ownerSessionCount: result?.ownerSessionCount ?? null,
    issues,
  };
}

function writeEvidence(evidencePath, payload) {
  writeFileSync(evidencePath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(evidencePath, 0o600);
}

async function main() {
  let config;
  try {
    config = parseOwnerRotationConfig(
      loadReviewedLocalDatabaseEnvironment(process.env),
      new Date(),
    );
    const result = await runOwnerRotation(config);
    const payload = buildEvidence(config, result);
    writeEvidence(config.evidencePath, payload);
    process.stdout.write(`${JSON.stringify({
      status: payload.status,
      acceptanceEligible: payload.acceptanceEligible,
      issueCount: payload.issueCount,
      mode: payload.mode,
    })}\n`);
  } catch (error) {
    const evidencePath = config?.evidencePath ?? process.env.PHASE_B_OWNER_ROTATION_EVIDENCE_PATH;
    if (
      typeof evidencePath === "string"
      && path.isAbsolute(evidencePath)
      && path.dirname(evidencePath) === EVIDENCE_DIRECTORY
    ) {
      writeEvidence(evidencePath, buildEvidence(config, {
        rotationState: error?.rotationState ?? null,
      }, "failed"));
    }
    process.stderr.write("Phase B owner rotation/preflight failed; inspect sanitized evidence and live state.\n");
    process.exitCode = 1;
  }
}

const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectExecution) {
  if (Date.now() < Date.parse(PHASE_B_EARLIEST_PROMOTION_AT)) {
    process.stderr.write("Phase B owner rotation/preflight is barred before the reviewed promotion time.\n");
    process.exitCode = 1;
  } else {
    await main();
  }
}
