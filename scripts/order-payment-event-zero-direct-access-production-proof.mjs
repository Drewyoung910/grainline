#!/usr/bin/env node
// Bind the static OrderPaymentEvent zero-direct-access proof to the exact
// current production deployment and the accepted credential-epoch drain.
// This operator reads provider/Git state and writes sanitized local evidence;
// it cannot change production, database posture, grants, or deployments.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  EXPECTED_AUTHORITY_CONSUMERS,
  EXPECTED_FIXED_OPERATIONS,
  EXPECTED_REFERENCE_FILES,
  verifyOrderPaymentEventZeroDirectAccessAtCommit,
} from "./verify-order-payment-event-zero-direct-access.mjs";

export const CONFIRMATION = "reviewed-order-payment-event-zero-direct-access";
export const VERCEL_SCOPE = "drew-youngs-projects";
export const VERCEL_PROJECT = "grainline";
export const VERCEL_CLI_VERSION = "59.10.0";
export const ACTIVE_DEPLOYMENT_STATES = "READY,BUILDING,QUEUED,INITIALIZING";
export const CREDENTIAL_EPOCH_CUTOFF = 1786644755419;
export const MAX_REQUEST_SECONDS = 300;
export const DEPLOYED_SOURCE_COMMIT = "ce7550dae6c417440230f4d596f2239393075f31";
export const CURRENT_DEPLOYMENT = Object.freeze({
  createdAt: 1788114206219,
  id: "dpl_Coyjd6rTXteBV9e4QZtZGFDaiEYc",
  sourceCommit: DEPLOYED_SOURCE_COMMIT,
  url: "grainline-ees25wgos-drew-youngs-projects.vercel.app",
});
export const CANONICAL_ALIASES = Object.freeze([
  "thegrainline.com",
  "www.thegrainline.com",
  "grainline.vercel.app",
  "grainline-drew-youngs-projects.vercel.app",
]);
export const EVIDENCE_DIRECTORY = "/Users/drewyoung/grainline-rollout-evidence";
export const DRAIN_EVIDENCE_PATH = path.join(
  EVIDENCE_DIRECTORY,
  "order-payment-event-credential-epoch-drain-6ce4932adaa4d6b651a2a902d8e731aaad08e259.json",
);
export const DRAIN_EVIDENCE_SHA256 =
  "1596ad71479f7a9bda51b00c94b3ac27bea6adf6a5454eb34e03c35618764e5d";

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

function readPrivateJson(filePath, label) {
  assertPrivateRegularFile(filePath, label);
  const raw = readFileSync(filePath);
  const value = JSON.parse(raw.toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must contain one JSON object`);
  }
  return { raw, value };
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

export function parseConfiguration(env = process.env) {
  if (env.ORDER_PAYMENT_EVENT_ZERO_DIRECT_CONFIRM !== CONFIRMATION) {
    throw new Error("OrderPaymentEvent zero-direct-access confirmation is invalid");
  }
  const operatorCommit = required(env, "ORDER_PAYMENT_EVENT_ZERO_DIRECT_OPERATOR_COMMIT");
  if (!/^[a-f0-9]{40}$/.test(operatorCommit)) {
    throw new Error("OrderPaymentEvent zero-direct-access commit is invalid");
  }
  const mainCiRunId = positiveInteger(env, "ORDER_PAYMENT_EVENT_ZERO_DIRECT_MAIN_CI_RUN_ID");
  const evidencePath = path.resolve(
    required(env, "ORDER_PAYMENT_EVENT_ZERO_DIRECT_EVIDENCE_PATH"),
  );
  if (
    path.dirname(evidencePath) !== EVIDENCE_DIRECTORY
    || path.basename(evidencePath)
      !== `order-payment-event-zero-direct-access-${operatorCommit}.json`
  ) throw new Error("OrderPaymentEvent zero-direct-access evidence path is not reviewed");
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
  ) throw new Error("OrderPaymentEvent zero-direct proof requires exact clean reviewed main");
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
  ) throw new Error("OrderPaymentEvent zero-direct exact-main CI binding did not pass");
  return Object.freeze({ exactCommit: true, passed: true, runId: expectedRunId });
}

export function validateDrainEvidence(raw, value) {
  const digest = createHash("sha256").update(raw).digest("hex");
  if (
    digest !== DRAIN_EVIDENCE_SHA256
    || value?.status !== "passed"
    || value.operator?.commit !== "6ce4932adaa4d6b651a2a902d8e731aaad08e259"
    || value.operator?.mainCiRunId !== 33332817851
    || value.deploymentDrain?.currentDeployment?.id !== CURRENT_DEPLOYMENT.id
    || value.deploymentDrain?.sharedCredentialPredecessorsAfter !== 0
    || value.deploymentDrain?.removedDeployments?.length !== 11
    || value.deploymentDrain?.currentAliasesPreserved !== true
    || value.deploymentDrain?.canonicalHealthPassed !== true
    || value.orderPaymentEvent?.zeroDirectAccessClaimed !== false
    || value.secretsRetained !== false
  ) throw new Error("accepted OrderPaymentEvent credential-epoch drain evidence drifted");
  return Object.freeze({ removedPredecessors: 11, sha256: digest });
}

export function parseVercelJson(raw) {
  const start = raw.indexOf("{");
  if (start < 0) throw new Error("Vercel did not return JSON");
  return JSON.parse(raw.slice(start));
}

function expectedInventoryRow(row) {
  return row?.name === VERCEL_PROJECT
    && row.url === CURRENT_DEPLOYMENT.url
    && row.state === "READY"
    && row.target === "production"
    && row.createdAt === CURRENT_DEPLOYMENT.createdAt
    && (row.meta?.githubCommitSha ?? row.meta?.gitCommitSha) === DEPLOYED_SOURCE_COMMIT;
}

export function validateDeploymentInventory(value) {
  const rows = value?.deployments;
  if (!Array.isArray(rows) || rows.length < 1 || value.contextName !== VERCEL_SCOPE) {
    throw new Error("Vercel production deployment inventory shape drifted");
  }
  if (Number.isFinite(value.pagination?.next) && value.pagination.next >= CREDENTIAL_EPOCH_CUTOFF) {
    throw new Error("Vercel inventory page does not cover the complete credential epoch");
  }
  const epochRows = rows.filter((row) => row.createdAt >= CREDENTIAL_EPOCH_CUTOFF);
  if (epochRows.length !== 1 || !expectedInventoryRow(epochRows[0])) {
    throw new Error("OrderPaymentEvent drained deployment epoch drifted");
  }
  return Object.freeze({
    currentDeploymentId: CURRENT_DEPLOYMENT.id,
    currentSourceCommit: DEPLOYED_SOURCE_COMMIT,
    sharedCredentialPredecessors: 0,
  });
}

export function validateDeploymentInspect(value) {
  if (
    value?.id !== CURRENT_DEPLOYMENT.id
    || value.name !== VERCEL_PROJECT
    || value.url !== CURRENT_DEPLOYMENT.url
    || value.target !== "production"
    || value.readyState !== "READY"
    || value.createdAt !== CURRENT_DEPLOYMENT.createdAt
  ) throw new Error("current OrderPaymentEvent deployment inspect drifted");
  const timeouts = (value.builds ?? []).flatMap((build) => build.output ?? [])
    .map((entry) => entry?.lambda?.timeout)
    .filter(Number.isFinite);
  if (timeouts.length === 0 || Math.max(...timeouts) > MAX_REQUEST_SECONDS) {
    throw new Error("current OrderPaymentEvent deployment timeout boundary drifted");
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
  ) throw new Error(`canonical alias ${alias} does not resolve to the current deployment`);
  return true;
}

export function validateHealth(status, body) {
  if (status !== 200 || body?.ok !== true || Object.keys(body).length !== 1) {
    throw new Error("canonical production health check failed");
  }
  return true;
}

function sameStringSet(actual, expected) {
  return Array.isArray(actual)
    && JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

export function validateZeroDirectTree(value, expectedCommit) {
  if (
    value?.sourceCommit !== expectedCommit
    || value.directAccessMatches !== 0
    || !Number.isSafeInteger(value.scannedFiles)
    || value.scannedFiles <= EXPECTED_REFERENCE_FILES.length
    || !sameStringSet(value.authorityConsumers, EXPECTED_AUTHORITY_CONSUMERS)
    || !sameStringSet(value.fixedOperations, EXPECTED_FIXED_OPERATIONS)
    || !sameStringSet(value.referenceFiles, EXPECTED_REFERENCE_FILES)
  ) throw new Error(`OrderPaymentEvent zero-direct tree ${expectedCommit} drifted`);
  return Object.freeze(value);
}

function runCommand(args) {
  return execFileSync(args[0], args.slice(1), {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 90_000,
  });
}

function vercelArgs(...args) {
  return ["npx", "--yes", `vercel@${VERCEL_CLI_VERSION}`, ...args, "--scope", VERCEL_SCOPE];
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

export function sanitizedEvidence({ config, deployed, drain, inventory, operator }) {
  validateZeroDirectTree(deployed, DEPLOYED_SOURCE_COMMIT);
  validateZeroDirectTree(operator, config?.operatorCommit);
  if (
    drain?.sha256 !== DRAIN_EVIDENCE_SHA256
    || drain.removedPredecessors !== 11
    || inventory?.sharedCredentialPredecessors !== 0
    || inventory.currentDeploymentId !== CURRENT_DEPLOYMENT.id
    || inventory.currentSourceCommit !== DEPLOYED_SOURCE_COMMIT
  ) throw new Error("OrderPaymentEvent zero-direct evidence input drifted");
  return Object.freeze({
    schemaVersion: 1,
    status: "passed",
    generatedAt: new Date().toISOString(),
    operator: { commit: config.operatorCommit, mainCiRunId: config.mainCiRunId },
    production: {
      currentDeployment: CURRENT_DEPLOYMENT,
      canonicalAliasesPreserved: true,
      canonicalHealthPassed: true,
      sharedCredentialPredecessors: 0,
    },
    acceptedDrain: { evidenceSha256: drain.sha256, removedPredecessors: 11 },
    deployedTree: deployed,
    operatorTree: operator,
    orderPaymentEvent: {
      zeroDirectApplicationAccess: true,
      migrationsRun: false,
      rlsChanged: false,
      grantsChanged: false,
      providerConfigurationChanged: false,
    },
    secretsRetained: false,
  });
}

export function validateAcceptedEvidence(value, config) {
  validateZeroDirectTree(value?.deployedTree, DEPLOYED_SOURCE_COMMIT);
  validateZeroDirectTree(value?.operatorTree, config?.operatorCommit);
  if (
    value?.schemaVersion !== 1
    || value.status !== "passed"
    || !Number.isFinite(Date.parse(value.generatedAt))
    || value.operator?.commit !== config.operatorCommit
    || value.operator?.mainCiRunId !== config.mainCiRunId
    || value.production?.currentDeployment?.id !== CURRENT_DEPLOYMENT.id
    || value.production.currentDeployment.sourceCommit !== DEPLOYED_SOURCE_COMMIT
    || value.production?.canonicalAliasesPreserved !== true
    || value.production?.canonicalHealthPassed !== true
    || value.production?.sharedCredentialPredecessors !== 0
    || value.acceptedDrain?.evidenceSha256 !== DRAIN_EVIDENCE_SHA256
    || value.acceptedDrain?.removedPredecessors !== 11
    || value.orderPaymentEvent?.zeroDirectApplicationAccess !== true
    || value.orderPaymentEvent?.migrationsRun !== false
    || value.orderPaymentEvent?.rlsChanged !== false
    || value.orderPaymentEvent?.grantsChanged !== false
    || value.orderPaymentEvent?.providerConfigurationChanged !== false
    || value.secretsRetained !== false
  ) throw new Error("existing OrderPaymentEvent zero-direct-access evidence drifted");
  return Object.freeze(value);
}

export async function runProof(
  config,
  { command = runCommand, fetchFn = fetch, root = process.cwd() } = {},
) {
  if (existsSync(config.evidencePath)) {
    return validateAcceptedEvidence(
      readPrivateJson(config.evidencePath, "OrderPaymentEvent zero-direct evidence").value,
      config,
    );
  }
  assertGitState(readGitState(root), config.operatorCommit);
  parseGitHubCiRun(command([
    "gh", "run", "view", String(config.mainCiRunId), "--json",
    "databaseId,headSha,conclusion,status,workflowName",
  ]), config.operatorCommit, config.mainCiRunId);
  const drainFile = readPrivateJson(DRAIN_EVIDENCE_PATH, "OrderPaymentEvent drain evidence");
  const drain = validateDrainEvidence(drainFile.raw, drainFile.value);
  const inventory = validateDeploymentInventory(listDeployments(command));
  validateDeploymentInspect(inspectDeployment(CURRENT_DEPLOYMENT.id, command));
  await verifyAliasesAndHealth(command, fetchFn);
  const deployed = verifyOrderPaymentEventZeroDirectAccessAtCommit(
    DEPLOYED_SOURCE_COMMIT,
    root,
  );
  const operator = verifyOrderPaymentEventZeroDirectAccessAtCommit(
    config.operatorCommit,
    root,
  );
  const evidence = sanitizedEvidence({ config, deployed, drain, inventory, operator });
  writePrivateJson(config.evidencePath, evidence);
  return evidence;
}

async function main() {
  const result = await runProof(parseConfiguration());
  console.log(JSON.stringify({
    orderPaymentEventZeroDirectAccess: result.status,
    deployedDirectAccessMatches: result.deployedTree.directAccessMatches,
    operatorDirectAccessMatches: result.operatorTree.directAccessMatches,
    sharedCredentialPredecessors: result.production.sharedCredentialPredecessors,
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
