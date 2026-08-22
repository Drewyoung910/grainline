#!/usr/bin/env node
// Retire the one superseded Production deployment conservatively classified as
// carrying the current pooled runtime password. This closes SellerPayoutEvent's
// direct-table compatibility window before table grants are revoked.
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  EXPECTED_AUTHORITY_CONSUMERS,
  EXPECTED_REFERENCE_FILES,
  verifySellerPayoutEventZeroDirectAccess,
  verifySellerPayoutEventZeroDirectAccessAtCommit,
} from "./verify-seller-payout-event-zero-direct-access.mjs";

export const CONFIRMATION = "reviewed-seller-payout-event-predecessor-drain";
export const VERCEL_SCOPE = "drew-youngs-projects";
export const VERCEL_PROJECT = "grainline";
export const VERCEL_CLI_VERSION = "59.0.0";
export const ACTIVE_DEPLOYMENT_STATES = "READY,BUILDING,QUEUED,INITIALIZING";
export const CURRENT_DEPLOYMENT = Object.freeze({
  createdAt: 1786857420805,
  id: "dpl_7PRTnXtMrMNq83ZFPJNeqFtyXZ8h",
  sourceCommit: "e9239463a71860451191344b26dd20b45298f239",
  url: "grainline-qps6dvkab-drew-youngs-projects.vercel.app",
});
export const PREDECESSOR_DEPLOYMENT = Object.freeze({
  createdAt: 1786729932642,
  id: "dpl_AGN7CU9du5Ln1EsUxHqJUopdDEsw",
  sourceCommit: "84a58f0fc818b502564ef6bcd974ff4af3cc4395",
  url: "grainline-l8zenc6ym-drew-youngs-projects.vercel.app",
});
export const CANONICAL_ALIASES = Object.freeze([
  "thegrainline.com",
  "www.thegrainline.com",
  "grainline.vercel.app",
  "grainline-drew-youngs-projects.vercel.app",
]);
export const MAX_REQUEST_SECONDS = 300;
export const EVIDENCE_DIRECTORY = "/Users/drewyoung/grainline-rollout-evidence";
export const RECOVERY_EVIDENCE_PATH = path.join(
  EVIDENCE_DIRECTORY,
  "database-credential-recovery-20260813.json",
);
export const RECOVERY_EVIDENCE_SHA256 =
  "ed7f8952c1eb5d72aa9d661701c64cc0153eed48f59494e3fe136b2c80e8e943";
export const STATE_PATH = path.join(
  EVIDENCE_DIRECTORY,
  "seller-payout-event-predecessor-drain-state.json",
);

function required(env, key) {
  const value = env[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`missing required ${key}`);
  }
  return value.trim();
}

function positiveInteger(env, key) {
  const value = required(env, key);
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${key} must be a positive integer`);
  return Number(value);
}

function assertPrivateRegularFile(filePath, label) {
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error(`${label} must be a mode-0600 regular file`);
  }
}

function writePrivateJson(filePath, value) {
  if (existsSync(filePath)) throw new Error(`refusing to overwrite ${filePath}`);
  const fd = openSync(filePath, "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  } finally {
    closeSync(fd);
  }
  chmodSync(filePath, 0o600);
  assertPrivateRegularFile(filePath, path.basename(filePath));
}

function replacePrivateJson(filePath, value) {
  const nextPath = `${filePath}.next`;
  if (existsSync(nextPath)) throw new Error(`stale state update exists for ${filePath}`);
  writePrivateJson(nextPath, value);
  renameSync(nextPath, filePath);
  chmodSync(filePath, 0o600);
}

function readPrivateJson(filePath, label) {
  assertPrivateRegularFile(filePath, label);
  const raw = readFileSync(filePath);
  const value = JSON.parse(raw.toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must contain one JSON object`);
  }
  return { raw, value };
}

export function parseConfiguration(env = process.env) {
  if (env.SELLER_PAYOUT_DRAIN_CONFIRM !== CONFIRMATION) {
    throw new Error("SellerPayoutEvent drain confirmation is invalid");
  }
  const operatorCommit = required(env, "SELLER_PAYOUT_DRAIN_OPERATOR_COMMIT");
  if (!/^[a-f0-9]{40}$/.test(operatorCommit)) {
    throw new Error("SellerPayoutEvent drain operator commit is invalid");
  }
  const mainCiRunId = positiveInteger(env, "SELLER_PAYOUT_DRAIN_MAIN_CI_RUN_ID");
  const evidencePath = path.resolve(required(env, "SELLER_PAYOUT_DRAIN_EVIDENCE_PATH"));
  if (
    path.dirname(evidencePath) !== EVIDENCE_DIRECTORY
    || path.basename(evidencePath) !== `seller-payout-event-predecessor-drain-${operatorCommit}.json`
  ) throw new Error("SellerPayoutEvent drain evidence path is not the reviewed path");
  return Object.freeze({ evidencePath, mainCiRunId, operatorCommit });
}

export function readGitState(cwd = process.cwd()) {
  const run = (args) => execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return Object.freeze({
    branch: run(["branch", "--show-current"]),
    head: run(["rev-parse", "HEAD"]),
    status: run(["status", "--porcelain=v1", "--untracked-files=all"]),
  });
}

export function assertGitState(state, expectedCommit) {
  if (
    state?.branch !== "main"
    || state.head !== expectedCommit
    || state.status !== ""
    || !/^[a-f0-9]{40}$/.test(expectedCommit)
  ) throw new Error("SellerPayoutEvent drain requires the exact clean reviewed main commit");
  return Object.freeze({ branch: "main", clean: true, head: expectedCommit });
}

export function parseGitHubCiRun(raw, expectedCommit, expectedRunId) {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (
    value?.databaseId !== expectedRunId
    || value.headSha !== expectedCommit
    || value.conclusion !== "success"
    || value.status !== "completed"
    || value.workflowName !== "CI"
  ) throw new Error("SellerPayoutEvent drain exact-main CI binding did not pass");
  return Object.freeze({ exactCommit: true, passed: true, runId: expectedRunId });
}

export function validateRecoveryEvidence(raw, value) {
  const digest = createHash("sha256").update(raw).digest("hex");
  if (
    digest !== RECOVERY_EVIDENCE_SHA256
    || value?.status !== "passed"
    || value.acceptanceEligible !== true
    || value.issueCount !== 0
    || value.operator?.commit !== "7bf07801152962eca4d3e5e3a0cfe9cb5b88ba89"
    || value.operator?.ciRunId !== 31730856176
    || value.deployment?.replacementId !== "dpl_C3N3PudFHg4GoRMAAZJuz9aNZ5Y6"
    || value.deployment?.sourceCommit !== "69c14c0618ea7ab9c74756422273d17d66db7efa"
    || value.credentials?.runtime?.role !== "grainline_app_runtime"
    || value.credentials.runtime.priorRejected !== true
    || value.credentials.runtime.replacementVerified !== true
    || value.credentials?.owner?.priorRejected !== true
    || value.credentials.owner.replacementVerified !== true
    || value.providerScopeOutsideRecoveryChanged !== false
  ) throw new Error("accepted database credential recovery evidence drifted");
  return Object.freeze({
    earlierDeploymentCredentialsRejected: true,
    replacementDeploymentId: value.deployment.replacementId,
    sha256: digest,
  });
}

export function parseVercelJson(raw) {
  const start = raw.indexOf("{");
  if (start < 0) throw new Error("Vercel did not return JSON");
  return JSON.parse(raw.slice(start));
}

export function validateDeploymentInventory(value, now = Date.now()) {
  const rows = value?.deployments;
  if (!Array.isArray(rows) || rows.length < 2 || value.contextName !== VERCEL_SCOPE) {
    throw new Error("Vercel production deployment inventory shape drifted");
  }
  const expected = [CURRENT_DEPLOYMENT, PREDECESSOR_DEPLOYMENT];
  for (let index = 0; index < expected.length; index += 1) {
    const row = rows[index];
    const deployment = expected[index];
    if (
      row?.name !== VERCEL_PROJECT
      || row.url !== deployment.url
      || row.state !== "READY"
      || row.target !== "production"
      || row.createdAt !== deployment.createdAt
      || (row.meta?.githubCommitSha ?? row.meta?.gitCommitSha) !== deployment.sourceCommit
    ) throw new Error(`Vercel deployment inventory row ${index} drifted`);
  }
  if (rows.slice(2).some((row) => row.createdAt > PREDECESSOR_DEPLOYMENT.createdAt)) {
    throw new Error("an unreviewed deployment may share the current runtime credential");
  }
  const elapsedSeconds = Math.floor((now - CURRENT_DEPLOYMENT.createdAt) / 1000);
  if (elapsedSeconds < MAX_REQUEST_SECONDS) {
    throw new Error("current compatible deployment has not completed the maximum request drain");
  }
  return Object.freeze({
    currentDeploymentId: CURRENT_DEPLOYMENT.id,
    elapsedSeconds,
    sharedCredentialPredecessors: 1,
  });
}

export function validatePostRemovalInventory(value) {
  const rows = value?.deployments;
  const current = rows?.[0];
  if (
    !Array.isArray(rows)
    || rows.length < 1
    || value.contextName !== VERCEL_SCOPE
    || current?.name !== VERCEL_PROJECT
    || current.url !== CURRENT_DEPLOYMENT.url
    || current.state !== "READY"
    || current.target !== "production"
    || current.createdAt !== CURRENT_DEPLOYMENT.createdAt
    || (current.meta?.githubCommitSha ?? current.meta?.gitCommitSha)
      !== CURRENT_DEPLOYMENT.sourceCommit
    || rows.some((row) => row.url === PREDECESSOR_DEPLOYMENT.url)
  ) throw new Error("Vercel post-removal deployment inventory drifted");
  return Object.freeze({ currentDeploymentId: CURRENT_DEPLOYMENT.id, predecessorAbsent: true });
}

export function validateDeploymentInspect(value, expected) {
  if (
    value?.id !== expected.id
    || value.name !== VERCEL_PROJECT
    || value.url !== expected.url
    || value.target !== "production"
    || value.readyState !== "READY"
    || value.createdAt !== expected.createdAt
  ) throw new Error(`Vercel deployment ${expected.id} inspect drifted`);
  const timeouts = (value.builds ?? []).flatMap((build) => build.output ?? [])
    .map((entry) => entry?.lambda?.timeout)
    .filter(Number.isFinite);
  if (timeouts.length === 0 || Math.max(...timeouts) > MAX_REQUEST_SECONDS) {
    throw new Error(`Vercel deployment ${expected.id} timeout boundary drifted`);
  }
  return Object.freeze({ maxRequestSeconds: Math.max(...timeouts), ready: true });
}

export function validateAliasResolution(value, alias) {
  if (
    !CANONICAL_ALIASES.includes(alias)
    || value?.id !== CURRENT_DEPLOYMENT.id
    || value.url !== CURRENT_DEPLOYMENT.url
    || value.target !== "production"
    || value.readyState !== "READY"
  ) throw new Error(`canonical alias ${alias} does not resolve to the compatible deployment`);
  return true;
}

export function validateHealth(status, body) {
  if (status !== 200 || body?.ok !== true || Object.keys(body).length !== 1) {
    throw new Error("canonical production health check failed");
  }
  return true;
}

export function validateState(value, config) {
  if (
    value?.schemaVersion !== 1
    || value.operatorCommit !== config.operatorCommit
    || value.mainCiRunId !== config.mainCiRunId
    || value.currentDeploymentId !== CURRENT_DEPLOYMENT.id
    || value.predecessorDeploymentId !== PREDECESSOR_DEPLOYMENT.id
    || !["removal-authorized", "predecessor-removed"].includes(value.stage)
  ) throw new Error("SellerPayoutEvent drain restart state drifted");
  return Object.freeze(value);
}

function validSourceAccess(sourceAccess) {
  return sourceAccess?.directAccessMatches === 0
    && JSON.stringify(sourceAccess.authorityConsumers) === JSON.stringify(
      [...EXPECTED_AUTHORITY_CONSUMERS].sort(),
    )
    && JSON.stringify(sourceAccess.referenceFiles) === JSON.stringify(
      [...EXPECTED_REFERENCE_FILES].sort(),
    )
    && Number.isSafeInteger(sourceAccess.scannedFiles)
    && sourceAccess.scannedFiles >= 1;
}

export function sanitizedEvidence({
  config,
  deployedSourceAccess,
  inventory,
  recovery,
  sourceAccess,
  startedAt,
}) {
  if (
    !/^[a-f0-9]{40}$/.test(config?.operatorCommit ?? "")
    || !Number.isSafeInteger(config?.mainCiRunId)
    || config.mainCiRunId < 1
    || recovery?.sha256 !== RECOVERY_EVIDENCE_SHA256
    || inventory?.sharedCredentialPredecessors !== 1
    || !Number.isSafeInteger(inventory?.elapsedSeconds)
    || inventory.elapsedSeconds < MAX_REQUEST_SECONDS
    || Number.isNaN(Date.parse(startedAt))
    || !validSourceAccess(sourceAccess)
    || !validSourceAccess(deployedSourceAccess)
    || deployedSourceAccess.sourceCommit !== CURRENT_DEPLOYMENT.sourceCommit
  ) throw new Error("SellerPayoutEvent zero-direct-access evidence input drifted");
  return Object.freeze({
    schemaVersion: 1,
    status: "passed",
    generatedAt: new Date().toISOString(),
    startedAt,
    operator: { commit: config.operatorCommit, mainCiRunId: config.mainCiRunId },
    credentialRecovery: {
      evidenceSha256: recovery.sha256,
      earlierDeploymentCredentialsRejected: true,
    },
    applicationAuthority: {
      deployedTree: deployedSourceAccess,
      operatorTree: { sourceCommit: config.operatorCommit, ...sourceAccess },
      zeroDirectAccess: true,
    },
    deploymentDrain: {
      currentDeploymentId: CURRENT_DEPLOYMENT.id,
      currentSourceCommit: CURRENT_DEPLOYMENT.sourceCommit,
      predecessorDeploymentId: PREDECESSOR_DEPLOYMENT.id,
      predecessorSourceCommit: PREDECESSOR_DEPLOYMENT.sourceCommit,
      sharedCredentialPredecessorsBefore: inventory.sharedCredentialPredecessors,
      sharedCredentialPredecessorsAfter: 0,
      elapsedSeconds: inventory.elapsedSeconds,
      maximumRequestSeconds: MAX_REQUEST_SECONDS,
      predecessorRemoved: true,
      currentAliasesPreserved: true,
      canonicalHealthPassed: true,
    },
    sellerPayoutEvent: {
      migrationsRun: false,
      rlsChanged: false,
      grantsChanged: false,
      providerConfigurationChanged: false,
    },
    secretsRetained: false,
  });
}

export function validateAcceptedEvidence(value, config) {
  if (
    value?.schemaVersion !== 1
    || value.status !== "passed"
    || value.operator?.commit !== config.operatorCommit
    || value.operator?.mainCiRunId !== config.mainCiRunId
    || value.credentialRecovery?.evidenceSha256 !== RECOVERY_EVIDENCE_SHA256
    || value.credentialRecovery?.earlierDeploymentCredentialsRejected !== true
    || value.applicationAuthority?.zeroDirectAccess !== true
    || value.applicationAuthority?.operatorTree?.sourceCommit !== config.operatorCommit
    || !validSourceAccess(value.applicationAuthority.operatorTree)
    || value.applicationAuthority?.deployedTree?.sourceCommit !== CURRENT_DEPLOYMENT.sourceCommit
    || !validSourceAccess(value.applicationAuthority.deployedTree)
    || value.deploymentDrain?.currentDeploymentId !== CURRENT_DEPLOYMENT.id
    || value.deploymentDrain?.currentSourceCommit !== CURRENT_DEPLOYMENT.sourceCommit
    || value.deploymentDrain?.predecessorDeploymentId !== PREDECESSOR_DEPLOYMENT.id
    || value.deploymentDrain?.predecessorSourceCommit !== PREDECESSOR_DEPLOYMENT.sourceCommit
    || value.deploymentDrain?.sharedCredentialPredecessorsBefore !== 1
    || value.deploymentDrain?.sharedCredentialPredecessorsAfter !== 0
    || !Number.isSafeInteger(value.deploymentDrain?.elapsedSeconds)
    || value.deploymentDrain.elapsedSeconds < MAX_REQUEST_SECONDS
    || value.deploymentDrain?.maximumRequestSeconds !== MAX_REQUEST_SECONDS
    || value.deploymentDrain?.predecessorRemoved !== true
    || value.deploymentDrain?.currentAliasesPreserved !== true
    || value.deploymentDrain?.canonicalHealthPassed !== true
    || value.sellerPayoutEvent?.migrationsRun !== false
    || value.sellerPayoutEvent?.rlsChanged !== false
    || value.sellerPayoutEvent?.grantsChanged !== false
    || value.sellerPayoutEvent?.providerConfigurationChanged !== false
    || value.secretsRetained !== false
  ) throw new Error("existing SellerPayoutEvent drain evidence drifted");
  return Object.freeze(value);
}

function runCommand(args, options = {}) {
  return execFileSync(args[0], args.slice(1), {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", options.stderr ?? "ignore"],
    timeout: 60_000,
  });
}

function vercelArgs(...args) {
  return ["npx", "--yes", `vercel@${VERCEL_CLI_VERSION}`, ...args, "--scope", VERCEL_SCOPE];
}

function verifyGitHubCi(config, command = runCommand) {
  const raw = command([
    "gh", "run", "view", String(config.mainCiRunId), "--json",
    "databaseId,headSha,conclusion,status,workflowName",
  ]);
  return parseGitHubCiRun(raw, config.operatorCommit, config.mainCiRunId);
}

function inspectDeployment(id, command = runCommand) {
  return parseVercelJson(command(vercelArgs("inspect", id, "--json")));
}

function listDeployments(command = runCommand) {
  return parseVercelJson(command(vercelArgs(
    "list", VERCEL_PROJECT, "--environment", "production", "--status", ACTIVE_DEPLOYMENT_STATES,
    "--limit", "100", "--json",
  )));
}

async function verifyAliasesAndHealth(command = runCommand, fetchFn = fetch) {
  for (const alias of CANONICAL_ALIASES) {
    validateAliasResolution(inspectDeployment(alias, command), alias);
  }
  const response = await fetchFn("https://thegrainline.com/api/health", {
    cache: "no-store",
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  validateHealth(response.status, await response.json());
}

export function validateInspectAbsentResult(result) {
  const output = `${result?.stdout ?? ""}\n${result?.stderr ?? ""}`;
  if (
    result?.status === 0
    || !/(?:can(?:not|'t) find|could not find|not found|does not exist)/i.test(output)
  ) throw new Error("superseded deployment is still inspectable or absence was not proven");
  return true;
}

function assertPredecessorAbsent(spawnCommand = spawnSync) {
  const args = vercelArgs("inspect", PREDECESSOR_DEPLOYMENT.id, "--json");
  const result = spawnCommand(args[0], args.slice(1), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  validateInspectAbsentResult(result);
}

async function preflight(config, { command = runCommand, fetchFn = fetch, now = Date.now() } = {}) {
  assertGitState(readGitState(), config.operatorCommit);
  verifyGitHubCi(config, command);
  const recovery = readPrivateJson(RECOVERY_EVIDENCE_PATH, "credential recovery evidence");
  const recoveryResult = validateRecoveryEvidence(recovery.raw, recovery.value);
  const inventory = validateDeploymentInventory(listDeployments(command), now);
  validateDeploymentInspect(inspectDeployment(CURRENT_DEPLOYMENT.id, command), CURRENT_DEPLOYMENT);
  validateDeploymentInspect(inspectDeployment(PREDECESSOR_DEPLOYMENT.id, command), PREDECESSOR_DEPLOYMENT);
  const sourceAccess = verifySellerPayoutEventZeroDirectAccess(process.cwd());
  const deployedSourceAccess = verifySellerPayoutEventZeroDirectAccessAtCommit(
    CURRENT_DEPLOYMENT.sourceCommit,
    process.cwd(),
  );
  await verifyAliasesAndHealth(command, fetchFn);
  return { deployedSourceAccess, inventory, recovery: recoveryResult, sourceAccess };
}

export async function executeDrain(
  config,
  { command = runCommand, fetchFn = fetch, now = Date.now(), spawnCommand = spawnSync } = {},
) {
  if (existsSync(config.evidencePath)) {
    const existing = readPrivateJson(config.evidencePath, "SellerPayoutEvent drain evidence").value;
    return validateAcceptedEvidence(existing, config);
  }

  const startedAt = new Date(now).toISOString();
  let state;
  let proof;
  if (existsSync(STATE_PATH)) {
    state = validateState(readPrivateJson(STATE_PATH, "SellerPayoutEvent drain state").value, config);
    assertGitState(readGitState(), config.operatorCommit);
    verifyGitHubCi(config, command);
    const recovery = readPrivateJson(RECOVERY_EVIDENCE_PATH, "credential recovery evidence");
    proof = {
      recovery: validateRecoveryEvidence(recovery.raw, recovery.value),
      inventory: {
        elapsedSeconds: Math.floor((now - CURRENT_DEPLOYMENT.createdAt) / 1000),
        sharedCredentialPredecessors: 1,
      },
      sourceAccess: verifySellerPayoutEventZeroDirectAccess(process.cwd()),
      deployedSourceAccess: verifySellerPayoutEventZeroDirectAccessAtCommit(
        CURRENT_DEPLOYMENT.sourceCommit,
        process.cwd(),
      ),
    };
  } else {
    proof = await preflight(config, { command, fetchFn, now });
    state = {
      schemaVersion: 1,
      stage: "removal-authorized",
      startedAt,
      operatorCommit: config.operatorCommit,
      mainCiRunId: config.mainCiRunId,
      currentDeploymentId: CURRENT_DEPLOYMENT.id,
      predecessorDeploymentId: PREDECESSOR_DEPLOYMENT.id,
    };
    writePrivateJson(STATE_PATH, state);
  }

  validateDeploymentInspect(inspectDeployment(CURRENT_DEPLOYMENT.id, command), CURRENT_DEPLOYMENT);
  await verifyAliasesAndHealth(command, fetchFn);
  const inventoryBefore = listDeployments(command);
  const predecessorPresent = inventoryBefore.deployments?.some(
    (row) => row.url === PREDECESSOR_DEPLOYMENT.url,
  );
  if (predecessorPresent) {
    validateDeploymentInventory(inventoryBefore, now);
    command(vercelArgs("remove", PREDECESSOR_DEPLOYMENT.id, "--yes"), { stderr: "pipe" });
  } else {
    validatePostRemovalInventory(inventoryBefore);
  }

  const inventoryAfter = listDeployments(command);
  validatePostRemovalInventory(inventoryAfter);
  assertPredecessorAbsent(spawnCommand);
  validateDeploymentInspect(inspectDeployment(CURRENT_DEPLOYMENT.id, command), CURRENT_DEPLOYMENT);
  await verifyAliasesAndHealth(command, fetchFn);
  state = { ...state, stage: "predecessor-removed" };
  replacePrivateJson(STATE_PATH, state);

  const evidence = sanitizedEvidence({
    config,
    deployedSourceAccess: proof.deployedSourceAccess,
    inventory: proof.inventory,
    recovery: proof.recovery,
    sourceAccess: proof.sourceAccess,
    startedAt: state.startedAt,
  });
  writePrivateJson(config.evidencePath, evidence);
  unlinkSync(STATE_PATH);
  return evidence;
}

async function main() {
  const mode = process.argv[2];
  if (!new Set(["preflight", "run"]).has(mode)) {
    throw new Error("usage: seller-payout-event-predecessor-drain.mjs preflight|run");
  }
  const config = parseConfiguration();
  if (mode === "preflight") {
    const result = await preflight(config);
    console.log(JSON.stringify({
      sellerPayoutEventPredecessorDrain: "preflight-passed",
      deployedDirectAccessMatches: result.deployedSourceAccess.directAccessMatches,
      directAccessMatches: result.sourceAccess.directAccessMatches,
      sharedCredentialPredecessors: result.inventory.sharedCredentialPredecessors,
    }));
    return;
  }
  const evidence = await executeDrain(config);
  console.log(JSON.stringify({
    sellerPayoutEventPredecessorDrain: evidence.status,
    currentAliasesPreserved: evidence.deploymentDrain.currentAliasesPreserved,
    predecessorRemoved: evidence.deploymentDrain.predecessorRemoved,
    zeroDirectAccess: evidence.applicationAuthority.zeroDirectAccess,
  }));
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
