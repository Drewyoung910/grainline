#!/usr/bin/env node
// Remove every superseded READY Production deployment that was created after
// the accepted 2026-08-13 runtime credential rotation. This closes the entire
// current-credential deployment epoch before OrderPaymentEvent table authority
// is revoked; it is intentionally not a database or RLS operator.
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

export const CONFIRMATION = "reviewed-order-payment-event-credential-epoch-drain";
export const VERCEL_SCOPE = "drew-youngs-projects";
export const VERCEL_PROJECT = "grainline";
export const VERCEL_CLI_VERSION = "59.10.0";
export const ACTIVE_DEPLOYMENT_STATES = "READY,BUILDING,QUEUED,INITIALIZING";
// The credential epoch begins when the accepted replacement deployment was
// created, not when the recovery operator later finished its postflights.
export const CREDENTIAL_EPOCH_CUTOFF = 1786644755419;
export const MAX_REQUEST_SECONDS = 300;

export const CURRENT_DEPLOYMENT = Object.freeze({
  createdAt: 1788114206219,
  id: "dpl_Coyjd6rTXteBV9e4QZtZGFDaiEYc",
  sourceCommit: "ce7550dae6c417440230f4d596f2239393075f31",
  url: "grainline-ees25wgos-drew-youngs-projects.vercel.app",
});

export const SUPERSEDED_DEPLOYMENTS = Object.freeze([
  {
    createdAt: 1788087169342,
    id: "dpl_UiZckAkuj8CSyLPBeQBUHF5Fq1Dj",
    sourceCommit: "4908bc7f377f5950da8de6b3398049d65a5fdfcb",
    url: "grainline-822kbxpu5-drew-youngs-projects.vercel.app",
  },
  {
    createdAt: 1788072322091,
    id: "dpl_7UeENeZebXL9yL481DWrXkDpWd4R",
    sourceCommit: "07eb9fc57bcec4d2fbac4d9ffc58b814ff78f5a8",
    url: "grainline-iji9ggah6-drew-youngs-projects.vercel.app",
  },
  {
    createdAt: 1788056934561,
    id: "dpl_2WkGbkiDdD8ySQYnCTur7ND3n2kd",
    sourceCommit: "4b2d4693ac03db773b766ca4c4c53c072ac0fdbe",
    url: "grainline-ghp69x6tu-drew-youngs-projects.vercel.app",
  },
  {
    createdAt: 1788056709026,
    id: "dpl_HugNfsCT8TTPaFn21iSUJW7JcX37",
    sourceCommit: "4b2d4693ac03db773b766ca4c4c53c072ac0fdbe",
    url: "grainline-530xoqtwt-drew-youngs-projects.vercel.app",
  },
  {
    createdAt: 1788050160433,
    id: "dpl_BdqJHNwjCUcsJ1xQvmghsbW7C3W3",
    sourceCommit: "8548c1bac683547f54e34c91496f5b6d7ffd059a",
    url: "grainline-9bmy7b429-drew-youngs-projects.vercel.app",
  },
  {
    createdAt: 1787952965308,
    id: "dpl_CcwbUVcaEsiVU1yscDT5fxX72P8S",
    sourceCommit: "3431bb83fa16fabb9b9e18a729a7d138d48764d9",
    url: "grainline-eam4z3v6i-drew-youngs-projects.vercel.app",
  },
  {
    createdAt: 1787861512393,
    id: "dpl_8FMq11zfZT166Dve7Vf6sTJTXFzX",
    sourceCommit: "a09827e0a641ec2f7e228520661cd7e74625bb0d",
    url: "grainline-bsi7gztbb-drew-youngs-projects.vercel.app",
  },
  {
    createdAt: 1787716306173,
    id: "dpl_AJanN3zfnubB39Aj14NFziHAhfeB",
    sourceCommit: "5ef81acca6f8e302830b983a614432094cfa2458",
    url: "grainline-600acniwq-drew-youngs-projects.vercel.app",
  },
  {
    createdAt: 1787695466246,
    id: "dpl_JCmwmKQVwTnvMB2nk7XwYFvQR5xA",
    sourceCommit: "a6593516be9fd5531e867aea43b4bbf6319f3094",
    url: "grainline-34fxv17am-drew-youngs-projects.vercel.app",
  },
  {
    createdAt: 1787622919541,
    id: "dpl_73aR913b9hfgkcdfBv2MwMyypR5a",
    sourceCommit: "2820986538c0d64f035defce052ba4ad0de1b3fb",
    url: "grainline-bm7c316wm-drew-youngs-projects.vercel.app",
  },
  {
    createdAt: 1786857420805,
    id: "dpl_7PRTnXtMrMNq83ZFPJNeqFtyXZ8h",
    sourceCommit: "e9239463a71860451191344b26dd20b45298f239",
    url: "grainline-qps6dvkab-drew-youngs-projects.vercel.app",
  },
].map(Object.freeze));

// Oldest first: a partial run preserves the newest rollback candidate longest.
export const DELETION_ORDER = Object.freeze([...SUPERSEDED_DEPLOYMENTS].reverse());
export const CANONICAL_ALIASES = Object.freeze([
  "thegrainline.com",
  "www.thegrainline.com",
  "grainline.vercel.app",
  "grainline-drew-youngs-projects.vercel.app",
]);
export const EVIDENCE_DIRECTORY = "/Users/drewyoung/grainline-rollout-evidence";
export const RECOVERY_EVIDENCE_PATH = path.join(
  EVIDENCE_DIRECTORY,
  "database-credential-recovery-20260813.json",
);
export const RECOVERY_EVIDENCE_SHA256 =
  "ed7f8952c1eb5d72aa9d661701c64cc0153eed48f59494e3fe136b2c80e8e943";
export const STATE_PATH = path.join(
  EVIDENCE_DIRECTORY,
  "order-payment-event-credential-epoch-drain-state.json",
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
  if (env.ORDER_PAYMENT_EVENT_DRAIN_CONFIRM !== CONFIRMATION) {
    throw new Error("OrderPaymentEvent credential-epoch drain confirmation is invalid");
  }
  const operatorCommit = required(env, "ORDER_PAYMENT_EVENT_DRAIN_OPERATOR_COMMIT");
  if (!/^[a-f0-9]{40}$/.test(operatorCommit)) {
    throw new Error("OrderPaymentEvent credential-epoch drain commit is invalid");
  }
  const mainCiRunId = positiveInteger(env, "ORDER_PAYMENT_EVENT_DRAIN_MAIN_CI_RUN_ID");
  const evidencePath = path.resolve(required(env, "ORDER_PAYMENT_EVENT_DRAIN_EVIDENCE_PATH"));
  if (
    path.dirname(evidencePath) !== EVIDENCE_DIRECTORY
    || path.basename(evidencePath)
      !== `order-payment-event-credential-epoch-drain-${operatorCommit}.json`
  ) throw new Error("OrderPaymentEvent credential-epoch drain evidence path is not reviewed");
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
  ) throw new Error("OrderPaymentEvent drain requires the exact clean reviewed main commit");
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
  ) throw new Error("OrderPaymentEvent drain exact-main CI binding did not pass");
  return Object.freeze({ exactCommit: true, passed: true, runId: expectedRunId });
}

export function validateRecoveryEvidence(raw, value) {
  const digest = createHash("sha256").update(raw).digest("hex");
  if (
    digest !== RECOVERY_EVIDENCE_SHA256
    || value?.status !== "passed"
    || value.acceptanceEligible !== true
    || value.issueCount !== 0
    || value.completedAt !== "2026-08-13T18:32:53.179Z"
    || value.operator?.commit !== "7bf07801152962eca4d3e5e3a0cfe9cb5b88ba89"
    || value.operator?.ciRunId !== 31730856176
    || value.deployment?.replacementId !== "dpl_C3N3PudFHg4GoRMAAZJuz9aNZ5Y6"
    || value.credentials?.runtime?.role !== "grainline_app_runtime"
    || value.credentials.runtime.priorRejected !== true
    || value.credentials.runtime.replacementVerified !== true
    || value.credentials?.owner?.priorRejected !== true
    || value.credentials.owner.replacementVerified !== true
    || value.providerScopeOutsideRecoveryChanged !== false
  ) throw new Error("accepted database credential recovery evidence drifted");
  return Object.freeze({
    cutoff: CREDENTIAL_EPOCH_CUTOFF,
    earlierDeploymentCredentialsRejected: true,
    sha256: digest,
  });
}

export function parseVercelJson(raw) {
  const start = raw.indexOf("{");
  if (start < 0) throw new Error("Vercel did not return JSON");
  return JSON.parse(raw.slice(start));
}

function expectedRow(row, expected) {
  return row?.name === VERCEL_PROJECT
    && row.url === expected.url
    && row.state === "READY"
    && row.target === "production"
    && row.createdAt === expected.createdAt
    && (row.meta?.githubCommitSha ?? row.meta?.gitCommitSha) === expected.sourceCommit;
}

export function validateDeploymentInventory(value, options = {}) {
  const { allowReviewedMissing = false, now = Date.now() } = options;
  const rows = value?.deployments;
  if (!Array.isArray(rows) || rows.length < 1 || value.contextName !== VERCEL_SCOPE) {
    throw new Error("Vercel production deployment inventory shape drifted");
  }
  if (Number.isFinite(value.pagination?.next) && value.pagination.next >= CREDENTIAL_EPOCH_CUTOFF) {
    throw new Error("Vercel inventory page does not cover the complete credential epoch");
  }
  const epochRows = rows.filter((row) => row.createdAt >= CREDENTIAL_EPOCH_CUTOFF);
  if (!expectedRow(epochRows[0], CURRENT_DEPLOYMENT)) {
    throw new Error("current credential-epoch deployment drifted");
  }
  const reviewedByUrl = new Map(SUPERSEDED_DEPLOYMENTS.map((item) => [item.url, item]));
  const observed = [];
  for (const row of epochRows.slice(1)) {
    const expected = reviewedByUrl.get(row.url);
    if (!expected || !expectedRow(row, expected) || observed.includes(expected.id)) {
      throw new Error("an unreviewed deployment shares the current runtime credential epoch");
    }
    observed.push(expected.id);
  }
  const expectedOrder = SUPERSEDED_DEPLOYMENTS
    .filter((item) => observed.includes(item.id))
    .map((item) => item.id);
  if (JSON.stringify(observed) !== JSON.stringify(expectedOrder)) {
    throw new Error("credential-epoch deployment ordering drifted");
  }
  if (!allowReviewedMissing && observed.length !== SUPERSEDED_DEPLOYMENTS.length) {
    throw new Error("reviewed credential-epoch predecessor inventory is incomplete");
  }
  const elapsedSeconds = Math.floor((now - CURRENT_DEPLOYMENT.createdAt) / 1000);
  if (elapsedSeconds < MAX_REQUEST_SECONDS) {
    throw new Error("current compatible deployment has not completed the maximum request drain");
  }
  return Object.freeze({
    currentDeploymentId: CURRENT_DEPLOYMENT.id,
    elapsedSeconds,
    observedPredecessorIds: Object.freeze(observed),
    sharedCredentialPredecessors: observed.length,
  });
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
  ) throw new Error(`canonical alias ${alias} does not resolve to the current deployment`);
  return true;
}

export function validateHealth(status, body) {
  if (status !== 200 || body?.ok !== true || Object.keys(body).length !== 1) {
    throw new Error("canonical production health check failed");
  }
  return true;
}

function isPrefix(prefix, complete) {
  return prefix.every((value, index) => complete[index] === value);
}

export function validateState(value, config) {
  const targetIds = DELETION_ORDER.map((item) => item.id);
  if (
    value?.schemaVersion !== 1
    || value.operatorCommit !== config.operatorCommit
    || value.mainCiRunId !== config.mainCiRunId
    || value.currentDeploymentId !== CURRENT_DEPLOYMENT.id
    || JSON.stringify(value.targetDeploymentIds) !== JSON.stringify(targetIds)
    || !Array.isArray(value.removedDeploymentIds)
    || !isPrefix(value.removedDeploymentIds, targetIds)
    || !["removal-authorized", "removal-complete"].includes(value.stage)
    || (value.stage === "removal-complete" && value.removedDeploymentIds.length !== targetIds.length)
  ) throw new Error("OrderPaymentEvent credential-epoch drain restart state drifted");
  return Object.freeze(value);
}

export function reconcileStateWithInventory(state, inventory) {
  const present = new Set(inventory.observedPredecessorIds);
  const missing = DELETION_ORDER.filter((item) => !present.has(item.id)).map((item) => item.id);
  const targetIds = DELETION_ORDER.map((item) => item.id);
  if (!isPrefix(missing, targetIds) || !isPrefix(state.removedDeploymentIds, missing)) {
    throw new Error("credential-epoch removal order or restart state drifted");
  }
  return Object.freeze({
    ...state,
    stage: missing.length === targetIds.length ? "removal-complete" : "removal-authorized",
    removedDeploymentIds: Object.freeze(missing),
  });
}

export function validateInspectAbsentResult(result) {
  const output = `${result?.stdout ?? ""}\n${result?.stderr ?? ""}`;
  if (
    result?.status === 0
    || !/(?:can(?:not|'t) find|could not find|not found|does not exist)/i.test(output)
  ) throw new Error("reviewed deployment is still inspectable or absence was not proven");
  return true;
}

export function sanitizedEvidence({ config, inventoryBefore, recovery, startedAt }) {
  if (
    !/^[a-f0-9]{40}$/.test(config?.operatorCommit ?? "")
    || !Number.isSafeInteger(config?.mainCiRunId)
    || recovery?.sha256 !== RECOVERY_EVIDENCE_SHA256
    || inventoryBefore?.sharedCredentialPredecessors !== SUPERSEDED_DEPLOYMENTS.length
    || !Number.isSafeInteger(inventoryBefore?.elapsedSeconds)
    || inventoryBefore.elapsedSeconds < MAX_REQUEST_SECONDS
    || Number.isNaN(Date.parse(startedAt))
  ) throw new Error("OrderPaymentEvent credential-epoch evidence input drifted");
  return Object.freeze({
    schemaVersion: 1,
    status: "passed",
    generatedAt: new Date().toISOString(),
    startedAt,
    operator: { commit: config.operatorCommit, mainCiRunId: config.mainCiRunId },
    credentialRecovery: {
      cutoff: CREDENTIAL_EPOCH_CUTOFF,
      evidenceSha256: recovery.sha256,
      earlierDeploymentCredentialsRejected: true,
    },
    deploymentDrain: {
      currentDeployment: CURRENT_DEPLOYMENT,
      removedDeployments: SUPERSEDED_DEPLOYMENTS,
      sharedCredentialPredecessorsBefore: SUPERSEDED_DEPLOYMENTS.length,
      sharedCredentialPredecessorsAfter: 0,
      deletionOrder: "oldest-first",
      elapsedSeconds: inventoryBefore.elapsedSeconds,
      maximumRequestSeconds: MAX_REQUEST_SECONDS,
      currentAliasesPreserved: true,
      canonicalHealthPassed: true,
    },
    orderPaymentEvent: {
      migrationsRun: false,
      rlsChanged: false,
      grantsChanged: false,
      providerConfigurationChanged: false,
      zeroDirectAccessClaimed: false,
    },
    secretsRetained: false,
  });
}

export function validateAcceptedEvidence(value, config) {
  const removedIds = SUPERSEDED_DEPLOYMENTS.map((item) => item.id);
  if (
    value?.schemaVersion !== 1
    || value.status !== "passed"
    || value.operator?.commit !== config.operatorCommit
    || value.operator?.mainCiRunId !== config.mainCiRunId
    || value.credentialRecovery?.cutoff !== CREDENTIAL_EPOCH_CUTOFF
    || value.credentialRecovery?.evidenceSha256 !== RECOVERY_EVIDENCE_SHA256
    || value.credentialRecovery?.earlierDeploymentCredentialsRejected !== true
    || value.deploymentDrain?.currentDeployment?.id !== CURRENT_DEPLOYMENT.id
    || value.deploymentDrain?.currentDeployment?.sourceCommit !== CURRENT_DEPLOYMENT.sourceCommit
    || JSON.stringify(value.deploymentDrain?.removedDeployments?.map((item) => item.id))
      !== JSON.stringify(removedIds)
    || value.deploymentDrain?.sharedCredentialPredecessorsBefore !== removedIds.length
    || value.deploymentDrain?.sharedCredentialPredecessorsAfter !== 0
    || value.deploymentDrain?.deletionOrder !== "oldest-first"
    || value.deploymentDrain?.maximumRequestSeconds !== MAX_REQUEST_SECONDS
    || value.deploymentDrain?.currentAliasesPreserved !== true
    || value.deploymentDrain?.canonicalHealthPassed !== true
    || value.orderPaymentEvent?.migrationsRun !== false
    || value.orderPaymentEvent?.rlsChanged !== false
    || value.orderPaymentEvent?.grantsChanged !== false
    || value.orderPaymentEvent?.providerConfigurationChanged !== false
    || value.orderPaymentEvent?.zeroDirectAccessClaimed !== false
    || value.secretsRetained !== false
  ) throw new Error("existing OrderPaymentEvent credential-epoch drain evidence drifted");
  return Object.freeze(value);
}

function runCommand(args, options = {}) {
  return execFileSync(args[0], args.slice(1), {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", options.stderr ?? "ignore"],
    timeout: 90_000,
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

function assertDeploymentAbsent(deployment, spawnCommand = spawnSync) {
  const args = vercelArgs("inspect", deployment.id, "--json");
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
  const inventory = validateDeploymentInventory(listDeployments(command), { now });
  validateDeploymentInspect(inspectDeployment(CURRENT_DEPLOYMENT.id, command), CURRENT_DEPLOYMENT);
  for (const deployment of SUPERSEDED_DEPLOYMENTS) {
    validateDeploymentInspect(inspectDeployment(deployment.id, command), deployment);
  }
  await verifyAliasesAndHealth(command, fetchFn);
  return { inventory, recovery: recoveryResult };
}

export async function executeDrain(
  config,
  { command = runCommand, fetchFn = fetch, now = Date.now(), spawnCommand = spawnSync } = {},
) {
  if (existsSync(config.evidencePath)) {
    return validateAcceptedEvidence(
      readPrivateJson(config.evidencePath, "OrderPaymentEvent credential-epoch evidence").value,
      config,
    );
  }

  let state;
  let inventoryBefore;
  let recovery;
  if (existsSync(STATE_PATH)) {
    state = validateState(
      readPrivateJson(STATE_PATH, "OrderPaymentEvent credential-epoch state").value,
      config,
    );
    assertGitState(readGitState(), config.operatorCommit);
    verifyGitHubCi(config, command);
    const acceptedRecovery = readPrivateJson(RECOVERY_EVIDENCE_PATH, "credential recovery evidence");
    recovery = validateRecoveryEvidence(acceptedRecovery.raw, acceptedRecovery.value);
    inventoryBefore = {
      elapsedSeconds: Math.floor((now - CURRENT_DEPLOYMENT.createdAt) / 1000),
      sharedCredentialPredecessors: SUPERSEDED_DEPLOYMENTS.length,
    };
  } else {
    const proof = await preflight(config, { command, fetchFn, now });
    inventoryBefore = proof.inventory;
    recovery = proof.recovery;
    state = {
      schemaVersion: 1,
      stage: "removal-authorized",
      startedAt: new Date(now).toISOString(),
      operatorCommit: config.operatorCommit,
      mainCiRunId: config.mainCiRunId,
      currentDeploymentId: CURRENT_DEPLOYMENT.id,
      targetDeploymentIds: DELETION_ORDER.map((item) => item.id),
      removedDeploymentIds: [],
    };
    writePrivateJson(STATE_PATH, state);
  }

  validateDeploymentInspect(inspectDeployment(CURRENT_DEPLOYMENT.id, command), CURRENT_DEPLOYMENT);
  await verifyAliasesAndHealth(command, fetchFn);
  let inventory = validateDeploymentInventory(listDeployments(command), {
    allowReviewedMissing: true,
    now,
  });
  let reconciled = reconcileStateWithInventory(state, inventory);
  if (JSON.stringify(reconciled) !== JSON.stringify(state)) {
    replacePrivateJson(STATE_PATH, reconciled);
    state = reconciled;
  }

  for (const deployment of DELETION_ORDER) {
    if (state.removedDeploymentIds.includes(deployment.id)) continue;
    const nextId = DELETION_ORDER[state.removedDeploymentIds.length]?.id;
    if (nextId !== deployment.id) throw new Error("OrderPaymentEvent drain deletion order drifted");

    validateDeploymentInspect(inspectDeployment(CURRENT_DEPLOYMENT.id, command), CURRENT_DEPLOYMENT);
    validateDeploymentInspect(inspectDeployment(deployment.id, command), deployment);
    await verifyAliasesAndHealth(command, fetchFn);
    inventory = validateDeploymentInventory(listDeployments(command), {
      allowReviewedMissing: true,
      now,
    });
    reconciled = reconcileStateWithInventory(state, inventory);
    if (reconciled.removedDeploymentIds.includes(deployment.id)) {
      replacePrivateJson(STATE_PATH, reconciled);
      state = reconciled;
      continue;
    }

    command(vercelArgs("remove", deployment.id, "--yes"), { stderr: "pipe" });
    assertDeploymentAbsent(deployment, spawnCommand);
    inventory = validateDeploymentInventory(listDeployments(command), {
      allowReviewedMissing: true,
      now,
    });
    reconciled = reconcileStateWithInventory(state, inventory);
    if (!reconciled.removedDeploymentIds.includes(deployment.id)) {
      throw new Error(`Vercel inventory still contains removed deployment ${deployment.id}`);
    }
    replacePrivateJson(STATE_PATH, reconciled);
    state = reconciled;
  }

  if (state.stage !== "removal-complete") {
    throw new Error("OrderPaymentEvent credential-epoch drain did not complete");
  }
  const finalInventory = validateDeploymentInventory(listDeployments(command), {
    allowReviewedMissing: true,
    now,
  });
  if (finalInventory.sharedCredentialPredecessors !== 0) {
    throw new Error("a reviewed current-credential predecessor remains callable");
  }
  for (const deployment of SUPERSEDED_DEPLOYMENTS) {
    assertDeploymentAbsent(deployment, spawnCommand);
  }
  validateDeploymentInspect(inspectDeployment(CURRENT_DEPLOYMENT.id, command), CURRENT_DEPLOYMENT);
  await verifyAliasesAndHealth(command, fetchFn);

  const evidence = sanitizedEvidence({
    config,
    inventoryBefore,
    recovery,
    startedAt: state.startedAt,
  });
  writePrivateJson(config.evidencePath, evidence);
  unlinkSync(STATE_PATH);
  return evidence;
}

async function main() {
  const mode = process.argv[2];
  if (!new Set(["preflight", "run"]).has(mode)) {
    throw new Error("usage: order-payment-event-credential-epoch-drain.mjs preflight|run");
  }
  const config = parseConfiguration();
  if (mode === "preflight") {
    const result = await preflight(config);
    console.log(JSON.stringify({
      orderPaymentEventCredentialEpochDrain: "preflight-passed",
      sharedCredentialPredecessors: result.inventory.sharedCredentialPredecessors,
      credentialEpochCutoff: result.recovery.cutoff,
    }));
    return;
  }
  const evidence = await executeDrain(config);
  console.log(JSON.stringify({
    orderPaymentEventCredentialEpochDrain: evidence.status,
    currentAliasesPreserved: evidence.deploymentDrain.currentAliasesPreserved,
    removedDeploymentCount: evidence.deploymentDrain.removedDeployments.length,
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
