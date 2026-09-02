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
export const REVIEWED_PROJECT = Object.freeze({
  orgId: "team_wvQeQHZGwCSwinC1uB7xbpjr",
  projectId: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp",
});
export const REQUIRED_ALIASES = Object.freeze([
  "thegrainline.com",
  "grainline.vercel.app",
  "www.thegrainline.com",
  "grainline-drew-youngs-projects.vercel.app",
]);
export const EVIDENCE_DIRECTORY = "/Users/drewyoung/grainline-rollout-evidence";
export const LOCAL_ENV_PATH = "/Users/drewyoung/grainline/.env.local";
export const OWNER_ENV_PATH = "/Users/drewyoung/grainline/.env.migration-owner.local";
export const STATE_PATH = path.join(
  EVIDENCE_DIRECTORY,
  "order-authenticated-route-smoke-state.json",
);

// Corrected seller-shipping policy application release. This is deliberately
// distinct from the later operator commit/CI binding: the smoke must execute
// from its own exact green main while proving this exact deployed application.
export const RELEASE_BINDING = Object.freeze({
  commit: "b22fa138d84bad792ba206ee00dacb48d475d4a4",
  ciRunId: 33595797533,
  deploymentId: "dpl_6vA4bWrP4KhADtGAXKsisXdmvJBX",
  origin: PRODUCTION_ORIGIN,
});

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

export function assertGitState(state, operatorCommit) {
  if (
    !/^[a-f0-9]{40}$/.test(operatorCommit ?? "")
    || state?.branch !== "main"
    || state.head !== operatorCommit
    || state.status !== ""
  ) {
    throw new Error("authenticated Order smoke requires exact clean reviewed main");
  }
  return Object.freeze({ branch: "main", clean: true, head: operatorCommit });
}

export function parseGitHubCiRun(raw, expectedCommit, expectedRunId) {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (
    !/^[a-f0-9]{40}$/.test(expectedCommit ?? "")
    || !Number.isSafeInteger(expectedRunId)
    || expectedRunId < 1
    || value?.databaseId !== expectedRunId
    || value.headSha !== expectedCommit
    || value.conclusion !== "success"
    || value.status !== "completed"
    || value.workflowName !== "CI"
    || value.headBranch !== "main"
    || value.event !== "push"
  ) {
    throw new Error("authenticated Order smoke exact-main CI binding did not pass");
  }
  return Object.freeze({ exactCommit: true, passed: true, runId: expectedRunId });
}

export function parseVercelDeployment(raw, binding = RELEASE_BINDING) {
  const exact = assertReleaseBinding(binding);
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  const aliases = value?.alias ?? value?.aliases ?? [];
  if (
    value?.id !== exact.deploymentId
    || value.target !== "production"
    || value.readyState !== "READY"
    || value.meta?.gitCommitSha !== exact.commit
    || value.project?.id !== REVIEWED_PROJECT.projectId
    || value.team?.id !== REVIEWED_PROJECT.orgId
    || REQUIRED_ALIASES.some((alias) => !aliases.includes(alias))
  ) {
    throw new Error("authenticated Order smoke deployment binding drifted");
  }
  return Object.freeze({
    aliases: Object.freeze([...aliases]),
    deploymentId: exact.deploymentId,
    ready: true,
    sourceCommit: exact.commit,
  });
}

export function validateConfiguration(env = process.env, binding = RELEASE_BINDING) {
  const exact = assertReleaseBinding(binding);
  if (env.ORDER_AUTH_ROUTE_SMOKE_CONFIRM !== CONFIRMATION) {
    throw new Error("authenticated Order smoke confirmation is invalid");
  }
  const operatorCommit = required(env, "ORDER_AUTH_ROUTE_SMOKE_OPERATOR_COMMIT");
  if (!/^[a-f0-9]{40}$/.test(operatorCommit)) {
    throw new Error("authenticated Order smoke operator commit is invalid");
  }
  const operatorCiRunId = positiveInteger(env, "ORDER_AUTH_ROUTE_SMOKE_OPERATOR_CI_RUN_ID");
  const evidencePath = path.resolve(required(env, "ORDER_AUTH_ROUTE_SMOKE_EVIDENCE_PATH"));
  if (
    path.dirname(evidencePath) !== EVIDENCE_DIRECTORY
    || path.basename(evidencePath) !== `order-authenticated-route-smoke-${operatorCommit}.json`
    || existsSync(evidencePath)
  ) {
    throw new Error("authenticated Order smoke evidence path is not fresh and exact");
  }
  return Object.freeze({
    evidencePath,
    operatorCiRunId,
    operatorCommit,
    release: exact,
  });
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

export function validateRestartState(state, config, binding = RELEASE_BINDING) {
  const exact = assertReleaseBinding(binding);
  if (
    !state
    || typeof state !== "object"
    || state.operatorCommit !== config?.operatorCommit
    || state.operatorCiRunId !== config?.operatorCiRunId
    || state.deployedCommit !== exact.commit
    || state.deployedCiRunId !== exact.ciRunId
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

export function assertBuyerQuote(body, expectedSubjectHash) {
  if (
    !body
    || !Array.isArray(body.rates)
    || body.rates.length < 1
    || body.rates.length > 12
    || !/^[A-Za-z0-9_-]{32}$/.test(expectedSubjectHash ?? "")
  ) throw new Error("buyer shipping quote shape drifted");
  const rate = body.rates.find((candidate) =>
    candidate?.objectId !== "pickup"
    && typeof candidate?.objectId === "string"
    && candidate.objectId.startsWith("quote-only:")
  );
  if (
    !rate
    || rate.subjectHash !== expectedSubjectHash
    || !Number.isSafeInteger(rate.amountCents)
    || rate.amountCents < 0
    || rate.amountCents > 500_000
    || rate.currency !== "usd"
    || !/^[a-f0-9]{64}$/.test(rate.token ?? "")
    || !Number.isSafeInteger(rate.expiresAt)
  ) throw new Error("buyer shipping quote did not bind the reviewed package");
  return Object.freeze({ ...rate });
}

export function assertCheckoutRouteResult({ body, expectedSessionId = null, status }) {
  if (
    status !== 200
    || !body
    || typeof body.sessionId !== "string"
    || !body.sessionId.startsWith("cs_test_")
    || (expectedSessionId !== null && body.sessionId !== expectedSessionId)
    || (expectedSessionId !== null && body.reused !== true)
  ) throw new Error("buyer checkout route result drifted");
  return body.sessionId;
}

export function assertLabelRequote({ body, status }) {
  if (
    status !== 202
    || body?.requiresRateSelection !== true
    || !Array.isArray(body.rates)
    || body.rates.length < 1
    || body.rates.length > 4
  ) throw new Error("seller label re-quote result drifted");
  for (const rate of body.rates) {
    if (
      typeof rate?.objectId !== "string"
      || !/^[A-Za-z0-9._:-]{1,255}$/.test(rate.objectId)
      || rate.objectId === "pickup"
      || rate.objectId === "fallback"
      || rate.objectId.startsWith("quote-only:")
      || !Number.isSafeInteger(rate.amountCents)
      || rate.amountCents < 0
      || rate.amountCents > 500_000
      || rate.currency !== "usd"
    ) throw new Error("seller label re-quote contained an invalid fixed rate");
  }
  return Object.freeze({ ...body.rates[0] });
}

export function assertLabelPurchase({ body, status }) {
  if (
    status !== 200
    || body?.ok !== true
    || body.order?.labelStatus !== "PURCHASED"
    || body.order?.fulfillmentStatus !== "SHIPPED"
    || typeof body.order?.id !== "string"
    || typeof body.order?.labelCarrier !== "string"
  ) throw new Error("seller label purchase result drifted");
  return Object.freeze({
    fulfillmentStatus: body.order.fulfillmentStatus,
    labelStatus: body.order.labelStatus,
  });
}

export function assertPrivateLabelRedirect({ cacheControl, location, pragma, status }) {
  let parsed;
  try {
    parsed = new URL(location);
  } catch {
    throw new Error("seller label download redirect is invalid");
  }
  if (
    status !== 302
    || parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || cacheControl !== "private, no-store, max-age=0"
    || pragma !== "no-cache"
  ) throw new Error("seller label download privacy boundary drifted");
  return Object.freeze({ privateNoStore: true, status: 302 });
}

export function assertFulfillmentRedirect({ location, orderId, status }) {
  if (
    status !== 303
    || location !== `${PRODUCTION_ORIGIN}/dashboard/sales/${orderId}`
  ) throw new Error("seller fulfillment redirect drifted");
  return Object.freeze({ orderId, status: 303 });
}

export function assertReceiptRedirect({ location, orderId, status }) {
  if (
    status !== 303
    || location !== `${PRODUCTION_ORIGIN}/dashboard/orders/${orderId}`
  ) throw new Error("buyer receipt redirect drifted");
  return Object.freeze({ orderId, status: 303 });
}

export function sanitizedEvidence({ binding, cleanup, operator, result, status }) {
  const exact = assertReleaseBinding(binding);
  if (
    !/^[a-f0-9]{40}$/.test(operator?.commit ?? "")
    || !Number.isSafeInteger(operator?.ciRunId)
    || operator.ciRunId < 1
  ) throw new Error("authenticated Order smoke operator evidence binding is invalid");
  if (!new Set(["passed", "failed"]).has(status)) {
    throw new Error("authenticated Order smoke evidence status is invalid");
  }
  return Object.freeze({
    generatedAt: new Date().toISOString(),
    operation: "order-authenticated-route-smoke",
    productionChangedByProof: false,
    release: exact,
    operator: Object.freeze({ commit: operator.commit, ciRunId: operator.ciRunId }),
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
