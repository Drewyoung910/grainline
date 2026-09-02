#!/usr/bin/env node
// Restart-safe authenticated Order route smoke. This scaffold is deliberately
// deployment-disabled until an exact corrected main/CI/deployment binding is
// installed after the seller-shipping policy release. It contains only local
// preflight, identity, state and evidence contracts; no production operation
// is reachable while RELEASE_BINDING is null.
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parsePublishableKey } from "@clerk/shared/keys";
import { parse as parseDotenv } from "dotenv";

export const CONFIRMATION = "reviewed-order-authenticated-route-smoke";
export const PRODUCTION_ORIGIN = "https://thegrainline.com";
export const PRODUCTION_ENDPOINT_ID = "ep-plain-river-aaqg8gj4";
export const PRODUCTION_DATABASE_NAME = "neondb";
export const RUNTIME_ROLE = "grainline_app_runtime";
export const CLERK_FRONTEND_API = "clerk.thegrainline.com";
export const EVIDENCE_DIRECTORY = "/Users/drewyoung/grainline-rollout-evidence";
export const LOCAL_ENV_PATH = "/Users/drewyoung/grainline/.env.local";
export const OWNER_ENV_PATH = "/Users/drewyoung/grainline/.env.migration-owner.local";
export const STATE_PATH = path.join(
  EVIDENCE_DIRECTORY,
  "order-authenticated-route-smoke-state.json",
);

// Installed only after the corrected shipping source is merged, exact-main CI
// succeeds and that same source is manually deployed and source-attested.
export const RELEASE_BINDING = null;

const STAGES = Object.freeze([
  "prepared",
  "buyer-quote-checkout",
  "seller-label",
  "seller-fulfillment",
  "buyer-receipt",
  "cleanup",
  "cleaned",
]);

function required(env, key) {
  const value = env[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`missing required ${key}`);
  }
  return value.trim();
}

function positiveInteger(env, key) {
  const value = required(env, key);
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${key} must be a positive integer`);
  }
  return Number(value);
}

export function assertPrivateRegularFile(filePath, label) {
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error(`${label} must be a mode-0600 regular file`);
  }
}

export function readPrivateJson(filePath, label) {
  assertPrivateRegularFile(filePath, label);
  const value = JSON.parse(readFileSync(filePath, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  return value;
}

export function writePrivateJson(filePath, value) {
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

export function replacePrivateJson(filePath, value) {
  const nextPath = `${filePath}.next`;
  if (existsSync(nextPath)) throw new Error(`stale state update exists for ${filePath}`);
  writePrivateJson(nextPath, value);
  renameSync(nextPath, filePath);
  chmodSync(filePath, 0o600);
}

export function loadPrivateEnvironment(filePath, label) {
  assertPrivateRegularFile(filePath, label);
  return parseDotenv(readFileSync(filePath, "utf8"));
}

export function assertReleaseBinding(binding = RELEASE_BINDING) {
  if (
    !binding
    || typeof binding !== "object"
    || !/^[a-f0-9]{40}$/.test(binding.commit ?? "")
    || !Number.isSafeInteger(binding.ciRunId)
    || binding.ciRunId < 1
    || !/^dpl_[A-Za-z0-9]{20,64}$/.test(binding.deploymentId ?? "")
    || binding.origin !== PRODUCTION_ORIGIN
  ) {
    throw new Error("authenticated Order smoke remains deployment-disabled");
  }
  return Object.freeze({
    ciRunId: binding.ciRunId,
    commit: binding.commit,
    deploymentId: binding.deploymentId,
    origin: binding.origin,
  });
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

export function assertGitState(state, binding = RELEASE_BINDING) {
  const exact = assertReleaseBinding(binding);
  if (state?.branch !== "main" || state.head !== exact.commit || state.status !== "") {
    throw new Error("authenticated Order smoke requires exact clean reviewed main");
  }
  return Object.freeze({ branch: "main", clean: true, head: exact.commit });
}

export function parseGitHubCiRun(raw, binding = RELEASE_BINDING) {
  const exact = assertReleaseBinding(binding);
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (
    value?.databaseId !== exact.ciRunId
    || value.headSha !== exact.commit
    || value.conclusion !== "success"
    || value.status !== "completed"
    || value.workflowName !== "CI"
  ) {
    throw new Error("authenticated Order smoke exact-main CI binding did not pass");
  }
  return Object.freeze({ exactCommit: true, passed: true, runId: exact.ciRunId });
}

export function validateConfiguration(env = process.env, binding = RELEASE_BINDING) {
  const exact = assertReleaseBinding(binding);
  if (env.ORDER_AUTH_ROUTE_SMOKE_CONFIRM !== CONFIRMATION) {
    throw new Error("authenticated Order smoke confirmation is invalid");
  }
  if (required(env, "ORDER_AUTH_ROUTE_SMOKE_COMMIT") !== exact.commit) {
    throw new Error("authenticated Order smoke commit binding drifted");
  }
  if (positiveInteger(env, "ORDER_AUTH_ROUTE_SMOKE_CI_RUN_ID") !== exact.ciRunId) {
    throw new Error("authenticated Order smoke CI binding drifted");
  }
  if (required(env, "ORDER_AUTH_ROUTE_SMOKE_DEPLOYMENT_ID") !== exact.deploymentId) {
    throw new Error("authenticated Order smoke deployment binding drifted");
  }
  const evidencePath = path.resolve(required(env, "ORDER_AUTH_ROUTE_SMOKE_EVIDENCE_PATH"));
  if (
    path.dirname(evidencePath) !== EVIDENCE_DIRECTORY
    || path.basename(evidencePath) !== `order-authenticated-route-smoke-${exact.commit}.json`
    || existsSync(evidencePath)
  ) {
    throw new Error("authenticated Order smoke evidence path is not fresh and exact");
  }
  return Object.freeze({ ...exact, evidencePath });
}

export function parseDatabaseUrls(localValues, ownerValues) {
  const runtimeDatabaseUrl = required(localValues, "DATABASE_URL");
  const ownerDatabaseUrl = required(ownerValues, "DIRECT_URL");
  const runtime = new URL(runtimeDatabaseUrl);
  const owner = new URL(ownerDatabaseUrl);
  if (
    runtime.protocol !== "postgresql:"
    || runtime.username !== RUNTIME_ROLE
    || runtime.hostname !== `${PRODUCTION_ENDPOINT_ID}-pooler.westus3.azure.neon.tech`
    || runtime.pathname !== `/${PRODUCTION_DATABASE_NAME}`
    || runtime.searchParams.get("sslmode") !== "verify-full"
    || runtime.searchParams.get("channel_binding") !== "require"
    || !runtime.password
  ) throw new Error("authenticated Order smoke runtime database identity drifted");
  if (
    owner.protocol !== "postgresql:"
    || owner.username !== "neondb_owner"
    || owner.hostname !== `${PRODUCTION_ENDPOINT_ID}.westus3.azure.neon.tech`
    || owner.pathname !== `/${PRODUCTION_DATABASE_NAME}`
    || owner.searchParams.get("sslmode") !== "verify-full"
    || owner.searchParams.get("channel_binding") !== "require"
    || !owner.password
  ) throw new Error("authenticated Order smoke owner database identity drifted");
  return Object.freeze({ ownerDatabaseUrl, runtimeDatabaseUrl });
}

export function validateProviderCredentials(localValues) {
  const stripeSecret = required(localValues, "STRIPE_SECRET_KEY");
  const shippoApiKey = required(localValues, "SHIPPO_API_KEY");
  const clerkSecret = required(localValues, "CLERK_SECRET_KEY");
  const clerkPublishable = required(localValues, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
  const redisUrl = required(localValues, "UPSTASH_REDIS_REST_URL");
  const redisToken = required(localValues, "UPSTASH_REDIS_REST_TOKEN");
  if (!stripeSecret.startsWith("sk_test_")) {
    throw new Error("authenticated Order smoke refuses non-test Stripe");
  }
  if (!shippoApiKey.startsWith("shippo_test_")) {
    throw new Error("authenticated Order smoke refuses non-test Shippo");
  }
  if (!clerkSecret.startsWith("sk_live_") || !clerkPublishable.startsWith("pk_live_")) {
    throw new Error("authenticated Order smoke requires the reviewed live Clerk pair");
  }
  const parsed = parsePublishableKey(clerkPublishable);
  if (parsed.instanceType !== "production" || parsed.frontendApi !== CLERK_FRONTEND_API) {
    throw new Error("authenticated Order smoke Clerk identity drifted");
  }
  if (!redisUrl.startsWith("https://") || redisToken.length < 16) {
    throw new Error("authenticated Order smoke Redis credentials are invalid");
  }
  return Object.freeze({
    clerkSecret,
    redisToken,
    redisUrl,
    shippoApiKey,
    stripeSecret,
  });
}

export function buildFixtureIds(marker) {
  if (!/^[a-f0-9]{32}$/.test(marker)) throw new Error("fixture marker is invalid");
  return Object.freeze({
    buyerUserId: `ord-smoke-buyer-${marker}`,
    sellerUserId: `ord-smoke-seller-${marker}`,
    sellerProfileId: `ord-smoke-shop-${marker}`,
    listingId: `ord-smoke-listing-${marker}`,
    labelOrderId: `ord-smoke-label-${marker}`,
    fulfillmentOrderId: `ord-smoke-fulfillment-${marker}`,
    receiptOrderId: `ord-smoke-receipt-${marker}`,
  });
}

export function validateRestartState(state, binding = RELEASE_BINDING) {
  const exact = assertReleaseBinding(binding);
  if (
    !state
    || typeof state !== "object"
    || state.commit !== exact.commit
    || state.ciRunId !== exact.ciRunId
    || state.deploymentId !== exact.deploymentId
    || !/^[a-f0-9]{32}$/.test(state.marker ?? "")
    || !STAGES.includes(state.stage)
    || state.fixtureIds == null
    || JSON.stringify(state.fixtureIds) !== JSON.stringify(buildFixtureIds(state.marker))
  ) throw new Error("authenticated Order smoke restart state drifted");
  return Object.freeze({
    ...state,
    stageIndex: STAGES.indexOf(state.stage),
  });
}

export function sanitizedEvidence({ binding, cleanup, result, status }) {
  const exact = assertReleaseBinding(binding);
  if (!new Set(["passed", "failed"]).has(status)) {
    throw new Error("authenticated Order smoke evidence status is invalid");
  }
  return Object.freeze({
    generatedAt: new Date().toISOString(),
    operation: "order-authenticated-route-smoke",
    productionChangedByProof: false,
    release: exact,
    status,
    result: {
      buyerQuantityTwoCheckoutPassed: result?.buyerQuantityTwoCheckoutPassed === true,
      sellerLabelPassed: result?.sellerLabelPassed === true,
      sellerFulfillmentPassed: result?.sellerFulfillmentPassed === true,
      buyerReceiptPassed: result?.buyerReceiptPassed === true,
      providerModes: { shippo: "test", stripe: "test" },
    },
    cleanup: {
      canaryRestored: cleanup?.canaryRestored === true,
      clerkSessionsRevoked: cleanup?.clerkSessionsRevoked === true,
      databaseFixturesDeleted: cleanup?.databaseFixturesDeleted === true,
      redisKeysDeleted: cleanup?.redisKeysDeleted === true,
    },
    expectedRetainedProviderEvidence: {
      stripeTestCheckoutSessions: Number(result?.stripeTestCheckoutSessions ?? 0),
      shippoTestTransactions: Number(result?.shippoTestTransactions ?? 0),
    },
  });
}

async function main() {
  assertReleaseBinding();
  throw new Error("authenticated Order smoke route phases are not installed yet");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "authenticated Order smoke failed");
    process.exitCode = 1;
  });
}
