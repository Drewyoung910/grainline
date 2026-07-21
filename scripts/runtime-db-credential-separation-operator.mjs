#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  PHASE_B_EARLIEST_PROMOTION_AT,
  REVIEWED_VERCEL_CLI_PATH,
  REVIEWED_VERCEL_PROJECT,
  REVIEWED_VERCEL_PROJECT_DIRECTORY,
  assertExactPostSkewCanary,
  assertReviewedVercelCli,
  assertReviewedVercelProject,
  loadReviewedLocalDatabaseEnvironment,
  realDatabaseOperations,
} from "./saved-search-phase-b-owner-rotation.mjs";
import {
  assertProductionMigrationDatabaseState,
  assertProductionMigrationGitState,
  readProductionMigrationDatabaseState,
  readProductionMigrationGitState,
} from "./guard-production-migration-runner.mjs";
import { privilegedDatabaseEnvironmentKeys } from "./guard-runtime-db-env.mjs";
import {
  buildNeonOwnerDirectUrl,
  readReviewedNeonOperation,
  readReviewedNeonOwnerRoleMetadata,
  resetReviewedNeonOwnerPassword,
  revealReviewedNeonOwnerPassword,
  verifyReviewedNeonTarget,
  waitForReviewedNeonOperations,
} from "./neon-owner-password-control.mjs";

export const SEPARATION_CONFIRMATION =
  "rotate-owner-into-protected-github-after-vercel-removal";
export const REVIEWED_GITHUB_REPOSITORY = "Drewyoung910/grainline";
export const REVIEWED_GITHUB_ENVIRONMENT = "Production";
export const REVIEWED_GITHUB_REVIEWER = Object.freeze({
  login: "Drewyoung910",
  id: 234014962,
});
export const MIGRATION_SECRET_NAME = "PRODUCTION_MIGRATION_DIRECT_URL";
export const MIGRATION_DIGEST_VARIABLE_NAME =
  "PRODUCTION_MIGRATION_DIRECT_URL_SHA256";
export const PHASE_B_POSTFLIGHT_SHA256 =
  "768096b53662ec9e8deaf8a3a63e6021ad755464f48b4b01c02fb339f1c78ea4";
export const EXPECTED_PRODUCTION_DATABASE_UPDATED_AT = 1784476074964;
export const EXPECTED_PRODUCTION_RUNTIME_ROLE_UPDATED_AT = 1784476081207;
export const EXPECTED_PRODUCTION_DIRECT_UPDATED_AT = 1784661836916;
export const EXPECTED_PRODUCTION_MIGRATION_ROLE_UPDATED_AT = 1784476084417;
export const EXPECTED_CURRENT_NEON_OWNER_UPDATED_AT =
  "2026-07-21T19:16:14.000Z";

const REVIEWED_GH_PATH = "/opt/homebrew/bin/gh";
const REVIEWED_GH_VERSION_PREFIX = "gh version 2.91.0 ";
const REVIEWED_VERCEL_SCOPE_SLUG = "drew-youngs-projects";
const EVIDENCE_DIRECTORY = "/Users/drewyoung/grainline-rollout-evidence";
const PHASE_B_POSTFLIGHT_PATH = path.join(
  EVIDENCE_DIRECTORY,
  "saved-search-phase-b-production-postflight-20260721.json",
);
const PRIOR_OWNER_STATE_PATH =
  "/Users/drewyoung/grainline/.env.local.runtime-db-separation-prior-owner.json";
export const SEPARATION_LOCAL_CREDENTIAL_PATH =
  "/Users/drewyoung/grainline/.env.migration-owner.local";
const SEPARATION_LOCAL_CREDENTIAL_TEMP_PATH =
  "/Users/drewyoung/grainline/.env.migration-owner.local.tmp";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const MODES = new Set([
  "preflight-only",
  "repair-local",
  "remove-vercel",
  "reset",
  "recover",
]);
const VERIFY_ATTEMPTS = 16;
const VERIFY_INTERVAL_MS = 2_000;
const EVIDENCE_RESERVATION_BYTES = 64 * 1024;

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

export function loadSeparationLocalDatabaseEnvironment(env = process.env) {
  const dedicatedCredentialExists = existsSync(SEPARATION_LOCAL_CREDENTIAL_PATH);
  assertSeparationLocalCredentialSource(env, dedicatedCredentialExists);
  if (!dedicatedCredentialExists) {
    return loadReviewedLocalDatabaseEnvironment(env);
  }
  const credentialStat = lstatSync(SEPARATION_LOCAL_CREDENTIAL_PATH);
  if (
    !credentialStat.isFile()
    || (credentialStat.mode & 0o777) !== 0o600
    || (typeof process.getuid === "function" && credentialStat.uid !== process.getuid())
  ) {
    throw new Error("separation owner credential file must remain a mode-0600 regular file");
  }
  const source = readFileSync(SEPARATION_LOCAL_CREDENTIAL_PATH, "utf8");
  const directUrl = parseSeparationLocalCredentialSource(source);
  const loaded = {
    ...env,
    DIRECT_URL: directUrl,
    RUNTIME_DB_ROLE: "grainline_app_runtime",
    MIGRATION_DB_ROLE: "neondb_owner",
  };
  delete loaded.DATABASE_URL;
  delete loaded.GRANT_AUDIT_DATABASE_URL;
  return loaded;
}

export function assertSeparationLocalCredentialSource(
  env,
  dedicatedCredentialExists,
) {
  if (
    dedicatedCredentialExists !== true
    && env?.RUNTIME_DB_SEPARATION_MODE !== "repair-local"
  ) {
    throw new Error(
      "dedicated separation owner credential is required outside repair-local bootstrap",
    );
  }
  return dedicatedCredentialExists ? "dedicated" : "legacy-bootstrap";
}

export function parseSeparationLocalCredentialSource(source) {
  const match = source.match(/^DIRECT_URL="([^"]+)"\n?$/);
  if (!match) {
    throw new Error("separation owner credential file must contain exactly one quoted DIRECT_URL");
  }
  return buildNeonOwnerDirectUrl(
    match[1],
    decodeURIComponent(new URL(match[1]).password),
  );
}

export function updateSeparationLocalDirectUrl(directUrl) {
  const reviewedDirectUrl = buildNeonOwnerDirectUrl(
    directUrl,
    decodeURIComponent(new URL(directUrl).password),
  );
  writeFileSync(
    SEPARATION_LOCAL_CREDENTIAL_TEMP_PATH,
    formatSeparationLocalCredentialSource(reviewedDirectUrl),
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
  chmodSync(SEPARATION_LOCAL_CREDENTIAL_TEMP_PATH, 0o600);
  renameSync(
    SEPARATION_LOCAL_CREDENTIAL_TEMP_PATH,
    SEPARATION_LOCAL_CREDENTIAL_PATH,
  );
  const persisted = readFileSync(SEPARATION_LOCAL_CREDENTIAL_PATH, "utf8");
  if (persisted !== formatSeparationLocalCredentialSource(reviewedDirectUrl)) {
    throw new Error("separation owner credential persistence verification failed");
  }
  return true;
}

export function formatSeparationLocalCredentialSource(directUrl) {
  const reviewedDirectUrl = buildNeonOwnerDirectUrl(
    directUrl,
    decodeURIComponent(new URL(directUrl).password),
  );
  return `DIRECT_URL="${reviewedDirectUrl}"\n`;
}

export function parseSeparationOperatorConfig(env = process.env, now = new Date()) {
  const mode = required(env, "RUNTIME_DB_SEPARATION_MODE");
  if (!MODES.has(mode)) throw new Error("RUNTIME_DB_SEPARATION_MODE is invalid");
  if (env.RUNTIME_DB_SEPARATION_CONFIRM !== SEPARATION_CONFIRMATION) {
    throw new Error("runtime database separation confirmation is invalid");
  }
  if (now.getTime() < Date.parse(PHASE_B_EARLIEST_PROMOTION_AT)) {
    throw new Error("runtime database separation is barred before the Phase B gate");
  }
  const releaseCommit = required(env, "RUNTIME_DB_SEPARATION_RELEASE_COMMIT");
  if (!COMMIT_PATTERN.test(releaseCommit)) {
    throw new Error("runtime database separation release commit is invalid");
  }
  const evidencePath = required(env, "RUNTIME_DB_SEPARATION_EVIDENCE_PATH");
  if (
    !path.isAbsolute(evidencePath)
    || path.dirname(evidencePath) !== EVIDENCE_DIRECTORY
    || path.extname(evidencePath) !== ".json"
  ) {
    throw new Error("runtime database separation evidence path is invalid");
  }
  return Object.freeze({
    mode,
    now,
    releaseCommit,
    evidencePath,
    currentDirectUrl: required(env, "DIRECT_URL"),
  });
}

function sanitizedChildEnvironment(env = process.env) {
  const child = { ...env };
  for (const key of Object.keys(child)) {
    if (
      key === "DATABASE_URL"
      || /^PG[A-Z0-9_]*$/.test(key)
      || privilegedDatabaseEnvironmentKeys({ [key]: child[key] }).length
      || (
        typeof child[key] === "string"
        && /^postgres(?:ql)?:\/\//i.test(child[key].trim())
      )
    ) {
      delete child[key];
    }
  }
  return child;
}

function runProvider(command, args, { input, json = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: REVIEWED_VERCEL_PROJECT_DIRECTORY,
    env: sanitizedChildEnvironment(),
    input,
    encoding: "utf8",
    timeout: 45_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error("provider CLI command failed");
  if (!json) return true;
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("provider CLI returned invalid JSON");
  }
}

export function assertReviewedGhCli() {
  const result = spawnSync(REVIEWED_GH_PATH, ["--version"], {
    env: sanitizedChildEnvironment(),
    encoding: "utf8",
    timeout: 10_000,
  });
  if (
    result.error
    || result.status !== 0
    || !result.stdout.startsWith(REVIEWED_GH_VERSION_PREFIX)
  ) {
    throw new Error("GitHub CLI does not match the reviewed operator version");
  }
  return true;
}

function exactSensitiveProductionRecord(entry, expectedUpdatedAt) {
  return entry?.type === "sensitive"
    && JSON.stringify(entry.target) === JSON.stringify(["production"])
    && (entry.gitBranch === null || entry.gitBranch === undefined)
    && Object.hasOwn(entry, "value") === false
    && Number.isFinite(entry.createdAt)
    && entry.updatedAt === expectedUpdatedAt;
}

export function normalizeVercelDatabaseEnvironmentState(
  payload,
  sharedPayload = { data: [], pagination: { count: 0, next: null } },
) {
  const records = Array.isArray(payload?.envs) ? payload.envs : [];
  const sharedRecords = sharedPayload?.data;
  if (
    !Array.isArray(sharedRecords)
    || sharedPayload?.pagination?.next !== null
    || sharedPayload?.pagination?.count !== sharedRecords.length
  ) {
    throw new Error("Vercel shared environment inventory is incomplete");
  }
  const linkedSharedRecords = sharedRecords.filter((entry) => (
    Array.isArray(entry?.projectId)
    && entry.projectId.includes(REVIEWED_VERCEL_PROJECT.projectId)
  ));
  if (linkedSharedRecords.some((entry) => (
    typeof entry?.id !== "string"
    || !/^env_[A-Za-z0-9]+$/.test(entry.id)
    || typeof entry?.key !== "string"
    || !Array.isArray(entry.target)
    || Object.hasOwn(entry, "value")
  ))) {
    throw new Error("Vercel linked shared environment metadata is invalid");
  }
  const findExactlyOneProduction = (key) => {
    const matches = records.filter((entry) => (
      entry?.key === key
      && Array.isArray(entry.target)
      && entry.target.includes("production")
    ));
    return matches.length === 1 ? matches[0] : null;
  };
  const databaseUrl = findExactlyOneProduction("DATABASE_URL");
  const runtimeRole = findExactlyOneProduction("RUNTIME_DB_ROLE");
  if (
    !exactSensitiveProductionRecord(databaseUrl, EXPECTED_PRODUCTION_DATABASE_UPDATED_AT)
    || !exactSensitiveProductionRecord(runtimeRole, EXPECTED_PRODUCTION_RUNTIME_ROLE_UPDATED_AT)
  ) {
    throw new Error("Vercel production runtime credential metadata drifted");
  }
  const privileged = records.filter((entry) => (
    privilegedDatabaseEnvironmentKeys({ [entry?.key]: true }).length > 0
  ));
  const unknownPrivileged = privileged.filter(
    (entry) => !["DIRECT_URL", "MIGRATION_DB_ROLE"].includes(entry.key),
  );
  if (unknownPrivileged.length > 0) {
    throw new Error("Vercel contains an unreviewed privileged database variable");
  }
  const misplacedPrivileged = privileged.filter((entry) => (
    JSON.stringify(entry.target) !== JSON.stringify(["production"])
    || (entry.gitBranch !== null && entry.gitBranch !== undefined)
  ));
  if (misplacedPrivileged.length > 0) {
    throw new Error("Vercel contains a privileged database variable outside unscoped Production");
  }
  for (const key of ["DIRECT_URL", "MIGRATION_DB_ROLE"]) {
    if (privileged.filter((entry) => entry.key === key).length > 1) {
      throw new Error("Vercel contains duplicate privileged database variables");
    }
  }
  const directUrl = findExactlyOneProduction("DIRECT_URL");
  const migrationRole = findExactlyOneProduction("MIGRATION_DB_ROLE");
  if (
    directUrl && !exactSensitiveProductionRecord(directUrl, EXPECTED_PRODUCTION_DIRECT_UPDATED_AT)
    || migrationRole && !exactSensitiveProductionRecord(
      migrationRole,
      EXPECTED_PRODUCTION_MIGRATION_ROLE_UPDATED_AT,
    )
  ) {
    throw new Error("Vercel privileged database metadata drifted");
  }
  const phaseGuardCount = records.filter(
    (entry) => entry?.key === "SAVED_SEARCH_RLS_DEPLOY_PHASE",
  ).length;
  if (phaseGuardCount !== 0) throw new Error("temporary SavedSearch deploy guard still exists");
  const sharedPrivilegedLinks = linkedSharedRecords
    .filter((entry) => (
      privilegedDatabaseEnvironmentKeys({ [entry.key]: true }).length > 0
    ))
    .map((entry) => Object.freeze({
      id: entry.id,
      key: entry.key,
      target: [...entry.target],
    }));
  const projectPrivilegedKeys = privileged.map((entry) => entry.key).sort();
  const presentPrivilegedKeys = [...new Set([
    ...projectPrivilegedKeys,
    ...sharedPrivilegedLinks.map((entry) => entry.key),
  ])].sort();
  let stage = "partial-removal";
  if (presentPrivilegedKeys.length === 0) stage = "runtime-only";
  if (
    sharedPrivilegedLinks.length === 0
    && JSON.stringify(projectPrivilegedKeys)
    === JSON.stringify(["DIRECT_URL", "MIGRATION_DB_ROLE"])
  ) stage = "pre-removal";
  return Object.freeze({
    stage,
    presentPrivilegedKeys,
    projectPrivilegedKeys,
    sharedPrivilegedLinks,
    linkedSharedDatabaseKeys: linkedSharedRecords
      .map((entry) => entry.key)
      .filter((key) => key === "DATABASE_URL" || (
        privilegedDatabaseEnvironmentKeys({ [key]: true }).length > 0
      ))
      .sort(),
    databaseUrlUpdatedAt: databaseUrl.updatedAt,
    runtimeRoleUpdatedAt: runtimeRole.updatedAt,
    directUrlUpdatedAt: directUrl?.updatedAt ?? null,
    migrationRoleUpdatedAt: migrationRole?.updatedAt ?? null,
    phaseGuardCount,
  });
}

export function readVercelIsolationState() {
  assertReviewedVercelCli();
  assertReviewedVercelProject(REVIEWED_VERCEL_PROJECT_DIRECTORY);
  const projectEnvironment = runProvider(
    process.execPath,
    [REVIEWED_VERCEL_CLI_PATH, "env", "ls", "--format", "json", "--no-color"],
    { json: true },
  );
  const sharedEnvironment = runProvider(process.execPath, [
    REVIEWED_VERCEL_CLI_PATH,
    "api",
    "/v1/env",
    "--raw",
    "--scope",
    REVIEWED_VERCEL_SCOPE_SLUG,
  ], { json: true });
  return normalizeVercelDatabaseEnvironmentState(
    projectEnvironment,
    sharedEnvironment,
  );
}

export function removeVercelPrivilegedDatabaseEnvironment(before = readVercelIsolationState()) {
  if (!new Set(["pre-removal", "partial-removal", "runtime-only"]).has(before?.stage)) {
    throw new Error("Vercel removal state is invalid");
  }
  for (const key of ["DIRECT_URL", "MIGRATION_DB_ROLE"]) {
    if (!before.projectPrivilegedKeys.includes(key)) continue;
    runProvider(process.execPath, [
      REVIEWED_VERCEL_CLI_PATH,
      "env",
      "rm",
      key,
      "production",
      "--yes",
      "--no-color",
    ]);
  }
  for (const link of before.sharedPrivilegedLinks) {
    runProvider(process.execPath, [
      REVIEWED_VERCEL_CLI_PATH,
      "api",
      `/v1/env/${link.id}/unlink/${REVIEWED_VERCEL_PROJECT.projectId}`,
      "-X",
      "PATCH",
      "-H",
      "Content-Type: application/json",
      "--scope",
      REVIEWED_VERCEL_SCOPE_SLUG,
      "--silent",
      "--no-color",
    ]);
  }
  const after = readVercelIsolationState();
  if (
    after.stage !== "runtime-only"
    || after.databaseUrlUpdatedAt !== before.databaseUrlUpdatedAt
    || after.runtimeRoleUpdatedAt !== before.runtimeRoleUpdatedAt
  ) {
    throw new Error("Vercel privileged database variable removal did not converge safely");
  }
  return after;
}

export function readGithubMigrationState() {
  assertReviewedGhCli();
  const environment = runProvider(REVIEWED_GH_PATH, [
    "api", `repos/${REVIEWED_GITHUB_REPOSITORY}/environments/${REVIEWED_GITHUB_ENVIRONMENT}`,
  ], { json: true });
  const policies = runProvider(REVIEWED_GH_PATH, [
    "api", `repos/${REVIEWED_GITHUB_REPOSITORY}/environments/${REVIEWED_GITHUB_ENVIRONMENT}/deployment-branch-policies`,
  ], { json: true });
  const secrets = runProvider(REVIEWED_GH_PATH, [
    "secret", "list", "--repo", REVIEWED_GITHUB_REPOSITORY,
    "--env", REVIEWED_GITHUB_ENVIRONMENT, "--json", "name,updatedAt",
  ], { json: true });
  const variables = runProvider(REVIEWED_GH_PATH, [
    "variable", "list", "--repo", REVIEWED_GITHUB_REPOSITORY,
    "--env", REVIEWED_GITHUB_ENVIRONMENT, "--json", "name,value,updatedAt",
  ], { json: true });
  const reviewerRule = environment.protection_rules
    ?.find((rule) => rule.type === "required_reviewers");
  const reviewers = reviewerRule?.reviewers ?? [];
  const branchPolicies = policies.branch_policies ?? [];
  if (
    environment.deployment_branch_policy?.protected_branches !== false
    || environment.deployment_branch_policy?.custom_branch_policies !== true
    || reviewers.length !== 1
    || reviewers[0]?.type !== "User"
    || reviewers[0]?.reviewer?.id !== REVIEWED_GITHUB_REVIEWER.id
    || reviewers[0]?.reviewer?.login !== REVIEWED_GITHUB_REVIEWER.login
    || reviewerRule?.prevent_self_review !== false
    || branchPolicies.length !== 1
    || branchPolicies[0]?.name !== "main"
    || branchPolicies[0]?.type !== "branch"
  ) {
    throw new Error("GitHub Production environment protection drifted");
  }
  return Object.freeze({
    protectionVerified: true,
    branchPolicyId: branchPolicies[0].id,
    migrationSecret: secrets.find((entry) => entry.name === MIGRATION_SECRET_NAME) ?? null,
    digestVariable: variables.find((entry) => entry.name === MIGRATION_DIGEST_VARIABLE_NAME) ?? null,
  });
}

export function updateGithubMigrationCredential(directUrl, digest) {
  assertReviewedGhCli();
  runProvider(REVIEWED_GH_PATH, [
    "secret", "set", MIGRATION_SECRET_NAME,
    "--repo", REVIEWED_GITHUB_REPOSITORY,
    "--env", REVIEWED_GITHUB_ENVIRONMENT,
  ], { input: `${directUrl}\n` });
  runProvider(REVIEWED_GH_PATH, [
    "variable", "set", MIGRATION_DIGEST_VARIABLE_NAME,
    "--repo", REVIEWED_GITHUB_REPOSITORY,
    "--env", REVIEWED_GITHUB_ENVIRONMENT,
    "--body", digest,
  ]);
  return true;
}

export function clearGithubMigrationCredential(state = readGithubMigrationState()) {
  assertReviewedGhCli();
  if (state.migrationSecret) {
    runProvider(REVIEWED_GH_PATH, [
      "secret", "delete", MIGRATION_SECRET_NAME,
      "--repo", REVIEWED_GITHUB_REPOSITORY,
      "--env", REVIEWED_GITHUB_ENVIRONMENT,
    ]);
  }
  if (state.digestVariable) {
    runProvider(REVIEWED_GH_PATH, [
      "variable", "delete", MIGRATION_DIGEST_VARIABLE_NAME,
      "--repo", REVIEWED_GITHUB_REPOSITORY,
      "--env", REVIEWED_GITHUB_ENVIRONMENT,
    ]);
  }
  assertEmptyGithubCredential(readGithubMigrationState());
  return true;
}

export function readPhaseBPostflightProof(proofPath = PHASE_B_POSTFLIGHT_PATH) {
  const proofStat = statSync(proofPath);
  if (!proofStat.isFile() || (proofStat.mode & 0o077) !== 0) {
    throw new Error("Phase B postflight proof must be a private regular file");
  }
  const source = readFileSync(proofPath);
  const sha256 = createHash("sha256").update(source).digest("hex");
  let proof;
  try {
    proof = JSON.parse(source.toString("utf8"));
  } catch {
    throw new Error("Phase B postflight proof is not valid JSON");
  }
  if (
    sha256 !== PHASE_B_POSTFLIGHT_SHA256
    || proof?.status !== "passed"
    || proof?.acceptanceEligible !== true
    || proof?.issueCount !== 0
    || proof?.database?.savedSearch?.relrowsecurity !== true
    || proof?.database?.savedSearch?.relforcerowsecurity !== true
    || proof?.database?.savedSearch?.policy_count !== 3
    || proof?.retainedRuntimeProof?.accepted !== true
    || proof?.deployment?.id !== "dpl_6nVQx5HBmurzH9iU1vwQLjA6gy2N"
  ) {
    throw new Error("Phase B production postflight proof drifted");
  }
  return Object.freeze({
    file: path.basename(proofPath),
    sha256,
    accepted: true,
  });
}

export function writePriorOwnerState(priorDirectUrl, roleUpdatedAt) {
  if (existsSync(PRIOR_OWNER_STATE_PATH)) {
    throw new Error("prior-owner recovery state already exists");
  }
  const reviewedDirectUrl = buildNeonOwnerDirectUrl(
    priorDirectUrl,
    decodeURIComponent(new URL(priorDirectUrl).password),
  );
  writeFileSync(PRIOR_OWNER_STATE_PATH, `${JSON.stringify({
    version: 1,
    createdAt: new Date().toISOString(),
    priorDirectUrl: reviewedDirectUrl,
    roleUpdatedAtBefore: roleUpdatedAt,
  })}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  chmodSync(PRIOR_OWNER_STATE_PATH, 0o600);
  return true;
}

export function readPriorOwnerState() {
  const priorStat = statSync(PRIOR_OWNER_STATE_PATH);
  if (!priorStat.isFile() || (priorStat.mode & 0o077) !== 0) {
    throw new Error("prior-owner recovery state must remain a private regular file");
  }
  let prior;
  try {
    prior = JSON.parse(readFileSync(PRIOR_OWNER_STATE_PATH, "utf8"));
  } catch {
    throw new Error("prior-owner recovery state is not valid JSON");
  }
  if (
    prior?.version !== 1
    || typeof prior.priorDirectUrl !== "string"
    || typeof prior.roleUpdatedAtBefore !== "string"
    || !Number.isFinite(Date.parse(prior.roleUpdatedAtBefore))
  ) {
    throw new Error("prior-owner recovery state is invalid");
  }
  const reviewedDirectUrl = buildNeonOwnerDirectUrl(
    prior.priorDirectUrl,
    decodeURIComponent(new URL(prior.priorDirectUrl).password),
  );
  return Object.freeze({ ...prior, priorDirectUrl: reviewedDirectUrl });
}

export function removePriorOwnerState() {
  unlinkSync(PRIOR_OWNER_STATE_PATH);
  return true;
}

export async function inspectOwnerCredential(readDatabaseState, directUrl) {
  try {
    return Object.freeze({ status: "accepted", state: await readDatabaseState(directUrl) });
  } catch (error) {
    if (error?.code === "28P01") return Object.freeze({ status: "rejected", state: null });
    throw new Error("owner credential inspection failed without a definitive password result");
  }
}

function defaultWait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readDatabaseStateWithRetry(readDatabaseState, directUrl, wait) {
  for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt += 1) {
    try {
      return await readDatabaseState(directUrl);
    } catch {
      if (attempt < VERIFY_ATTEMPTS) await wait(VERIFY_INTERVAL_MS);
    }
  }
  throw new Error("new owner credential did not authenticate in the reviewed retry window");
}

async function waitForCredentialRejection(readDatabaseState, directUrl, wait) {
  for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt += 1) {
    const inspected = await inspectOwnerCredential(readDatabaseState, directUrl);
    if (inspected.status === "rejected") return true;
    if (attempt < VERIFY_ATTEMPTS) await wait(VERIFY_INTERVAL_MS);
  }
  throw new Error("superseded deployment owner credential still authenticates");
}

async function drainOwnerSessions(readCount, directUrl, wait) {
  let ownerSessionCount = null;
  for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt += 1) {
    ownerSessionCount = await readCount(directUrl);
    if (ownerSessionCount === 0) return 0;
    if (attempt < VERIFY_ATTEMPTS) await wait(VERIFY_INTERVAL_MS);
  }
  throw new Error("owner session drain did not reach zero");
}

function assertEmptyGithubCredential(state) {
  if (state.migrationSecret || state.digestVariable) {
    throw new Error("GitHub migration credential must be absent before the reset");
  }
}

function assertGithubCredentialMetadata(state, digest) {
  if (!state.migrationSecret || state.digestVariable?.value !== digest) {
    throw new Error("GitHub migration credential metadata proof failed");
  }
}

function roleTimestampAdvanced(before, after) {
  return Number.isFinite(Date.parse(before))
    && Number.isFinite(Date.parse(after))
    && Date.parse(after) > Date.parse(before);
}

function placeCredential({ nextDirectUrl, dependencies, state }) {
  const digest = createHash("sha256").update(nextDirectUrl).digest("hex");
  dependencies.updateLocalDirectUrl(nextDirectUrl);
  state.localDirectUrlUpdated = true;
  dependencies.updateGithubCredential(nextDirectUrl, digest);
  state.githubCredentialUpdated = true;
  assertGithubCredentialMetadata(dependencies.readGithubState(), digest);
  state.githubCredentialMetadataVerified = true;
  return digest;
}

async function verifyCredential({
  priorDirectUrl,
  nextDirectUrl,
  digest,
  dependencies,
  state,
}) {
  assertProductionMigrationDatabaseState(await readDatabaseStateWithRetry(
    dependencies.readDatabaseState,
    nextDirectUrl,
    dependencies.wait,
  ));
  state.newCredentialVerified = true;
  await waitForCredentialRejection(
    dependencies.readDatabaseState,
    priorDirectUrl,
    dependencies.wait,
  );
  state.oldCredentialRejected = true;
  const ownerSessionCount = await drainOwnerSessions(
    dependencies.readOtherOwnerSessionCount,
    nextDirectUrl,
    dependencies.wait,
  );
  state.ownerSessionsDrained = true;
  const vercelAfter = dependencies.readVercelState();
  if (vercelAfter.stage !== "runtime-only") {
    throw new Error("Vercel regained a privileged database variable during rotation");
  }
  state.vercelRuntimeOnly = true;
  state.priorOwnerStateRemovalReady = true;
  return { digest, ownerSessionCount, vercelAfter };
}

export async function runSeparationOperator(config, dependencyOverrides = {}) {
  const dependencies = {
    readGitState: readProductionMigrationGitState,
    readDatabaseState: readProductionMigrationDatabaseState,
    readOwnerState: realDatabaseOperations.readOwnerState,
    readOtherOwnerSessionCount: realDatabaseOperations.readOtherOwnerSessionCount,
    readVercelState: readVercelIsolationState,
    removeVercelEnvironment: removeVercelPrivilegedDatabaseEnvironment,
    readGithubState: readGithubMigrationState,
    updateGithubCredential: updateGithubMigrationCredential,
    clearGithubCredential: clearGithubMigrationCredential,
    updateLocalDirectUrl: updateSeparationLocalDirectUrl,
    readPhaseBProof: readPhaseBPostflightProof,
    verifyNeonTarget: verifyReviewedNeonTarget,
    readNeonRoleMetadata: readReviewedNeonOwnerRoleMetadata,
    resetNeonPassword: resetReviewedNeonOwnerPassword,
    revealNeonPassword: revealReviewedNeonOwnerPassword,
    readNeonOperation: readReviewedNeonOperation,
    waitForNeonOperations: waitForReviewedNeonOperations,
    buildNeonDirectUrl: buildNeonOwnerDirectUrl,
    writePriorOwnerState,
    readPriorOwnerState,
    removePriorOwnerState,
    priorOwnerStateExists: () => existsSync(PRIOR_OWNER_STATE_PATH),
    wait: defaultWait,
    ...dependencyOverrides,
  };
  const state = {
    sourceVerified: false,
    phaseBPostflightVerified: false,
    vercelStateVerified: false,
    vercelRuntimeOnly: false,
    githubProtectionVerified: false,
    databaseStateVerified: false,
    canaryVerified: false,
    neonTargetVerified: false,
    priorOwnerStateWritten: false,
    neonPasswordResetAttempted: false,
    neonPasswordResetResponseVerified: false,
    neonOperationsFinished: false,
    localDirectUrlUpdated: false,
    githubCredentialUpdated: false,
    githubCredentialMetadataVerified: false,
    githubCredentialCleared: false,
    newCredentialVerified: false,
    oldCredentialRejected: false,
    ownerSessionsDrained: false,
    priorOwnerStateRemovalReady: false,
    priorOwnerStateRemoved: false,
  };
  let phaseBProof = null;
  let vercel = null;
  let canary = null;
  let neon = null;
  try {
    assertProductionMigrationGitState(dependencies.readGitState(), config.releaseCommit);
    state.sourceVerified = true;
    phaseBProof = dependencies.readPhaseBProof();
    state.phaseBPostflightVerified = true;
    vercel = dependencies.readVercelState();
    state.vercelStateVerified = true;
    const githubBefore = dependencies.readGithubState();
    state.githubProtectionVerified = true;
    dependencies.verifyNeonTarget();
    state.neonTargetVerified = true;

    if (config.mode === "repair-local") {
      assertEmptyGithubCredential(githubBefore);
      if (dependencies.priorOwnerStateExists()) {
        throw new Error("local repair is barred while prior-owner recovery state exists");
      }
      if (vercel.stage !== "pre-removal") {
        throw new Error("local repair requires the exact pre-removal Vercel state");
      }
      const staleCredential = await inspectOwnerCredential(
        dependencies.readDatabaseState,
        config.currentDirectUrl,
      );
      if (staleCredential.status !== "rejected") {
        throw new Error("local owner credential still authenticates and does not need repair");
      }
      state.oldCredentialRejected = true;
      const roleMetadata = dependencies.readNeonRoleMetadata();
      if (roleMetadata.updatedAt !== EXPECTED_CURRENT_NEON_OWNER_UPDATED_AT) {
        throw new Error("Neon owner timestamp drifted from the reviewed Phase B credential");
      }
      const password = dependencies.revealNeonPassword();
      const nextDirectUrl = dependencies.buildNeonDirectUrl(
        config.currentDirectUrl,
        password,
      );
      if (nextDirectUrl === config.currentDirectUrl) {
        throw new Error("Neon revealed the already rejected local credential");
      }
      assertProductionMigrationDatabaseState(
        await dependencies.readDatabaseState(nextDirectUrl),
      );
      state.databaseStateVerified = true;
      canary = assertExactPostSkewCanary(
        (await dependencies.readOwnerState(nextDirectUrl)).canary,
        config.now,
      );
      state.canaryVerified = true;
      dependencies.updateLocalDirectUrl(nextDirectUrl);
      state.localDirectUrlUpdated = true;
      return {
        acceptanceEligible: false,
        recoveryOutcome: "local-current-owner-reconciled",
        state,
        phaseBProof,
        vercel,
        canary,
        neon: {
          roleUpdatedAtBefore: roleMetadata.updatedAt,
          roleUpdatedAtAfter: roleMetadata.updatedAt,
          operations: [],
        },
        directUrlSha256: createHash("sha256").update(nextDirectUrl).digest("hex"),
        ownerSessionCount: null,
      };
    }

    if (config.mode === "recover") {
      if (vercel.stage !== "runtime-only") {
        throw new Error("recovery requires Vercel to remain runtime-only");
      }
      state.vercelRuntimeOnly = true;
      const prior = dependencies.readPriorOwnerState();
      const priorCredential = await inspectOwnerCredential(
        dependencies.readDatabaseState,
        prior.priorDirectUrl,
      );
      const roleMetadata = dependencies.readNeonRoleMetadata();
      if (priorCredential.status === "accepted") {
        assertProductionMigrationDatabaseState(priorCredential.state);
        if (
          roleMetadata.updatedAt === prior.roleUpdatedAtBefore
          && config.currentDirectUrl === prior.priorDirectUrl
          && !githubBefore.migrationSecret
          && !githubBefore.digestVariable
        ) {
          state.priorOwnerStateRemovalReady = true;
          return {
            acceptanceEligible: false,
            cleanupPriorOwnerState: true,
            recoveryOutcome: "reset-not-completed",
            state,
            phaseBProof,
            vercel,
            canary: null,
            neon: {
              roleUpdatedAtBefore: prior.roleUpdatedAtBefore,
              roleUpdatedAtAfter: roleMetadata.updatedAt,
              operations: [],
            },
            directUrlSha256: null,
            ownerSessionCount: null,
          };
        }
        const revealedPassword = dependencies.revealNeonPassword();
        const revealedDirectUrl = dependencies.buildNeonDirectUrl(
          prior.priorDirectUrl,
          revealedPassword,
        );
        if (revealedDirectUrl === prior.priorDirectUrl) {
          if (config.currentDirectUrl !== prior.priorDirectUrl) {
            dependencies.updateLocalDirectUrl(prior.priorDirectUrl);
            state.localDirectUrlUpdated = true;
          }
          if (githubBefore.migrationSecret || githubBefore.digestVariable) {
            dependencies.clearGithubCredential(githubBefore);
            state.githubCredentialCleared = true;
          }
          state.priorOwnerStateRemovalReady = true;
          return {
            acceptanceEligible: false,
            cleanupPriorOwnerState: true,
            recoveryOutcome: "reset-not-completed-reconciled",
            state,
            phaseBProof,
            vercel,
            canary: null,
            neon: {
              roleUpdatedAtBefore: prior.roleUpdatedAtBefore,
              roleUpdatedAtAfter: roleMetadata.updatedAt,
              operations: [],
            },
            directUrlSha256: null,
            ownerSessionCount: null,
          };
        }
        if (!roleTimestampAdvanced(prior.roleUpdatedAtBefore, roleMetadata.updatedAt)) {
          throw new Error("recovery found a changed password without an advanced role timestamp");
        }
        const digest = placeCredential({
          nextDirectUrl: revealedDirectUrl,
          dependencies,
          state,
        });
        const completion = await verifyCredential({
          priorDirectUrl: prior.priorDirectUrl,
          nextDirectUrl: revealedDirectUrl,
          digest,
          dependencies,
          state,
        });
        neon = {
          roleUpdatedAtBefore: prior.roleUpdatedAtBefore,
          roleUpdatedAtAfter: roleMetadata.updatedAt,
          operations: [],
        };
        return {
          acceptanceEligible: true,
          cleanupPriorOwnerState: true,
          recoveryOutcome: "completed-reset-recovered-after-overlap",
          state,
          phaseBProof,
          vercel: completion.vercelAfter,
          canary: null,
          neon,
          directUrlSha256: completion.digest,
          ownerSessionCount: completion.ownerSessionCount,
        };
      }
      if (!roleTimestampAdvanced(prior.roleUpdatedAtBefore, roleMetadata.updatedAt)) {
        throw new Error("recovery cannot prove a completed owner password reset");
      }
      const password = dependencies.revealNeonPassword();
      const nextDirectUrl = dependencies.buildNeonDirectUrl(
        prior.priorDirectUrl,
        password,
      );
      const digest = placeCredential({
        nextDirectUrl,
        dependencies,
        state,
      });
      const completion = await verifyCredential({
        priorDirectUrl: prior.priorDirectUrl,
        nextDirectUrl,
        digest,
        dependencies,
        state,
      });
      neon = {
        roleUpdatedAtBefore: prior.roleUpdatedAtBefore,
        roleUpdatedAtAfter: roleMetadata.updatedAt,
        operations: [],
      };
      return {
        acceptanceEligible: true,
        cleanupPriorOwnerState: true,
        recoveryOutcome: "completed-reset-recovered",
        state,
        phaseBProof,
        vercel: completion.vercelAfter,
        canary: null,
        neon,
        directUrlSha256: completion.digest,
        ownerSessionCount: completion.ownerSessionCount,
      };
    }

    assertEmptyGithubCredential(githubBefore);
    if (dependencies.priorOwnerStateExists()) {
      throw new Error("prior-owner recovery state exists; use recover mode");
    }
    assertProductionMigrationDatabaseState(
      await dependencies.readDatabaseState(config.currentDirectUrl),
    );
    state.databaseStateVerified = true;
    canary = assertExactPostSkewCanary(
      (await dependencies.readOwnerState(config.currentDirectUrl)).canary,
      config.now,
    );
    state.canaryVerified = true;

    if (config.mode === "preflight-only") {
      if (!new Set(["pre-removal", "runtime-only"]).has(vercel.stage)) {
        throw new Error("preflight found a partial Vercel removal; use remove-vercel mode to converge it");
      }
      return {
        acceptanceEligible: false,
        state,
        phaseBProof,
        vercel,
        canary,
        neon: null,
        directUrlSha256: null,
        ownerSessionCount: null,
      };
    }

    if (config.mode === "remove-vercel") {
      vercel = dependencies.removeVercelEnvironment(vercel);
      if (vercel.stage !== "runtime-only") {
        throw new Error("Vercel privileged database environment removal is incomplete");
      }
      state.vercelRuntimeOnly = true;
      return {
        acceptanceEligible: false,
        state,
        phaseBProof,
        vercel,
        canary,
        neon: null,
        directUrlSha256: null,
        ownerSessionCount: null,
      };
    }

    if (vercel.stage !== "runtime-only") {
      throw new Error("owner reset requires Vercel to be runtime-only first");
    }
    state.vercelRuntimeOnly = true;
    const roleBefore = dependencies.readNeonRoleMetadata();
    dependencies.writePriorOwnerState(config.currentDirectUrl, roleBefore.updatedAt);
    state.priorOwnerStateWritten = true;
    state.neonPasswordResetAttempted = true;
    const reset = dependencies.resetNeonPassword();
    if (!roleTimestampAdvanced(roleBefore.updatedAt, reset.roleUpdatedAt)) {
      throw new Error("Neon owner reset timestamp did not advance");
    }
    const priorPassword = decodeURIComponent(new URL(config.currentDirectUrl).password);
    if (reset.password === priorPassword) {
      throw new Error("Neon owner reset returned the superseded password");
    }
    state.neonPasswordResetResponseVerified = true;
    const nextDirectUrl = dependencies.buildNeonDirectUrl(
      config.currentDirectUrl,
      reset.password,
    );
    const digest = placeCredential({
      nextDirectUrl,
      dependencies,
      state,
    });
    const operations = await dependencies.waitForNeonOperations(
      reset.operations,
      dependencies.readNeonOperation,
      dependencies.wait,
    );
    state.neonOperationsFinished = true;
    const completion = await verifyCredential({
      priorDirectUrl: config.currentDirectUrl,
      nextDirectUrl,
      digest,
      dependencies,
      state,
    });
    neon = {
      roleUpdatedAtBefore: roleBefore.updatedAt,
      roleUpdatedAtAfter: reset.roleUpdatedAt,
      operations,
    };
    return {
      acceptanceEligible: true,
      cleanupPriorOwnerState: true,
      state,
      phaseBProof,
      vercel: completion.vercelAfter,
      canary,
      neon,
      directUrlSha256: completion.digest,
      ownerSessionCount: completion.ownerSessionCount,
    };
  } catch (error) {
    error.separationState = { ...state };
    error.separationPhaseBProof = phaseBProof;
    error.separationVercel = vercel;
    error.separationCanary = canary;
    error.separationNeon = neon;
    throw error;
  }
}

export function buildSeparationEvidence(config, result, status = "passed") {
  const checks = result?.state ?? result?.separationState ?? null;
  const passed = status === "passed";
  const issues = passed ? [] : [
    "Runtime database credential separation step failed closed",
    ...(checks?.neonPasswordResetAttempted && !checks?.newCredentialVerified
      ? ["Neon reset may have completed; retain private prior-owner state and use recover mode before any retry"]
      : []),
  ];
  return {
    generatedAt: new Date().toISOString(),
    status,
    acceptanceEligible: passed
      && result?.acceptanceEligible === true
      && checks?.priorOwnerStateRemoved === true,
    issueCount: issues.length,
    phase: "runtime-db-credential-separation",
    mode: config?.mode ?? null,
    releaseCommit: config?.releaseCommit ?? null,
    checks,
    phaseBPostflight: result?.phaseBProof ?? result?.separationPhaseBProof ?? null,
    vercel: result?.vercel ?? result?.separationVercel ?? null,
    canary: result?.canary ?? result?.separationCanary ?? null,
    neon: result?.neon ?? result?.separationNeon ?? null,
    recoveryOutcome: result?.recoveryOutcome ?? null,
    directUrlSha256: result?.directUrlSha256 ?? null,
    ownerSessionCount: result?.ownerSessionCount ?? null,
    issues,
  };
}

function writeEvidence(filePath, payload) {
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  chmodSync(filePath, 0o600);
}

function reservedEvidencePath(filePath) {
  return `${filePath}.pending`;
}

function writeAllSync(descriptor, buffer, position = 0) {
  let offset = 0;
  while (offset < buffer.length) {
    const written = writeSync(
      descriptor,
      buffer,
      offset,
      buffer.length - offset,
      position + offset,
    );
    if (written <= 0) throw new Error("private evidence write did not make progress");
    offset += written;
  }
}

function reserveEvidenceDestination(filePath) {
  const pendingPath = reservedEvidencePath(filePath);
  if (existsSync(filePath) || existsSync(pendingPath)) {
    throw new Error("runtime database separation evidence destination already exists");
  }
  const descriptor = openSync(pendingPath, "wx", 0o600);
  try {
    writeAllSync(descriptor, Buffer.alloc(EVIDENCE_RESERVATION_BYTES, 0x20));
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(pendingPath, 0o600);
  return pendingPath;
}

function stageReservedEvidence(pendingPath, payload) {
  const serialized = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
  if (serialized.length > EVIDENCE_RESERVATION_BYTES) {
    throw new Error("runtime database separation evidence exceeded its reserved space");
  }
  const descriptor = openSync(pendingPath, "r+");
  try {
    writeAllSync(descriptor, serialized);
    ftruncateSync(descriptor, serialized.length);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function publishReservedEvidence(pendingPath, filePath) {
  renameSync(pendingPath, filePath);
  chmodSync(filePath, 0o600);
}

function publishInterruptedCompletedEvidence(config) {
  const pendingPath = reservedEvidencePath(config.evidencePath);
  if (existsSync(config.evidencePath) || !existsSync(pendingPath)) return null;
  const pendingStat = statSync(pendingPath);
  if (!pendingStat.isFile() || (pendingStat.mode & 0o077) !== 0) {
    throw new Error("pending runtime database separation evidence is not private");
  }
  let evidence;
  try {
    evidence = JSON.parse(readFileSync(pendingPath, "utf8").trim());
  } catch {
    throw new Error("unfinished runtime database separation evidence requires reconciliation");
  }
  if (
    evidence?.status !== "passed"
    || evidence.phase !== "runtime-db-credential-separation"
    || evidence.mode !== config.mode
    || evidence.releaseCommit !== config.releaseCommit
    || evidence.checks?.priorOwnerStateRemoved !== true
    || existsSync(PRIOR_OWNER_STATE_PATH)
  ) {
    throw new Error("pending runtime database separation evidence is not publishable");
  }
  publishReservedEvidence(pendingPath, config.evidencePath);
  return evidence;
}

async function main() {
  let config;
  let pendingEvidencePath = null;
  let preparedSuccessfulEvidence = null;
  let priorOwnerCleanupCompleted = false;
  try {
    config = parseSeparationOperatorConfig(
      loadSeparationLocalDatabaseEnvironment(process.env),
      new Date(),
    );
    const interruptedEvidence = publishInterruptedCompletedEvidence(config);
    if (interruptedEvidence) {
      process.stdout.write(`${JSON.stringify({
        status: interruptedEvidence.status,
        acceptanceEligible: interruptedEvidence.acceptanceEligible,
        issueCount: interruptedEvidence.issueCount,
        mode: interruptedEvidence.mode,
        recoveredPreparedEvidence: true,
      })}\n`);
      return;
    }
    pendingEvidencePath = reserveEvidenceDestination(config.evidencePath);
    const result = await runSeparationOperator(config);
    let finalizedResult = result;
    if (result.cleanupPriorOwnerState === true) {
      if (result.state?.priorOwnerStateRemovalReady !== true) {
        throw new Error("prior-owner recovery state is not ready for final cleanup");
      }
      finalizedResult = {
        ...result,
        state: { ...result.state, priorOwnerStateRemoved: true },
      };
    }
    const evidence = buildSeparationEvidence(config, finalizedResult);
    preparedSuccessfulEvidence = evidence;
    stageReservedEvidence(pendingEvidencePath, evidence);
    if (result.cleanupPriorOwnerState === true) {
      removePriorOwnerState();
      priorOwnerCleanupCompleted = true;
    }
    publishReservedEvidence(pendingEvidencePath, config.evidencePath);
    pendingEvidencePath = null;
    process.stdout.write(`${JSON.stringify({
      status: evidence.status,
      acceptanceEligible: evidence.acceptanceEligible,
      issueCount: evidence.issueCount,
      mode: evidence.mode,
    })}\n`);
  } catch (error) {
    const evidencePath = config?.evidencePath ?? process.env.RUNTIME_DB_SEPARATION_EVIDENCE_PATH;
    if (
      priorOwnerCleanupCompleted
      && preparedSuccessfulEvidence
      && pendingEvidencePath
      && existsSync(pendingEvidencePath)
      && typeof evidencePath === "string"
      && !existsSync(evidencePath)
    ) {
      try {
        publishReservedEvidence(pendingEvidencePath, evidencePath);
        process.stdout.write(`${JSON.stringify({
          status: preparedSuccessfulEvidence.status,
          acceptanceEligible: preparedSuccessfulEvidence.acceptanceEligible,
          issueCount: preparedSuccessfulEvidence.issueCount,
          mode: preparedSuccessfulEvidence.mode,
          recoveredPreparedEvidence: true,
        })}\n`);
        return;
      } catch {
        pendingEvidencePath = null;
      }
    }
    if (
      typeof evidencePath === "string"
      && path.isAbsolute(evidencePath)
      && path.dirname(evidencePath) === EVIDENCE_DIRECTORY
      && path.extname(evidencePath) === ".json"
      && !existsSync(evidencePath)
    ) {
      const failedEvidence = buildSeparationEvidence(config, {
        separationState: error?.separationState ?? null,
        separationPhaseBProof: error?.separationPhaseBProof ?? null,
        separationVercel: error?.separationVercel ?? null,
        separationCanary: error?.separationCanary ?? null,
        separationNeon: error?.separationNeon ?? null,
      }, "failed");
      if (pendingEvidencePath && existsSync(pendingEvidencePath)) {
        stageReservedEvidence(pendingEvidencePath, failedEvidence);
        publishReservedEvidence(pendingEvidencePath, evidencePath);
        pendingEvidencePath = null;
      } else if (!existsSync(reservedEvidencePath(evidencePath))) {
        writeEvidence(evidencePath, failedEvidence);
      }
    }
    process.stderr.write("Runtime database credential separation operator failed.\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
