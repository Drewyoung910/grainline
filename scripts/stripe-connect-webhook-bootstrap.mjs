#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY = "Drewyoung910/grainline";
const REQUIRED_HOST = "thegrainline.com";
const REQUIRED_EVENT = "payout.failed";
const ENVIRONMENT_VARIABLE = "STRIPE_CONNECT_WEBHOOK_SECRET";
const STRIPE_API_VERSION = "2026-02-25.clover";
const VERCEL_CLI_VERSION = "58.9.0";
const VERCEL_PROJECT = Object.freeze({
  orgId: "team_wvQeQHZGwCSwinC1uB7xbpjr",
  projectId: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp",
  projectName: "grainline",
});
const MODE_CONFIRMATIONS = Object.freeze({
  preflight: "inspect-disabled-connect-bootstrap",
  bootstrap: "create-disabled-connect-bootstrap",
});
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const RUN_ID_PATTERN = /^[1-9][0-9]*$/;
const STRIPE_SECRET_PATTERN = /\b(?:sk_(?:live|test)_[A-Za-z0-9_]+|whsec_[A-Za-z0-9_]+)\b/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

function redact(value) {
  return String(value ?? "")
    .replace(STRIPE_SECRET_PATTERN, "[redacted-stripe-secret]")
    .replace(BEARER_PATTERN, "Bearer [redacted-token]");
}

function safeError(error) {
  if (error instanceof Error) return redact(error.message || error.name);
  return redact(String(error));
}

function required(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${name} is required without surrounding whitespace`);
  }
  return value;
}

function parseUrl(raw, label) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (
    parsed.protocol !== "https:"
    || parsed.hostname !== REQUIRED_HOST
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new Error(`${label} must be an HTTPS ${REQUIRED_HOST} URL without credentials, query or fragment`);
  }
  return parsed;
}

function evidencePathFromEnv(env) {
  const raw = required(env, "STRIPE_CONNECT_BOOTSTRAP_EVIDENCE_PATH");
  if (raw.includes("\0")) throw new Error("evidence path must not contain null bytes");
  const resolved = path.resolve(ROOT_DIR, raw);
  if (resolved === ROOT_DIR || !resolved.startsWith(`${ROOT_DIR}${path.sep}`) || path.extname(resolved) !== ".json") {
    throw new Error("evidence path must be one JSON file inside the repository");
  }
  return resolved;
}

function stripeMode(secretKey) {
  if (/^sk_live_[A-Za-z0-9_]+$/.test(secretKey)) return "live";
  if (/^sk_test_[A-Za-z0-9_]+$/.test(secretKey)) return "test";
  throw new Error("STRIPE_SECRET_KEY must use an sk_live_ or sk_test_ key");
}

export function parseConfig(env = process.env) {
  const mode = required(env, "STRIPE_CONNECT_BOOTSTRAP_MODE");
  if (!Object.hasOwn(MODE_CONFIRMATIONS, mode)) {
    throw new Error("STRIPE_CONNECT_BOOTSTRAP_MODE must be preflight or bootstrap");
  }
  if (env.STRIPE_CONNECT_BOOTSTRAP_CONFIRM !== MODE_CONFIRMATIONS[mode]) {
    throw new Error(`STRIPE_CONNECT_BOOTSTRAP_CONFIRM=${MODE_CONFIRMATIONS[mode]} is required`);
  }

  const expectedCommit = required(env, "STRIPE_CONNECT_BOOTSTRAP_EXPECTED_COMMIT");
  const ciRunId = required(env, "STRIPE_CONNECT_BOOTSTRAP_CI_RUN_ID");
  if (!SHA_PATTERN.test(expectedCommit)) throw new Error("expected commit must be a lowercase 40-character SHA");
  if (!RUN_ID_PATTERN.test(ciRunId)) throw new Error("CI run ID must be a positive integer");

  const secretKey = required(env, "STRIPE_SECRET_KEY");
  const providerMode = stripeMode(secretKey);
  const expectedProviderMode = required(env, "STRIPE_CONNECT_BOOTSTRAP_PROVIDER_MODE");
  if (expectedProviderMode !== providerMode) {
    throw new Error(`Stripe key mode is ${providerMode}, not ${expectedProviderMode}`);
  }
  if (mode === "bootstrap" && providerMode !== "live") {
    throw new Error("bootstrap mode requires a live Stripe key");
  }

  const bootstrapUrl = parseUrl(
    env.STRIPE_CONNECT_BOOTSTRAP_URL
      || "https://thegrainline.com/api/stripe/webhook/connect-bootstrap-disabled",
    "bootstrap URL",
  );
  const canonicalUrl = parseUrl(
    env.STRIPE_CONNECT_CANONICAL_URL || "https://thegrainline.com/api/stripe/webhook/connect",
    "canonical URL",
  );
  if (bootstrapUrl.pathname !== "/api/stripe/webhook/connect-bootstrap-disabled") {
    throw new Error("bootstrap URL must use the reviewed absent route");
  }
  if (canonicalUrl.pathname !== "/api/stripe/webhook/connect") {
    throw new Error("canonical URL must use the reviewed Connect route");
  }

  const vercelProjectDirectory = path.resolve(required(env, "STRIPE_CONNECT_BOOTSTRAP_VERCEL_PROJECT_DIRECTORY"));
  const evidencePath = mode === "bootstrap" ? evidencePathFromEnv(env) : null;
  return Object.freeze({
    bootstrapUrl: bootstrapUrl.href,
    canonicalUrl: canonicalUrl.href,
    ciRunId,
    evidencePath,
    expectedCommit,
    mode,
    providerMode,
    secretKey,
    vercelProjectDirectory,
  });
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function exactEvents(endpoint) {
  const events = sortedUnique(endpoint?.enabled_events ?? []);
  return events.length === 1 && events[0] === REQUIRED_EVENT;
}

export function assertExactDisabledEndpoint(endpoint, config) {
  if (
    !endpoint
    || typeof endpoint.id !== "string"
    || endpoint.url !== config.bootstrapUrl
    || endpoint.status !== "disabled"
    || endpoint.livemode !== (config.providerMode === "live")
    || !exactEvents(endpoint)
  ) {
    throw new Error("created Stripe endpoint does not match the exact reviewed disabled bootstrap state");
  }
  return endpoint;
}

function normalizeVercelRows(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["envs", "env", "variables"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  throw new Error("Vercel environment list returned an unrecognized JSON shape");
}

function productionTarget(row) {
  const targets = Array.isArray(row?.target) ? row.target : [row?.target];
  return targets.includes("production") && (row?.gitBranch === null || row?.gitBranch === undefined);
}

export function findProductionEnvironmentVariable(payload, name = ENVIRONMENT_VARIABLE) {
  return normalizeVercelRows(payload).filter((row) => row?.key === name && productionTarget(row));
}

export function assertSensitiveProductionVariable(payload) {
  const matches = findProductionEnvironmentVariable(payload);
  if (matches.length !== 1) throw new Error("Vercel production Connect secret was not installed exactly once");
  const row = matches[0];
  if (row.type !== "sensitive" && row.sensitive !== true && row.visibility !== "secret") {
    throw new Error("Vercel production Connect secret is not classified as Sensitive");
  }
  return row;
}

function assertNoProductionVariable(payload) {
  if (findProductionEnvironmentVariable(payload).length !== 0) {
    throw new Error("Vercel production Connect secret already exists");
  }
}

function assertReviewedProject(project) {
  for (const [key, value] of Object.entries(VERCEL_PROJECT)) {
    if (project?.[key] !== value) {
      throw new Error("linked Vercel project is not the reviewed Grainline project");
    }
  }
}

function assertSuccessfulCi(run, config) {
  if (
    run?.conclusion !== "success"
    || run?.headSha !== config.expectedCommit
    || run?.headBranch !== "main"
    || run?.workflowName !== "CI"
    || run?.event !== "push"
  ) {
    throw new Error("GitHub CI run is not a successful exact-main CI run for the reviewed commit");
  }
}

function endpointConflicts(endpoints, config) {
  return endpoints.filter((endpoint) => (
    endpoint?.url === config.bootstrapUrl || endpoint?.url === config.canonicalUrl
  ));
}

function endpointDigest(endpointId) {
  return createHash("sha256").update(endpointId).digest("hex");
}

function defaultCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: process.env,
    input: options.input,
    maxBuffer: 1024 * 1024,
    timeout: 60_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${options.label || command} failed with exit ${result.status ?? "unknown"}`);
  }
  return result.stdout;
}

export function normalizeGitHubCiRun(payload, config) {
  if (Number(payload?.id) !== Number(config.ciRunId) || payload?.repository?.full_name !== REPOSITORY) {
    throw new Error("GitHub CI lookup returned a different run or repository");
  }
  return {
    conclusion: payload.conclusion,
    event: payload.event,
    headBranch: payload.head_branch,
    headSha: payload.head_sha,
    workflowName: payload.name,
  };
}

async function fetchExactCiRun(config) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "grainline-stripe-connect-bootstrap",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/actions/runs/${config.ciRunId}`, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub CI lookup failed with HTTP ${response.status}`);
  }
  return normalizeGitHubCiRun(await response.json(), config);
}

function vercelArgs(...args) {
  return ["--yes", `vercel@${VERCEL_CLI_VERSION}`, ...args, "--no-color"];
}

function createDefaultLocalDependencies(config) {
  return {
    currentCommit() {
      return execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: ROOT_DIR,
        encoding: "utf8",
      }).trim();
    },
    ciRun() {
      return fetchExactCiRun(config);
    },
    readVercelProject() {
      return JSON.parse(readFileSync(path.join(config.vercelProjectDirectory, ".vercel", "project.json"), "utf8"));
    },
    listVercelEnvironment() {
      return JSON.parse(defaultCommand(
        "npx",
        vercelArgs("env", "ls", "production", "--json", "--cwd", config.vercelProjectDirectory),
        { cwd: ROOT_DIR, label: "Vercel production environment lookup" },
      ));
    },
    addVercelEnvironment(secret) {
      defaultCommand(
        "npx",
        vercelArgs("env", "add", ENVIRONMENT_VARIABLE, "production", "--sensitive", "--yes", "--cwd", config.vercelProjectDirectory),
        { cwd: ROOT_DIR, input: `${secret}\n`, label: "Vercel production environment installation" },
      );
    },
    removeVercelEnvironment() {
      defaultCommand(
        "npx",
        vercelArgs("env", "remove", ENVIRONMENT_VARIABLE, "production", "--yes", "--cwd", config.vercelProjectDirectory),
        { cwd: ROOT_DIR, label: "Vercel production environment rollback" },
      );
    },
  };
}

async function listAll(listPromise) {
  if (typeof listPromise.autoPagingToArray === "function") {
    return listPromise.autoPagingToArray({ limit: 1000 });
  }
  const rows = [];
  for await (const row of listPromise) rows.push(row);
  return rows;
}

async function createDefaultStripeDependencies(config) {
  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(config.secretKey, { apiVersion: STRIPE_API_VERSION });
  return {
    listStripeEndpoints: () => listAll(stripe.webhookEndpoints.list({ limit: 100 })),
    createStripeEndpoint: () => stripe.webhookEndpoints.create(
      {
        api_version: STRIPE_API_VERSION,
        connect: true,
        description: "Grainline disabled Connect payout bootstrap",
        enabled_events: [REQUIRED_EVENT],
        url: config.bootstrapUrl,
      },
      { idempotencyKey: `grainline-connect-bootstrap-${config.expectedCommit}-${config.ciRunId}` },
    ),
    disableStripeEndpoint: (id) => stripe.webhookEndpoints.update(id, { disabled: true }),
    retrieveStripeEndpoint: (id) => stripe.webhookEndpoints.retrieve(id),
    deleteStripeEndpoint: (id) => stripe.webhookEndpoints.del(id),
  };
}

function reserveEvidence(evidencePath) {
  const pendingPath = `${evidencePath}.pending`;
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  if (existsSync(evidencePath) || existsSync(pendingPath)) {
    throw new Error("evidence path or pending reservation already exists");
  }
  writeFileSync(pendingPath, "", { encoding: "utf8", mode: 0o600, flag: "wx" });
  chmodSync(pendingPath, 0o600);
  return pendingPath;
}

function finalizeEvidence(pendingPath, evidencePath, payload) {
  writeFileSync(pendingPath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(pendingPath, 0o600);
  renameSync(pendingPath, evidencePath);
}

function discardEvidence(pendingPath) {
  if (pendingPath && existsSync(pendingPath)) unlinkSync(pendingPath);
}

async function rollback({ config, deps, endpointId, createAttempted, vercelAddAttempted }) {
  const failures = [];
  if (vercelAddAttempted) {
    try {
      const current = await deps.listVercelEnvironment();
      const matches = findProductionEnvironmentVariable(current);
      if (matches.length > 1) {
        throw new Error("Vercel rollback found multiple production Connect secrets");
      }
      if (matches.length === 1) {
        await deps.removeVercelEnvironment();
        assertNoProductionVariable(await deps.listVercelEnvironment());
      }
    } catch (error) {
      failures.push(`Vercel rollback: ${safeError(error)}`);
    }
  }

  let deletionId = endpointId;
  if (!deletionId && createAttempted) {
    try {
      const candidates = (await deps.listStripeEndpoints()).filter((endpoint) => (
        endpoint?.url === config.bootstrapUrl
        && endpoint?.livemode === (config.providerMode === "live")
        && exactEvents(endpoint)
      ));
      if (candidates.length === 1) deletionId = candidates[0].id;
      else if (candidates.length > 0) failures.push("Stripe rollback found multiple exact bootstrap candidates");
    } catch (error) {
      failures.push(`Stripe rollback reconciliation: ${safeError(error)}`);
    }
  }
  if (deletionId) {
    try {
      const deleted = await deps.deleteStripeEndpoint(deletionId);
      if (deleted?.deleted !== true || deleted?.id !== deletionId) {
        throw new Error("Stripe deletion response did not attest the exact endpoint");
      }
    } catch (error) {
      failures.push(`Stripe rollback: ${safeError(error)}`);
    }
  }
  return failures;
}

export async function runStripeConnectBootstrap({ env = process.env, dependencies = {} } = {}) {
  const config = parseConfig(env);
  const local = { ...createDefaultLocalDependencies(config), ...dependencies };
  if (await local.currentCommit() !== config.expectedCommit) {
    throw new Error("current commit does not match the reviewed commit");
  }
  assertSuccessfulCi(await local.ciRun(), config);
  assertReviewedProject(await local.readVercelProject());
  assertNoProductionVariable(await local.listVercelEnvironment());

  const stripeDefaults = dependencies.listStripeEndpoints
    ? {}
    : await createDefaultStripeDependencies(config);
  const deps = { ...local, ...stripeDefaults, ...dependencies };
  const existingEndpoints = await deps.listStripeEndpoints();
  const conflicts = endpointConflicts(existingEndpoints, config);
  if (conflicts.length > 0) {
    throw new Error("a Stripe endpoint already occupies the bootstrap or canonical URL");
  }
  if (config.mode === "preflight") {
    return Object.freeze({
      ciRunId: config.ciRunId,
      expectedCommit: config.expectedCommit,
      mode: "preflight",
      providerMode: config.providerMode,
      status: "passed",
    });
  }

  let pendingPath;
  let endpointId;
  let createAttempted = false;
  let vercelAddAttempted = false;
  try {
    pendingPath = (dependencies.reserveEvidence || reserveEvidence)(config.evidencePath);
    createAttempted = true;
    const created = await deps.createStripeEndpoint();
    endpointId = typeof created?.id === "string" ? created.id : undefined;
    if (!endpointId || typeof created?.secret !== "string" || !/^whsec_[A-Za-z0-9_]+$/.test(created.secret)) {
      throw new Error("Stripe create response did not include the exact endpoint ID and one-time signing secret");
    }
    const signingSecret = created.secret;

    await deps.disableStripeEndpoint(endpointId);
    const disabled = assertExactDisabledEndpoint(await deps.retrieveStripeEndpoint(endpointId), config);
    vercelAddAttempted = true;
    await deps.addVercelEnvironment(signingSecret);
    assertSensitiveProductionVariable(await deps.listVercelEnvironment());

    const payload = {
      generatedAt: new Date().toISOString(),
      phase: "stripe-connect-disabled-bootstrap",
      status: "passed",
      mode: config.providerMode,
      commit: config.expectedCommit,
      ciRunId: config.ciRunId,
      stripe: {
        endpointIdSha256: endpointDigest(endpointId),
        url: disabled.url,
        status: disabled.status,
        livemode: disabled.livemode,
        enabledEvents: [REQUIRED_EVENT],
        connectedAccountSourceRequestedAtCreation: true,
        signingSecretPersistedInEvidence: false,
      },
      vercel: {
        environment: "production",
        name: ENVIRONMENT_VARIABLE,
        classification: "Sensitive",
        valuePersistedInEvidence: false,
      },
      nextBoundary: "deploy compatible app while the Stripe endpoint remains disabled",
    };
    (dependencies.finalizeEvidence || finalizeEvidence)(pendingPath, config.evidencePath, payload);
    pendingPath = undefined;
    return Object.freeze(payload);
  } catch (error) {
    const rollbackFailures = await rollback({
      config,
      deps,
      endpointId,
      createAttempted,
      vercelAddAttempted,
    });
    (dependencies.discardEvidence || discardEvidence)(pendingPath);
    const suffix = rollbackFailures.length > 0
      ? `; rollback incomplete: ${rollbackFailures.join("; ")}`
      : "; rollback completed";
    throw new Error(`${safeError(error)}${suffix}`);
  }
}

async function main() {
  try {
    const result = await runStripeConnectBootstrap();
    process.stdout.write(`${JSON.stringify({
      ciRunId: result.ciRunId,
      commit: result.commit ?? result.expectedCommit,
      mode: result.mode,
      phase: result.phase ?? "stripe-connect-disabled-bootstrap-preflight",
      status: result.status,
    })}\n`);
  } catch (error) {
    process.stderr.write(`Stripe Connect bootstrap failed: ${safeError(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
