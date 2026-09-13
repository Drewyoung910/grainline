#!/usr/bin/env node
// One-shot authenticated production smoke for the compatible
// CheckoutStockReservation application release. The operator uses the retained
// non-customer Clerk canary and temporary private listings, creates only Stripe
// test-mode Checkout Sessions, proves retry/resume/rollback plus signed expiry,
// and removes every database/Redis/Clerk fixture it owns. Stripe Sessions and
// their webhook ledger rows are immutable provider/audit evidence and remain.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
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

export const CONFIRMATION = "reviewed-checkout-stock-production-smoke";
export const COMPATIBLE_APP_COMMIT = "84a58f0fc818b502564ef6bcd974ff4af3cc4395";
export const COMPATIBLE_APP_CI_RUN_ID = 31822968848;
export const PRODUCTION_DEPLOYMENT_ID = "dpl_AGN7CU9du5Ln1EsUxHqJUopdDEsw";
export const PRODUCTION_ENDPOINT_ID = "ep-plain-river-aaqg8gj4";
export const PRODUCTION_DATABASE_NAME = "neondb";
export const RUNTIME_ROLE = "grainline_app_runtime";
export const PRODUCTION_ORIGIN = "https://thegrainline.com";
export const CLERK_FRONTEND_API = "clerk.thegrainline.com";
export const TERMS_VERSION = "2026-06-14";
export const EVIDENCE_DIRECTORY = "/Users/drewyoung/grainline-rollout-evidence";
export const LOCAL_ENV_PATH = "/Users/drewyoung/grainline/.env.local";
export const OWNER_ENV_PATH = "/Users/drewyoung/grainline/.env.migration-owner.local";
export const STATE_PATH = path.join(
  EVIDENCE_DIRECTORY,
  "checkout-stock-reservation-production-smoke-state.json",
);
const MAX_JSON_BYTES = 128 * 1024;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const FIXTURE_STOCK = 3;
const ADDRESS = Object.freeze({
  name: "Grainline Operational Canary",
  line1: "1 Test Plaza",
  line2: null,
  city: "New York",
  state: "NY",
  postalCode: "10001",
  phone: null,
});

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
    throw new Error(`${label} must be a private regular file`);
  }
}

function readPrivateJson(filePath, label) {
  assertPrivateRegularFile(filePath, label);
  const value = JSON.parse(readFileSync(filePath, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  return value;
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

function loadPrivateEnvironment(filePath, label) {
  assertPrivateRegularFile(filePath, label);
  return parseDotenv(readFileSync(filePath, "utf8"));
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
  ) {
    throw new Error("checkout smoke requires the exact clean reviewed main commit");
  }
  return Object.freeze({ branch: state.branch, clean: true, head: state.head });
}

export function parseGitHubCiRun(raw, expectedCommit, expectedRunId) {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (
    value?.databaseId !== expectedRunId
    || value.headSha !== expectedCommit
    || value.conclusion !== "success"
    || value.status !== "completed"
    || value.workflowName !== "CI"
  ) {
    throw new Error("checkout smoke exact-main CI binding did not pass");
  }
  return Object.freeze({ exactCommit: true, passed: true, runId: expectedRunId });
}

function verifyGitHubCi(expectedCommit, expectedRunId) {
  const raw = execFileSync(
    "gh",
    [
      "run",
      "view",
      String(expectedRunId),
      "--json",
      "databaseId,headSha,conclusion,status,workflowName",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return parseGitHubCiRun(raw, expectedCommit, expectedRunId);
}

export function validateConfiguration(env = process.env) {
  if (env.CHECKOUT_STOCK_SMOKE_CONFIRM !== CONFIRMATION) {
    throw new Error("checkout smoke confirmation is invalid");
  }
  const operatorCommit = required(env, "CHECKOUT_STOCK_SMOKE_OPERATOR_COMMIT");
  if (!/^[a-f0-9]{40}$/.test(operatorCommit)) {
    throw new Error("checkout smoke operator commit is invalid");
  }
  const mainCiRunId = positiveInteger(env, "CHECKOUT_STOCK_SMOKE_MAIN_CI_RUN_ID");
  const evidencePath = path.resolve(required(env, "CHECKOUT_STOCK_SMOKE_EVIDENCE_PATH"));
  if (
    path.dirname(evidencePath) !== EVIDENCE_DIRECTORY
    || path.basename(evidencePath) !== `checkout-stock-reservation-production-smoke-${operatorCommit}.json`
    || existsSync(evidencePath)
  ) {
    throw new Error("checkout smoke evidence path is not the fresh reviewed path");
  }
  return Object.freeze({ evidencePath, mainCiRunId, operatorCommit });
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
  ) {
    throw new Error("checkout smoke runtime database identity drifted");
  }
  if (
    owner.protocol !== "postgresql:"
    || owner.username !== "neondb_owner"
    || owner.hostname !== `${PRODUCTION_ENDPOINT_ID}.westus3.azure.neon.tech`
    || owner.pathname !== `/${PRODUCTION_DATABASE_NAME}`
    || owner.searchParams.get("sslmode") !== "verify-full"
    || owner.searchParams.get("channel_binding") !== "require"
    || !owner.password
  ) {
    throw new Error("checkout smoke owner database identity drifted");
  }
  return Object.freeze({ ownerDatabaseUrl, runtimeDatabaseUrl });
}

export function validateProviderCredentials(localValues) {
  const stripeSecret = required(localValues, "STRIPE_SECRET_KEY");
  const clerkSecret = required(localValues, "CLERK_SECRET_KEY");
  const clerkPublishable = required(localValues, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
  const redisUrl = required(localValues, "UPSTASH_REDIS_REST_URL");
  const redisToken = required(localValues, "UPSTASH_REDIS_REST_TOKEN");
  if (!stripeSecret.startsWith("sk_test_")) {
    throw new Error("checkout smoke refuses any non-test Stripe secret");
  }
  if (!clerkSecret.startsWith("sk_live_") || !clerkPublishable.startsWith("pk_live_")) {
    throw new Error("checkout smoke requires the reviewed live Clerk pair");
  }
  const parsed = parsePublishableKey(clerkPublishable);
  if (parsed.instanceType !== "production" || parsed.frontendApi !== CLERK_FRONTEND_API) {
    throw new Error("checkout smoke Clerk Frontend API identity drifted");
  }
  if (!redisUrl.startsWith("https://") || redisToken.length < 16) {
    throw new Error("checkout smoke Redis credentials are invalid");
  }
  return Object.freeze({ clerkSecret, redisToken, redisUrl, stripeSecret });
}

async function boundedText(response, maxBytes) {
  const value = await response.text();
  if (Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new Error("route response exceeded its reviewed size bound");
  }
  return value;
}

async function boundedJson(response) {
  const value = JSON.parse(await boundedText(response, MAX_JSON_BYTES));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("route response was not a JSON object");
  }
  return value;
}

async function fetchJson(pathname, token, { body, method = "GET", origin = PRODUCTION_ORIGIN } = {}) {
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
  return { body: await boundedJson(response), status: response.status };
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
  ) {
    throw new Error("Clerk one-use ticket exchange failed");
  }
  const token = await clerk.sessions.getToken(sessionId, undefined, 300);
  if (typeof token?.jwt !== "string" || token.jwt.split(".").length !== 3) {
    throw new Error("Clerk session token shape drifted");
  }
  return { jwt: token.jwt, sessionId, signInTokenId: signInToken.id };
}

async function revokeCanarySessions(clerk, clerkUserId) {
  const active = await clerk.sessions.getSessionList({ limit: 100, status: "active", userId: clerkUserId });
  for (const session of active.data) await clerk.sessions.revokeSession(session.id);
  const after = await clerk.sessions.getSessionList({ limit: 100, status: "active", userId: clerkUserId });
  return after.totalCount === 0 && after.data.length === 0;
}

function checkoutRate(rate) {
  if (
    !rate
    || rate.objectId !== "pickup"
    || rate.amountCents !== 0
    || rate.currency !== "usd"
    || typeof rate.token !== "string"
    || !Number.isInteger(rate.expiresAt)
    || typeof rate.subjectHash !== "string"
  ) {
    throw new Error("shipping quote did not return the exact signed pickup rate");
  }
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

async function signedPickupRate(token, body) {
  const response = await fetchJson("/api/shipping/quote", token, { body, method: "POST" });
  if (response.status !== 200 || !Array.isArray(response.body.rates)) {
    throw new Error("shipping quote route failed");
  }
  return checkoutRate(response.body.rates.find((rate) => rate?.objectId === "pickup"));
}

function assertCheckoutResponse(response, label, expectedSessionId = null) {
  if (
    response.status !== 200
    || !/^cs_test_[A-Za-z0-9_]+$/.test(String(response.body.sessionId ?? ""))
    || typeof response.body.clientSecret !== "string"
    || !response.body.clientSecret.includes("_secret_")
    || (expectedSessionId && response.body.sessionId !== expectedSessionId)
  ) {
    throw new Error(`${label} returned an invalid Checkout Session`);
  }
  if (expectedSessionId && response.body.reused !== true) {
    throw new Error(`${label} did not prove exact retry reuse`);
  }
  return response.body.sessionId;
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
  if (page.status !== 200 || !pageBody.includes(`dpl=${PRODUCTION_DEPLOYMENT_ID}`)) {
    throw new Error("canonical alias is not serving the reviewed deployment marker");
  }
  return { canonicalDeploymentMarker: true, healthStatus: 200 };
}

async function verifyDatabaseIdentity(owner, runtime) {
  const [ownerIdentity, runtimeIdentity, posture] = await Promise.all([
    owner.query("SELECT current_user AS role, current_database() AS database"),
    runtime.query("SELECT current_user AS role, current_database() AS database"),
    owner.query(`
      SELECT class.relrowsecurity AS enabled,
             class.relforcerowsecurity AS forced,
             pg_catalog.pg_get_userbyid(class.relowner) AS owner
        FROM pg_catalog.pg_class AS class
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
       WHERE namespace.nspname = 'public'
         AND class.relname = 'CheckoutStockReservation'
         AND class.relkind = 'r'
    `),
  ]);
  assert.deepEqual(ownerIdentity.rows, [{ role: "neondb_owner", database: PRODUCTION_DATABASE_NAME }]);
  assert.deepEqual(runtimeIdentity.rows, [{ role: RUNTIME_ROLE, database: PRODUCTION_DATABASE_NAME }]);
  assert.deepEqual(posture.rows, [{ enabled: false, forced: false, owner: "neondb_owner" }]);
  return { rlsEnabled: false, rlsForced: false, runtimeRole: RUNTIME_ROLE };
}

async function selectCanary(clerk, owner) {
  const users = await clerk.users.getUserList({ externalId: [NOTIFICATION_CANARY_EXTERNAL_ID], limit: 2 });
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
  ) {
    throw new Error("operational canary identity drifted");
  }
  const result = await owner.query(`
    SELECT id, "clerkId", "termsAcceptedAt", "termsVersion", "ageAttestedAt"
      FROM public."User"
     WHERE "clerkId" = $1 AND "deletedAt" IS NULL AND banned = false
  `, [clerkUser.id]);
  if (result.rowCount !== 1) throw new Error("operational canary database identity drifted");
  const candidate = result.rows[0];
  const activity = await owner.query(`
    SELECT
      (SELECT pg_catalog.count(*)::integer FROM public."Order" WHERE "buyerId" = $1) AS orders,
      (SELECT pg_catalog.count(*)::integer
         FROM public."CartItem" AS item
         JOIN public."Cart" AS cart ON cart.id = item."cartId"
        WHERE cart."userId" = $1) AS cart_items,
      (SELECT pg_catalog.count(*)::integer
         FROM public."CheckoutStockReservation"
        WHERE "buyerId" = $1 AND status IN ('RESERVED', 'SESSION_CREATED')) AS active_reservations
  `, [candidate.id]);
  assert.deepEqual(activity.rows, [{ orders: 0, cart_items: 0, active_reservations: 0 }]);
  const sessions = await clerk.sessions.getSessionList({ limit: 100, status: "active", userId: candidate.clerkId });
  if (sessions.totalCount !== 0 || sessions.data.length !== 0) {
    throw new Error("operational canary has a pre-existing active Clerk session");
  }
  return candidate;
}

async function selectSeller(owner, stripe, buyerId) {
  const candidates = await owner.query(`
    SELECT seller.id, seller."userId", seller."stripeAccountId"
      FROM public."SellerProfile" AS seller
      JOIN public."User" AS account ON account.id = seller."userId"
     WHERE seller."chargesEnabled" = true
       AND seller."stripeAccountId" IS NOT NULL
       AND seller."allowLocalPickup" = true
       AND seller."vacationMode" = false
       AND seller."acceptingNewOrders" = true
       AND account.banned = false
       AND account."deletedAt" IS NULL
       AND seller."userId" <> $1
     ORDER BY seller.id
     LIMIT 5
  `, [buyerId]);
  for (const candidate of candidates.rows) {
    try {
      const account = await stripe.accounts.retrieve(candidate.stripeAccountId);
      if (account && !account.deleted && account.charges_enabled === true) return candidate;
    } catch {
      // Try the next already-eligible database candidate without exposing IDs.
    }
  }
  throw new Error("no existing eligible Stripe test-mode pickup seller was available");
}

function createInitialState(config, candidate, seller, cart, cartCreated) {
  const nonce = randomUUID();
  return {
    version: 1,
    status: "running",
    stage: "selected-identities",
    operatorCommit: config.operatorCommit,
    mainCiRunId: config.mainCiRunId,
    compatibleAppCommit: COMPATIBLE_APP_COMMIT,
    compatibleAppCiRunId: COMPATIBLE_APP_CI_RUN_ID,
    deploymentId: PRODUCTION_DEPLOYMENT_ID,
    buyerId: candidate.id,
    clerkId: candidate.clerkId,
    sellerId: seller.id,
    originalTerms: {
      termsAcceptedAt: candidate.termsAcceptedAt,
      termsVersion: candidate.termsVersion,
      ageAttestedAt: candidate.ageAttestedAt,
    },
    cartId: cart.id,
    cartCreated,
    cartItemId: randomUUID(),
    listingIds: {
      inStock: randomUUID(),
      madeToOrder: randomUUID(),
    },
    reservationIds: [],
    sessions: [],
    nonce,
    startedAt: new Date().toISOString(),
  };
}

function saveState(state) {
  if (existsSync(STATE_PATH)) replacePrivateJson(STATE_PATH, state);
  else writePrivateJson(STATE_PATH, state);
}

async function seedFixtures(owner, state) {
  await owner.query("BEGIN");
  try {
    const termsAt = new Date();
    const adjusted = await owner.query(`
      UPDATE public."User"
         SET "termsAcceptedAt" = $2, "termsVersion" = $3, "ageAttestedAt" = $2
       WHERE id = $1
    `, [state.buyerId, termsAt, TERMS_VERSION]);
    if (adjusted.rowCount !== 1) throw new Error("canary terms adjustment failed");
    if (state.cartCreated) {
      await owner.query(`
        INSERT INTO public."Cart" (id, "userId", "createdAt", "updatedAt")
        VALUES ($1, $2, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp())
      `, [state.cartId, state.buyerId]);
    }
    await owner.query(`
      INSERT INTO public."Listing" (
        id, "sellerId", title, description, "priceCents", currency, status,
        "listingType", "stockQuantity", "shipsWithinDays", "isPrivate",
        "reservedForUserId", "packagedWeightGrams", "packagedLengthCm",
        "packagedWidthCm", "packagedHeightCm", "createdAt", "updatedAt"
      ) VALUES
        ($1, $3, $4, 'Disposable private production checkout smoke fixture', 500, 'usd', 'ACTIVE',
         'IN_STOCK', $6, 2, true, $7, 500, 10, 10, 10,
         pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
        ($2, $3, $5, 'Disposable private production checkout smoke fixture', 500, 'usd', 'ACTIVE',
         'MADE_TO_ORDER', NULL, NULL, true, $7, 500, 10, 10, 10,
         pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp())
    `, [
      state.listingIds.inStock,
      state.listingIds.madeToOrder,
      state.sellerId,
      `checkout-smoke-in-stock-${state.nonce.slice(0, 8)}`,
      `checkout-smoke-made-to-order-${state.nonce.slice(0, 8)}`,
      FIXTURE_STOCK,
      state.buyerId,
    ]);
    await owner.query("COMMIT");
  } catch (error) {
    await owner.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function addCartFixture(owner, state) {
  const inserted = await owner.query(`
    INSERT INTO public."CartItem" (
      id, "cartId", "listingId", quantity, "priceCents", "priceVersion",
      "selectedVariantOptionIds", "variantKey", "createdAt"
    ) VALUES ($1, $2, $3, 1, 500, 1, ARRAY[]::text[], '', pg_catalog.clock_timestamp())
    RETURNING id
  `, [state.cartItemId, state.cartId, state.listingIds.inStock]);
  if (inserted.rowCount !== 1) throw new Error("cart fixture insertion failed");
}

async function recordSession(state, stripe, sessionId, kind, expectedLockKey) {
  state.sessions.push({ id: sessionId, kind, lockKey: expectedLockKey });
  state.stage = `${kind}-session-returned`;
  saveState(state);
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (
    session.livemode !== false
    || session.status !== "open"
    || session.payment_status !== "unpaid"
    || session.metadata?.buyerId !== state.buyerId
    || session.metadata?.sellerId !== state.sellerId
  ) {
    throw new Error(`${kind} Stripe Checkout Session posture drifted`);
  }
  const lockKey = session.metadata?.checkoutLockKey;
  if (lockKey !== expectedLockKey) {
    throw new Error(`${kind} Stripe Checkout Session lock metadata drifted`);
  }
  state.stage = `${kind}-session-created`;
  saveState(state);
  return session;
}

async function assertReservation(owner, state, sessionId, expectedStatus = "SESSION_CREATED") {
  const reservation = await owner.query(`
    SELECT id, status, "reservedItems", "buyerId", "sellerId"
      FROM public."CheckoutStockReservation"
     WHERE "stripeSessionId" = $1
  `, [sessionId]);
  if (
    reservation.rowCount !== 1
    || reservation.rows[0].status !== expectedStatus
    || reservation.rows[0].buyerId !== state.buyerId
    || reservation.rows[0].sellerId !== state.sellerId
    || !Array.isArray(reservation.rows[0].reservedItems)
    || reservation.rows[0].reservedItems.length !== 1
  ) {
    throw new Error("CheckoutStockReservation database state drifted");
  }
  if (!state.reservationIds.includes(reservation.rows[0].id)) {
    state.reservationIds.push(reservation.rows[0].id);
    saveState(state);
  }
  return reservation.rows[0];
}

async function rollbackSession(token, sessionId) {
  const response = await fetchJson("/api/cart/checkout/rollback", token, {
    body: { sessionIds: [sessionId] },
    method: "POST",
  });
  if (
    response.status !== 200
    || response.body.ok !== true
    || !Array.isArray(response.body.results)
    || response.body.results.length !== 1
    || response.body.results[0]?.status !== "restored"
  ) {
    throw new Error("checkout rollback route did not restore the exact test session");
  }
}

async function assertExpiredAndRestored({ owner, redis, state, stripe, sessionId, reservationExpected }) {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.status !== "expired" || session.payment_status !== "unpaid") {
    throw new Error("test Checkout Session was not expired");
  }
  if (await redis.get(session.metadata.checkoutLockKey)) {
    throw new Error("checkout Redis lock remained after rollback");
  }
  if (reservationExpected) {
    await assertReservation(owner, state, sessionId, "RESTORED");
  } else {
    const legacyState = await owner.query(`
      SELECT
        (SELECT pg_catalog.count(*)::integer
           FROM public."CheckoutStockReservation"
          WHERE "stripeSessionId" = $1) AS reservations,
        (SELECT pg_catalog.count(*)::integer
           FROM public."StripeWebhookEvent"
          WHERE id = 'checkout-stock-restore:' || $1::text
            AND type = 'checkout.session.stock_restored'
            AND "processedAt" IS NOT NULL
            AND "lastError" IS NULL) AS legacy_restore_claims
    `, [sessionId]);
    assert.deepEqual(legacyState.rows, [{ reservations: 0, legacy_restore_claims: 1 }]);
  }
}

async function waitForSignedExpiry(owner, sessionIds) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const result = await owner.query(`
      SELECT pg_catalog.count(*)::integer AS count
        FROM public."StripeWebhookEvent"
       WHERE type = 'checkout.session.expired'
         AND "sourceObjectId" = ANY($1::text[])
         AND "processedAt" IS NOT NULL
         AND "lastError" IS NULL
    `, [sessionIds]);
    if (result.rows[0]?.count === sessionIds.length) return sessionIds.length;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("signed Stripe expiry deliveries did not reach the reviewed ledger in time");
}

async function cleanup({ clerk, owner, redis, runtime, state, stripe }) {
  const cleanup = {
    sessionsExpired: false,
    signedExpiryProcessed: false,
    reservationsRestored: false,
    redisLocksDeleted: false,
    databaseFixturesDeleted: false,
    termsRestored: false,
    clerkSessionsRevoked: false,
    accountStateCacheDeleted: false,
  };
  if (!state) return cleanup;

  // Recover any exact fixture reservation that was committed before an HTTP
  // response was lost. This query is bounded by buyer, seller, fixture listing
  // IDs and the operator start time; it cannot adopt unrelated marketplace
  // rows into cleanup.
  let exactReservations = [];
  let reservationDiscoveryPassed = true;
  try {
    const recovered = await owner.query(`
      SELECT id, status, "stripeSessionId", "payloadHash"
        FROM public."CheckoutStockReservation"
       WHERE "buyerId" = $1
         AND "sellerId" = $2
         AND "createdAt" >= ($3::timestamptz AT TIME ZONE 'UTC')
         AND (
           "reservedItems" @> pg_catalog.jsonb_build_array(
             pg_catalog.jsonb_build_object('listingId', $4::text)
           )
           OR "reservedItems" @> pg_catalog.jsonb_build_array(
             pg_catalog.jsonb_build_object('listingId', $5::text)
           )
         )
       ORDER BY "createdAt", id
    `, [
      state.buyerId,
      state.sellerId,
      state.startedAt,
      state.listingIds.inStock,
      state.listingIds.madeToOrder,
    ]);
    exactReservations = recovered.rows;
    for (const row of exactReservations) {
      if (!state.reservationIds.includes(row.id)) state.reservationIds.push(row.id);
      if (
        row.stripeSessionId
        && !state.sessions.some((entry) => entry.id === row.stripeSessionId)
      ) {
        const session = await stripe.checkout.sessions.retrieve(row.stripeSessionId);
        const lockKey = session.metadata?.checkoutLockKey;
        if (
          session.metadata?.buyerId !== state.buyerId
          || session.metadata?.sellerId !== state.sellerId
          || typeof lockKey !== "string"
          || !lockKey.startsWith("checkout:")
        ) {
          throw new Error("recovered Checkout Session did not belong to the exact fixture");
        }
        state.sessions.push({ id: row.stripeSessionId, kind: "recovered", lockKey });
      }
    }
    saveState(state);
  } catch {
    exactReservations = [];
    reservationDiscoveryPassed = false;
  }

  let sessionsExpired = true;
  for (const entry of state.sessions ?? []) {
    try {
      const session = await stripe.checkout.sessions.retrieve(entry.id);
      if (session.status === "open") await stripe.checkout.sessions.expire(entry.id);
      const after = await stripe.checkout.sessions.retrieve(entry.id);
      sessionsExpired &&= after.status === "expired" || after.status === "complete";
    } catch {
      sessionsExpired = false;
    }
  }
  cleanup.sessionsExpired = sessionsExpired;

  if (sessionsExpired) {
    try {
      const sessionIds = (state.sessions ?? []).map((entry) => entry.id);
      cleanup.signedExpiryProcessed = sessionIds.length === 0
        || await waitForSignedExpiry(owner, sessionIds) === sessionIds.length;
    } catch {
      cleanup.signedExpiryProcessed = false;
    }
  }

  let reservationsRestored = sessionsExpired && reservationDiscoveryPassed;
  if (sessionsExpired) {
    for (const reservation of exactReservations) {
      if (reservation.status === "RESERVED" && !reservation.stripeSessionId) {
        try {
          await runtime.query(
            `SELECT * FROM public.grainline_checkout_reservation_checkout_abort($1::text, $2::text, $3::text)`,
            [reservation.id, state.buyerId, reservation.payloadHash],
          );
        } catch {
          reservationsRestored = false;
        }
      }
    }
    for (const entry of state.sessions ?? []) {
      try {
        await runtime.query(
          `SELECT * FROM public.grainline_checkout_reservation_buyer_expired_restore($1::text, $2::text)`,
          [state.buyerId, entry.id],
        );
      } catch {
        reservationsRestored = false;
      }
    }
    try {
      const stock = await owner.query(
        `SELECT "stockQuantity" AS stock FROM public."Listing" WHERE id = $1`,
        [state.listingIds.inStock],
      );
      if (stock.rowCount === 1) reservationsRestored &&= stock.rows[0].stock === FIXTURE_STOCK;
      const terminal = await owner.query(`
        SELECT pg_catalog.count(*)::integer AS count
          FROM public."CheckoutStockReservation"
         WHERE id = ANY($1::text[]) AND status <> 'RESTORED'
      `, [state.reservationIds ?? []]);
      reservationsRestored &&= terminal.rows[0]?.count === 0;
    } catch {
      reservationsRestored = false;
    }
  }
  cleanup.reservationsRestored = reservationsRestored;

  let redisLocksDeleted = reservationsRestored;
  if (reservationsRestored) {
    for (const entry of state.sessions ?? []) {
      try {
        await redis.del(entry.lockKey);
        redisLocksDeleted &&= (await redis.get(entry.lockKey)) === null;
      } catch {
        redisLocksDeleted = false;
      }
    }
  }
  cleanup.redisLocksDeleted = redisLocksDeleted;

  // Never delete terminal reservation evidence before the real signed expiry
  // delivery has finished. Otherwise a later webhook would find no fixed row
  // and could fall through to the predecessor restore path.
  if (reservationsRestored && redisLocksDeleted && cleanup.signedExpiryProcessed) {
    try {
      await owner.query("BEGIN");
      await owner.query(`DELETE FROM public."CartItem" WHERE id = $1`, [state.cartItemId]);
      await owner.query(
        `DELETE FROM public."CheckoutStockReservation" WHERE id = ANY($1::text[])`,
        [state.reservationIds ?? []],
      );
      await owner.query(
        `DELETE FROM public."Listing" WHERE id = ANY($1::text[])`,
        [[state.listingIds.inStock, state.listingIds.madeToOrder]],
      );
      if (state.cartCreated) {
        await owner.query(`DELETE FROM public."Cart" WHERE id = $1 AND NOT EXISTS (
          SELECT 1 FROM public."CartItem" WHERE "cartId" = $1
        )`, [state.cartId]);
      }
      await owner.query("COMMIT");
      const residue = await owner.query(`
        SELECT
          (SELECT pg_catalog.count(*)::integer FROM public."Listing" WHERE id = ANY($1::text[])) AS listings,
          (SELECT pg_catalog.count(*)::integer FROM public."CartItem" WHERE id = $2) AS cart_items,
          (SELECT pg_catalog.count(*)::integer FROM public."CheckoutStockReservation" WHERE id = ANY($3::text[])) AS reservations
      `, [[state.listingIds.inStock, state.listingIds.madeToOrder], state.cartItemId, state.reservationIds ?? []]);
      cleanup.databaseFixturesDeleted = residue.rows[0]?.listings === 0
        && residue.rows[0]?.cart_items === 0
        && residue.rows[0]?.reservations === 0;
    } catch {
      await owner.query("ROLLBACK").catch(() => {});
    }
  }

  try {
    const restored = await owner.query(`
      UPDATE public."User"
         SET "termsAcceptedAt" = $2, "termsVersion" = $3, "ageAttestedAt" = $4
       WHERE id = $1
    `, [
      state.buyerId,
      state.originalTerms.termsAcceptedAt,
      state.originalTerms.termsVersion,
      state.originalTerms.ageAttestedAt,
    ]);
    cleanup.termsRestored = restored.rowCount === 1;
  } catch {}

  try {
    cleanup.clerkSessionsRevoked = await revokeCanarySessions(clerk, state.clerkId);
  } catch {}

  try {
    const key = `account-state:vercel-production:clerk:${state.clerkId}`;
    await redis.del(key);
    cleanup.accountStateCacheDeleted = (await redis.get(key)) === null;
  } catch {}
  return cleanup;
}

function cleanupPassed(value) {
  return Boolean(value) && Object.values(value).every(Boolean);
}

export function sanitizedEvidence({ cleanup: cleanupResult, config, result, stage, status }) {
  return {
    generatedAt: new Date().toISOString(),
    scope: "checkout-stock-reservation-compatible-production-smoke",
    status,
    operatorCommit: config.operatorCommit,
    mainCiRunId: config.mainCiRunId,
    compatibleApplication: {
      commit: COMPATIBLE_APP_COMMIT,
      ciRunId: COMPATIBLE_APP_CI_RUN_ID,
      deploymentId: PRODUCTION_DEPLOYMENT_ID,
    },
    production: {
      databaseEndpointId: PRODUCTION_ENDPOINT_ID,
      databaseName: PRODUCTION_DATABASE_NAME,
      runtimeRole: RUNTIME_ROLE,
      stripeMode: "test",
    },
    identity: {
      existingOperationalCanaryUsed: true,
      newClerkUserCreated: false,
      existingEligibleSellerUsed: true,
      retainedIdentifier: false,
    },
    result,
    cleanup: cleanupResult,
    expectedRetainedProviderEvidence: {
      expiredStripeTestCheckoutSessions: result?.checkoutSessionsCreated ?? 0,
      processedStripeExpiryLedgerRows: result?.signedExpiryDeliveries ?? 0,
      processedLegacyStockRestoreClaims: result?.legacyStockRestoreClaims ?? 0,
    },
    failureStage: status === "failed" ? stage : null,
    secretsRetained: false,
  };
}

async function runOperator() {
  const config = validateConfiguration();
  assertGitState(readGitState(), config.operatorCommit);
  verifyGitHubCi(config.operatorCommit, config.mainCiRunId);
  if (existsSync(STATE_PATH)) {
    throw new Error("checkout smoke state already exists; run cleanup before a new attempt");
  }
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
  let primaryFailure = null;
  let result = null;
  let cleanupResult = null;
  let signInTokenId = null;
  try {
    await owner.connect();
    await runtime.connect();
    stage = "verify-boundaries";
    const deployment = await verifyDeploymentBoundary();
    const databasePosture = await verifyDatabaseIdentity(owner, runtime);
    const candidate = await selectCanary(clerk, owner);
    const seller = await selectSeller(owner, stripe, candidate.id);
    const existingCart = await owner.query(`SELECT id FROM public."Cart" WHERE "userId" = $1`, [candidate.id]);
    if (existingCart.rowCount > 1) throw new Error("operational canary cart uniqueness drifted");
    const cart = existingCart.rows[0] ?? { id: randomUUID() };
    state = createInitialState(config, candidate, seller, cart, existingCart.rowCount === 0);
    saveState(state);

    stage = "seed-fixtures";
    state.stage = stage;
    saveState(state);
    await seedFixtures(owner, state);
    await redis.del(`account-state:vercel-production:clerk:${state.clerkId}`);

    stage = "authenticate-canary";
    const authentication = await createCanarySession(clerk, state.clerkId);
    signInTokenId = authentication.signInTokenId;
    const token = authentication.jwt;

    stage = "cross-origin-denial";
    const crossOrigin = await fetchJson("/api/cart/checkout/single", token, {
      body: {}, method: "POST", origin: "https://example.invalid",
    });
    if (crossOrigin.status !== 403 || crossOrigin.body.error !== "Forbidden") {
      throw new Error("checkout mutation did not reject explicit cross-origin input");
    }

    const runSingle = async (kind, listingId, reservationExpected) => {
      stage = `${kind}-quote`;
      const selectedRate = await signedPickupRate(token, {
        mode: "single",
        listingId,
        quantity: 1,
        toPostal: ADDRESS.postalCode,
        toState: ADDRESS.state,
        toCity: ADDRESS.city,
        toCountry: "US",
      });
      const body = {
        listingId,
        quantity: 1,
        shippingAddress: ADDRESS,
        selectedRate,
        giftNote: null,
        giftWrapping: false,
        selectedVariantOptionIds: [],
      };
      stage = `${kind}-create`;
      const created = await fetchJson("/api/cart/checkout/single", token, { body, method: "POST" });
      const sessionId = created.body?.sessionId;
      if (/^cs_test_[A-Za-z0-9_]+$/.test(String(sessionId ?? ""))) {
        await recordSession(
          state,
          stripe,
          sessionId,
          kind,
          `checkout:single:${state.buyerId}:listing:${listingId}`,
        );
      }
      assertCheckoutResponse(created, `${kind} creation`);
      if (reservationExpected) await assertReservation(owner, state, sessionId);
      stage = `${kind}-retry`;
      const retry = await fetchJson("/api/cart/checkout/single", token, { body, method: "POST" });
      assertCheckoutResponse(retry, `${kind} retry`, sessionId);
      stage = `${kind}-rollback`;
      await rollbackSession(token, sessionId);
      await assertExpiredAndRestored({ owner, redis, state, stripe, sessionId, reservationExpected });
      return sessionId;
    };

    await runSingle("single-in-stock", state.listingIds.inStock, true);
    await runSingle("single-made-to-order", state.listingIds.madeToOrder, false);

    stage = "cart-seed";
    await addCartFixture(owner, state);
    const cartRate = await signedPickupRate(token, {
      mode: "cart",
      cartId: state.cartId,
      sellerId: state.sellerId,
      toPostal: ADDRESS.postalCode,
      toState: ADDRESS.state,
      toCity: ADDRESS.city,
      toCountry: "US",
    });
    const checkoutGroupId = randomUUID();
    const cartBody = {
      sellerId: state.sellerId,
      checkoutGroupId,
      shippingAddress: ADDRESS,
      selectedRate: cartRate,
      giftNote: null,
      giftWrapping: false,
    };
    stage = "cart-create";
    const cartCreated = await fetchJson("/api/cart/checkout-seller", token, { body: cartBody, method: "POST" });
    const cartSessionId = cartCreated.body?.sessionId;
    if (/^cs_test_[A-Za-z0-9_]+$/.test(String(cartSessionId ?? ""))) {
      await recordSession(
        state,
        stripe,
        cartSessionId,
        "cart-in-stock",
        `checkout:cart:${state.cartId}:seller:${state.sellerId}`,
      );
    }
    assertCheckoutResponse(cartCreated, "cart creation");
    await assertReservation(owner, state, cartSessionId);
    stage = "cart-resume";
    const resume = await fetchJson("/api/cart/checkout/resume", token);
    if (
      resume.status !== 200
      || !Array.isArray(resume.body.clientSecrets)
      || resume.body.clientSecrets.length !== 1
      || resume.body.clientSecrets[0]?.sessionId !== cartSessionId
    ) {
      throw new Error("cart resume did not return the exact open Checkout Session");
    }
    stage = "cart-retry";
    const cartRetry = await fetchJson("/api/cart/checkout-seller", token, { body: cartBody, method: "POST" });
    assertCheckoutResponse(cartRetry, "cart retry", cartSessionId);
    stage = "cart-rollback";
    await rollbackSession(token, cartSessionId);
    await assertExpiredAndRestored({
      owner, redis, state, stripe, sessionId: cartSessionId, reservationExpected: true,
    });
    const resumeAfter = await fetchJson("/api/cart/checkout/resume", token);
    if (resumeAfter.status !== 200 || resumeAfter.body.clientSecrets?.length !== 0) {
      throw new Error("cart resume retained an expired Checkout Session");
    }

    stage = "signed-expiry-ledger";
    const signedExpiryDeliveries = await waitForSignedExpiry(owner, state.sessions.map((entry) => entry.id));
    const legacyRestoreClaimIds = state.sessions
      .filter((entry) => entry.kind === "single-made-to-order")
      .map((entry) => `checkout-stock-restore:${entry.id}`);
    const final = await owner.query(`
      SELECT
        (SELECT "stockQuantity" FROM public."Listing" WHERE id = $1) AS stock,
        (SELECT pg_catalog.count(*)::integer FROM public."Order" WHERE "buyerId" = $2) AS orders,
        (SELECT pg_catalog.count(*)::integer
           FROM public."CheckoutStockReservation"
          WHERE id = ANY($3::text[]) AND status = 'RESTORED') AS restored_reservations,
        (SELECT pg_catalog.count(*)::integer
           FROM public."StripeWebhookEvent"
          WHERE id = ANY($4::text[])
            AND type = 'checkout.session.stock_restored'
            AND "processedAt" IS NOT NULL
            AND "lastError" IS NULL) AS legacy_restore_claims
    `, [
      state.listingIds.inStock,
      state.buyerId,
      state.reservationIds,
      legacyRestoreClaimIds,
    ]);
    if (
      final.rows[0]?.stock !== FIXTURE_STOCK
      || final.rows[0]?.orders !== 0
      || final.rows[0]?.restored_reservations !== 2
      || final.rows[0]?.legacy_restore_claims !== 1
    ) {
      throw new Error("checkout smoke final database state drifted");
    }
    result = {
      deployment,
      databasePosture,
      checkoutSessionsCreated: state.sessions.length,
      exactRetryReuses: 3,
      singleInStockPassed: true,
      singleMadeToOrderPassed: true,
      cartInStockPassed: true,
      cartResumePassed: true,
      rollbackAndStockRestorePassed: true,
      legacyStockRestoreClaims: final.rows[0].legacy_restore_claims,
      crossOriginDenied: true,
      signedExpiryDeliveries,
      paidCompletionExercised: false,
      paidCompletionReason: "covered by the disposable provider proof; this production smoke creates no charge or order",
    };
  } catch (error) {
    primaryFailure = error;
  } finally {
    stage = primaryFailure ? stage : "cleanup";
    if (state) {
      cleanupResult = await cleanup({ clerk, owner, redis, runtime, state, stripe });
      state.status = cleanupPassed(cleanupResult) ? "cleaned" : "cleanup-incomplete";
      state.stage = stage;
      saveState(state);
    }
    if (signInTokenId && state) {
      // A consumed ticket cannot be revoked; its session is revoked by cleanup.
      // An unconsumed ticket expires after 60 seconds and is never retained.
    }
    await owner.end().catch(() => {});
    await runtime.end().catch(() => {});
  }

  const status = !primaryFailure && cleanupPassed(cleanupResult) ? "passed" : "failed";
  const evidence = sanitizedEvidence({ cleanup: cleanupResult, config, result, stage, status });
  const serialized = JSON.stringify(evidence);
  for (const sensitive of [
    database.ownerDatabaseUrl,
    database.runtimeDatabaseUrl,
    provider.stripeSecret,
    provider.clerkSecret,
    provider.redisToken,
    state?.buyerId,
    state?.clerkId,
    state?.sellerId,
    state?.cartId,
    state?.cartItemId,
    state?.listingIds?.inStock,
    state?.listingIds?.madeToOrder,
    ...(state?.reservationIds ?? []),
    ...(state?.sessions ?? []).flatMap((entry) => [entry.id, entry.lockKey]),
  ]) {
    if (sensitive && serialized.includes(sensitive)) {
      throw new Error("checkout smoke evidence retained a secret or identifier");
    }
  }
  writePrivateJson(config.evidencePath, evidence);
  if (status === "passed") {
    unlinkSync(STATE_PATH);
    console.log(JSON.stringify({
      checkoutStockReservationProductionSmoke: "passed",
      databaseFixturesDeleted: true,
      clerkSessionsRevoked: true,
      stripeMode: "test",
      signedExpiryDeliveries: result.signedExpiryDeliveries,
    }));
    return;
  }
  throw new Error(`checkout smoke failed closed at ${stage}; private cleanup state was retained`);
}

async function cleanupOnly() {
  const state = readPrivateJson(STATE_PATH, "checkout smoke state");
  const localValues = loadPrivateEnvironment(LOCAL_ENV_PATH, "local environment file");
  const ownerValues = loadPrivateEnvironment(OWNER_ENV_PATH, "migration-owner environment file");
  const database = parseDatabaseUrls(localValues, ownerValues);
  const provider = validateProviderCredentials(localValues);
  const owner = new Client({ connectionString: database.ownerDatabaseUrl });
  const runtime = new Client({ connectionString: database.runtimeDatabaseUrl });
  const stripe = new Stripe(provider.stripeSecret);
  const clerk = createClerkClient({ secretKey: provider.clerkSecret });
  const redis = new Redis({ url: provider.redisUrl, token: provider.redisToken });
  await owner.connect();
  await runtime.connect();
  try {
    await verifyDatabaseIdentity(owner, runtime);
    const result = await cleanup({ clerk, owner, redis, runtime, state, stripe });
    if (!cleanupPassed(result)) throw new Error("checkout smoke cleanup remains incomplete");
    unlinkSync(STATE_PATH);
    console.log(JSON.stringify({ checkoutStockReservationProductionSmokeCleanup: "passed" }));
  } finally {
    await owner.end().catch(() => {});
    await runtime.end().catch(() => {});
  }
}

async function main() {
  const command = process.argv[2];
  if (command === "run") return runOperator();
  if (command === "cleanup") return cleanupOnly();
  throw new Error("Usage: node scripts/checkout-stock-reservation-production-smoke.mjs <run|cleanup>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "checkout smoke failed");
    process.exitCode = 1;
  });
}
