#!/usr/bin/env node
// Restart-safe authenticated Order route smoke. Every production application,
// operator, CI, provider-mode, database-role, fixture and cleanup boundary is
// checked before the marker-bound route phases are allowed to run.
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
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
import { createClerkClient } from "@clerk/backend";
import { parsePublishableKey } from "@clerk/shared/keys";
import { Redis } from "@upstash/redis";
import { parse as parseDotenv } from "dotenv";
import pg from "pg";
import Stripe from "stripe";
import { NOTIFICATION_CANARY_EXTERNAL_ID } from "./notification-operational-canary.mjs";

const { Client } = pg;

export const CONFIRMATION = "reviewed-order-authenticated-route-smoke";
export const PRODUCTION_ORIGIN = "https://thegrainline.com";
export const PRODUCTION_ENDPOINT_ID = "ep-plain-river-aaqg8gj4";
export const PRODUCTION_DATABASE_NAME = "neondb";
export const RUNTIME_ROLE = "grainline_app_runtime";
export const CLERK_FRONTEND_API = "clerk.thegrainline.com";
export const TERMS_VERSION = "2026-06-14";
export const VERCEL_CLI_VERSION = "58.9.0";
export const FIXTURE_STOCK = 5;
export const ADDRESS = Object.freeze({
  name: "Grainline Route Canary",
  line1: "123 Main St",
  line2: null,
  city: "Austin",
  state: "TX",
  postalCode: "78701",
  phone: null,
});
const MAX_JSON_BYTES = 256 * 1024;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
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
    || !aliases.includes("grainline-drew-youngs-projects.vercel.app")
  ) {
    throw new Error("authenticated Order smoke deployment binding drifted");
  }
  return Object.freeze({
    providerAliases: Object.freeze([...aliases]),
    deploymentId: exact.deploymentId,
    ready: true,
    sourceCommit: exact.commit,
  });
}

export function parseVercelAliasInspection(raw, alias, binding = RELEASE_BINDING) {
  const exact = assertReleaseBinding(binding);
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (
    !REQUIRED_ALIASES.includes(alias)
    || value?.id !== exact.deploymentId
    || value.target !== "production"
    || value.readyState !== "READY"
  ) throw new Error(`authenticated Order smoke alias binding drifted for ${alias}`);
  return Object.freeze({ alias, deploymentId: exact.deploymentId, ready: true });
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
  const cleanupOnly = env.ORDER_AUTH_ROUTE_SMOKE_CLEANUP_ONLY === "1";
  if (
    env.ORDER_AUTH_ROUTE_SMOKE_CLEANUP_ONLY !== undefined
    && env.ORDER_AUTH_ROUTE_SMOKE_CLEANUP_ONLY !== ""
    && env.ORDER_AUTH_ROUTE_SMOKE_CLEANUP_ONLY !== "1"
  ) throw new Error("authenticated Order smoke cleanup-only flag is invalid");
  const evidencePath = path.resolve(required(env, "ORDER_AUTH_ROUTE_SMOKE_EVIDENCE_PATH"));
  if (
    path.dirname(evidencePath) !== EVIDENCE_DIRECTORY
    || path.basename(evidencePath) !== `order-authenticated-route-smoke-${operatorCommit}.json`
    || (existsSync(evidencePath) && !existsSync(STATE_PATH))
  ) {
    throw new Error("authenticated Order smoke evidence path is not fresh and exact");
  }
  return Object.freeze({
    evidencePath,
    cleanupOnly,
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

function verifyGitHubCi(expectedCommit, expectedRunId) {
  const raw = execFileSync("gh", [
    "run", "view", String(expectedRunId), "--json",
    "databaseId,headSha,conclusion,status,workflowName,headBranch,event",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return parseGitHubCiRun(raw, expectedCommit, expectedRunId);
}

export function verifyVercelDeployment(binding = RELEASE_BINDING) {
  const raw = execFileSync("npx", [
    "--yes", `vercel@${VERCEL_CLI_VERSION}`, "api",
    `/v13/deployments/${binding.deploymentId}`, "--raw", "--no-color",
    "--scope", "drew-youngs-projects",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const deployment = parseVercelDeployment(raw, binding);
  const aliases = REQUIRED_ALIASES.map((alias) => {
    const inspection = execFileSync("npx", [
      "--yes", `vercel@${VERCEL_CLI_VERSION}`, "inspect", alias,
      "--json", "--scope", "drew-youngs-projects",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return parseVercelAliasInspection(inspection, alias, binding);
  });
  return Object.freeze({ ...deployment, aliases: Object.freeze(aliases) });
}

async function boundedText(response, maxBytes) {
  const value = await response.text();
  if (Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new Error("authenticated Order route response exceeded its reviewed size bound");
  }
  return value;
}

async function boundedJson(response) {
  const value = JSON.parse(await boundedText(response, MAX_JSON_BYTES));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("authenticated Order route response was not a JSON object");
  }
  return value;
}

async function fetchRoute(pathname, token, {
  body,
  method = "GET",
  origin = PRODUCTION_ORIGIN,
  expectJson = true,
} = {}) {
  const response = await fetch(`${PRODUCTION_ORIGIN}${pathname}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      authorization: `Bearer ${token}`,
      "cache-control": "no-store",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(origin ? { origin } : {}),
    },
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(60_000),
  });
  return {
    body: expectJson ? await boundedJson(response) : null,
    headers: response.headers,
    status: response.status,
  };
}

function absorbClerkResponseCookies(response, jar) {
  const values = response.headers.getSetCookie?.() ?? [];
  if (values.length < 1 || values.length > 16) {
    throw new Error("Clerk cookie response drifted");
  }
  for (const value of values) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    const name = pair.slice(0, separator);
    const content = pair.slice(separator + 1);
    if (separator <= 0 || !/^[A-Za-z0-9_]+$/.test(name) || !content || content.length > 8_192) {
      throw new Error("Clerk returned an invalid cookie shape");
    }
    jar.set(name, content);
  }
}

function clerkCookieHeader(jar) {
  const value = [...jar].map(([name, content]) => `${name}=${content}`).join("; ");
  if (!value || value.length > 24_000) throw new Error("Clerk cookie jar drifted");
  return value;
}

async function createCanarySession(clerk, clerkUserId) {
  const signInToken = await clerk.signInTokens.createSignInToken({
    expiresInSeconds: 60,
    userId: clerkUserId,
  });
  if (!signInToken?.id || !signInToken?.token || signInToken.userId !== clerkUserId) {
    throw new Error("Clerk did not create the bounded one-use ticket");
  }
  const jar = new Map();
  const clientResponse = await fetch(`https://${CLERK_FRONTEND_API}/v1/client`, {
    body: "",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: PRODUCTION_ORIGIN },
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  absorbClerkResponseCookies(clientResponse, jar);
  const clientPayload = await boundedJson(clientResponse);
  if (clientResponse.status !== 200 || (clientPayload.response ?? clientPayload).object !== "client") {
    throw new Error("Clerk client handshake failed");
  }
  const exchange = await fetch(`https://${CLERK_FRONTEND_API}/v1/client/sign_ins`, {
    body: new URLSearchParams({ strategy: "ticket", ticket: signInToken.token }),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: clerkCookieHeader(jar),
      origin: PRODUCTION_ORIGIN,
    },
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  absorbClerkResponseCookies(exchange, jar);
  const payload = await boundedJson(exchange);
  const attempt = payload.response ?? payload;
  const sessionId = attempt.created_session_id;
  if (
    exchange.status !== 200
    || attempt.object !== "sign_in_attempt"
    || attempt.status !== "complete"
    || !/^sess_[A-Za-z0-9]+$/.test(String(sessionId ?? ""))
  ) throw new Error("Clerk one-use ticket exchange failed");
  const token = await clerk.sessions.getToken(sessionId, undefined, 300);
  if (typeof token?.jwt !== "string" || token.jwt.split(".").length !== 3) {
    throw new Error("Clerk session token shape drifted");
  }
  return { jwt: token.jwt, sessionId, signInTokenId: signInToken.id };
}

async function revokeCanarySessions(clerk, clerkUserId) {
  const active = await clerk.sessions.getSessionList({
    limit: 100,
    status: "active",
    userId: clerkUserId,
  });
  for (const session of active.data) await clerk.sessions.revokeSession(session.id);
  const after = await clerk.sessions.getSessionList({
    limit: 100,
    status: "active",
    userId: clerkUserId,
  });
  return after.totalCount === 0 && after.data.length === 0;
}

async function verifyDeploymentBoundary() {
  const health = await fetch(`${PRODUCTION_ORIGIN}/api/health`, {
    headers: { "cache-control": "no-store" },
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const healthBody = await boundedJson(health);
  if (health.status !== 200 || healthBody.ok !== true) {
    throw new Error("production health check failed");
  }
  const page = await fetch(PRODUCTION_ORIGIN, {
    headers: { "cache-control": "no-store" },
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const pageBody = await boundedText(page, MAX_PAGE_BYTES);
  if (page.status !== 200 || !pageBody.includes(`dpl=${RELEASE_BINDING.deploymentId}`)) {
    throw new Error("canonical alias is not serving the reviewed deployment marker");
  }
  return Object.freeze({ canonicalDeploymentMarker: true, healthStatus: 200 });
}

async function verifyDatabaseIdentity(owner, runtime) {
  const [ownerIdentity, runtimeIdentity, posture] = await Promise.all([
    owner.query("SELECT current_user AS role, current_database() AS database"),
    runtime.query("SELECT current_user AS role, current_database() AS database"),
    owner.query(`
      SELECT class.relname AS table_name,
             class.relrowsecurity AS enabled,
             class.relforcerowsecurity AS forced,
             pg_catalog.pg_get_userbyid(class.relowner) AS owner
        FROM pg_catalog.pg_class AS class
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
       WHERE namespace.nspname = 'public'
         AND class.relname = ANY($1::text[])
         AND class.relkind = 'r'
       ORDER BY class.relname
    `, [["Order", "OrderItem", "OrderShippingRateQuote"]]),
  ]);
  assert.deepEqual(ownerIdentity.rows, [{ role: "neondb_owner", database: PRODUCTION_DATABASE_NAME }]);
  assert.deepEqual(runtimeIdentity.rows, [{ role: RUNTIME_ROLE, database: PRODUCTION_DATABASE_NAME }]);
  assert.deepEqual(posture.rows, [
    { table_name: "Order", enabled: false, forced: false, owner: "neondb_owner" },
    { table_name: "OrderItem", enabled: false, forced: false, owner: "neondb_owner" },
    { table_name: "OrderShippingRateQuote", enabled: false, forced: false, owner: "neondb_owner" },
  ]);
  return Object.freeze({ ownerRole: "neondb_owner", runtimeRole: RUNTIME_ROLE });
}

async function selectCanary(clerk, owner) {
  const users = await clerk.users.getUserList({
    externalId: [NOTIFICATION_CANARY_EXTERNAL_ID],
    limit: 2,
  });
  if (users.totalCount !== 1 || users.data.length !== 1) {
    throw new Error("expected exactly one retained operational canary");
  }
  const clerkUser = users.data[0];
  if (
    clerkUser.externalId !== NOTIFICATION_CANARY_EXTERNAL_ID
    || clerkUser.banned
    || clerkUser.locked
    || clerkUser.publicMetadata?.grainlineOperationalCanary
      !== "notification-rls-route-and-production-canary"
  ) throw new Error("operational canary identity drifted");
  const result = await owner.query(`
    SELECT account.id, account."clerkId", account.role::text, account."termsAcceptedAt",
           account."termsVersion", account."ageAttestedAt",
           account."notificationPreferences", account."emailPreferenceOptInAt",
           (seller.id IS NOT NULL) AS has_seller
      FROM public."User" AS account
      LEFT JOIN public."SellerProfile" AS seller ON seller."userId" = account.id
     WHERE account."clerkId" = $1 AND account."deletedAt" IS NULL AND NOT account.banned
  `, [clerkUser.id]);
  if (result.rowCount !== 1 || result.rows[0].role !== "USER" || result.rows[0].has_seller) {
    throw new Error("operational canary database identity drifted");
  }
  const candidate = result.rows[0];
  const residue = await owner.query(`
    SELECT
      (SELECT pg_catalog.count(*)::integer FROM public."Order" WHERE "buyerId" = $1) AS orders,
      (SELECT pg_catalog.count(*)::integer FROM public."CheckoutStockReservation"
        WHERE "buyerId" = $1 AND status IN ('RESERVED', 'SESSION_CREATED')) AS reservations
  `, [candidate.id]);
  assert.deepEqual(residue.rows, [{ orders: 0, reservations: 0 }]);
  const sessions = await clerk.sessions.getSessionList({ limit: 100, status: "active", userId: clerkUser.id });
  if (sessions.totalCount !== 0 || sessions.data.length !== 0) {
    throw new Error("operational canary has a pre-existing active Clerk session");
  }
  return Object.freeze({ ...candidate, clerkUserId: clerkUser.id });
}

async function selectCheckoutSeller(owner, stripe, buyerId) {
  const candidates = await owner.query(`
    SELECT seller.id, seller."userId", seller."stripeAccountId"
      FROM public."SellerProfile" AS seller
      JOIN public."User" AS account ON account.id = seller."userId"
     WHERE seller."chargesEnabled"
       AND seller."stripeAccountId" IS NOT NULL
       AND seller."vacationMode" = false
       AND seller."acceptingNewOrders"
       AND seller."useCalculatedShipping"
       AND NULLIF(pg_catalog.btrim(seller."shipFromName"), '') IS NOT NULL
       AND NULLIF(pg_catalog.btrim(seller."shipFromLine1"), '') IS NOT NULL
       AND NULLIF(pg_catalog.btrim(seller."shipFromCity"), '') IS NOT NULL
       AND NULLIF(pg_catalog.btrim(seller."shipFromState"), '') IS NOT NULL
       AND NULLIF(pg_catalog.btrim(seller."shipFromPostal"), '') IS NOT NULL
       AND NOT account.banned AND account."deletedAt" IS NULL
       AND seller."userId" <> $1
     ORDER BY seller.id
     LIMIT 10
  `, [buyerId]);
  for (const candidate of candidates.rows) {
    try {
      const account = await stripe.accounts.retrieve(candidate.stripeAccountId);
      if (account && !account.deleted && account.charges_enabled === true) {
        return Object.freeze({ ...candidate });
      }
    } catch {
      // Try the next independently validated existing test-mode seller.
    }
  }
  throw new Error("no existing eligible Stripe test-mode shipping seller was available");
}

export function shippingRateSubjectHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url").slice(0, 32);
}

function saveState(state) {
  if (existsSync(STATE_PATH)) replacePrivateJson(STATE_PATH, state);
  else writePrivateJson(STATE_PATH, state);
}

export function buildFixtureIds(marker) {
  if (!/^[a-f0-9]{32}$/.test(marker)) throw new Error("fixture marker is invalid");
  return Object.freeze({
    checkoutListingId: `ord-smoke-checkout-listing-${marker}`,
    syntheticBuyerUserId: `ord-smoke-buyer-${marker}`,
    canarySellerProfileId: `ord-smoke-canary-shop-${marker}`,
    labelListingId: `ord-smoke-label-listing-${marker}`,
    labelOrderId: `ord-smoke-label-${marker}`,
    labelOrderItemId: `ord-smoke-label-item-${marker}`,
    fulfillmentListingId: `ord-smoke-fulfillment-listing-${marker}`,
    fulfillmentOrderId: `ord-smoke-fulfillment-${marker}`,
    fulfillmentOrderItemId: `ord-smoke-fulfillment-item-${marker}`,
    receiptSellerUserId: `ord-smoke-receipt-seller-${marker}`,
    receiptSellerProfileId: `ord-smoke-receipt-shop-${marker}`,
    receiptListingId: `ord-smoke-receipt-listing-${marker}`,
    receiptOrderId: `ord-smoke-receipt-${marker}`,
    receiptOrderItemId: `ord-smoke-receipt-item-${marker}`,
    syntheticBuyerSuppressionId: `ord-smoke-email-suppression-${marker}`,
  });
}

export function validateRestartState(state, config, binding = RELEASE_BINDING) {
  const exact = assertReleaseBinding(binding);
  const validTimestamp = (value) => value === null
    || (typeof value === "string" && !Number.isNaN(Date.parse(value)));
  const validId = (value, maximum = 255) => typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && /^[A-Za-z0-9:_-]+$/.test(value);
  const redisKeys = new Set([
    `account-state:vercel-production:clerk:${state?.canary?.clerkUserId}`,
    `checkout:single:${state?.canary?.userId}:listing:${state?.fixtureIds?.checkoutListingId}`,
  ]);
  const cleanupValid = state?.stage !== "cleaned"
    ? state?.cleanup === undefined
    : cleanupPassed(state?.cleanup);
  if (
    !state
    || typeof state !== "object"
    || state.version !== 1
    || state.operatorCommit !== config?.operatorCommit
    || state.operatorCiRunId !== config?.operatorCiRunId
    || state.deployedCommit !== exact.commit
    || state.deployedCiRunId !== exact.ciRunId
    || state.deploymentId !== exact.deploymentId
    || !/^[a-f0-9]{32}$/.test(state.marker ?? "")
    || !STAGES.includes(state.stage)
    || state.fixtureIds == null
    || JSON.stringify(state.fixtureIds) !== JSON.stringify(buildFixtureIds(state.marker))
    || !new Set(["running", "failed", "cleaned", "cleaned-after-failure"]).has(state.status)
    || typeof state.routePhasesPassed !== "boolean"
    || (state.stage === "cleaned"
      ? !new Set(["cleaned", "cleaned-after-failure"]).has(state.status)
      : new Set(["cleaned", "cleaned-after-failure"]).has(state.status))
    || !validTimestamp(state.startedAt)
    || Date.parse(state.startedAt) > Date.now() + 5 * 60_000
    || !validId(state.canary?.userId, 191)
    || !/^user_[A-Za-z0-9]+$/.test(state.canary?.clerkUserId ?? "")
    || state.canary?.originalRole !== "USER"
    || !validTimestamp(state.canary?.originalTermsAcceptedAt)
    || !(state.canary?.originalTermsVersion === null
      || (typeof state.canary?.originalTermsVersion === "string"
        && state.canary.originalTermsVersion.length <= 50))
    || !validTimestamp(state.canary?.originalAgeAttestedAt)
    || !validTimestamp(state.canary?.originalEmailPreferenceOptInAt)
    || !state.canary?.originalNotificationPreferences
    || typeof state.canary.originalNotificationPreferences !== "object"
    || Array.isArray(state.canary.originalNotificationPreferences)
    || JSON.stringify(state.canary.originalNotificationPreferences).length > 16_384
    || !Array.isArray(state.canary?.sessionIds)
    || state.canary.sessionIds.length > 32
    || new Set(state.canary.sessionIds).size !== state.canary.sessionIds.length
    || state.canary.sessionIds.some((id) => !/^sess_[A-Za-z0-9]+$/.test(id))
    || !validId(state.checkoutSeller?.sellerProfileId, 191)
    || !validId(state.checkoutSeller?.userId, 191)
    || !/^acct_[A-Za-z0-9]+$/.test(state.checkoutSeller?.stripeAccountId ?? "")
    || !Array.isArray(state.checkout?.reservationIds)
    || state.checkout.reservationIds.length > 1
    || new Set(state.checkout.reservationIds).size !== state.checkout.reservationIds.length
    || state.checkout.reservationIds.some((id) => !validId(id, 191))
    || !Array.isArray(state.checkout?.redisKeys)
    || state.checkout.redisKeys.length > 2
    || new Set(state.checkout.redisKeys).size !== state.checkout.redisKeys.length
    || state.checkout.redisKeys.some((key) => !redisKeys.has(key))
    || !(state.checkout?.stripeSessionId === null
      || /^cs_test_[A-Za-z0-9_]+$/.test(state.checkout.stripeSessionId))
    || typeof state.checkout?.signedExpiryObserved !== "boolean"
    || !(state.provider?.shippoTransactionId === null
      || validId(state.provider.shippoTransactionId, 255))
    || !cleanupValid
    || (state.stageIndex !== undefined && state.stageIndex !== STAGES.indexOf(state.stage))
  ) throw new Error("authenticated Order smoke restart state drifted");
  // This is intentionally mutable: the restart journal is advanced after each
  // successfully re-proven phase. Freezing the validated copy would make every
  // resumed run fail on its first state update.
  const validated = { ...state };
  // stageIndex was used only as a validation aid in the scaffold. Never carry
  // it into the mutable journal, where it would become stale after advancing
  // the stage and incorrectly block the following restart.
  delete validated.stageIndex;
  return validated;
}

function createInitialState(config, canary, checkoutSeller) {
  const marker = randomBytes(16).toString("hex");
  return {
    version: 1,
    status: "running",
    stage: "prepared",
    operatorCommit: config.operatorCommit,
    operatorCiRunId: config.operatorCiRunId,
    deployedCommit: RELEASE_BINDING.commit,
    deployedCiRunId: RELEASE_BINDING.ciRunId,
    deploymentId: RELEASE_BINDING.deploymentId,
    marker,
    fixtureIds: buildFixtureIds(marker),
    canary: {
      userId: canary.id,
      clerkUserId: canary.clerkUserId,
      originalTermsAcceptedAt: canary.termsAcceptedAt,
      originalTermsVersion: canary.termsVersion,
      originalAgeAttestedAt: canary.ageAttestedAt,
      originalNotificationPreferences: canary.notificationPreferences,
      originalEmailPreferenceOptInAt: canary.emailPreferenceOptInAt,
      originalRole: canary.role,
      sessionIds: [],
    },
    checkoutSeller: {
      sellerProfileId: checkoutSeller.id,
      userId: checkoutSeller.userId,
      stripeAccountId: checkoutSeller.stripeAccountId,
    },
    checkout: {
      reservationIds: [],
      redisKeys: [],
      stripeSessionId: null,
      signedExpiryObserved: false,
    },
    provider: { shippoTransactionId: null },
    routePhasesPassed: false,
    startedAt: new Date().toISOString(),
  };
}

export async function seedBuyerFixture(owner, redis, state) {
  const ids = state.fixtureIds;
  await owner.query("BEGIN");
  try {
    const adjusted = await owner.query(`
      UPDATE public."User"
         SET "termsAcceptedAt" = pg_catalog.clock_timestamp(),
             "termsVersion" = $2,
             "ageAttestedAt" = pg_catalog.clock_timestamp()
       WHERE id = $1 AND role::text = 'USER' AND NOT banned AND "deletedAt" IS NULL
    `, [state.canary.userId, TERMS_VERSION]);
    if (adjusted.rowCount !== 1) throw new Error("canary compliance fixture adjustment failed");
    const inserted = await owner.query(`
      INSERT INTO public."Listing" (
        id, "sellerId", title, description, "priceCents", "priceVersion", currency,
        status, "listingType", "stockQuantity", "shipsWithinDays", "isPrivate",
        "reservedForUserId", "packagedWeightGrams", "packagedLengthCm",
        "packagedWidthCm", "packagedHeightCm", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, 'Disposable private authenticated Order smoke fixture',
        500, 1, 'usd', 'ACTIVE', 'IN_STOCK', $4, 2, true, $5,
        500, 10, 10, 10, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
      ) ON CONFLICT (id) DO NOTHING
      RETURNING id
    `, [
      ids.checkoutListingId,
      state.checkoutSeller.sellerProfileId,
      `order-auth-route-checkout-${state.marker}`,
      FIXTURE_STOCK,
      state.canary.userId,
    ]);
    if (inserted.rowCount > 1) throw new Error("checkout Listing fixture insertion drifted");
    const exact = await owner.query(`
      SELECT id, "sellerId", status::text, "listingType"::text, "stockQuantity",
             "isPrivate", "reservedForUserId", "priceCents", "priceVersion",
             "packagedWeightGrams", "packagedLengthCm", "packagedWidthCm", "packagedHeightCm"
        FROM public."Listing" WHERE id = $1
    `, [ids.checkoutListingId]);
    assert.deepEqual(exact.rows, [{
      id: ids.checkoutListingId,
      sellerId: state.checkoutSeller.sellerProfileId,
      status: "ACTIVE",
      listingType: "IN_STOCK",
      stockQuantity: FIXTURE_STOCK,
      isPrivate: true,
      reservedForUserId: state.canary.userId,
      priceCents: 500,
      priceVersion: 1,
      packagedWeightGrams: 500,
      packagedLengthCm: 10,
      packagedWidthCm: 10,
      packagedHeightCm: 10,
    }]);
    await owner.query("COMMIT");
  } catch (error) {
    await owner.query("ROLLBACK").catch(() => {});
    throw error;
  }
  const accountStateKey = `account-state:vercel-production:clerk:${state.canary.clerkUserId}`;
  await redis.del(accountStateKey);
  if (!state.checkout.redisKeys.includes(accountStateKey)) {
    state.checkout.redisKeys.push(accountStateKey);
    saveState(state);
  }
}

function orderListingSnapshot(marker, title) {
  return {
    title,
    description: `Disposable authenticated Order fixture ${marker}`,
    priceCents: 500,
    imageUrls: [],
    category: "OTHER",
    tags: ["operator-canary"],
    sellerName: "Grainline Route Canary",
    capturedAt: new Date().toISOString(),
    listingType: "IN_STOCK",
    processingTimeMinDays: null,
    processingTimeMaxDays: null,
    shipsWithinDays: 2,
    shippingPackageComplete: true,
    shippingWeightGrams: 500,
    shippingLengthCm: 10,
    shippingWidthCm: 10,
    shippingHeightCm: 10,
  };
}

function uniqueRowsById(rows, expectedCount, label) {
  if (!Array.isArray(rows) || rows.length !== expectedCount) {
    throw new Error(`${label} fixture count drifted`);
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (byId.size !== expectedCount) throw new Error(`${label} fixture identity drifted`);
  return byId;
}

export function assertSeededOrderFixtureSnapshot(snapshot, state) {
  const ids = state?.fixtureIds;
  const marker = state?.marker;
  if (!ids || !/^[a-f0-9]{32}$/.test(marker ?? "")) {
    throw new Error("seeded Order fixture snapshot state is invalid");
  }
  const users = uniqueRowsById(snapshot?.users, 2, "User");
  assert.deepEqual(users.get(ids.syntheticBuyerUserId), {
    id: ids.syntheticBuyerUserId,
    clerkId: `order-route-buyer:${marker}`,
    email: `order-route-${marker}@example.invalid`,
    name: "Disposable Order Buyer",
    role: "USER",
    notificationPreferences: {},
    banned: false,
    deleted: false,
  });
  assert.deepEqual(users.get(ids.receiptSellerUserId), {
    id: ids.receiptSellerUserId,
    clerkId: `order-route-receipt-seller:${marker}`,
    email: `order-route-seller-${marker}@example.invalid`,
    name: "Disposable Receipt Seller",
    role: "USER",
    notificationPreferences: {},
    banned: false,
    deleted: false,
  });

  const sellers = uniqueRowsById(snapshot?.sellers, 2, "SellerProfile");
  assert.deepEqual(sellers.get(ids.canarySellerProfileId), {
    id: ids.canarySellerProfileId,
    userId: state.canary.userId,
    displayName: "Grainline Route Canary Shop",
    displayNameNormalized: "grainline route canary shop",
    vacationMode: true,
    acceptingNewOrders: false,
    onboardingComplete: false,
    chargesEnabled: false,
    stripeAccountId: null,
    useCalculatedShipping: false,
  });
  assert.deepEqual(sellers.get(ids.receiptSellerProfileId), {
    id: ids.receiptSellerProfileId,
    userId: ids.receiptSellerUserId,
    displayName: "Disposable Receipt Shop",
    displayNameNormalized: "disposable receipt shop",
    vacationMode: true,
    acceptingNewOrders: false,
    onboardingComplete: false,
    chargesEnabled: false,
    stripeAccountId: null,
    useCalculatedShipping: false,
  });

  const listings = uniqueRowsById(snapshot?.listings, 3, "Listing");
  const expectedListings = [
    [ids.labelListingId, ids.canarySellerProfileId, 0],
    [ids.fulfillmentListingId, ids.canarySellerProfileId, 1],
    [ids.receiptListingId, ids.receiptSellerProfileId, 2],
  ];
  for (const [listingId, sellerId, index] of expectedListings) {
    assert.deepEqual(listings.get(listingId), {
      id: listingId,
      sellerId,
      title: `order-auth-route-${index}-${marker}`,
      priceCents: 500,
      priceVersion: 1,
      currency: "usd",
      status: "HIDDEN",
      listingType: "IN_STOCK",
      stockQuantity: 1,
      shipsWithinDays: 2,
      isPrivate: true,
      reservedForUserId: null,
      packagedWeightGrams: 500,
      packagedLengthCm: 10,
      packagedWidthCm: 10,
      packagedHeightCm: 10,
    });
  }

  const orders = uniqueRowsById(snapshot?.orders, 3, "Order");
  const immutableOrder = (orderId, buyerId, sellerProfileId) => ({
    id: orderId,
    buyerId,
    sellerProfileId,
    paid: true,
    currency: "usd",
    chargedTotalCents: 500,
    itemsSubtotalCents: 500,
    shippingAmountCents: 0,
    taxAmountCents: 0,
    buyerName: "Grainline Route Canary",
    shipToLine1: "123 Main St",
    shipToCity: "Austin",
    shipToState: "TX",
    shipToPostalCode: "78701",
    shipToCountry: "US",
    fulfillmentMethod: "SHIPPING",
  });
  const label = orders.get(ids.labelOrderId);
  assert.deepEqual(Object.fromEntries(Object.entries(label).filter(([key]) =>
    !["fulfillmentStatus", "shipped", "delivered", "labelStatus", "trackingCarrier", "trackingNumber", "sellerNotes"].includes(key))),
  immutableOrder(ids.labelOrderId, ids.syntheticBuyerUserId, ids.canarySellerProfileId));
  if (
    !new Set(["PENDING", "SHIPPED"]).has(label.fulfillmentStatus)
    || label.delivered
    || label.trackingCarrier !== null
    || label.trackingNumber !== null
    || label.sellerNotes !== null
    || (label.fulfillmentStatus === "PENDING" && (label.shipped || label.labelStatus !== null))
    || (label.fulfillmentStatus === "SHIPPED" && (!label.shipped || label.labelStatus !== "PURCHASED"))
  ) throw new Error("label Order fixture progression drifted");

  const fulfillment = orders.get(ids.fulfillmentOrderId);
  assert.deepEqual(Object.fromEntries(Object.entries(fulfillment).filter(([key]) =>
    !["fulfillmentStatus", "shipped", "delivered", "labelStatus", "trackingCarrier", "trackingNumber", "sellerNotes"].includes(key))),
  immutableOrder(ids.fulfillmentOrderId, ids.syntheticBuyerUserId, ids.canarySellerProfileId));
  if (
    !new Set(["PENDING", "SHIPPED"]).has(fulfillment.fulfillmentStatus)
    || fulfillment.delivered
    || fulfillment.labelStatus !== null
    || (fulfillment.fulfillmentStatus === "PENDING"
      && (fulfillment.shipped || fulfillment.trackingCarrier !== null || fulfillment.trackingNumber !== null))
    || (fulfillment.fulfillmentStatus === "SHIPPED"
      && (!fulfillment.shipped || fulfillment.trackingCarrier !== "UPS"
        || fulfillment.trackingNumber !== "1Z999AA10123456784"))
    || (fulfillment.sellerNotes !== null
      && (!fulfillment.sellerNotes.includes(marker) || /<\/?script/i.test(fulfillment.sellerNotes)))
  ) throw new Error("fulfillment Order fixture progression drifted");

  const receipt = orders.get(ids.receiptOrderId);
  assert.deepEqual(Object.fromEntries(Object.entries(receipt).filter(([key]) =>
    !["fulfillmentStatus", "shipped", "delivered", "labelStatus", "trackingCarrier", "trackingNumber", "sellerNotes"].includes(key))),
  immutableOrder(ids.receiptOrderId, state.canary.userId, ids.receiptSellerProfileId));
  if (
    !new Set(["SHIPPED", "DELIVERED"]).has(receipt.fulfillmentStatus)
    || !receipt.shipped
    || receipt.labelStatus !== null
    || receipt.trackingCarrier !== null
    || receipt.trackingNumber !== null
    || receipt.sellerNotes !== null
    || receipt.delivered !== (receipt.fulfillmentStatus === "DELIVERED")
  ) throw new Error("receipt Order fixture progression drifted");

  const items = uniqueRowsById(snapshot?.items, 3, "OrderItem");
  const expectedItems = [
    [ids.labelOrderItemId, ids.labelOrderId, ids.labelListingId, ids.canarySellerProfileId],
    [ids.fulfillmentOrderItemId, ids.fulfillmentOrderId, ids.fulfillmentListingId,
      ids.canarySellerProfileId],
    [ids.receiptOrderItemId, ids.receiptOrderId, ids.receiptListingId,
      ids.receiptSellerProfileId],
  ];
  for (const [itemId, orderId, listingId, sellerProfileId] of expectedItems) {
    const item = items.get(itemId);
    const listingSnapshot = item?.listingSnapshot;
    assert.deepEqual({ ...item, listingSnapshot: undefined }, {
      id: itemId,
      orderId,
      listingId,
      sellerProfileId,
      quantity: 1,
      priceCents: 500,
      listingSnapshot: undefined,
    });
    if (
      listingSnapshot?.description !== `Disposable authenticated Order fixture ${marker}`
      || listingSnapshot.title !== listingId
      || listingSnapshot.priceCents !== 500
      || listingSnapshot.category !== "OTHER"
      || JSON.stringify(listingSnapshot.tags) !== '["operator-canary"]'
      || listingSnapshot.listingType !== "IN_STOCK"
      || listingSnapshot.shipsWithinDays !== 2
      || listingSnapshot.shippingPackageComplete !== true
      || listingSnapshot.shippingWeightGrams !== 500
      || listingSnapshot.shippingLengthCm !== 10
      || listingSnapshot.shippingWidthCm !== 10
      || listingSnapshot.shippingHeightCm !== 10
      || Number.isNaN(Date.parse(listingSnapshot.capturedAt ?? ""))
    ) throw new Error("OrderItem listing snapshot fixture drifted");
  }
  assert.deepEqual(snapshot?.suppressions, [{
    id: ids.syntheticBuyerSuppressionId,
    email: `order-route-${marker}@example.invalid`,
    reason: "BOUNCE",
    source: "order-authenticated-route-smoke",
    details: { markerBound: true },
  }]);
  return Object.freeze({ exact: true });
}

async function captureSeededOrderFixtureSnapshot(owner, state) {
  const ids = state.fixtureIds;
  const users = await owner.query(`
      SELECT id, "clerkId", email, name, role::text,
             "notificationPreferences", banned, ("deletedAt" IS NOT NULL) AS deleted
        FROM public."User" WHERE id = ANY($1::text[]) ORDER BY id
    `, [[ids.syntheticBuyerUserId, ids.receiptSellerUserId]]);
  const sellers = await owner.query(`
      SELECT id, "userId", "displayName", "displayNameNormalized", "vacationMode",
             "acceptingNewOrders", "onboardingComplete", "chargesEnabled",
             "stripeAccountId", "useCalculatedShipping"
        FROM public."SellerProfile" WHERE id = ANY($1::text[]) ORDER BY id
    `, [[ids.canarySellerProfileId, ids.receiptSellerProfileId]]);
  const listings = await owner.query(`
      SELECT id, "sellerId", title, "priceCents", "priceVersion", currency,
             status::text, "listingType"::text, "stockQuantity", "shipsWithinDays",
             "isPrivate", "reservedForUserId", "packagedWeightGrams",
             "packagedLengthCm", "packagedWidthCm", "packagedHeightCm"
        FROM public."Listing" WHERE id = ANY($1::text[]) ORDER BY id
    `, [[ids.labelListingId, ids.fulfillmentListingId, ids.receiptListingId]]);
  const orders = await owner.query(`
      SELECT id, "buyerId", "sellerProfileId", ("paidAt" IS NOT NULL) AS paid,
             currency, "chargedTotalCents", "itemsSubtotalCents", "shippingAmountCents",
             "taxAmountCents", "buyerName", "shipToLine1", "shipToCity", "shipToState",
             "shipToPostalCode", "shipToCountry", "fulfillmentMethod"::text,
             "fulfillmentStatus"::text, ("shippedAt" IS NOT NULL) AS shipped,
             ("deliveredAt" IS NOT NULL) AS delivered, "labelStatus"::text,
             "trackingCarrier", "trackingNumber", "sellerNotes"
        FROM public."Order" WHERE id = ANY($1::text[]) ORDER BY id
    `, [[ids.labelOrderId, ids.fulfillmentOrderId, ids.receiptOrderId]]);
  const items = await owner.query(`
      SELECT id, "orderId", "listingId", "sellerProfileId", quantity, "priceCents",
             "listingSnapshot"
        FROM public."OrderItem" WHERE id = ANY($1::text[]) ORDER BY id
    `, [[ids.labelOrderItemId, ids.fulfillmentOrderItemId, ids.receiptOrderItemId]]);
  const suppressions = await owner.query(`
      SELECT id, email, reason::text, source, details
        FROM public."EmailSuppression" WHERE id = $1 ORDER BY id
    `, [ids.syntheticBuyerSuppressionId]);
  return {
    users: users.rows,
    sellers: sellers.rows,
    listings: listings.rows,
    orders: orders.rows,
    items: items.rows,
    suppressions: suppressions.rows,
  };
}

export async function seedOrderFixtures(owner, state) {
  const ids = state.fixtureIds;
  const syntheticBuyerEmail = `order-route-${state.marker}@example.invalid`;
  const receiptSellerEmail = `order-route-seller-${state.marker}@example.invalid`;
  await owner.query("BEGIN");
  try {
    await owner.query(`
      INSERT INTO public."User" (
        id, "clerkId", email, name, role, "notificationPreferences", "createdAt", "updatedAt"
      ) VALUES
        ($1, $2, $3, 'Disposable Order Buyer', 'USER', '{}'::jsonb,
         pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
        ($4, $5, $6, 'Disposable Receipt Seller', 'USER', '{}'::jsonb,
         pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp())
      ON CONFLICT (id) DO NOTHING
    `, [
      ids.syntheticBuyerUserId,
      `order-route-buyer:${state.marker}`,
      syntheticBuyerEmail,
      ids.receiptSellerUserId,
      `order-route-receipt-seller:${state.marker}`,
      receiptSellerEmail,
    ]);
    await owner.query(`
      INSERT INTO public."EmailSuppression" (
        id, email, reason, source, details, "createdAt", "updatedAt"
      ) VALUES ($1, $2, 'BOUNCE', 'order-authenticated-route-smoke',
        pg_catalog.jsonb_build_object('markerBound', true),
        pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp())
      ON CONFLICT (id) DO NOTHING
    `, [ids.syntheticBuyerSuppressionId, syntheticBuyerEmail]);
    await owner.query(`
      INSERT INTO public."SellerProfile" (
        id, "userId", "displayName", "displayNameNormalized", "shipFromName",
        "shipFromLine1", "shipFromCity", "shipFromState", "shipFromPostal",
        "shipFromCountry", "defaultPkgWeightGrams", "defaultPkgLengthCm",
        "defaultPkgWidthCm", "defaultPkgHeightCm", "vacationMode",
        "acceptingNewOrders", "onboardingComplete", "createdAt", "updatedAt"
      ) VALUES
        ($1, $2, 'Grainline Route Canary Shop', 'grainline route canary shop',
         'Grainline Route Canary', '123 Main St', 'Austin', 'TX', '78701', 'US',
         500, 10, 10, 10, true, false, false,
         pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
        ($3, $4, 'Disposable Receipt Shop', 'disposable receipt shop',
         'Disposable Receipt Shop', '123 Main St', 'Austin', 'TX', '78701', 'US',
         500, 10, 10, 10, true, false, false,
         pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp())
      ON CONFLICT (id) DO NOTHING
    `, [
      ids.canarySellerProfileId,
      state.canary.userId,
      ids.receiptSellerProfileId,
      ids.receiptSellerUserId,
    ]);
    const listingIds = [ids.labelListingId, ids.fulfillmentListingId, ids.receiptListingId];
    const sellerIds = [
      ids.canarySellerProfileId,
      ids.canarySellerProfileId,
      ids.receiptSellerProfileId,
    ];
    for (let index = 0; index < listingIds.length; index += 1) {
      await owner.query(`
        INSERT INTO public."Listing" (
          id, "sellerId", title, description, "priceCents", "priceVersion", currency,
          status, "listingType", "stockQuantity", "shipsWithinDays", "isPrivate",
          "packagedWeightGrams", "packagedLengthCm", "packagedWidthCm",
          "packagedHeightCm", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, 'Disposable private authenticated Order fixture',
          500, 1, 'usd', 'HIDDEN', 'IN_STOCK', 1, 2, true,
          500, 10, 10, 10, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp())
        ON CONFLICT (id) DO NOTHING
      `, [listingIds[index], sellerIds[index], `order-auth-route-${index}-${state.marker}`]);
    }
    const orderRows = [
      [ids.labelOrderId, ids.syntheticBuyerUserId, ids.canarySellerProfileId, "PENDING", null],
      [ids.fulfillmentOrderId, ids.syntheticBuyerUserId, ids.canarySellerProfileId, "PENDING", null],
      [ids.receiptOrderId, state.canary.userId, ids.receiptSellerProfileId, "SHIPPED", new Date()],
    ];
    for (const [orderId, buyerId, sellerProfileId, fulfillmentStatus, shippedAt] of orderRows) {
      await owner.query(`
        INSERT INTO public."Order" (
          id, "buyerId", "sellerProfileId", "paidAt", currency, "chargedTotalCents",
          "itemsSubtotalCents", "shippingAmountCents", "taxAmountCents", "buyerName",
          "shipToLine1", "shipToCity", "shipToState", "shipToPostalCode", "shipToCountry",
          "fulfillmentMethod", "fulfillmentStatus", "shippedAt", "createdAt"
        ) VALUES ($1, $2, $3, pg_catalog.clock_timestamp(), 'usd', 500, 500, 0, 0,
          'Grainline Route Canary', '123 Main St', 'Austin', 'TX', '78701', 'US',
          'SHIPPING', $4::public."FulfillmentStatus", $5,
          pg_catalog.clock_timestamp())
        ON CONFLICT (id) DO NOTHING
      `, [orderId, buyerId, sellerProfileId, fulfillmentStatus, shippedAt]);
    }
    const itemRows = [
      [ids.labelOrderItemId, ids.labelOrderId, ids.labelListingId, ids.canarySellerProfileId],
      [ids.fulfillmentOrderItemId, ids.fulfillmentOrderId, ids.fulfillmentListingId, ids.canarySellerProfileId],
      [ids.receiptOrderItemId, ids.receiptOrderId, ids.receiptListingId, ids.receiptSellerProfileId],
    ];
    for (const [itemId, orderId, listingId, sellerProfileId] of itemRows) {
      await owner.query(`
        INSERT INTO public."OrderItem" (
          id, "orderId", "listingId", "sellerProfileId", quantity, "priceCents",
          "listingSnapshot", "createdAt"
        ) VALUES ($1, $2, $3, $4, 1, 500, $5::jsonb, pg_catalog.clock_timestamp())
        ON CONFLICT (id) DO NOTHING
      `, [itemId, orderId, listingId, sellerProfileId,
        JSON.stringify(orderListingSnapshot(state.marker, listingId))]);
    }
    assertSeededOrderFixtureSnapshot(
      await captureSeededOrderFixtureSnapshot(owner, state),
      state,
    );
    await owner.query("COMMIT");
  } catch (error) {
    await owner.query("ROLLBACK").catch(() => {});
    throw error;
  }
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
    || typeof rate.label !== "string"
    || rate.label.length < 1
    || rate.label.length > 100
    || typeof rate.carrier !== "string"
    || rate.carrier.length > 100
    || !(rate.estDays === null
      || (Number.isSafeInteger(rate.estDays) && rate.estDays >= 1 && rate.estDays <= 60))
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
    || typeof body.clientSecret !== "string"
    || !body.clientSecret.includes("_secret_")
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

export function assertLabelPurchase({ body, expectedOrderId, status }) {
  if (
    status !== 200
    || body?.ok !== true
    || body.order?.labelStatus !== "PURCHASED"
    || body.order?.fulfillmentStatus !== "SHIPPED"
    || body.order?.id !== expectedOrderId
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

export function assertStableConflict({ body, status }, expectedMessage) {
  if (status !== 409 || body?.error !== expectedMessage) {
    throw new Error("authenticated Order replay conflict drifted");
  }
  return Object.freeze({ stableConflict: true, status: 409 });
}

function checkoutRate(rate) {
  return {
    objectId: rate.objectId,
    amountCents: rate.amountCents,
    currency: rate.currency,
    displayName: rate.label,
    carrier: rate.carrier,
    estDays: rate.estDays,
    subjectHash: rate.subjectHash,
    token: rate.token,
    expiresAt: rate.expiresAt,
  };
}

async function quoteSingle(token, state, quantity) {
  const expectedSubjectHash = shippingRateSubjectHash({
    mode: "single",
    listingId: state.fixtureIds.checkoutListingId,
    quantity,
    variantKey: "",
    unitPriceCents: 500,
    priceVersion: 1,
    weight: 500,
    length: 10,
    width: 10,
    height: 10,
  });
  const response = await fetchRoute("/api/shipping/quote", token, {
    body: {
      mode: "single",
      listingId: state.fixtureIds.checkoutListingId,
      quantity,
      selectedVariantOptionIds: [],
      toPostal: ADDRESS.postalCode,
      toState: ADDRESS.state,
      toCity: ADDRESS.city,
      toCountry: "US",
    },
    method: "POST",
  });
  if (response.status !== 200) throw new Error("buyer shipping quote route failed");
  return assertBuyerQuote(response.body, expectedSubjectHash);
}

async function waitForSignedExpiry(owner, sessionId) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const result = await owner.query(`
      SELECT pg_catalog.count(*)::integer AS count
        FROM public."StripeWebhookEvent"
       WHERE type = 'checkout.session.expired'
         AND "sourceObjectId" = $1
         AND "processedAt" IS NOT NULL
         AND "lastError" IS NULL
    `, [sessionId]);
    if (result.rows[0]?.count === 1) return true;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("signed Stripe expiry delivery did not reach the reviewed ledger in time");
}

async function runBuyerPhase({ owner, redis, state, stripe, token }) {
  await seedBuyerFixture(owner, redis, state);
  const crossOrigin = await fetchRoute("/api/shipping/quote", token, {
    body: {
      mode: "single",
      listingId: state.fixtureIds.checkoutListingId,
      quantity: 2,
      toPostal: ADDRESS.postalCode,
      toState: ADDRESS.state,
      toCity: ADDRESS.city,
      toCountry: "US",
    },
    method: "POST",
    origin: "https://example.invalid",
  });
  if (crossOrigin.status !== 403 || crossOrigin.body.error !== "Forbidden") {
    throw new Error("shipping quote did not reject explicit cross-origin input");
  }
  const quantityOne = await quoteSingle(token, state, 1);
  const quantityTwo = await quoteSingle(token, state, 2);
  if (quantityOne.subjectHash === quantityTwo.subjectHash) {
    throw new Error("quantity-one and quantity-two shipping subjects collided");
  }
  const body = {
    listingId: state.fixtureIds.checkoutListingId,
    quantity: 2,
    shippingAddress: ADDRESS,
    selectedRate: checkoutRate(quantityTwo),
    giftNote: null,
    giftWrapping: false,
    selectedVariantOptionIds: [],
  };
  let sessionId = state.checkout.stripeSessionId;
  if (!sessionId) {
    const created = await fetchRoute("/api/cart/checkout/single", token, { body, method: "POST" });
    sessionId = assertCheckoutRouteResult(created);
    state.checkout.stripeSessionId = sessionId;
    saveState(state);
  }
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const lockKey = session.metadata?.checkoutLockKey;
  if (
    session.livemode !== false
    || session.payment_status !== "unpaid"
    || !new Set(["open", "expired"]).has(session.status)
    || session.metadata?.buyerId !== state.canary.userId
    || session.metadata?.sellerId !== state.checkoutSeller.sellerProfileId
    || session.metadata?.listingId !== state.fixtureIds.checkoutListingId
    || session.metadata?.quantity !== "2"
    || lockKey !== `checkout:single:${state.canary.userId}:listing:${state.fixtureIds.checkoutListingId}`
  ) throw new Error("buyer Stripe test Checkout Session posture drifted");
  if (!state.checkout.redisKeys.includes(lockKey)) {
    state.checkout.redisKeys.push(lockKey);
    saveState(state);
  }
  const reservation = await owner.query(`
    SELECT id, status, "buyerId", "sellerId", "reservedItems"
      FROM public."CheckoutStockReservation"
     WHERE "stripeSessionId" = $1
  `, [sessionId]);
  if (
    reservation.rowCount !== 1
    || !new Set(["SESSION_CREATED", "RESTORED"]).has(reservation.rows[0].status)
    || reservation.rows[0].buyerId !== state.canary.userId
    || reservation.rows[0].sellerId !== state.checkoutSeller.sellerProfileId
    || !Array.isArray(reservation.rows[0].reservedItems)
    || reservation.rows[0].reservedItems.length !== 1
  ) throw new Error("buyer CheckoutStockReservation posture drifted");
  if (!state.checkout.reservationIds.includes(reservation.rows[0].id)) {
    state.checkout.reservationIds.push(reservation.rows[0].id);
    saveState(state);
  }
  if (session.status === "open") {
    const retry = await fetchRoute("/api/cart/checkout/single", token, { body, method: "POST" });
    assertCheckoutRouteResult({ ...retry, expectedSessionId: sessionId });
    const rollback = await fetchRoute("/api/cart/checkout/rollback", token, {
      body: { sessionIds: [sessionId] },
      method: "POST",
    });
    if (
      rollback.status !== 200
      || rollback.body.ok !== true
      || !Array.isArray(rollback.body.results)
      || rollback.body.results.length !== 1
      || rollback.body.results[0]?.status !== "restored"
    ) throw new Error("buyer checkout rollback did not restore the exact Session");
  }
  const [afterSession, afterReservation, stock] = await Promise.all([
    stripe.checkout.sessions.retrieve(sessionId),
    owner.query(`SELECT status FROM public."CheckoutStockReservation" WHERE id = $1`,
      [reservation.rows[0].id]),
    owner.query(`SELECT "stockQuantity" AS stock FROM public."Listing" WHERE id = $1`,
      [state.fixtureIds.checkoutListingId]),
  ]);
  if (
    afterSession.status !== "expired"
    || afterSession.payment_status !== "unpaid"
    || afterReservation.rows[0]?.status !== "RESTORED"
    || stock.rows[0]?.stock !== FIXTURE_STOCK
    || await redis.get(lockKey)
  ) throw new Error("buyer checkout did not restore exact stock and lock state");
  state.checkout.signedExpiryObserved = await waitForSignedExpiry(owner, sessionId);
  state.stage = "buyer-quote-checkout";
  saveState(state);
  return Object.freeze({ passed: true, stripeSessionId: sessionId });
}

async function assertRouteSideEffects(owner, {
  auditAction,
  expectedEmailStatus = null,
  notificationType,
  orderId,
}) {
  const result = await owner.query(`
    SELECT
      (SELECT pg_catalog.count(*)::integer FROM public."SystemAuditLog"
        WHERE action = $2 AND "targetType" = 'ORDER' AND "targetId" = $1) AS audits,
      (SELECT pg_catalog.count(*)::integer
         FROM public."Notification" AS notification
         JOIN public."SystemAuditLog" AS audit ON audit.id = notification."sourceId"
        WHERE audit.action = $2 AND audit."targetType" = 'ORDER' AND audit."targetId" = $1
          AND notification.type::text = $3
          AND notification."sourceType" = 'order_fulfillment') AS notifications,
      (SELECT pg_catalog.count(*)::integer
         FROM public."EmailOutbox" AS outbox
         JOIN public."SystemAuditLog" AS audit ON audit.id = outbox."sourceId"
        WHERE audit.action = $2 AND audit."targetType" = 'ORDER' AND audit."targetId" = $1
          AND outbox."sourceType" = 'order_fulfillment'
          AND ($4::text IS NULL OR outbox.status = $4)) AS outbox
  `, [orderId, auditAction, notificationType, expectedEmailStatus]);
  if (
    result.rows[0]?.audits !== 1
    || result.rows[0]?.notifications !== 1
    || (expectedEmailStatus === null ? result.rows[0]?.outbox !== 0 : result.rows[0]?.outbox !== 1)
  ) throw new Error("authenticated Order route side effects drifted");
  return result.rows[0];
}

async function runSellerLabelPhase({ owner, state, token }) {
  const ids = state.fixtureIds;
  const current = await owner.query(`
    SELECT "labelStatus"::text, "fulfillmentStatus"::text, "shippoTransactionId",
           "shippoRateObjectId"
      FROM public."Order" WHERE id = $1
  `, [ids.labelOrderId]);
  if (current.rowCount !== 1) throw new Error("seller label Order fixture is missing");
  if (current.rows[0].labelStatus !== "PURCHASED") {
    let rateObjectId = current.rows[0].shippoRateObjectId;
    if (!rateObjectId) {
      const quote = await fetchRoute(`/api/orders/${ids.labelOrderId}/label`, token, {
        body: {},
        method: "POST",
      });
      rateObjectId = assertLabelRequote(quote).objectId;
    }
    if (
      typeof rateObjectId !== "string"
      || rateObjectId === "pickup"
      || rateObjectId === "fallback"
      || rateObjectId.startsWith("quote-only:")
    ) throw new Error("seller label restart rate identity drifted");
    const purchased = await fetchRoute(`/api/orders/${ids.labelOrderId}/label`, token, {
      body: { rateObjectId },
      method: "POST",
    });
    assertLabelPurchase({ ...purchased, expectedOrderId: ids.labelOrderId });
  }
  const exact = await owner.query(`
    SELECT "labelStatus"::text AS label_status,
           "fulfillmentStatus"::text AS fulfillment_status,
           "shippoTransactionId" AS transaction_id,
           "labelClaimStatus" AS claim_status,
           "labelClawbackStatus" AS clawback_status
      FROM public."Order" WHERE id = $1
  `, [ids.labelOrderId]);
  if (
    exact.rows[0]?.label_status !== "PURCHASED"
    || exact.rows[0]?.fulfillment_status !== "SHIPPED"
    || typeof exact.rows[0]?.transaction_id !== "string"
    || exact.rows[0]?.claim_status !== "FINALIZED"
    || exact.rows[0]?.clawback_status !== "MANUAL_REVIEW"
  ) throw new Error("seller label durable result drifted");
  state.provider.shippoTransactionId = exact.rows[0].transaction_id;
  saveState(state);
  await assertRouteSideEffects(owner, {
    auditAction: "ORDER_FULFILLMENT_TRANSITION",
    notificationType: "ORDER_SHIPPED",
    orderId: ids.labelOrderId,
  });
  const download = await fetchRoute(`/api/orders/${ids.labelOrderId}/label`, token, {
    expectJson: false,
  });
  assertPrivateLabelRedirect({
    cacheControl: download.headers.get("cache-control"),
    location: download.headers.get("location"),
    pragma: download.headers.get("pragma"),
    status: download.status,
  });
  state.stage = "seller-label";
  saveState(state);
  return Object.freeze({ passed: true });
}

async function runSellerFulfillmentPhase({ owner, state, token }) {
  const ids = state.fixtureIds;
  const nonBuyer = await fetchRoute(`/api/orders/${ids.fulfillmentOrderId}/confirm-delivery`, token, {
    body: {},
    method: "POST",
  });
  if (nonBuyer.status !== 404 || nonBuyer.body.error !== "Order not found.") {
    throw new Error("seller actor received buyer-only Order disclosure");
  }
  const status = await owner.query(`
    SELECT "fulfillmentStatus"::text AS status, "sellerNotes" AS notes
      FROM public."Order" WHERE id = $1
  `, [ids.fulfillmentOrderId]);
  if (status.rows[0]?.status === "PENDING") {
    if (typeof status.rows[0].notes !== "string" || !status.rows[0].notes.includes(state.marker)) {
      const notes = await fetchRoute(`/api/orders/${ids.fulfillmentOrderId}/fulfillment`, token, {
        body: { action: "update_notes", sellerNotes: `<script>unsafe</script> ${state.marker}` },
        method: "POST",
      });
      assertFulfillmentRedirect({
        location: notes.headers.get("location"),
        orderId: ids.fulfillmentOrderId,
        status: notes.status,
      });
    }
    const persisted = await owner.query(`SELECT "sellerNotes" AS notes FROM public."Order" WHERE id = $1`,
      [ids.fulfillmentOrderId]);
    if (
      typeof persisted.rows[0]?.notes !== "string"
      || !persisted.rows[0].notes.includes(state.marker)
      || /<script>|<\/script>/i.test(persisted.rows[0].notes)
    ) throw new Error("seller note sanitization drifted");
    const invalid = await fetchRoute(`/api/orders/${ids.fulfillmentOrderId}/fulfillment`, token, {
      body: { action: "shipped", trackingCarrier: "UPS", trackingNumber: "bad" },
      method: "POST",
    });
    if (invalid.status !== 400 || invalid.body.error !== "Invalid tracking number.") {
      throw new Error("seller fulfillment accepted invalid tracking evidence");
    }
    const shipped = await fetchRoute(`/api/orders/${ids.fulfillmentOrderId}/fulfillment`, token, {
      body: { action: "shipped", trackingCarrier: "UPS", trackingNumber: "1Z999AA10123456784" },
      method: "POST",
    });
    assertFulfillmentRedirect({
      location: shipped.headers.get("location"),
      orderId: ids.fulfillmentOrderId,
      status: shipped.status,
    });
  }
  const replay = await fetchRoute(`/api/orders/${ids.fulfillmentOrderId}/fulfillment`, token, {
    body: { action: "shipped", trackingCarrier: "UPS", trackingNumber: "1Z999AA10123456784" },
    method: "POST",
  });
  assertStableConflict(replay, "Order state changed. Refresh and try again.");
  const exact = await owner.query(`
    SELECT "fulfillmentStatus"::text AS status, "trackingCarrier" AS carrier,
           "trackingNumber" AS tracking
      FROM public."Order" WHERE id = $1
  `, [ids.fulfillmentOrderId]);
  assert.deepEqual(exact.rows, [{ status: "SHIPPED", carrier: "UPS", tracking: "1Z999AA10123456784" }]);
  await assertRouteSideEffects(owner, {
    auditAction: "ORDER_FULFILLMENT_TRANSITION",
    expectedEmailStatus: "SKIPPED",
    notificationType: "ORDER_SHIPPED",
    orderId: ids.fulfillmentOrderId,
  });
  const noteAudits = await owner.query(`
    SELECT pg_catalog.count(*)::integer AS count FROM public."SystemAuditLog"
     WHERE action = 'ORDER_SELLER_NOTES_UPDATED' AND "targetType" = 'ORDER' AND "targetId" = $1
  `, [ids.fulfillmentOrderId]);
  if (noteAudits.rows[0]?.count !== 1) throw new Error("seller note audit replay drifted");
  state.stage = "seller-fulfillment";
  saveState(state);
  return Object.freeze({ passed: true });
}

async function runBuyerReceiptPhase({ owner, state, token }) {
  const ids = state.fixtureIds;
  const current = await owner.query(`
    SELECT "fulfillmentStatus"::text AS status FROM public."Order" WHERE id = $1
  `, [ids.receiptOrderId]);
  if (current.rows[0]?.status === "SHIPPED") {
    const confirmed = await fetchRoute(`/api/orders/${ids.receiptOrderId}/confirm-delivery`, token, {
      body: {},
      method: "POST",
    });
    assertReceiptRedirect({
      location: confirmed.headers.get("location"),
      orderId: ids.receiptOrderId,
      status: confirmed.status,
    });
  }
  const replay = await fetchRoute(`/api/orders/${ids.receiptOrderId}/confirm-delivery`, token, {
    body: {},
    method: "POST",
  });
  assertStableConflict(replay, "Only shipped or ready-for-pickup orders can be confirmed received.");
  const exact = await owner.query(`
    SELECT "fulfillmentStatus"::text AS status, ("deliveredAt" IS NOT NULL) AS delivered
      FROM public."Order" WHERE id = $1
  `, [ids.receiptOrderId]);
  assert.deepEqual(exact.rows, [{ status: "DELIVERED", delivered: true }]);
  await assertRouteSideEffects(owner, {
    auditAction: "ORDER_FULFILLMENT_TRANSITION",
    notificationType: "ORDER_DELIVERED",
    orderId: ids.receiptOrderId,
  });
  state.stage = "buyer-receipt";
  saveState(state);
  return Object.freeze({ passed: true });
}

async function assertCheckoutSellerUnchanged(owner, stripe, state) {
  const seller = await owner.query(`
    SELECT id, "userId", "stripeAccountId", "chargesEnabled", "vacationMode",
           "acceptingNewOrders", "useCalculatedShipping"
      FROM public."SellerProfile" WHERE id = $1
  `, [state.checkoutSeller.sellerProfileId]);
  if (
    seller.rowCount !== 1
    || seller.rows[0].userId !== state.checkoutSeller.userId
    || seller.rows[0].stripeAccountId !== state.checkoutSeller.stripeAccountId
    || seller.rows[0].chargesEnabled !== true
    || seller.rows[0].vacationMode !== false
    || seller.rows[0].acceptingNewOrders !== true
    || seller.rows[0].useCalculatedShipping !== true
  ) throw new Error("authenticated Order smoke checkout seller drifted");
  const account = await stripe.accounts.retrieve(state.checkoutSeller.stripeAccountId);
  if (!account || account.deleted || account.charges_enabled !== true) {
    throw new Error("authenticated Order smoke Stripe test seller is no longer eligible");
  }
  return Object.freeze({ unchanged: true });
}

async function loadRestartCanary(clerk, owner, stripe, state) {
  const users = await clerk.users.getUserList({
    externalId: [NOTIFICATION_CANARY_EXTERNAL_ID],
    limit: 2,
  });
  if (
    users.totalCount !== 1
    || users.data.length !== 1
    || users.data[0].id !== state.canary.clerkUserId
    || users.data[0].banned
    || users.data[0].locked
    || users.data[0].publicMetadata?.grainlineOperationalCanary
      !== "notification-rls-route-and-production-canary"
  ) throw new Error("restart canary identity drifted");
  const database = await owner.query(`
    SELECT id, "clerkId", role::text FROM public."User"
     WHERE id = $1 AND "clerkId" = $2 AND NOT banned AND "deletedAt" IS NULL
  `, [state.canary.userId, state.canary.clerkUserId]);
  if (database.rowCount !== 1 || database.rows[0].role !== "USER") {
    throw new Error("restart canary database identity drifted");
  }
  await assertCheckoutSellerUnchanged(owner, stripe, state);
  return Object.freeze({ id: state.canary.userId, clerkUserId: state.canary.clerkUserId });
}

async function canaryToken(clerk, state) {
  for (const sessionId of [...state.canary.sessionIds].reverse()) {
    try {
      const session = await clerk.sessions.getSession(sessionId);
      if (session.status !== "active") continue;
      const token = await clerk.sessions.getToken(sessionId, undefined, 300);
      if (typeof token?.jwt === "string" && token.jwt.split(".").length === 3) {
        return token.jwt;
      }
    } catch {
      // Create a new bounded session below if an earlier one expired.
    }
  }
  const authentication = await createCanarySession(clerk, state.canary.clerkUserId);
  state.canary.sessionIds.push(authentication.sessionId);
  saveState(state);
  return authentication.jwt;
}

async function cleanupFixtures({ clerk, owner, redis, runtime, state, stripe }) {
  const ids = state.fixtureIds;
  const cleanup = {
    canaryRestored: false,
    checkoutSellerUnchanged: false,
    clerkSessionsRevoked: false,
    databaseFixturesDeleted: false,
    processedWebhookLeaseCount: null,
    redisKeysDeleted: false,
  };
  const discovered = await owner.query(`
    SELECT id, status, "stripeSessionId", "payloadHash"
      FROM public."CheckoutStockReservation"
     WHERE "buyerId" = $1
       AND "sellerId" = $2
       AND "createdAt" >= ($3::timestamptz AT TIME ZONE 'UTC')
       AND "reservedItems" @> pg_catalog.jsonb_build_array(
         pg_catalog.jsonb_build_object('listingId', $4::text, 'quantity', 2)
       )
     ORDER BY "createdAt", id
  `, [
    state.canary.userId,
    state.checkoutSeller.sellerProfileId,
    state.startedAt,
    ids.checkoutListingId,
  ]);
  if (discovered.rowCount > 1) {
    throw new Error("cleanup found more than one marker-bound checkout reservation");
  }
  for (const reservation of discovered.rows) {
    if (!state.checkout.reservationIds.includes(reservation.id)) {
      state.checkout.reservationIds.push(reservation.id);
    }
    if (reservation.stripeSessionId) {
      if (
        state.checkout.stripeSessionId
        && state.checkout.stripeSessionId !== reservation.stripeSessionId
      ) throw new Error("cleanup discovered a competing Checkout Session");
      state.checkout.stripeSessionId = reservation.stripeSessionId;
    }
  }
  const derivedLockKey = `checkout:single:${state.canary.userId}:listing:${ids.checkoutListingId}`;
  if (!state.checkout.redisKeys.includes(derivedLockKey)) state.checkout.redisKeys.push(derivedLockKey);
  saveState(state);
  if (state.checkout.stripeSessionId) {
    const session = await stripe.checkout.sessions.retrieve(state.checkout.stripeSessionId);
    if (session.status === "open") await stripe.checkout.sessions.expire(session.id);
    const after = await stripe.checkout.sessions.retrieve(session.id);
    if (after.status !== "expired" || after.payment_status !== "unpaid") {
      throw new Error("cleanup refused a non-expired or paid Checkout Session");
    }
    await runtime.query(
      `SELECT * FROM public.grainline_checkout_reservation_buyer_expired_restore($1::text, $2::text)`,
      [state.canary.userId, session.id],
    );
    state.checkout.signedExpiryObserved = await waitForSignedExpiry(owner, session.id);
  }
  for (const reservation of discovered.rows) {
    if (reservation.status === "RESERVED" && !reservation.stripeSessionId) {
      await runtime.query(
        `SELECT * FROM public.grainline_checkout_reservation_checkout_abort($1::text, $2::text, $3::text)`,
        [reservation.id, state.canary.userId, reservation.payloadHash],
      );
    }
  }
  if (state.checkout.reservationIds.length > 0) {
    const terminal = await owner.query(`
      SELECT pg_catalog.count(*)::integer AS count
        FROM public."CheckoutStockReservation"
       WHERE id = ANY($1::text[]) AND status <> 'RESTORED'
    `, [state.checkout.reservationIds]);
    if (terminal.rows[0]?.count !== 0) {
      throw new Error("cleanup refused a non-restored checkout reservation");
    }
  }
  for (const key of state.checkout.redisKeys) await redis.del(key);
  cleanup.redisKeysDeleted = (await Promise.all(
    state.checkout.redisKeys.map((key) => redis.get(key)),
  )).every((value) => value === null);
  if (!cleanup.redisKeysDeleted) throw new Error("cleanup left an exact Redis key");

  const orderIds = [ids.labelOrderId, ids.fulfillmentOrderId, ids.receiptOrderId];
  const listingIds = [
    ids.checkoutListingId,
    ids.labelListingId,
    ids.fulfillmentListingId,
    ids.receiptListingId,
  ];
  const itemIds = [ids.labelOrderItemId, ids.fulfillmentOrderItemId, ids.receiptOrderItemId];
  const sellerIds = [ids.canarySellerProfileId, ids.receiptSellerProfileId];
  const userIds = [ids.syntheticBuyerUserId, ids.receiptSellerUserId];
  let auditIds = [];
  await owner.query("BEGIN");
  try {
    const audits = await owner.query(`
      SELECT id FROM public."SystemAuditLog"
       WHERE "targetType" = 'ORDER' AND "targetId" = ANY($1::text[])
    `, [orderIds]);
    auditIds = audits.rows.map((row) => row.id);
    await owner.query(`DELETE FROM public."Notification" WHERE "sourceId" = ANY($1::text[])`,
      [auditIds]);
    await owner.query(`DELETE FROM public."EmailOutbox" WHERE "sourceId" = ANY($1::text[])`,
      [auditIds]);
    await owner.query(`DELETE FROM public."SystemAuditLog" WHERE id = ANY($1::text[])`,
      [auditIds]);
    await owner.query(`DELETE FROM public."OrderShippingRateQuote" WHERE "orderId" = ANY($1::text[])`,
      [orderIds]);
    await owner.query(`
      DELETE FROM public."CheckoutStockReservation"
       WHERE id = ANY($1::text[]) AND status = 'RESTORED'
    `, [state.checkout.reservationIds]);
    await owner.query(`DELETE FROM public."OrderItem" WHERE id = ANY($1::text[])`, [itemIds]);
    await owner.query(`DELETE FROM public."Order" WHERE id = ANY($1::text[])`, [orderIds]);
    await owner.query(`DELETE FROM public."Listing" WHERE id = ANY($1::text[])`, [listingIds]);
    await owner.query(`DELETE FROM public."SellerProfile" WHERE id = ANY($1::text[])`, [sellerIds]);
    await owner.query(`DELETE FROM public."EmailSuppression" WHERE id = $1`,
      [ids.syntheticBuyerSuppressionId]);
    await owner.query(`DELETE FROM public."User" WHERE id = ANY($1::text[])`, [userIds]);
    const restored = await owner.query(`
      UPDATE public."User"
         SET role = $2::public."Role",
             "termsAcceptedAt" = $3,
             "termsVersion" = $4,
             "ageAttestedAt" = $5,
             "notificationPreferences" = $6::jsonb,
             "emailPreferenceOptInAt" = $7
       WHERE id = $1 AND "clerkId" = $8 AND NOT banned AND "deletedAt" IS NULL
    `, [
      state.canary.userId,
      state.canary.originalRole,
      state.canary.originalTermsAcceptedAt,
      state.canary.originalTermsVersion,
      state.canary.originalAgeAttestedAt,
      JSON.stringify(state.canary.originalNotificationPreferences),
      state.canary.originalEmailPreferenceOptInAt,
      state.canary.clerkUserId,
    ]);
    if (restored.rowCount !== 1) throw new Error("cleanup could not restore the exact canary");
    await owner.query("COMMIT");
  } catch (error) {
    await owner.query("ROLLBACK").catch(() => {});
    throw error;
  }
  cleanup.clerkSessionsRevoked = await revokeCanarySessions(clerk, state.canary.clerkUserId);
  if (!cleanup.clerkSessionsRevoked) throw new Error("cleanup left an active Clerk session");
  const residue = await owner.query(`
    SELECT
      (SELECT pg_catalog.count(*)::integer FROM public."User" WHERE id = ANY($1::text[])) AS users,
      (SELECT pg_catalog.count(*)::integer FROM public."SellerProfile" WHERE id = ANY($2::text[])) AS sellers,
      (SELECT pg_catalog.count(*)::integer FROM public."Listing" WHERE id = ANY($3::text[])) AS listings,
      (SELECT pg_catalog.count(*)::integer FROM public."Order" WHERE id = ANY($4::text[])) AS orders,
      (SELECT pg_catalog.count(*)::integer FROM public."OrderItem" WHERE id = ANY($5::text[])) AS items,
      (SELECT pg_catalog.count(*)::integer FROM public."CheckoutStockReservation"
        WHERE id = ANY($6::text[])) AS reservations,
      (SELECT pg_catalog.count(*)::integer FROM public."EmailSuppression" WHERE id = $7) AS suppressions,
      (SELECT pg_catalog.count(*)::integer FROM public."SystemAuditLog"
        WHERE "targetType" = 'ORDER' AND "targetId" = ANY($4::text[])) AS audits,
      (SELECT pg_catalog.count(*)::integer FROM public."Notification"
        WHERE "sourceId" = ANY($8::text[])) AS notifications,
      (SELECT pg_catalog.count(*)::integer FROM public."EmailOutbox"
        WHERE "sourceId" = ANY($8::text[])) AS outbox,
      (SELECT pg_catalog.count(*)::integer FROM public."OrderShippingRateQuote"
        WHERE "orderId" = ANY($4::text[])) AS quotes,
      (SELECT pg_catalog.count(*)::integer FROM public."SellerProfile" WHERE "userId" = $9) AS canary_sellers
  `, [
    userIds,
    sellerIds,
    listingIds,
    orderIds,
    itemIds,
    state.checkout.reservationIds,
    ids.syntheticBuyerSuppressionId,
    auditIds,
    state.canary.userId,
  ]);
  assert.deepEqual(residue.rows, [{
    users: 0,
    sellers: 0,
    listings: 0,
    orders: 0,
    items: 0,
    reservations: 0,
    suppressions: 0,
    audits: 0,
    notifications: 0,
    outbox: 0,
    quotes: 0,
    canary_sellers: 0,
  }]);
  const webhookLeases = await owner.query(`
    SELECT pg_catalog.count(*)::integer AS count
      FROM public."StripeWebhookEvent"
     WHERE type = 'checkout.session.expired'
       AND "sourceObjectId" = $1
       AND "processedAt" IS NOT NULL
       AND "lastError" IS NULL
  `, [state.checkout.stripeSessionId]);
  const expectedWebhookLeaseCount = Number(Boolean(state.checkout.stripeSessionId));
  if (webhookLeases.rows[0]?.count !== expectedWebhookLeaseCount) {
    throw new Error("cleanup signed Stripe webhook lease posture drifted");
  }
  cleanup.processedWebhookLeaseCount = expectedWebhookLeaseCount;
  const canary = await owner.query(`
    SELECT role::text, "termsAcceptedAt", "termsVersion", "ageAttestedAt",
           "notificationPreferences", "emailPreferenceOptInAt"
      FROM public."User" WHERE id = $1 AND "clerkId" = $2
  `, [state.canary.userId, state.canary.clerkUserId]);
  if (
    canary.rowCount !== 1
    || canary.rows[0].role !== state.canary.originalRole
    || new Date(canary.rows[0].termsAcceptedAt ?? 0).toISOString()
      !== new Date(state.canary.originalTermsAcceptedAt ?? 0).toISOString()
    || canary.rows[0].termsVersion !== state.canary.originalTermsVersion
    || new Date(canary.rows[0].ageAttestedAt ?? 0).toISOString()
      !== new Date(state.canary.originalAgeAttestedAt ?? 0).toISOString()
    || JSON.stringify(canary.rows[0].notificationPreferences)
      !== JSON.stringify(state.canary.originalNotificationPreferences)
    || new Date(canary.rows[0].emailPreferenceOptInAt ?? 0).toISOString()
      !== new Date(state.canary.originalEmailPreferenceOptInAt ?? 0).toISOString()
  ) throw new Error("cleanup canary restoration proof drifted");
  cleanup.canaryRestored = true;
  await assertCheckoutSellerUnchanged(owner, stripe, state);
  cleanup.checkoutSellerUnchanged = true;
  cleanup.databaseFixturesDeleted = true;
  return Object.freeze(cleanup);
}

function cleanupPassed(cleanup) {
  return cleanup?.canaryRestored === true
    && cleanup.checkoutSellerUnchanged === true
    && cleanup.clerkSessionsRevoked === true
    && cleanup.databaseFixturesDeleted === true
    && new Set([0, 1]).has(cleanup.processedWebhookLeaseCount)
    && cleanup.redisKeysDeleted === true;
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
    // The route smoke intentionally creates temporary production rows and
    // test-mode provider objects. Successful cleanup proves zero persistent
    // application-fixture residue; it does not make the proof read-only.
    productionChangedByProof: true,
    persistentMutableFixtureResidue: !cleanupPassed(cleanup),
    providerConfigurationChanged: false,
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
      checkoutSellerUnchanged: cleanup?.checkoutSellerUnchanged === true,
      clerkSessionsRevoked: cleanup?.clerkSessionsRevoked === true,
      databaseFixturesDeleted: cleanup?.databaseFixturesDeleted === true,
      processedWebhookLeaseCount: Number(cleanup?.processedWebhookLeaseCount ?? -1),
      redisKeysDeleted: cleanup?.redisKeysDeleted === true,
    },
    expectedRetainedDatabaseEvidence: {
      processedStripeWebhookLeases: Number(cleanup?.processedWebhookLeaseCount ?? 0),
    },
    expectedRetainedProviderEvidence: {
      stripeTestCheckoutSessions: Number(result?.stripeTestCheckoutSessions ?? 0),
      shippoTestTransactions: Number(result?.shippoTestTransactions ?? 0),
    },
  });
}

function evidenceResultForState(state, passed) {
  return {
    buyerQuantityTwoCheckoutPassed: passed,
    sellerLabelPassed: passed,
    sellerFulfillmentPassed: passed,
    buyerReceiptPassed: passed,
    stripeTestCheckoutSessions: Number(Boolean(state.checkout?.stripeSessionId)),
    shippoTestTransactions: Number(Boolean(state.provider?.shippoTransactionId)),
  };
}

function evidenceWithoutTimestamp(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("authenticated Order smoke existing evidence is invalid");
  }
  const { generatedAt, ...rest } = value;
  if (Number.isNaN(Date.parse(generatedAt ?? ""))) {
    throw new Error("authenticated Order smoke evidence timestamp is invalid");
  }
  return rest;
}

function assertEvidenceContainsNoSensitiveState(serialized, database, provider, state) {
  for (const sensitive of [
    database.ownerDatabaseUrl,
    database.runtimeDatabaseUrl,
    provider.clerkSecret,
    provider.redisToken,
    provider.redisUrl,
    provider.shippoApiKey,
    provider.stripeSecret,
    state.marker,
    state.canary.clerkUserId,
    state.canary.userId,
    state.checkoutSeller.sellerProfileId,
    state.checkoutSeller.userId,
    state.checkoutSeller.stripeAccountId,
    state.checkout.stripeSessionId,
    state.provider.shippoTransactionId,
    ...Object.values(state.fixtureIds),
  ].filter(Boolean)) {
    if (serialized.includes(sensitive)) {
      throw new Error("authenticated Order smoke evidence retained sensitive state");
    }
  }
}

function finalizeEvidence({ config, database, evidence, provider, state }) {
  const serialized = JSON.stringify(evidence);
  assertEvidenceContainsNoSensitiveState(serialized, database, provider, state);
  if (existsSync(config.evidencePath)) {
    const existing = readPrivateJson(config.evidencePath, "authenticated Order smoke evidence");
    assert.deepEqual(evidenceWithoutTimestamp(existing), evidenceWithoutTimestamp(evidence));
    assertEvidenceContainsNoSensitiveState(JSON.stringify(existing), database, provider, state);
  } else {
    writePrivateJson(config.evidencePath, evidence);
  }
  if (existsSync(STATE_PATH)) unlinkSync(STATE_PATH);
  return evidence;
}

function finalizeCleanedState({ config, database, provider, state }) {
  if (state.stage !== "cleaned" || !cleanupPassed(state.cleanup)) {
    throw new Error("authenticated Order smoke terminal cleanup state drifted");
  }
  const passed = state.status === "cleaned";
  if (!passed && state.status !== "cleaned-after-failure") {
    throw new Error("authenticated Order smoke terminal status drifted");
  }
  if (passed && (!state.checkout?.stripeSessionId || !state.provider?.shippoTransactionId)) {
    throw new Error("authenticated Order smoke passed without exact provider evidence");
  }
  if (
    state.cleanup.processedWebhookLeaseCount
      !== Number(Boolean(state.checkout?.stripeSessionId))
  ) throw new Error("authenticated Order smoke terminal webhook evidence drifted");
  const evidence = sanitizedEvidence({
    binding: config.release,
    cleanup: state.cleanup,
    operator: { commit: config.operatorCommit, ciRunId: config.operatorCiRunId },
    result: evidenceResultForState(state, passed),
    status: passed ? "passed" : "failed",
  });
  return finalizeEvidence({ config, database, evidence, provider, state });
}

export async function runOperator() {
  const config = validateConfiguration();
  assertGitState(readGitState(), config.operatorCommit);
  verifyGitHubCi(config.operatorCommit, config.operatorCiRunId);
  verifyVercelDeployment(config.release);
  const localValues = loadPrivateEnvironment(LOCAL_ENV_PATH, "local environment file");
  const ownerValues = loadPrivateEnvironment(OWNER_ENV_PATH, "migration-owner environment file");
  const database = parseDatabaseUrls(localValues, ownerValues);
  const provider = validateProviderCredentials(localValues);
  const owner = new Client({ connectionString: database.ownerDatabaseUrl });
  const runtime = new Client({ connectionString: database.runtimeDatabaseUrl });
  const stripe = new Stripe(provider.stripeSecret);
  const clerk = createClerkClient({ secretKey: provider.clerkSecret });
  const redis = new Redis({ url: provider.redisUrl, token: provider.redisToken });
  let state = null;
  let stage = "connect";
  try {
    await owner.connect();
    await runtime.connect();
    stage = "verify-boundaries";
    await verifyDeploymentBoundary();
    await verifyDatabaseIdentity(owner, runtime);
    const restartExists = existsSync(STATE_PATH);
    if (restartExists) {
      state = validateRestartState(readPrivateJson(STATE_PATH, "Order smoke restart state"), config);
      await loadRestartCanary(clerk, owner, stripe, state);
      if (existsSync(config.evidencePath) && state.stage !== "cleaned") {
        throw new Error("authenticated Order smoke evidence exists before terminal cleanup");
      }
      if (state.stage === "cleaned") {
        return finalizeCleanedState({ config, database, provider, state });
      }
    } else {
      if (config.cleanupOnly) {
        throw new Error("authenticated Order smoke cleanup-only mode requires exact restart state");
      }
      const canary = await selectCanary(clerk, owner);
      const checkoutSeller = await selectCheckoutSeller(owner, stripe, canary.id);
      state = createInitialState(config, canary, checkoutSeller);
      saveState(state);
    }
    if (config.cleanupOnly || state.stage === "cleanup") {
      stage = "cleanup";
      state.stage = "cleanup";
      saveState(state);
      const cleanup = await cleanupFixtures({ clerk, owner, redis, runtime, state, stripe });
      if (!cleanupPassed(cleanup)) throw new Error("authenticated Order cleanup resume did not pass");
      state.cleanup = cleanup;
      state.stage = "cleaned";
      state.status = state.routePhasesPassed ? "cleaned" : "cleaned-after-failure";
      saveState(state);
      return finalizeCleanedState({ config, database, provider, state });
    }
    const token = await canaryToken(clerk, state);
    stage = "buyer-quote-checkout";
    await runBuyerPhase({ owner, redis, state, stripe, token });
    stage = "seed-order-fixtures";
    await seedOrderFixtures(owner, state);
    stage = "seller-label";
    await runSellerLabelPhase({ owner, state, token });
    stage = "seller-fulfillment";
    await runSellerFulfillmentPhase({ owner, state, token });
    stage = "buyer-receipt";
    await runBuyerReceiptPhase({ owner, state, token });
    stage = "cleanup";
    state.routePhasesPassed = true;
    state.stage = "cleanup";
    saveState(state);
    const cleanup = await cleanupFixtures({ clerk, owner, redis, runtime, state, stripe });
    if (!cleanupPassed(cleanup)) throw new Error("authenticated Order smoke cleanup did not pass");
    state.stage = "cleaned";
    state.status = "cleaned";
    state.cleanup = cleanup;
    saveState(state);
    return finalizeCleanedState({ config, database, provider, state });
  } catch (error) {
    if (state) {
      if (state.stage === "cleaned") {
        state.lastFinalizationFailedAt = new Date().toISOString();
      } else {
        state.status = "failed";
        state.failureStage = stage;
        state.lastFailedAt = new Date().toISOString();
      }
      saveState(state);
    }
    throw error;
  } finally {
    await owner.end().catch(() => {});
    await runtime.end().catch(() => {});
  }
}

async function main() {
  await runOperator();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "authenticated Order smoke failed");
    process.exitCode = 1;
  });
}
