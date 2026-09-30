#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  PRODUCTION_ORIGIN,
  REQUIRED_ALIASES,
  REVIEWED_PROJECT,
  VERCEL_CLI_VERSION,
  assertReleaseBinding,
  loadPrivateEnvironment,
  parseGitHubCiRun,
  parseVercelAliasInspection,
  parseVercelDeployment,
  readPrivateJson,
  verifyDeploymentBoundary,
  writePrivateJson,
} from "/private/tmp/grainline-order-ops-health-candidate-20260930/scripts/order-authenticated-route-smoke.mjs";

const SOURCE = "/private/tmp/grainline-order-ops-health-candidate-20260930";
const PACKET = "/Users/drewyoung/grainline/recovery-checkpoints/order-zero-direct-authority-20260908/order-candidate-promotion-02f27a39-20260930";
const BINDING_PATH = "/Users/drewyoung/grainline/recovery-checkpoints/order-zero-direct-authority-20260908/order-staged-smoke-inputs-02f27a39-20260930/binding.json";
const BYPASS_PATH = "/Users/drewyoung/grainline/recovery-checkpoints/order-zero-direct-authority-20260908/order-staged-smoke-inputs-20260924/bypass.env";
const OPERATION = path.join(PACKET, "operation-explicit-aliases-1");
const CONFIRMATION = "promote-reviewed-order-candidate-02f27a39-with-explicit-aliases";
const RECOVERY_CONFIRMATION = "restore-reviewed-order-predecessor-79894635";
const CURRENT_MAIN = "02f27a3948a2cbc87ddb7b53d0f07e8251718b83";
const CURRENT_MAIN_CI = 36718477687;
const CANDIDATE_SOURCE = "02f27a3948a2cbc87ddb7b53d0f07e8251718b83";
const CANDIDATE_SOURCE_CI = 36718477687;
const CANDIDATE_ID = "dpl_G6hBoBC1jJt6KiphZifpqQj2Br4J";
const CANDIDATE_HOST = "grainline-i2hm5z9cb-drew-youngs-projects.vercel.app";
const PREDECESSOR_SOURCE = "798946354d7cecbaa8aa490ef39a1e89e2d856fa";
const PREDECESSOR_SOURCE_CI = 36690981247;
const PREDECESSOR_ID = "dpl_9RH5JuxfotPEYYij4ZK4X8gNbNwW";
const PREDECESSOR_HOST = "grainline-eorectsb8-drew-youngs-projects.vercel.app";

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${label} drifted`);
  }
}

function run(file, args, options = {}) {
  return execFileSync(file, args, {
    cwd: SOURCE,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function verifyCi(commit, runId) {
  const raw = run("gh", [
    "run", "view", String(runId), "--json",
    "databaseId,headSha,conclusion,status,workflowName,headBranch,event",
  ]);
  return parseGitHubCiRun(raw, commit, runId);
}

function verifyRemoteMain() {
  const raw = run("git", ["ls-remote", "origin", "refs/heads/main"]).trim();
  if (raw !== `${CURRENT_MAIN}\trefs/heads/main`) {
    throw new Error("Order candidate promotion main drifted");
  }
  return true;
}

function verifyRuntimeTree() {
  run("git", [
    "diff", "--exit-code", `${CANDIDATE_SOURCE}..${CURRENT_MAIN}`, "--",
    "src", "package.json", "package-lock.json", "next.config.mjs",
  ]);
  return true;
}

function vercel(args) {
  return run("npx", ["--yes", `vercel@${VERCEL_CLI_VERSION}`, ...args]);
}

function readDeployment(binding) {
  return parseVercelDeployment(vercel([
    "api", `/v13/deployments/${binding.deploymentId}`, "--raw", "--no-color",
    "--scope", "drew-youngs-projects",
  ]), binding);
}

function readCandidateDeployment() {
  const value = JSON.parse(vercel([
    "api", `/v13/deployments/${CANDIDATE_ID}`, "--raw", "--no-color",
    "--scope", "drew-youngs-projects",
  ]));
  const aliases = value?.alias ?? value?.aliases ?? [];
  const sourceShas = [value?.meta?.githubCommitSha, value?.meta?.gitCommitSha]
    .filter(sha => sha !== undefined);
  if (
    value?.id !== CANDIDATE_ID
    || value.target !== "production"
    || value.readyState !== "READY"
    || value.url !== CANDIDATE_HOST
    || sourceShas.length === 0
    || sourceShas.some(sha => sha !== CANDIDATE_SOURCE)
    || value.project?.id !== REVIEWED_PROJECT.projectId
    || value.team?.id !== REVIEWED_PROJECT.orgId
    || !Array.isArray(aliases)
    || aliases.some(alias => typeof alias !== "string" || !REQUIRED_ALIASES.includes(alias))
  ) {
    throw new Error("candidate-deployment-identity");
  }
  return Object.freeze({
    deploymentId: CANDIDATE_ID,
    providerAliases: Object.freeze([...aliases]),
    ready: true,
    sourceCommit: CANDIDATE_SOURCE,
  });
}

function readPredecessorDeployment() {
  const value = JSON.parse(vercel([
    "api", `/v13/deployments/${PREDECESSOR_ID}`, "--raw", "--no-color",
    "--scope", "drew-youngs-projects",
  ]));
  const aliases = value?.alias ?? value?.aliases ?? [];
  const sourceShas = [value?.meta?.githubCommitSha, value?.meta?.gitCommitSha]
    .filter(sha => sha !== undefined);
  if (
    value?.id !== PREDECESSOR_ID
    || value.target !== "production"
    || value.readyState !== "READY"
    || value.url !== PREDECESSOR_HOST
    || sourceShas.length === 0
    || sourceShas.some(sha => sha !== PREDECESSOR_SOURCE)
    || value.project?.id !== REVIEWED_PROJECT.projectId
    || value.team?.id !== REVIEWED_PROJECT.orgId
    || !Array.isArray(aliases)
    || aliases.some(alias => typeof alias !== "string" || !REQUIRED_ALIASES.includes(alias))
  ) {
    throw new Error("predecessor-deployment-identity");
  }
  return Object.freeze({
    deploymentId: PREDECESSOR_ID,
    providerAliases: Object.freeze([...aliases]),
    ready: true,
    sourceCommit: PREDECESSOR_SOURCE,
  });
}

function readAliases(binding) {
  return REQUIRED_ALIASES.map(alias => parseVercelAliasInspection(vercel([
    "inspect", alias, "--json", "--scope", "drew-youngs-projects",
  ]), alias, binding));
}

function promote(deploymentId) {
  vercel([
    "promote", deploymentId,
    "--scope", "drew-youngs-projects",
    "--timeout", "3m",
    "--yes",
    "--no-color",
  ]);
}

function assignAlias(deploymentHost, alias) {
  vercel([
    "alias", "set", deploymentHost, alias,
    "--scope", "drew-youngs-projects",
    "--no-color",
  ]);
}

function assignAllAliases(deploymentHost, completed) {
  for (const alias of REQUIRED_ALIASES) {
    assignAlias(deploymentHost, alias);
    completed.push(alias);
  }
}

const canonicalCandidate = assertReleaseBinding({
  ciRunId: CANDIDATE_SOURCE_CI,
  commit: CANDIDATE_SOURCE,
  deploymentId: CANDIDATE_ID,
  origin: PRODUCTION_ORIGIN,
});
const canonicalPredecessor = assertReleaseBinding({
  ciRunId: PREDECESSOR_SOURCE_CI,
  commit: PREDECESSOR_SOURCE,
  deploymentId: PREDECESSOR_ID,
  origin: PRODUCTION_ORIGIN,
});

function loadInputs() {
  const binding = assertReleaseBinding(readPrivateJson(BINDING_PATH, "Order staged binding"));
  if (binding.commit !== CANDIDATE_SOURCE
    || binding.ciRunId !== CANDIDATE_SOURCE_CI
    || binding.deploymentId !== CANDIDATE_ID
    || binding.predecessorDeploymentId !== PREDECESSOR_ID) {
    throw new Error("Order staged binding drifted");
  }
  const values = loadPrivateEnvironment(BYPASS_PATH, "Order staged bypass");
  exactKeys(values, ["ORDER_STAGED_BYPASS_SECRET"], "Order staged bypass");
  return { binding, bypass: values.ORDER_STAGED_BYPASS_SECRET };
}

async function admit() {
  verifyRemoteMain();
  verifyCi(CURRENT_MAIN, CURRENT_MAIN_CI);
  verifyCi(CANDIDATE_SOURCE, CANDIDATE_SOURCE_CI);
  verifyRuntimeTree();
  const { binding, bypass } = loadInputs();
  const candidate = readDeployment(binding);
  const aliases = readAliases(binding);
  const stagedHealth = await verifyDeploymentBoundary(binding, fetch, bypass);
  const predecessor = readPredecessorDeployment();
  const canonicalHealth = await verifyDeploymentBoundary(canonicalPredecessor, fetch);
  return Object.freeze({
    aliasesBefore: aliases.map(({ alias, deploymentId }) => ({ alias, deploymentId })),
    candidateDeploymentId: candidate.deploymentId,
    candidateSource: candidate.sourceCommit,
    candidateStagedHealth: stagedHealth.healthStatus === 200,
    currentMain: CURRENT_MAIN,
    currentMainCiRunId: CURRENT_MAIN_CI,
    predecessorCanonicalHealth: canonicalHealth.healthStatus === 200,
    predecessorDeploymentId: predecessor.deploymentId,
    runtimeTreeMatchesCurrentMain: true,
  });
}

async function retryPostflight(callback, attempts = 8, delayMs = 10_000, onFailure) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await callback();
    } catch (error) {
      last = error;
      const rawReason = error instanceof Error ? error.message : "postflight-check";
      const reason = [
        "candidate-deployment-identity",
        "candidate-alias-owners",
        "candidate-canonical-health-marker",
      ].includes(rawReason) ? rawReason : "postflight-check";
      onFailure?.(Object.freeze({ attempt, reason }));
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw last;
}

async function verifyCandidateCanonical() {
  let deployment;
  try {
    deployment = readCandidateDeployment();
  } catch {
    throw new Error("candidate-deployment-identity");
  }
  let aliases;
  try {
    aliases = readAliases(canonicalCandidate);
  } catch {
    throw new Error("candidate-alias-owners");
  }
  let health;
  try {
    health = await verifyDeploymentBoundary(canonicalCandidate, fetch);
  } catch {
    throw new Error("candidate-canonical-health-marker");
  }
  return Object.freeze({
    aliases: aliases.map(({ alias, deploymentId }) => ({ alias, deploymentId })),
    canonicalHealth: health.healthStatus === 200,
    deploymentId: deployment.deploymentId,
    sourceCommit: deployment.sourceCommit,
  });
}

async function verifyPredecessorCanonical() {
  const deployment = readPredecessorDeployment();
  const aliases = readAliases(canonicalPredecessor);
  const health = await verifyDeploymentBoundary(canonicalPredecessor, fetch);
  return Object.freeze({
    aliases: aliases.map(({ alias, deploymentId }) => ({ alias, deploymentId })),
    canonicalHealth: health.healthStatus === 200,
    deploymentId: deployment.deploymentId,
    sourceCommit: deployment.sourceCommit,
  });
}

async function execute() {
  if (process.env.ORDER_CANDIDATE_PROMOTION_CONFIRM !== CONFIRMATION) {
    throw new Error("Order candidate promotion confirmation is invalid");
  }
  if (existsSync(OPERATION)) {
    throw new Error("Order candidate promotion operation already exists");
  }
  const admission = await admit();
  mkdirSync(OPERATION, { mode: 0o700 });
  writePrivateJson(path.join(OPERATION, "intent.json"), {
    admission,
    candidateDeploymentId: CANDIDATE_ID,
    confirmation: CONFIRMATION,
    explicitAliases: REQUIRED_ALIASES,
    predecessorDeploymentId: PREDECESSOR_ID,
    requestedAt: new Date().toISOString(),
  });
  let mutationEntered = false;
  let failureStage = "before-mutation";
  const assignedCandidateAliases = [];
  const postflightFailures = [];
  try {
    mutationEntered = true;
    failureStage = "provider-promotion";
    promote(CANDIDATE_ID);
    failureStage = "candidate-explicit-aliases";
    assignAllAliases(CANDIDATE_HOST, assignedCandidateAliases);
    failureStage = "candidate-postflight";
    const postflight = await retryPostflight(
      verifyCandidateCanonical,
      8,
      10_000,
      failure => postflightFailures.push(failure),
    );
    const result = {
      accepted: true,
      candidateDeploymentId: CANDIDATE_ID,
      checkoutCutoverApplied: false,
      coreOrderRlsChanged: false,
      explicitlyAssignedAliases: assignedCandidateAliases,
      postflight,
      promotedAt: new Date().toISOString(),
    };
    writePrivateJson(path.join(OPERATION, "result.json"), result);
    return result;
  } catch {
    if (!mutationEntered) throw new Error("Order candidate promotion stopped before mutation");
    try {
      writePrivateJson(path.join(OPERATION, "failure.json"), {
        assignedCandidateAliases,
        candidatePromotionAccepted: false,
        failureStage,
        postflightFailures,
        rawProviderErrorPersisted: false,
        recordedAt: new Date().toISOString(),
      });
    } catch { /* recovery must not depend on evidence persistence */ }
    const assignedRollbackAliases = [];
    try {
      promote(PREDECESSOR_ID);
      assignAllAliases(PREDECESSOR_HOST, assignedRollbackAliases);
      const rollback = await retryPostflight(verifyPredecessorCanonical, 6, 10_000);
      writePrivateJson(path.join(OPERATION, "rollback.json"), {
        accepted: true,
        assignedRollbackAliases,
        candidatePromotionAccepted: false,
        predecessorRestoredAt: new Date().toISOString(),
        rollback,
      });
    } catch {
      writePrivateJson(path.join(OPERATION, "rollback-unaccepted.json"), {
        accepted: false,
        assignedRollbackAliases,
        manualAliasRecoveryRequired: true,
        recordedAt: new Date().toISOString(),
      });
      throw new Error("Order candidate promotion stopped; explicit predecessor rollback is unaccepted");
    }
    throw new Error("Order candidate promotion stopped; predecessor was explicitly restored");
  }
}

async function recoverPredecessor() {
  if (process.env.ORDER_CANDIDATE_PROMOTION_RECOVERY_CONFIRM !== RECOVERY_CONFIRMATION) {
    throw new Error("Order candidate promotion recovery confirmation is invalid");
  }
  if (!existsSync(OPERATION)) {
    throw new Error("Order candidate promotion recovery has no durable operation intent");
  }
  if (existsSync(path.join(OPERATION, "result.json"))) {
    throw new Error("Order candidate promotion is already accepted; recovery is disabled");
  }

  const priorRecovery = ["rollback.json", "rollback-recovery.json"]
    .map(name => path.join(OPERATION, name))
    .find(existsSync);
  if (priorRecovery) {
    const rollback = await verifyPredecessorCanonical();
    return Object.freeze({
      accepted: true,
      predecessorDeploymentId: PREDECESSOR_ID,
      providerMutationRequired: false,
      recoveryAlreadyRecorded: true,
      rollback,
    });
  }

  try {
    const rollback = await verifyPredecessorCanonical();
    const result = {
      accepted: true,
      predecessorDeploymentId: PREDECESSOR_ID,
      providerMutationRequired: false,
      recoveredAt: new Date().toISOString(),
      rollback,
    };
    writePrivateJson(path.join(OPERATION, "rollback-recovery.json"), result);
    return result;
  } catch { /* ambiguous or mixed routing requires explicit restoration */ }

  const recoveryIntent = path.join(OPERATION, "recovery-intent.json");
  if (!existsSync(recoveryIntent)) {
    writePrivateJson(recoveryIntent, {
      confirmation: RECOVERY_CONFIRMATION,
      predecessorDeploymentId: PREDECESSOR_ID,
      requestedAt: new Date().toISOString(),
    });
  }
  const assignedRollbackAliases = [];
  try {
    promote(PREDECESSOR_ID);
    assignAllAliases(PREDECESSOR_HOST, assignedRollbackAliases);
    const rollback = await retryPostflight(verifyPredecessorCanonical, 6, 10_000);
    const result = {
      accepted: true,
      assignedRollbackAliases,
      predecessorDeploymentId: PREDECESSOR_ID,
      providerMutationRequired: true,
      recoveredAt: new Date().toISOString(),
      rollback,
    };
    writePrivateJson(path.join(OPERATION, "rollback-recovery.json"), result);
    return result;
  } catch {
    writePrivateJson(path.join(OPERATION, "rollback-recovery-unaccepted.json"), {
      accepted: false,
      assignedRollbackAliases,
      manualAliasRecoveryRequired: true,
      rawProviderErrorPersisted: false,
      recordedAt: new Date().toISOString(),
    });
    throw new Error("Order candidate promotion recovery remains unaccepted");
  }
}

const mode = process.argv[2];
try {
  if (mode === "preflight") {
    const result = await admit();
    process.stdout.write(`${JSON.stringify({ accepted: true, ...result })}\n`);
  } else if (mode === "deployment-identity-probe") {
    const result = readCandidateDeployment();
    process.stdout.write(`${JSON.stringify({ accepted: true, ...result })}\n`);
  } else if (mode === "execute") {
    const result = await execute();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (mode === "recover-predecessor") {
    const result = await recoverPredecessor();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    throw new Error(
      "Usage: promote-order-candidate-explicit-aliases.mjs "
      + "preflight|deployment-identity-probe|execute|recover-predecessor",
    );
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "Order candidate promotion stopped";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
