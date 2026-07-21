#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  chmodSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  auditLiveDatabase,
  collectSavedSearchPolicyIssues,
  deriveGrantInventory,
  readSavedSearchCatalogState,
  readSavedSearchPolicyState,
} from "./audit-runtime-db-grants.mjs";
import {
  PHASE_B_CANARY_BUCKET,
  PHASE_B_CANARY_QUERY,
  PHASE_B_RELEASE_COMMIT,
  REVIEWED_DATABASE_NAME,
  REVIEWED_OWNER_ROLE,
  REVIEWED_RUNTIME_ROLE,
  REVIEWED_VERCEL_CLI_PATH,
  REVIEWED_VERCEL_PROJECT,
  assertExactPostSkewCanary,
  assertReviewedVercelCli,
  assertReviewedVercelProject,
  loadReviewedLocalDatabaseEnvironment,
} from "./saved-search-phase-b-owner-rotation.mjs";
import {
  assertDeterministicPostgresEnvironment,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";

const { Client } = pg;

export const PHASE_B_DEPLOYMENT_ID = "dpl_6nVQx5HBmurzH9iU1vwQLjA6gy2N";
export const PHASE_B_DEPLOYMENT_HOST = "grainline-dgz3lapjl-drew-youngs-projects.vercel.app";
export const PHASE_B_RELEASE_BRANCH = "codex/saved-search-phase-b-20260719";
export const PHASE_B_MIGRATION = "20260720060000_force_saved_search_rls";
export const PHASE_B_DIRECT_URL_UPDATED_AT = 1784661836916;
export const PHASE_B_RUNTIME_URL_UPDATED_AT = 1784476074964;
export const PHASE_A_RUNTIME_PROOF_SHA256 =
  "09d1309617eb2f7b87fbd5b52cbd0190b75b0a3ef931b818ca80ea55338364ae";

const CONFIRMATION = "verify-live-saved-search-phase-b-production";
const EVIDENCE_DIRECTORY = "/Users/drewyoung/grainline-rollout-evidence";
const PROJECT_DIRECTORY = "/Users/drewyoung/grainline";
const RELEASE_DIRECTORY = "/private/tmp/grainline-saved-search-phase-b-release-run";
const PHASE_A_RUNTIME_PROOF_PATH = path.join(
  EVIDENCE_DIRECTORY,
  "saved-search-phase-a-postflight-20260719.json",
);
const REQUIRED_ALIASES = Object.freeze([
  "thegrainline.com",
  "www.thegrainline.com",
  "grainline.vercel.app",
]);
const CONNECTION_TIMEOUT_MS = 10_000;
const STATEMENT_TIMEOUT_MS = 30_000;
const QUERY_TIMEOUT_MS = 35_000;

function required(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${name} is required without surrounding whitespace`);
  }
  return value;
}

export function parseProductionPostflightConfig(env = process.env) {
  if (required(env, "PHASE_B_PRODUCTION_POSTFLIGHT_CONFIRM") !== CONFIRMATION) {
    throw new Error("production postflight confirmation does not match the reviewed value");
  }
  if (required(env, "PHASE_B_PRODUCTION_POSTFLIGHT_RELEASE_COMMIT") !== PHASE_B_RELEASE_COMMIT) {
    throw new Error("production postflight release commit does not match the sealed candidate");
  }
  if (required(env, "PHASE_B_PRODUCTION_POSTFLIGHT_DEPLOYMENT_ID") !== PHASE_B_DEPLOYMENT_ID) {
    throw new Error("production postflight deployment does not match the reviewed deployment");
  }
  const evidencePath = required(env, "PHASE_B_PRODUCTION_POSTFLIGHT_EVIDENCE_PATH");
  if (
    !path.isAbsolute(evidencePath)
    || path.dirname(evidencePath) !== EVIDENCE_DIRECTORY
    || path.extname(evidencePath) !== ".json"
  ) {
    throw new Error("production postflight evidence must be one JSON file in the rollout-evidence directory");
  }
  return Object.freeze({
    generatedAt: new Date().toISOString(),
    evidencePath,
    projectDirectory: PROJECT_DIRECTORY,
    releaseDirectory: RELEASE_DIRECTORY,
  });
}

function cleanChildEnvironment(env = process.env) {
  const child = { ...env };
  for (const key of ["DATABASE_URL", "DIRECT_URL", "GRANT_AUDIT_DATABASE_URL"]) {
    delete child[key];
  }
  return child;
}

function runBounded(command, args, cwd, timeout = 30_000) {
  const result = spawnSync(command, args, {
    cwd,
    env: cleanChildEnvironment(),
    encoding: "utf8",
    timeout,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error("bounded postflight subprocess failed");
  }
  return result.stdout;
}

export function assertSealedReleaseWorktree(releaseDirectory = RELEASE_DIRECTORY) {
  const head = runBounded("git", ["rev-parse", "HEAD"], releaseDirectory).trim();
  const status = runBounded("git", ["status", "--porcelain"], releaseDirectory);
  if (head !== PHASE_B_RELEASE_COMMIT || status !== "") {
    throw new Error("sealed Phase B release worktree is missing, dirty, or at the wrong commit");
  }
  return Object.freeze({ head, clean: true });
}

function parseJsonOutput(source, label) {
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`${label} was not valid JSON`);
  }
}

function readOneSensitiveProductionEnvironment(payload, key) {
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
}

export function normalizeVercelPostflightState(deployment, environmentPayload) {
  const aliases = Array.isArray(deployment?.alias) ? [...deployment.alias].sort() : [];
  const directUrl = readOneSensitiveProductionEnvironment(environmentPayload, "DIRECT_URL");
  const databaseUrl = readOneSensitiveProductionEnvironment(environmentPayload, "DATABASE_URL");
  const runtimeRole = readOneSensitiveProductionEnvironment(environmentPayload, "RUNTIME_DB_ROLE");
  const migrationRole = readOneSensitiveProductionEnvironment(environmentPayload, "MIGRATION_DB_ROLE");
  const phaseGuardRecords = environmentPayload?.envs?.filter(
    (entry) => entry?.key === "SAVED_SEARCH_RLS_DEPLOY_PHASE",
  ) ?? [];
  const state = {
    deployment: {
      id: deployment?.id,
      url: deployment?.url,
      name: deployment?.name,
      projectId: deployment?.projectId,
      ownerId: deployment?.ownerId,
      target: deployment?.target,
      readyState: deployment?.readyState,
      aliases,
      createdAt: deployment?.createdAt,
      source: deployment?.source,
      gitCommitSha: deployment?.meta?.gitCommitSha,
      gitCommitRef: deployment?.meta?.gitCommitRef,
    },
    environment: {
      directUrl,
      databaseUrl,
      runtimeRole,
      migrationRole,
      phaseGuardRecordCount: phaseGuardRecords.length,
    },
  };
  const deploymentMatches =
    state.deployment.id === PHASE_B_DEPLOYMENT_ID
    && state.deployment.url === PHASE_B_DEPLOYMENT_HOST
    && state.deployment.name === REVIEWED_VERCEL_PROJECT.projectName
    && state.deployment.projectId === REVIEWED_VERCEL_PROJECT.projectId
    && state.deployment.ownerId === REVIEWED_VERCEL_PROJECT.orgId
    && state.deployment.target === "production"
    && state.deployment.readyState === "READY"
    && state.deployment.source === "cli"
    && state.deployment.gitCommitSha === PHASE_B_RELEASE_COMMIT
    && state.deployment.gitCommitRef === PHASE_B_RELEASE_BRANCH
    && REQUIRED_ALIASES.every((alias) => aliases.includes(alias));
  const environmentMatches =
    directUrl.updatedAt === PHASE_B_DIRECT_URL_UPDATED_AT
    && databaseUrl.updatedAt === PHASE_B_RUNTIME_URL_UPDATED_AT
    && phaseGuardRecords.length === 0;
  return Object.freeze({ ...state, deploymentMatches, environmentMatches });
}

export function readVercelPostflightState(projectDirectory = PROJECT_DIRECTORY) {
  assertReviewedVercelCli();
  assertReviewedVercelProject(projectDirectory);
  const deployment = parseJsonOutput(
    runBounded(
      process.execPath,
      [
        REVIEWED_VERCEL_CLI_PATH,
        "api",
        `/v13/deployments/${PHASE_B_DEPLOYMENT_ID}`,
        "--raw",
        "--no-color",
      ],
      projectDirectory,
    ),
    "Vercel production deployment response",
  );
  const environment = parseJsonOutput(
    runBounded(
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
      projectDirectory,
    ),
    "Vercel production environment response",
  );
  return normalizeVercelPostflightState(deployment, environment);
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

function sortedMemberships(role) {
  return Array.isArray(role?.memberships)
    ? [...role.memberships].sort((left, right) => left.localeCompare(right))
    : [];
}

export function exactPhaseBRoleState(ownerRole, runtimeRole) {
  const ownerMembershipOptions = Array.isArray(ownerRole?.membership_options)
    ? ownerRole.membership_options
    : [];
  return ownerRole?.rolname === REVIEWED_OWNER_ROLE
    && ownerRole.rolsuper === false
    && ownerRole.rolcreatedb === true
    && ownerRole.rolcreaterole === true
    && ownerRole.rolinherit === true
    && ownerRole.rolcanlogin === true
    && ownerRole.rolreplication === true
    && ownerRole.rolbypassrls === true
    && JSON.stringify(sortedMemberships(ownerRole))
      === JSON.stringify([REVIEWED_RUNTIME_ROLE, "neon_superuser"].sort())
    && ownerMembershipOptions.length === 2
    && ownerMembershipOptions.some((membership) => (
      membership.role === REVIEWED_RUNTIME_ROLE
      && membership.adminOption === true
      && membership.inheritOption === false
      && membership.setOption === false
    ))
    && ownerMembershipOptions.some((membership) => (
      membership.role === "neon_superuser"
      && membership.adminOption === false
      && membership.inheritOption === true
      && membership.setOption === true
    ))
    && runtimeRole?.rolname === REVIEWED_RUNTIME_ROLE
    && runtimeRole.rolsuper === false
    && runtimeRole.rolcreatedb === false
    && runtimeRole.rolcreaterole === false
    && runtimeRole.rolinherit === false
    && runtimeRole.rolcanlogin === true
    && runtimeRole.rolreplication === false
    && runtimeRole.rolbypassrls === false
    && sortedMemberships(runtimeRole).length === 0
    && Array.isArray(runtimeRole.membership_options)
    && runtimeRole.membership_options.length === 0;
}

function sanitizePolicy(row) {
  return Object.freeze({
    policy_name: row.policy_name,
    policy_command: row.policy_command,
    policy_permissive: row.policy_permissive,
    policy_roles: Array.isArray(row.policy_roles) ? [...row.policy_roles] : row.policy_roles,
    using_expression: row.using_expression,
    check_expression: row.check_expression,
  });
}

export async function readProductionDatabasePostflight(
  connectionString,
  releaseDirectory = RELEASE_DIRECTORY,
  now = new Date(),
) {
  assertDeterministicPostgresEnvironment(process.env, "Phase B production postflight");
  const inventory = deriveGrantInventory(releaseDirectory);
  const client = new Client({
    ...postgresChannelBindingClientOptions(new URL(connectionString)),
    connectionString,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
    application_name: "grainline-phase-b-production-postflight",
  });
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const identity = (await client.query(`
      SELECT current_database() AS database_name,
             current_user AS current_user_name,
             session_user AS session_user_name
    `)).rows[0];
    const ownerRole = await readRole(client, REVIEWED_OWNER_ROLE);
    const runtimeRole = await readRole(client, REVIEWED_RUNTIME_ROLE);
    const savedSearchOwner = (await client.query(`
      SELECT pg_get_userbyid(c.relowner) AS owner_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = 'SavedSearch'
         AND c.relkind IN ('r', 'p')
    `)).rows[0]?.owner_name;
    const catalog = await readSavedSearchCatalogState(client);
    const policies = await readSavedSearchPolicyState(client);
    const policyIssues = collectSavedSearchPolicyIssues(
      policies,
      REVIEWED_RUNTIME_ROLE,
      true,
    );
    const grantIssues = await auditLiveDatabase({
      client,
      runtimeRole: REVIEWED_RUNTIME_ROLE,
      migrationRole: REVIEWED_OWNER_ROLE,
      inventory,
    });
    const migrationRows = (await client.query(`
      SELECT migration_name,
             finished_at IS NOT NULL AS finished,
             rolled_back_at IS NULL AS not_rolled_back,
             applied_steps_count
        FROM public._prisma_migrations
       WHERE migration_name = $1
       ORDER BY started_at DESC
    `, [PHASE_B_MIGRATION])).rows;
    const canaryRow = (await client.query(
      PHASE_B_CANARY_QUERY,
      [PHASE_B_CANARY_BUCKET],
    )).rows[0];
    const canary = assertExactPostSkewCanary(canaryRow, now);
    const otherOwnerSessionCount = Number((await client.query(`
      SELECT COUNT(*)::integer AS count
        FROM pg_stat_activity
       WHERE datname = current_database()
         AND usename = current_user
         AND backend_type = 'client backend'
         AND pid <> pg_backend_pid()
    `)).rows[0]?.count);
    await client.query("COMMIT");
    const migration = migrationRows[0];
    return Object.freeze({
      identity,
      ownerRole,
      runtimeRole,
      savedSearch: {
        ...catalog,
        owner_name: savedSearchOwner,
      },
      policies: policies.filter((row) => row.policy_name).map(sanitizePolicy),
      policyIssues,
      grantIssues,
      grantInventory: {
        tables: inventory.tables.length,
        enums: inventory.enums.length,
        functions: inventory.functions.length,
        extensions: inventory.extensions.length,
        rlsPolicyTables: inventory.rlsPolicyTables.length,
        sequenceReferences: inventory.sequenceSqlReferences.length,
      },
      migration: migration ? {
        migration_name: migration.migration_name,
        finished: migration.finished,
        not_rolled_back: migration.not_rolled_back,
        applied_steps_count: Number(migration.applied_steps_count),
      } : null,
      migrationRowCount: migrationRows.length,
      canary,
      otherOwnerSessionCount,
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original failure while closing the connection below.
    }
    throw error;
  } finally {
    await client.end();
  }
}

export function readRetainedRuntimeProof(proofPath = PHASE_A_RUNTIME_PROOF_PATH) {
  const proofStat = statSync(proofPath);
  if (!proofStat.isFile() || (proofStat.mode & 0o077) !== 0) {
    throw new Error("retained runtime proof must be a private regular file");
  }
  const source = readFileSync(proofPath);
  const sha256 = createHash("sha256").update(source).digest("hex");
  const proof = parseJsonOutput(source.toString("utf8"), "retained runtime proof");
  const runtimeIdentity = proof?.checks?.runtimeIdentity;
  const runtimeRole = proof?.checks?.runtimeRole;
  const accepted =
    sha256 === PHASE_A_RUNTIME_PROOF_SHA256
    && proof?.status === "passed"
    && proof?.acceptanceEligible === true
    && proof?.issueCount === 0
    && runtimeIdentity?.database === REVIEWED_DATABASE_NAME
    && runtimeIdentity?.role === REVIEWED_RUNTIME_ROLE
    && runtimeIdentity?.contextReset === true
    && runtimeIdentity?.failClosedWithoutContext === true
    && runtimeRole?.rolname === REVIEWED_RUNTIME_ROLE
    && runtimeRole?.rolsuper === false
    && runtimeRole?.rolbypassrls === false
    && runtimeRole?.membership_count === 0;
  return Object.freeze({
    file: path.basename(proofPath),
    sha256,
    accepted,
    scope: "retained direct production runtime no-context denial; Phase B changes FORCE only",
  });
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function readProductionRouteSmokes(fetchImpl = fetch) {
  const request = async (pathname) => fetchImpl(`https://thegrainline.com${pathname}`, {
    redirect: "manual",
    headers: { "user-agent": "Grainline-Phase-B-Postflight/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  const healthResponse = await request("/api/health");
  const healthPayload = await readJsonResponse(healthResponse);
  const browseResponse = await request("/browse");
  const savedSearchResponse = await request("/api/search/saved");
  const savedSearchPayload = await readJsonResponse(savedSearchResponse);
  const accountResponse = await request("/account/saved-searches");
  return Object.freeze({
    health: {
      status: healthResponse.status,
      ok: healthPayload?.ok === true,
      cacheControl: healthResponse.headers.get("cache-control"),
    },
    browse: { status: browseResponse.status },
    signedOutSavedSearchApi: {
      status: savedSearchResponse.status,
      error: savedSearchPayload?.error,
      cacheControl: savedSearchResponse.headers.get("cache-control"),
    },
    signedOutSavedSearchPage: {
      status: accountResponse.status,
      location: accountResponse.headers.get("location"),
    },
  });
}

export function collectProductionPostflightIssues(result) {
  const issues = [];
  const database = result?.database;
  if (
    database?.identity?.database_name !== REVIEWED_DATABASE_NAME
    || database.identity.current_user_name !== REVIEWED_OWNER_ROLE
    || database.identity.session_user_name !== REVIEWED_OWNER_ROLE
  ) issues.push("database identity does not match the reviewed production owner connection");
  if (!exactPhaseBRoleState(database?.ownerRole, database?.runtimeRole)) {
    issues.push("owner or runtime role posture drifted");
  }
  if (
    database?.savedSearch?.schema !== "public"
    || database.savedSearch.table !== "SavedSearch"
    || database.savedSearch.relrowsecurity !== true
    || database.savedSearch.relforcerowsecurity !== true
    || database.savedSearch.policy_count !== 3
    || database.savedSearch.owner_name !== REVIEWED_OWNER_ROLE
  ) issues.push("SavedSearch Phase B catalog state does not match the reviewed contract");
  if (database?.policyIssues?.length !== 0) issues.push("SavedSearch policy definitions drifted");
  if (database?.grantIssues?.length !== 0) issues.push("runtime grant inventory audit failed");
  if (
    database?.migrationRowCount !== 1
    || database?.migration?.migration_name !== PHASE_B_MIGRATION
    || database.migration.finished !== true
    || database.migration.not_rolled_back !== true
    || database.migration.applied_steps_count !== 1
  ) issues.push("Phase B migration record is missing, duplicated, unfinished, or rolled back");
  if (database?.otherOwnerSessionCount !== 0) issues.push("other owner sessions remain after deployment");
  if (!result?.vercel?.deploymentMatches) issues.push("Vercel deployment attestation drifted");
  if (!result?.vercel?.environmentMatches) issues.push("Vercel environment metadata or phase-guard cleanup drifted");
  if (result?.release?.head !== PHASE_B_RELEASE_COMMIT || result?.release?.clean !== true) {
    issues.push("sealed release worktree attestation failed");
  }
  if (result?.runtimeProof?.accepted !== true) issues.push("retained runtime direct-denial proof is missing or drifted");
  const routes = result?.routes;
  if (routes?.health?.status !== 200 || routes.health.ok !== true) {
    issues.push("production health route failed");
  }
  if (routes?.browse?.status !== 200) issues.push("production browse route failed");
  if (
    routes?.signedOutSavedSearchApi?.status !== 401
    || routes.signedOutSavedSearchApi.error !== "Unauthorized"
  ) issues.push("signed-out SavedSearch API boundary failed");
  if (
    routes?.signedOutSavedSearchPage?.status !== 307
    || routes.signedOutSavedSearchPage.location !== "/sign-in?redirect_url=%2Faccount%2Fsaved-searches"
  ) issues.push("signed-out SavedSearch page boundary failed");
  return issues;
}

export async function runProductionPostflight(config, dependencies = {}) {
  const verifyRelease = dependencies.verifyRelease ?? assertSealedReleaseWorktree;
  const readDatabase = dependencies.readDatabase ?? readProductionDatabasePostflight;
  const readVercel = dependencies.readVercel ?? readVercelPostflightState;
  const readRuntimeProof = dependencies.readRuntimeProof ?? readRetainedRuntimeProof;
  const readRoutes = dependencies.readRoutes ?? readProductionRouteSmokes;
  const localEnvironment = dependencies.localEnvironment
    ?? loadReviewedLocalDatabaseEnvironment(process.env);
  const release = verifyRelease(config.releaseDirectory);
  const [database, vercel, runtimeProof, routes] = await Promise.all([
    readDatabase(localEnvironment.DIRECT_URL, config.releaseDirectory, new Date(config.generatedAt)),
    readVercel(config.projectDirectory),
    Promise.resolve(readRuntimeProof()),
    readRoutes(),
  ]);
  const result = { release, database, vercel, runtimeProof, routes };
  return Object.freeze({ ...result, issues: collectProductionPostflightIssues(result) });
}

export function buildProductionPostflightEvidence(config, result, status = "passed") {
  const issues = Array.isArray(result?.issues) ? [...result.issues] : [];
  return {
    generatedAt: config?.generatedAt ?? new Date().toISOString(),
    status,
    acceptanceEligible: status === "passed" && issues.length === 0,
    issueCount: issues.length,
    issues,
    release: result?.release ?? null,
    deployment: result?.vercel?.deployment ?? null,
    environment: result?.vercel?.environment ?? null,
    database: result?.database ?? null,
    retainedRuntimeProof: result?.runtimeProof ?? null,
    routes: result?.routes ?? null,
    followUp: {
      postDeploymentScheduledCanary: "verify the next completed ops-health bucket after deployment; not an activation blocker",
      nextRollout: "externalize DIRECT_URL and MIGRATION_DB_ROLE from application Functions before Notification activation",
    },
  };
}

function writeEvidence(evidencePath, payload) {
  writeFileSync(evidencePath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  chmodSync(evidencePath, 0o600);
}

async function main() {
  let config;
  try {
    config = parseProductionPostflightConfig();
    const result = await runProductionPostflight(config);
    if (result.issues.length > 0) {
      writeEvidence(config.evidencePath, buildProductionPostflightEvidence(config, result, "failed"));
      process.stderr.write("Phase B production postflight failed; inspect sanitized evidence.\n");
      process.exitCode = 1;
      return;
    }
    writeEvidence(config.evidencePath, buildProductionPostflightEvidence(config, result));
    process.stdout.write("Phase B production postflight passed; sanitized evidence written.\n");
  } catch {
    const evidencePath = config?.evidencePath
      ?? process.env.PHASE_B_PRODUCTION_POSTFLIGHT_EVIDENCE_PATH;
    if (
      typeof evidencePath === "string"
      && path.isAbsolute(evidencePath)
      && path.dirname(evidencePath) === EVIDENCE_DIRECTORY
      && path.extname(evidencePath) === ".json"
    ) {
      try {
        writeEvidence(evidencePath, buildProductionPostflightEvidence(config, {}, "failed"));
      } catch {
        // Preserve the primary failure without replacing existing evidence.
      }
    }
    process.stderr.write("Phase B production postflight failed; inspect sanitized evidence and live state.\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
