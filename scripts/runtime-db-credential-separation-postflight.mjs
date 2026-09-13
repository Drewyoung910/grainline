#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  REVIEWED_DATABASE_NAME,
  REVIEWED_DATABASE_REGION,
  REVIEWED_ENDPOINT_ID,
  REVIEWED_OWNER_ROLE,
  REVIEWED_RUNTIME_ROLE,
  REVIEWED_VERCEL_CLI_PATH,
  assertExactPostSkewCanary,
  realDatabaseOperations,
} from "./saved-search-phase-b-owner-rotation.mjs";
import {
  assertProductionMigrationDatabaseState,
  assertProductionMigrationGitState,
  readProductionMigrationDatabaseState,
  readProductionMigrationGitState,
} from "./guard-production-migration-runner.mjs";
import {
  assertVercelRuntimeDatabaseIsolation,
  parseVercelRuntimeDatabaseIdentity,
  privilegedDatabaseEnvironmentKeys,
  unreviewedPostgresUrlEnvironmentKeys,
} from "./guard-runtime-db-env.mjs";
import { postgresChannelBindingClientOptions } from "./postgres-url-safety.mjs";
import {
  MIGRATION_DIGEST_VARIABLE_NAME,
  MIGRATION_SECRET_NAME,
  REVIEWED_GITHUB_REPOSITORY,
  loadSeparationLocalDatabaseEnvironment,
  readGithubMigrationState,
  readPhaseBPostflightProof,
  readVercelIsolationState,
} from "./runtime-db-credential-separation-operator.mjs";
import {
  buildNeonRuntimePoolerUrl,
  readReviewedNeonOwnerRoleMetadata,
  revealReviewedNeonRuntimePassword,
  verifyReviewedNeonTarget,
} from "./neon-owner-password-control.mjs";

const { Client } = pg;

export const POSTFLIGHT_CONFIRMATION = "verify-live-runtime-db-separation";
export const DEPLOYMENT_ID = "dpl_6Y6C3NT81zbhLc6eHJAveCH1Ave8";
export const DEPLOYMENT_SOURCE_COMMIT = "b4f14beaff06831ed2e8d7a35578226b756c1a61";
export const DEPLOYMENT_SOURCE_REF = "codex/rls-runtime-env-separation-20260719";
export const DEPLOYMENT_CI_RUN_ID = 29877480616;
export const MIGRATION_RUN_ID = 29872336361;
export const RESET_RELEASE_COMMIT = "b7c95fd05a832f6e5d806cee4e118e2dd95cdbb3";
export const RESET_EVIDENCE_SHA256 =
  "1b839f0cb3a887c20227ef4a8ddaed3d8560a4d5f0569b7cc094f6d1099830c8";
export const RESET_OWNER_UPDATED_AT = "2026-07-21T22:01:31.000Z";

const RESET_EVIDENCE_PATH =
  "/Users/drewyoung/grainline-rollout-evidence/runtime-db-separation-reset-b7c95fd0-20260721.json";
const EVIDENCE_DIRECTORY = "/Users/drewyoung/grainline-rollout-evidence";
const REVIEWED_GH_PATH = "/opt/homebrew/bin/gh";
const VERCEL_SCOPE = "drew-youngs-projects";
const CUSTOM_ALIASES = Object.freeze([
  "thegrainline.com",
  "www.thegrainline.com",
  "grainline.vercel.app",
]);
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const RUN_ID_PATTERN = /^[1-9][0-9]{7,19}$/;

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

function assertPrivateRegularFile(filePath, label) {
  const stat = lstatSync(filePath);
  if (
    !stat.isFile()
    || (stat.mode & 0o077) !== 0
    || (typeof process.getuid === "function" && stat.uid !== process.getuid())
  ) {
    throw new Error(`${label} must remain a private regular file`);
  }
  return stat;
}

export function parsePostflightConfig(
  env = process.env,
  now = new Date(),
  credentials = {},
) {
  if (env.RUNTIME_DB_SEPARATION_POSTFLIGHT_CONFIRM !== POSTFLIGHT_CONFIRMATION) {
    throw new Error("runtime database separation postflight confirmation is invalid");
  }
  if (
    privilegedDatabaseEnvironmentKeys(env).length > 0
    || unreviewedPostgresUrlEnvironmentKeys(env).length > 0
  ) {
    throw new Error("runtime database separation postflight rejects ambient database credentials");
  }
  const operatorCommit = required(env, "RUNTIME_DB_SEPARATION_POSTFLIGHT_OPERATOR_COMMIT");
  if (!COMMIT_PATTERN.test(operatorCommit)) {
    throw new Error("runtime database separation postflight operator commit is invalid");
  }
  const operatorCiRunIdText = required(
    env,
    "RUNTIME_DB_SEPARATION_POSTFLIGHT_CI_RUN_ID",
  );
  if (!RUN_ID_PATTERN.test(operatorCiRunIdText)) {
    throw new Error("runtime database separation postflight CI run id is invalid");
  }
  const operatorCiRunId = Number(operatorCiRunIdText);
  if (!Number.isSafeInteger(operatorCiRunId)) {
    throw new Error("runtime database separation postflight CI run id is unsafe");
  }
  const evidencePath = required(env, "RUNTIME_DB_SEPARATION_POSTFLIGHT_EVIDENCE_PATH");
  if (
    !path.isAbsolute(evidencePath)
    || path.dirname(evidencePath) !== EVIDENCE_DIRECTORY
    || path.extname(evidencePath) !== ".json"
  ) {
    throw new Error("runtime database separation postflight evidence path is invalid");
  }
  const ownerDirectUrl = credentials.ownerDirectUrl
    ?? loadSeparationLocalDatabaseEnvironment(env).DIRECT_URL;
  const runtimeDatabaseUrl = credentials.runtimeDatabaseUrl ?? null;
  const runtimeGuard = runtimeDatabaseUrl === null
    ? null
    : assertVercelRuntimeDatabaseIsolation({
      VERCEL: "1",
      VERCEL_ENV: "production",
      DATABASE_URL: runtimeDatabaseUrl,
      RUNTIME_DB_ROLE: REVIEWED_RUNTIME_ROLE,
    });
  const ownerIdentity = parseVercelRuntimeDatabaseIdentity(ownerDirectUrl, "DIRECT_URL");
  if (
    ownerIdentity.isPooler
    || ownerIdentity.username !== REVIEWED_OWNER_ROLE
    || ownerIdentity.endpointId !== REVIEWED_ENDPOINT_ID
    || ownerIdentity.databaseName !== REVIEWED_DATABASE_NAME
    || ownerIdentity.region !== REVIEWED_DATABASE_REGION
  ) {
    throw new Error("postflight owner credential does not match the reviewed identity");
  }
  return Object.freeze({
    now,
    operatorCommit,
    operatorCiRunId,
    evidencePath,
    ownerDirectUrl,
    runtimeDatabaseUrl,
    runtimeGuard,
  });
}

export function readAndVerifyResetEvidence(
  filePath = RESET_EVIDENCE_PATH,
  expectedDirectUrlSha256,
) {
  assertPrivateRegularFile(filePath, "reset evidence");
  const source = readFileSync(filePath);
  const sha256 = createHash("sha256").update(source).digest("hex");
  let evidence;
  try {
    evidence = JSON.parse(source.toString("utf8"));
  } catch {
    throw new Error("reset evidence is not valid JSON");
  }
  const terminalChecks = [
    "sourceVerified",
    "phaseBPostflightVerified",
    "vercelStateVerified",
    "vercelRuntimeOnly",
    "githubProtectionVerified",
    "databaseStateVerified",
    "canaryVerified",
    "neonTargetVerified",
    "neonPasswordResetAttempted",
    "neonPasswordResetResponseVerified",
    "neonOperationsFinished",
    "localDirectUrlUpdated",
    "githubCredentialUpdated",
    "githubCredentialMetadataVerified",
    "newCredentialVerified",
    "oldCredentialRejected",
    "ownerSessionsDrained",
    "priorOwnerStateRemoved",
  ];
  if (
    sha256 !== RESET_EVIDENCE_SHA256
    || evidence?.status !== "passed"
    || evidence.acceptanceEligible !== true
    || evidence.issueCount !== 0
    || evidence.mode !== "reset"
    || evidence.releaseCommit !== RESET_RELEASE_COMMIT
    || evidence.directUrlSha256 !== expectedDirectUrlSha256
    || evidence.ownerSessionCount !== 0
    || evidence.neon?.roleUpdatedAtAfter !== RESET_OWNER_UPDATED_AT
    || terminalChecks.some((key) => evidence.checks?.[key] !== true)
  ) {
    throw new Error("accepted reset evidence drifted");
  }
  return Object.freeze({
    file: path.basename(filePath),
    sha256,
    accepted: true,
    oldCredentialRejected: true,
    roleUpdatedAtAfter: evidence.neon.roleUpdatedAtAfter,
  });
}

function sanitizedProviderEnvironment(env = process.env) {
  const child = { ...env };
  for (const [key, value] of Object.entries(child)) {
    if (
      key === "DATABASE_URL"
      || /^PG[A-Z0-9_]*$/.test(key)
      || privilegedDatabaseEnvironmentKeys({ [key]: value }).length > 0
      || (typeof value === "string" && /^postgres(?:ql)?:\/\//i.test(value.trim()))
    ) delete child[key];
  }
  return child;
}

function runJson(command, args, maxBuffer = 4 * 1024 * 1024) {
  const result = spawnSync(command, args, {
    env: sanitizedProviderEnvironment(),
    encoding: "utf8",
    timeout: 45_000,
    maxBuffer,
  });
  if (result.error || result.status !== 0) throw new Error("postflight provider read failed");
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("postflight provider returned invalid JSON");
  }
}

export function normalizeGithubRun(run, expected) {
  if (
    run?.id !== expected.id
    || run.name !== expected.name
    || (expected.event !== null && run.event !== expected.event)
    || run.head_sha !== expected.headSha
    || run.status !== "completed"
    || run.conclusion !== "success"
  ) throw new Error("reviewed GitHub Actions run drifted");
  return Object.freeze({
    id: run.id,
    name: run.name,
    headSha: run.head_sha,
    status: run.status,
    conclusion: run.conclusion,
  });
}

function readGithubRun(id, name, headSha, event = null) {
  const run = runJson(REVIEWED_GH_PATH, [
    "api",
    `repos/${REVIEWED_GITHUB_REPOSITORY}/actions/runs/${id}`,
  ]);
  return normalizeGithubRun(run, { id, name, headSha, event });
}

export function normalizeDeploymentState(deployment, aliasInspections) {
  if (
    deployment?.id !== DEPLOYMENT_ID
    || deployment.readyState !== "READY"
    || deployment.target !== "production"
    || deployment.meta?.gitCommitSha !== DEPLOYMENT_SOURCE_COMMIT
    || deployment.meta.gitCommitRef !== DEPLOYMENT_SOURCE_REF
    || aliasInspections.length !== CUSTOM_ALIASES.length
    || aliasInspections.some((entry, index) => (
      entry.alias !== CUSTOM_ALIASES[index]
      || entry.id !== DEPLOYMENT_ID
      || entry.readyState !== "READY"
      || entry.target !== "production"
    ))
  ) throw new Error("production deployment source or alias state drifted");
  return Object.freeze({
    id: deployment.id,
    sourceCommit: deployment.meta.gitCommitSha,
    sourceRef: deployment.meta.gitCommitRef,
    target: deployment.target,
    readyState: deployment.readyState,
    aliases: aliasInspections.map((entry) => entry.alias),
  });
}

function readDeploymentState() {
  const deployment = runJson(process.execPath, [
    REVIEWED_VERCEL_CLI_PATH,
    "api",
    `/v13/deployments/${DEPLOYMENT_ID}`,
    "--raw",
    "--scope",
    VERCEL_SCOPE,
  ]);
  const aliasInspections = CUSTOM_ALIASES.map((alias) => {
    const inspected = runJson(process.execPath, [
      REVIEWED_VERCEL_CLI_PATH,
      "inspect",
      alias,
      "--format=json",
      "--scope",
      VERCEL_SCOPE,
      "--no-color",
    ], 32 * 1024 * 1024);
    return { ...inspected, alias };
  });
  return normalizeDeploymentState(deployment, aliasInspections);
}

export function normalizeRuntimeRlsProof(before, contextual, after) {
  if (
    before?.current_user_name !== REVIEWED_RUNTIME_ROLE
    || before.session_user_name !== REVIEWED_RUNTIME_ROLE
    || before.rolbypassrls !== false
    || ![null, ""].includes(before.app_user_id)
    || Number(before.saved_search_count) !== 0
    || contextual?.app_user_id !== "grainline_postflight_nonexistent_user"
    || Number(contextual.saved_search_count) !== 0
    || ![null, ""].includes(after?.app_user_id)
    || Number(after.saved_search_count) !== 0
  ) throw new Error("runtime SavedSearch direct denial or context cleanup failed");
  return Object.freeze({
    runtimeRole: before.current_user_name,
    bypassRls: before.rolbypassrls,
    noContextRowCount: Number(before.saved_search_count),
    nonexistentContextRowCount: Number(contextual.saved_search_count),
    cleanupContextCleared: true,
    cleanupRowCount: Number(after.saved_search_count),
  });
}

async function readRuntimeRlsProof(connectionString) {
  const client = new Client({
    connectionString,
    application_name: "grainline-runtime-separation-postflight",
    connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000,
    query_timeout: 25_000,
    ...postgresChannelBindingClientOptions(new URL(connectionString)),
  });
  await client.connect();
  try {
    const queryState = async () => (await client.query(`
      SELECT current_user AS current_user_name,
             session_user AS session_user_name,
             (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS rolbypassrls,
             NULLIF(current_setting('app.user_id', true), '') AS app_user_id,
             (SELECT COUNT(*)::integer FROM public."SavedSearch") AS saved_search_count
    `)).rows[0];
    const before = await queryState();
    await client.query("BEGIN");
    let contextual;
    try {
      await client.query(
        "SELECT set_config('app.user_id', $1, true)",
        ["grainline_postflight_nonexistent_user"],
      );
      contextual = await queryState();
    } finally {
      await client.query("ROLLBACK");
    }
    const after = await queryState();
    return normalizeRuntimeRlsProof(before, contextual, after);
  } finally {
    await client.end();
  }
}

export function normalizeLiveRoutes(routes) {
  const expected = [
    { path: "/", contentTypePrefix: "text/html" },
    { path: "/api/health", contentTypePrefix: "application/json" },
  ];
  if (routes.length !== expected.length || routes.some((route, index) => (
    route.path !== expected[index].path
    || route.status !== 200
    || !route.contentType.startsWith(expected[index].contentTypePrefix)
  ))) throw new Error("live production route proof failed");
  return Object.freeze(routes.map((route) => Object.freeze({ ...route })));
}

async function readLiveRoutes() {
  const routes = [];
  for (const routePath of ["/", "/api/health"]) {
    const response = await fetch(new URL(routePath, "https://thegrainline.com"), {
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    routes.push({
      path: routePath,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
    });
    await response.body?.cancel();
  }
  return normalizeLiveRoutes(routes);
}

export async function runPostflight(config, overrides = {}, reportStage = () => {}) {
  const dependencies = {
    readGitState: readProductionMigrationGitState,
    readResetProof: readAndVerifyResetEvidence,
    readPhaseBProof: readPhaseBPostflightProof,
    readVercelState: readVercelIsolationState,
    readGithubState: readGithubMigrationState,
    readDeploymentState,
    readCiRun: () => readGithubRun(
      DEPLOYMENT_CI_RUN_ID,
      "CI",
      DEPLOYMENT_SOURCE_COMMIT,
      "push",
    ),
    readOperatorCiRun: () => readGithubRun(
      config.operatorCiRunId,
      "CI",
      config.operatorCommit,
      "push",
    ),
    readMigrationRun: () => readGithubRun(
      MIGRATION_RUN_ID,
      "Production Migrations",
      RESET_RELEASE_COMMIT,
      "workflow_dispatch",
    ),
    verifyNeonTarget: verifyReviewedNeonTarget,
    readNeonRole: readReviewedNeonOwnerRoleMetadata,
    readRuntimeDatabaseUrl: () => buildNeonRuntimePoolerUrl(
      revealReviewedNeonRuntimePassword(),
    ),
    readDatabaseState: readProductionMigrationDatabaseState,
    readOwnerState: realDatabaseOperations.readOwnerState,
    readOwnerSessionCount: realDatabaseOperations.readOtherOwnerSessionCount,
    readRuntimeProof: readRuntimeRlsProof,
    readRoutes: readLiveRoutes,
    ...overrides,
  };
  const directUrlSha256 = createHash("sha256").update(config.ownerDirectUrl).digest("hex");
  reportStage("git_checkout");
  const git = assertProductionMigrationGitState(
    dependencies.readGitState(),
    config.operatorCommit,
  );
  reportStage("reset_evidence");
  const resetProof = dependencies.readResetProof(undefined, directUrlSha256);
  reportStage("phase_b_evidence");
  const phaseBProof = dependencies.readPhaseBProof();
  reportStage("vercel_environment");
  const vercel = dependencies.readVercelState();
  if (
    vercel.stage !== "runtime-only"
    || vercel.presentPrivilegedKeys.length !== 0
    || vercel.projectPrivilegedKeys.length !== 0
    || vercel.sharedPrivilegedLinks.length !== 0
  ) throw new Error("Vercel runtime database separation postflight failed");
  reportStage("github_environment");
  const github = dependencies.readGithubState();
  if (
    github.protectionVerified !== true
    || github.migrationSecret?.name !== MIGRATION_SECRET_NAME
    || github.digestVariable?.name !== MIGRATION_DIGEST_VARIABLE_NAME
    || github.digestVariable.value !== directUrlSha256
  ) throw new Error("protected GitHub migration credential metadata drifted");
  reportStage("neon_target");
  dependencies.verifyNeonTarget();
  reportStage("neon_owner_role");
  const neonRole = dependencies.readNeonRole();
  if (neonRole.updatedAt !== RESET_OWNER_UPDATED_AT) {
    throw new Error("Neon owner role timestamp drifted after reset");
  }
  reportStage("owner_database_catalog");
  const database = assertProductionMigrationDatabaseState(
    await dependencies.readDatabaseState(config.ownerDirectUrl),
  );
  reportStage("saved_search_canary");
  const canary = assertExactPostSkewCanary(
    (await dependencies.readOwnerState(config.ownerDirectUrl)).canary,
    config.now,
  );
  reportStage("owner_session_drain");
  const ownerSessionCount = await dependencies.readOwnerSessionCount(config.ownerDirectUrl);
  if (ownerSessionCount !== 0) throw new Error("postflight owner session count is not zero");
  reportStage("runtime_credential_reveal");
  const runtimeDatabaseUrl = config.runtimeDatabaseUrl
    ?? dependencies.readRuntimeDatabaseUrl();
  const runtimeIdentity = config.runtimeGuard
    ?? assertVercelRuntimeDatabaseIsolation({
      VERCEL: "1",
      VERCEL_ENV: "production",
      DATABASE_URL: runtimeDatabaseUrl,
      RUNTIME_DB_ROLE: REVIEWED_RUNTIME_ROLE,
    });
  reportStage("runtime_rls");
  const runtimeProof = await dependencies.readRuntimeProof(runtimeDatabaseUrl);
  reportStage("production_deployment");
  const deployment = dependencies.readDeploymentState();
  reportStage("deployment_ci");
  const ciRun = dependencies.readCiRun();
  reportStage("operator_ci");
  const operatorCiRun = dependencies.readOperatorCiRun();
  reportStage("production_migrations_run");
  const migrationRun = dependencies.readMigrationRun();
  reportStage("live_routes");
  const routes = await dependencies.readRoutes();
  reportStage("complete");
  return Object.freeze({
    git,
    resetProof,
    phaseBProof,
    vercel,
    github: {
      protectionVerified: github.protectionVerified,
      migrationSecretName: github.migrationSecret.name,
      migrationSecretUpdatedAt: github.migrationSecret.updatedAt,
      digestVariableName: github.digestVariable.name,
      digestVariableUpdatedAt: github.digestVariable.updatedAt,
      digestMatchesCurrentOwnerCredential: true,
    },
    neon: { targetVerified: true, roleUpdatedAt: neonRole.updatedAt },
    database,
    canary,
    ownerSessionCount,
    runtimeIdentity,
    runtimeProof,
    deployment,
    ciRun,
    operatorCiRun,
    migrationRun,
    routes,
  });
}

export function buildPostflightEvidence(
  config,
  result,
  status = "passed",
  failureStage = null,
) {
  const passed = status === "passed";
  return Object.freeze({
    version: 1,
    phase: "runtime-db-credential-separation-postflight",
    generatedAt: new Date().toISOString(),
    status,
    acceptanceEligible: passed,
    issueCount: passed ? 0 : 1,
    issues: passed ? [] : ["Runtime database credential separation postflight failed closed"],
    failedStage: passed ? null : failureStage,
    operatorCommit: config?.operatorCommit ?? null,
    deploymentSourceCommit: DEPLOYMENT_SOURCE_COMMIT,
    ...(passed ? result : {}),
  });
}

export function writePostflightEvidence(filePath, evidence) {
  const temporaryPath = `${filePath}.tmp`;
  if (existsSync(filePath) || existsSync(temporaryPath)) {
    throw new Error("postflight evidence destination already exists");
  }
  const descriptor = openSync(temporaryPath, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, filePath);
  chmodSync(filePath, 0o600);
  return true;
}

async function main() {
  let config;
  let stage = "configuration";
  try {
    config = parsePostflightConfig();
    const result = await runPostflight(config, {}, (nextStage) => {
      stage = nextStage;
    });
    const evidence = buildPostflightEvidence(config, result);
    writePostflightEvidence(config.evidencePath, evidence);
    process.stdout.write(`${JSON.stringify({
      status: evidence.status,
      acceptanceEligible: evidence.acceptanceEligible,
      issueCount: evidence.issueCount,
      deploymentId: evidence.deployment.id,
    })}\n`);
  } catch {
    if (config?.evidencePath && !existsSync(config.evidencePath)) {
      try {
        writePostflightEvidence(
          config.evidencePath,
          buildPostflightEvidence(config, null, "failed", stage),
        );
      } catch {
        // Preserve the first failure and avoid emitting provider or credential details.
      }
    }
    process.stderr.write("Runtime database credential separation postflight failed.\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
