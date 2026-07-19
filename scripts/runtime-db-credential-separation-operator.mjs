#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  PHASE_B_EARLIEST_PROMOTION_AT,
  REVIEWED_VERCEL_CLI_PATH,
  REVIEWED_VERCEL_PROJECT_DIRECTORY,
  assertExactPostSkewCanary,
  assertReviewedVercelCli,
  assertReviewedVercelProject,
  buildRotatedDirectUrl,
  buildScramSha256Verifier,
  loadReviewedLocalDatabaseEnvironment,
  realDatabaseOperations,
  updateReviewedLocalDirectUrl,
} from "./saved-search-phase-b-owner-rotation.mjs";
import {
  assertProductionMigrationDatabaseState,
  assertProductionMigrationGitState,
  readProductionMigrationDatabaseState,
  readProductionMigrationGitState,
} from "./guard-production-migration-runner.mjs";
import { privilegedDatabaseEnvironmentKeys } from "./guard-runtime-db-env.mjs";

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

const REVIEWED_GH_PATH = "/opt/homebrew/bin/gh";
const REVIEWED_GH_VERSION_PREFIX = "gh version 2.91.0 ";
const EVIDENCE_DIRECTORY = "/Users/drewyoung/grainline-rollout-evidence";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const MODES = new Set(["preflight-only", "rotate"]);
const DRAIN_ATTEMPTS = 7;
const DRAIN_INTERVAL_MS = 5_000;

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
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
    if (key === "DATABASE_URL" || privilegedDatabaseEnvironmentKeys({ [key]: child[key] }).length) {
      delete child[key];
    }
  }
  return child;
}

function runJson(command, args, { input } = {}) {
  const result = spawnSync(command, args, {
    env: sanitizedChildEnvironment(),
    input,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error("provider CLI command failed");
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

export function readVercelIsolationState() {
  assertReviewedVercelCli();
  assertReviewedVercelProject(REVIEWED_VERCEL_PROJECT_DIRECTORY);
  const payload = runJson(process.execPath, [
    REVIEWED_VERCEL_CLI_PATH,
    "env", "ls", "production", "--format", "json", "--no-color",
  ]);
  const records = payload?.envs ?? [];
  const presentKeys = Object.fromEntries(records.map((entry) => [entry.key, true]));
  const privilegedKeys = privilegedDatabaseEnvironmentKeys(presentKeys);
  const databaseUrls = records.filter((entry) => entry.key === "DATABASE_URL");
  const databaseUrl = databaseUrls[0];
  if (
    privilegedKeys.length !== 0
    || databaseUrls.length !== 1
    || databaseUrl.type !== "sensitive"
    || JSON.stringify(databaseUrl.target) !== JSON.stringify(["production"])
    || Object.hasOwn(databaseUrl, "value")
  ) {
    throw new Error("Vercel production is not runtime-database-only");
  }
  return Object.freeze({
    privilegedKeys,
    databaseUrlUpdatedAt: databaseUrl.updatedAt,
  });
}

export function readGithubMigrationState() {
  assertReviewedGhCli();
  const environment = runJson(REVIEWED_GH_PATH, [
    "api", `repos/${REVIEWED_GITHUB_REPOSITORY}/environments/${REVIEWED_GITHUB_ENVIRONMENT}`,
  ]);
  const policies = runJson(REVIEWED_GH_PATH, [
    "api", `repos/${REVIEWED_GITHUB_REPOSITORY}/environments/${REVIEWED_GITHUB_ENVIRONMENT}/deployment-branch-policies`,
  ]);
  const secrets = runJson(REVIEWED_GH_PATH, [
    "secret", "list", "--repo", REVIEWED_GITHUB_REPOSITORY,
    "--env", REVIEWED_GITHUB_ENVIRONMENT, "--json", "name,updatedAt",
  ]);
  const variables = runJson(REVIEWED_GH_PATH, [
    "variable", "list", "--repo", REVIEWED_GITHUB_REPOSITORY,
    "--env", REVIEWED_GITHUB_ENVIRONMENT, "--json", "name,value,updatedAt",
  ]);
  const reviewers = environment.protection_rules
    ?.find((rule) => rule.type === "required_reviewers")?.reviewers ?? [];
  const branchPolicies = policies.branch_policies ?? [];
  if (
    environment.deployment_branch_policy?.protected_branches !== false
    || environment.deployment_branch_policy?.custom_branch_policies !== true
    || reviewers.length !== 1
    || reviewers[0]?.type !== "User"
    || reviewers[0]?.reviewer?.id !== REVIEWED_GITHUB_REVIEWER.id
    || reviewers[0]?.reviewer?.login !== REVIEWED_GITHUB_REVIEWER.login
    || environment.protection_rules
      ?.find((rule) => rule.type === "required_reviewers")?.prevent_self_review !== false
    || branchPolicies.length !== 1
    || branchPolicies[0]?.name !== "main"
    || branchPolicies[0]?.type !== "branch"
  ) {
    throw new Error("GitHub Production environment protection drifted");
  }
  return Object.freeze({
    migrationSecret: secrets.find((entry) => entry.name === MIGRATION_SECRET_NAME) ?? null,
    digestVariable: variables.find((entry) => entry.name === MIGRATION_DIGEST_VARIABLE_NAME) ?? null,
  });
}

export function updateGithubMigrationCredential(directUrl, digest) {
  assertReviewedGhCli();
  const secret = spawnSync(REVIEWED_GH_PATH, [
    "secret", "set", MIGRATION_SECRET_NAME,
    "--repo", REVIEWED_GITHUB_REPOSITORY,
    "--env", REVIEWED_GITHUB_ENVIRONMENT,
  ], {
    env: sanitizedChildEnvironment(),
    input: `${directUrl}\n`,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (secret.error || secret.status !== 0) throw new Error("GitHub migration secret update failed");
  const variable = spawnSync(REVIEWED_GH_PATH, [
    "variable", "set", MIGRATION_DIGEST_VARIABLE_NAME,
    "--repo", REVIEWED_GITHUB_REPOSITORY,
    "--env", REVIEWED_GITHUB_ENVIRONMENT,
    "--body", digest,
  ], {
    env: sanitizedChildEnvironment(),
    encoding: "utf8",
    timeout: 30_000,
  });
  if (variable.error || variable.status !== 0) throw new Error("GitHub migration digest update failed");
  return true;
}

function defaultPasswordGenerator() {
  return randomBytes(32).toString("base64url");
}

function defaultWait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function runSeparationOperator(config, dependencies = {}) {
  const {
    readGitState = readProductionMigrationGitState,
    readDatabaseState = readProductionMigrationDatabaseState,
    readOwnerState = realDatabaseOperations.readOwnerState,
    readVercelState = readVercelIsolationState,
    readGithubState = readGithubMigrationState,
    updateLocalDirectUrl = updateReviewedLocalDirectUrl,
    updateGithubCredential = updateGithubMigrationCredential,
    alterOwnerPassword = realDatabaseOperations.alterCurrentOwnerPassword,
    proveOldCredentialRejected = realDatabaseOperations.proveOldCredentialRejected,
    readOtherOwnerSessionCount = realDatabaseOperations.readOtherOwnerSessionCount,
    generatePassword = defaultPasswordGenerator,
    buildVerifier = buildScramSha256Verifier,
    wait = defaultWait,
  } = dependencies;
  const state = {
    sourceVerified: false,
    vercelRuntimeOnly: false,
    githubProtectionVerified: false,
    localDirectUrlUpdated: false,
    githubCredentialUpdated: false,
    githubCredentialMetadataVerified: false,
    databaseCredentialRotationAttempted: false,
    newCredentialVerified: false,
    oldCredentialRejected: false,
    ownerSessionsDrained: false,
  };
  try {
    assertProductionMigrationGitState(readGitState(), config.releaseCommit);
    state.sourceVerified = true;
    readVercelState();
    state.vercelRuntimeOnly = true;
    const githubBefore = readGithubState();
    if (githubBefore.migrationSecret || githubBefore.digestVariable) {
      throw new Error("GitHub migration credential must be absent before rotation");
    }
    state.githubProtectionVerified = true;
    assertProductionMigrationDatabaseState(await readDatabaseState(config.currentDirectUrl));
    const ownerState = await readOwnerState(config.currentDirectUrl);
    const canary = assertExactPostSkewCanary(ownerState.canary, config.now);
    if (config.mode === "preflight-only") {
      return { acceptanceEligible: false, state, canary, ownerSessionCount: null };
    }

    const password = generatePassword();
    const rotatedDirectUrl = buildRotatedDirectUrl(config.currentDirectUrl, password);
    const digest = createHash("sha256").update(rotatedDirectUrl).digest("hex");
    const verifier = buildVerifier(password);
    updateLocalDirectUrl(rotatedDirectUrl);
    state.localDirectUrlUpdated = true;
    updateGithubCredential(rotatedDirectUrl, digest);
    state.githubCredentialUpdated = true;
    const githubAfter = readGithubState();
    if (!githubAfter.migrationSecret || githubAfter.digestVariable?.value !== digest) {
      throw new Error("GitHub migration credential metadata proof failed");
    }
    state.githubCredentialMetadataVerified = true;

    state.databaseCredentialRotationAttempted = true;
    try {
      await alterOwnerPassword(config.currentDirectUrl, verifier);
    } catch {
      // New authentication below resolves a post-commit connection failure.
    }
    assertProductionMigrationDatabaseState(await readDatabaseState(rotatedDirectUrl));
    state.newCredentialVerified = true;
    await proveOldCredentialRejected(config.currentDirectUrl);
    state.oldCredentialRejected = true;

    let ownerSessionCount = null;
    for (let attempt = 1; attempt <= DRAIN_ATTEMPTS; attempt += 1) {
      ownerSessionCount = await readOtherOwnerSessionCount(rotatedDirectUrl);
      if (ownerSessionCount === 0) break;
      if (attempt < DRAIN_ATTEMPTS) await wait(DRAIN_INTERVAL_MS);
    }
    if (ownerSessionCount !== 0) throw new Error("owner session drain did not reach zero");
    state.ownerSessionsDrained = true;
    readVercelState();
    return {
      acceptanceEligible: true,
      state,
      canary,
      directUrlSha256: digest,
      ownerSessionCount,
    };
  } catch (error) {
    error.rotationState = { ...state };
    throw error;
  }
}

export function buildSeparationEvidence(config, result, status = "passed") {
  const checks = result?.state ?? result?.rotationState ?? null;
  const issues = status === "passed" ? [] : [
    "Runtime database credential separation preflight or rotation failed",
    ...(checks?.localDirectUrlUpdated && !checks?.newCredentialVerified
      ? ["Local and possibly GitHub hold the proposed credential; database acceptance is unproved"]
      : []),
  ];
  return {
    generatedAt: new Date().toISOString(),
    status,
    acceptanceEligible: status === "passed" && result?.acceptanceEligible === true,
    issueCount: issues.length,
    phase: "runtime-db-credential-separation",
    mode: config?.mode ?? null,
    releaseCommit: config?.releaseCommit ?? null,
    checks,
    canary: result?.canary ?? null,
    directUrlSha256: result?.directUrlSha256 ?? null,
    ownerSessionCount: result?.ownerSessionCount ?? null,
    issues,
  };
}

function writeEvidence(filePath, payload) {
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  chmodSync(filePath, 0o600);
}

async function main() {
  let config;
  try {
    config = parseSeparationOperatorConfig(
      loadReviewedLocalDatabaseEnvironment(process.env),
      new Date(),
    );
    const result = await runSeparationOperator(config);
    const evidence = buildSeparationEvidence(config, result);
    writeEvidence(config.evidencePath, evidence);
    process.stdout.write(`${JSON.stringify({
      status: evidence.status,
      acceptanceEligible: evidence.acceptanceEligible,
      issueCount: evidence.issueCount,
    })}\n`);
  } catch (error) {
    const evidencePath = config?.evidencePath ?? process.env.RUNTIME_DB_SEPARATION_EVIDENCE_PATH;
    if (
      typeof evidencePath === "string"
      && path.isAbsolute(evidencePath)
      && path.dirname(evidencePath) === EVIDENCE_DIRECTORY
    ) {
      writeEvidence(evidencePath, buildSeparationEvidence(config, {
        rotationState: error?.rotationState ?? null,
      }, "failed"));
    }
    process.stderr.write("Runtime database credential separation operator failed.\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
