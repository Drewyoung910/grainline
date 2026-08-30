#!/usr/bin/env node
// Shared bounded authenticated compatibility smoke for the current
// OrderPaymentEvent application release. This operator creates no database,
// Stripe or Vercel fixtures. It uses the retained operational Clerk canary,
// proves the deployed account page and the authoritative review-eligibility
// denial, then revokes its session and clears only that canary's transient
// account-cache and review-rate-limit state.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
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
import { createClerkClient } from "@clerk/backend";
import { parsePublishableKey } from "@clerk/shared/keys";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { parse as parseDotenv } from "dotenv";
import { NOTIFICATION_CANARY_EXTERNAL_ID } from "./notification-operational-canary.mjs";

export const CONFIRMATION = "reviewed-order-payment-event-transition-production-smoke";
export const DEPLOYED_SOURCE_COMMIT = "ce7550dae6c417440230f4d596f2239393075f31";
export const DEPLOYED_SOURCE_CI_RUN_ID = 33327064035;
export const DEPLOYMENT_ID = "dpl_Coyjd6rTXteBV9e4QZtZGFDaiEYc";
export const PREDECESSOR_SOURCE_COMMIT = "4908bc7f377f5950da8de6b3398049d65a5fdfcb";
export const PREDECESSOR_DEPLOYMENT_ID = "dpl_UiZckAkuj8CSyLPBeQBUHF5Fq1Dj";
export const TRANSITION_AUTHORITY_EVIDENCE_SHA256 =
  "63eadf89f23a6fa729814bc7a39c0ea18a126db241bff8ba2aef725a5f5fb81b";
export const TRANSITION_MIGRATION_RUN_ID = 33326252495;
export const EVIDENCE_DIRECTORY = "/Users/drewyoung/grainline-rollout-evidence";
export const TRANSITION_AUTHORITY_EVIDENCE_PATH = path.join(
  EVIDENCE_DIRECTORY,
  "order-payment-event-transition-authority-production-postflight-720f99522ab273332ee6ba577ecec1c356d86bc3.json",
);
export const STATE_PATH = path.join(
  EVIDENCE_DIRECTORY,
  "order-payment-event-transition-production-smoke-state.json",
);
export const PRODUCTION_ORIGIN = "https://thegrainline.com";
export const REVIEWED_CLERK_FRONTEND_API = "clerk.thegrainline.com";
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

const LOCAL_ENV_PATH = "/Users/drewyoung/grainline/.env.local";
const VERCEL_CLI_VERSION = "58.9.0";
const MAX_JSON_BYTES = 128 * 1024;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function parseTransitionAuthorityEvidence(
  raw,
  expectedSha256 = TRANSITION_AUTHORITY_EVIDENCE_SHA256,
) {
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  if (sha256(bytes) !== expectedSha256) {
    throw new Error("transition authority evidence digest drifted");
  }
  const value = JSON.parse(bytes.toString("utf8"));
  if (
    value?.schemaVersion !== 1
    || value.operation !== "order-payment-event-transition-authority-production-postflight"
    || value.status !== "passed"
    || value.source?.clean !== true
    || value.source.commit !== "720f99522ab273332ee6ba577ecec1c356d86bc3"
    || value.runs?.inspectionRunId !== 33323654599
    || value.runs?.mainCiRunId !== 33317024869
    || value.runs?.migrationRunId !== TRANSITION_MIGRATION_RUN_ID
    || value.target?.role !== "grainline_app_runtime"
    || value.proof?.orderPaymentEventPredecessorCrudRetained !== true
    || value.proof?.orderPaymentEventRlsEnabled !== false
    || value.proof?.postflightReadOnly !== true
    || value.proof?.rowsExported !== false
    || value.proof?.publicOrUnreviewedAuthority !== false
    || value.proof?.productionChangedByPostflight !== false
    || value.proof?.transitionProjectionQueryProven !== true
    || value.proof?.transitionPrivateFunctionCount !== 3
    || value.proof?.deniedTransitionPrivateFunctionCount !== 3
    || value.productionChangedByPostflight !== false
  ) {
    throw new Error("transition authority evidence shape drifted");
  }
  return Object.freeze({
    accepted: true,
    migrationRunId: value.runs.migrationRunId,
    sha256: expectedSha256,
  });
}

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

export function verifyTransitionAuthorityEvidence(
  filePath = TRANSITION_AUTHORITY_EVIDENCE_PATH,
) {
  assertPrivateRegularFile(filePath, "transition authority evidence");
  return parseTransitionAuthorityEvidence(readFileSync(filePath));
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
  const descriptor = openSync(filePath, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  } finally {
    closeSync(descriptor);
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

function loadLocalEnvironment() {
  assertPrivateRegularFile(LOCAL_ENV_PATH, "local environment file");
  return parseDotenv(readFileSync(LOCAL_ENV_PATH, "utf8"));
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
    originMain: run(["rev-parse", "origin/main"]),
    status: run(["status", "--porcelain=v1", "--untracked-files=all"]),
  });
}

export function assertGitState(state, expectedCommit) {
  if (
    !/^[a-f0-9]{40}$/.test(expectedCommit)
    || state?.head !== expectedCommit
    || state.originMain !== expectedCommit
    || state.status !== ""
    || !["", "main"].includes(state.branch)
  ) {
    throw new Error("transition smoke requires the exact clean reviewed main commit");
  }
  return Object.freeze({ clean: true, exactMain: true, head: state.head });
}

export function parseGitHubCiRun(raw, expectedCommit, expectedRunId) {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (
    value?.databaseId !== expectedRunId
    || value.headSha !== expectedCommit
    || value.conclusion !== "success"
    || value.status !== "completed"
    || value.workflowName !== "CI"
    || value.headBranch !== "main"
    || value.event !== "push"
  ) {
    throw new Error("transition smoke exact-main CI binding did not pass");
  }
  return Object.freeze({ passed: true, runId: expectedRunId });
}

function readGitHubCiRun(runId) {
  return execFileSync(
    "gh",
    [
      "run",
      "view",
      String(runId),
      "--json",
      "databaseId,headSha,conclusion,status,workflowName,headBranch,event",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

export function parseVercelDeployment(raw, expected) {
  let value = raw;
  if (typeof raw === "string") {
    const jsonStart = raw.indexOf("{");
    if (jsonStart < 0) throw new Error("Vercel deployment response was not JSON");
    value = JSON.parse(raw.slice(jsonStart));
  }
  const aliases = value?.alias ?? value?.aliases ?? [];
  if (
    value?.id !== expected.deploymentId
    || value?.target !== "production"
    || value?.readyState !== "READY"
    || value?.meta?.gitCommitSha !== expected.sourceCommit
    || value?.project?.id !== REVIEWED_PROJECT.projectId
    || value?.team?.id !== REVIEWED_PROJECT.orgId
  ) {
    throw new Error("Vercel production deployment identity drifted");
  }
  if (expected.requireAliases && REQUIRED_ALIASES.some((alias) => !aliases.includes(alias))) {
    throw new Error("Vercel production alias inventory drifted");
  }
  return Object.freeze({
    aliases: Object.freeze([...aliases]),
    deploymentId: value.id,
    ready: true,
    sourceCommit: value.meta.gitCommitSha,
  });
}

export function validateConfiguration(env = process.env) {
  if (env.ORDER_PAYMENT_TRANSITION_SMOKE_CONFIRM !== CONFIRMATION) {
    throw new Error("transition smoke confirmation is invalid");
  }
  const operatorCommit = required(env, "ORDER_PAYMENT_TRANSITION_SMOKE_OPERATOR_COMMIT");
  if (!/^[a-f0-9]{40}$/.test(operatorCommit)) {
    throw new Error("transition smoke operator commit is invalid");
  }
  const mainCiRunId = positiveInteger(env, "ORDER_PAYMENT_TRANSITION_SMOKE_MAIN_CI_RUN_ID");
  const evidencePath = path.resolve(required(env, "ORDER_PAYMENT_TRANSITION_SMOKE_EVIDENCE_PATH"));
  if (
    path.dirname(evidencePath) !== EVIDENCE_DIRECTORY
    || path.basename(evidencePath)
      !== `order-payment-event-transition-production-smoke-${operatorCommit}.json`
    || existsSync(evidencePath)
  ) {
    throw new Error("transition smoke evidence path is not fresh or reviewed");
  }
  return Object.freeze({ evidencePath, mainCiRunId, operatorCommit });
}

export function validateLocalCredentials(values) {
  const clerkSecret = required(values, "CLERK_SECRET_KEY");
  const clerkPublishable = required(values, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
  const redisUrl = required(values, "UPSTASH_REDIS_REST_URL");
  const redisToken = required(values, "UPSTASH_REDIS_REST_TOKEN");
  if (!clerkSecret.startsWith("sk_live_") || !clerkPublishable.startsWith("pk_live_")) {
    throw new Error("transition smoke requires the reviewed live Clerk key pair");
  }
  const parsed = parsePublishableKey(clerkPublishable);
  if (parsed.instanceType !== "production" || parsed.frontendApi !== REVIEWED_CLERK_FRONTEND_API) {
    throw new Error("transition smoke Clerk Frontend API identity drifted");
  }
  if (!redisUrl.startsWith("https://") || redisToken.length < 16) {
    throw new Error("transition smoke Redis credentials are invalid");
  }
  return Object.freeze({
    clerkFrontendApi: parsed.frontendApi,
    clerkSecret,
    redisToken,
    redisUrl,
  });
}

export function validateRestartState(value, config) {
  if (
    value?.version !== 1
    || value.operatorCommit !== config.operatorCommit
    || value.mainCiRunId !== config.mainCiRunId
    || value.deployedSourceCommit !== DEPLOYED_SOURCE_COMMIT
    || value.deploymentId !== DEPLOYMENT_ID
    || typeof value.stage !== "string"
    || typeof value.startedAt !== "string"
    || (value.sessionId !== null && !/^sess_[A-Za-z0-9]+$/.test(value.sessionId))
    || (value.signInTokenId !== null && !/^sit_[A-Za-z0-9]+$/.test(value.signInTokenId))
  ) {
    throw new Error("transition smoke restart state drifted");
  }
  return value;
}

function assertVercelProject(cwd) {
  const value = JSON.parse(readFileSync(path.join(cwd, ".vercel", "project.json"), "utf8"));
  if (value?.projectId !== REVIEWED_PROJECT.projectId || value?.orgId !== REVIEWED_PROJECT.orgId) {
    throw new Error("transition smoke Vercel project binding drifted");
  }
}

function readVercelDeployment(cwd, deploymentId) {
  return execFileSync(
    "npx",
    [
      "--yes",
      `vercel@${VERCEL_CLI_VERSION}`,
      "api",
      `/v13/deployments/${deploymentId}`,
      "--raw",
      "--cwd",
      cwd,
      "--no-color",
    ],
    {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_loglevel: "error",
        npm_config_update_notifier: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

async function boundedText(response, maxBytes) {
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > maxBytes) {
    throw new Error("transition smoke response exceeded its reviewed bound");
  }
  return body;
}

async function boundedJson(response) {
  const body = JSON.parse(await boundedText(response, MAX_JSON_BYTES));
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("transition smoke route response was not an object");
  }
  return body;
}

async function verifyDeployment(config) {
  assertVercelProject(config.cwd);
  const current = parseVercelDeployment(
    readVercelDeployment(config.cwd, DEPLOYMENT_ID),
    {
      deploymentId: DEPLOYMENT_ID,
      requireAliases: true,
      sourceCommit: DEPLOYED_SOURCE_COMMIT,
    },
  );
  const predecessor = parseVercelDeployment(
    readVercelDeployment(config.cwd, PREDECESSOR_DEPLOYMENT_ID),
    {
      deploymentId: PREDECESSOR_DEPLOYMENT_ID,
      requireAliases: false,
      sourceCommit: PREDECESSOR_SOURCE_COMMIT,
    },
  );
  const health = await fetch(`${PRODUCTION_ORIGIN}/api/health`, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const healthBody = await boundedJson(health);
  if (health.status !== 200 || healthBody.ok !== true) {
    throw new Error("transition smoke production health failed");
  }
  const homepage = await fetch(PRODUCTION_ORIGIN, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const homepageBody = await boundedText(homepage, MAX_PAGE_BYTES);
  if (homepage.status !== 200 || !homepageBody.includes(`dpl=${DEPLOYMENT_ID}`)) {
    throw new Error("transition smoke canonical alias drifted");
  }
  return Object.freeze({ current, health: true, predecessor });
}

function absorbClerkResponseCookies(response, jar) {
  const values = response.headers.getSetCookie?.() ?? [];
  if (values.length < 1 || values.length > 16) {
    throw new Error("Clerk Frontend API cookie response drifted");
  }
  for (const value of values) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    const name = pair.slice(0, separator);
    const content = pair.slice(separator + 1);
    if (
      separator <= 0
      || !/^[A-Za-z0-9_]+$/.test(name)
      || !content
      || content.length > 8_192
    ) {
      throw new Error("Clerk Frontend API returned an invalid cookie shape");
    }
    jar.set(name, content);
  }
}

function clerkCookieHeader(jar) {
  const value = [...jar].map(([name, content]) => `${name}=${content}`).join("; ");
  if (!value || value.length > 24_000) {
    throw new Error("Clerk Frontend API cookie jar exceeded its reviewed bound");
  }
  return value;
}

async function selectCanary(clerk) {
  const users = await clerk.users.getUserList({
    externalId: [NOTIFICATION_CANARY_EXTERNAL_ID],
    limit: 2,
  });
  if (users.totalCount !== 1 || users.data.length !== 1) {
    throw new Error("expected exactly one retained operational canary");
  }
  const user = users.data[0];
  if (
    user.externalId !== NOTIFICATION_CANARY_EXTERNAL_ID
    || user.banned
    || user.locked
    || user.publicMetadata?.grainlineOperationalCanary
      !== "notification-rls-route-and-production-canary"
  ) {
    throw new Error("operational canary identity drifted");
  }
  return user;
}

async function activeSessions(clerk, userId) {
  const result = await clerk.sessions.getSessionList({ limit: 10, status: "active", userId });
  if (result.totalCount !== result.data.length || result.data.length > 1) {
    throw new Error("operational canary active-session inventory drifted");
  }
  return result.data;
}

async function revokeSessions(clerk, userId) {
  const sessions = await activeSessions(clerk, userId);
  for (const session of sessions) {
    const revoked = await clerk.sessions.revokeSession(session.id);
    if (revoked?.id !== session.id || revoked.status !== "revoked") {
      throw new Error("operational canary session revocation failed");
    }
  }
  const after = await activeSessions(clerk, userId);
  if (after.length !== 0) throw new Error("operational canary session remained active");
  return sessions.length;
}

function reviewLimiter(redis) {
  return new Ratelimit({
    analytics: false,
    limiter: Ratelimit.slidingWindow(5, "60 s"),
    prefix: "rl:review",
    redis,
  });
}

async function cleanupTransientState({ clerk, redis, state, userId }) {
  const revokedSessions = await revokeSessions(clerk, userId);
  let unconsumedSignInTokenRevoked = state?.signInTokenId === null;
  if (state?.signInTokenId && state.sessionId === null && revokedSessions === 0) {
    const revoked = await clerk.signInTokens.revokeSignInToken(state.signInTokenId);
    if (revoked?.id !== state.signInTokenId || revoked.status !== "revoked") {
      throw new Error("operational canary sign-in token revocation failed");
    }
    unconsumedSignInTokenRevoked = true;
  } else if (state?.sessionId || revokedSessions === 1) {
    unconsumedSignInTokenRevoked = true;
  }
  await reviewLimiter(redis).resetUsedTokens(userId);
  await redis.del(`account-state:vercel-production:clerk:${userId}`);
  return Object.freeze({
    accountStateCacheDeleted: true,
    rateLimitTokensReset: true,
    revokedSessions,
    unconsumedSignInTokenRevoked,
  });
}

async function createSession(clerk, frontendApi, userId, state) {
  const ticket = await clerk.signInTokens.createSignInToken({
    expiresInSeconds: 60,
    userId,
  });
  if (
    !/^sit_[A-Za-z0-9]+$/.test(String(ticket?.id ?? ""))
    || ticket.userId !== userId
    || typeof ticket.token !== "string"
    || ticket.token.length < 32
    || ticket.token.length > 4_096
  ) {
    throw new Error("Clerk did not create the expected bounded sign-in token");
  }
  state.signInTokenId = ticket.id;
  state.stage = "sign-in-token-created";
  replacePrivateJson(STATE_PATH, state);

  const jar = new Map();
  const clientResponse = await fetch(`https://${frontendApi}/v1/client`, {
    body: "",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: PRODUCTION_ORIGIN,
    },
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  absorbClerkResponseCookies(clientResponse, jar);
  const clientPayload = await boundedJson(clientResponse);
  const client = clientPayload.response ?? clientPayload;
  if (clientResponse.status !== 200 || client.object !== "client") {
    throw new Error("Clerk Frontend API client handshake failed");
  }

  const exchangeResponse = await fetch(`https://${frontendApi}/v1/client/sign_ins`, {
    body: new URLSearchParams({ strategy: "ticket", ticket: ticket.token }),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: clerkCookieHeader(jar),
      origin: PRODUCTION_ORIGIN,
    },
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  absorbClerkResponseCookies(exchangeResponse, jar);
  const exchangePayload = await boundedJson(exchangeResponse);
  const attempt = exchangePayload.response ?? exchangePayload;
  const sessionId = /^sess_[A-Za-z0-9]+$/.test(String(attempt.created_session_id ?? ""))
    ? attempt.created_session_id
    : null;
  if (
    exchangeResponse.status !== 200
    || attempt.object !== "sign_in_attempt"
    || attempt.status !== "complete"
    || !sessionId
  ) {
    throw new Error("Clerk Frontend API did not complete the one-use ticket exchange");
  }
  state.sessionId = sessionId;
  state.stage = "session-created";
  replacePrivateJson(STATE_PATH, state);

  const session = await clerk.sessions.getSession(sessionId);
  if (session.userId !== userId || session.status !== "active") {
    throw new Error("Clerk ticket exchange did not create the expected active session");
  }
  const token = await clerk.sessions.getToken(sessionId, undefined, 300);
  if (typeof token?.jwt !== "string" || token.jwt.split(".").length !== 3) {
    throw new Error("Clerk did not return a bounded session token");
  }
  return token.jwt;
}

async function routeJson(pathname, { body, method = "GET", token } = {}) {
  const response = await fetch(`${PRODUCTION_ORIGIN}${pathname}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(method === "GET" ? {} : { origin: PRODUCTION_ORIGIN }),
    },
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(60_000),
  });
  return Object.freeze({ body: await boundedJson(response), status: response.status });
}

export function sanitizedEvidence({ cleanup, config, deployment, result }) {
  return Object.freeze({
    version: 1,
    status: "passed",
    generatedAt: new Date().toISOString(),
    operator: {
      commit: config.operatorCommit,
      mainCiRunId: config.mainCiRunId,
    },
    application: {
      commit: DEPLOYED_SOURCE_COMMIT,
      mainCiRunId: DEPLOYED_SOURCE_CI_RUN_ID,
      deploymentId: DEPLOYMENT_ID,
      ready: deployment.current.ready,
      aliasesVerified: REQUIRED_ALIASES.length,
      healthPassed: deployment.health,
    },
    predecessor: {
      commit: PREDECESSOR_SOURCE_COMMIT,
      deploymentId: PREDECESSOR_DEPLOYMENT_ID,
      preservedReady: deployment.predecessor.ready,
    },
    prerequisites: {
      transitionAuthorityEvidenceSha256: TRANSITION_AUTHORITY_EVIDENCE_SHA256,
      transitionMigrationRunId: TRANSITION_MIGRATION_RUN_ID,
    },
    result: {
      accountPageStatus: result.accountPageStatus,
      authenticatedReviewDenialStatus: result.authenticatedReviewDenialStatus,
      authoritativeEligibilityReached: result.authoritativeEligibilityReached,
      databaseFixturesCreated: 0,
      paymentOrProviderObjectsCreated: 0,
      reviewsCreated: 0,
      unauthenticatedReviewStatus: result.unauthenticatedReviewStatus,
    },
    cleanup: {
      accountStateCacheDeleted: cleanup.accountStateCacheDeleted,
      clerkSessionsRevoked: cleanup.revokedSessions >= 1,
      rateLimitTokensReset: cleanup.rateLimitTokensReset,
      unconsumedSignInTokenRevoked: cleanup.unconsumedSignInTokenRevoked,
    },
    boundaries: {
      authorityAndConcurrencyProofIsSeparate: true,
      migrationsRun: false,
      predecessorDrained: false,
      productionDatabaseMutated: false,
      providerConfigurationChanged: false,
      rlsChanged: false,
      retainedRateLimitAnalyticsEvent: true,
      transitionRoutesDirectlyExercised: false,
    },
  });
}

export async function runTransitionSmoke(env = process.env, dependencies = {}) {
  const config = { ...validateConfiguration(env), cwd: process.cwd() };
  assertGitState(readGitState(config.cwd), config.operatorCommit);
  parseGitHubCiRun(
    readGitHubCiRun(config.mainCiRunId),
    config.operatorCommit,
    config.mainCiRunId,
  );
  parseGitHubCiRun(
    readGitHubCiRun(DEPLOYED_SOURCE_CI_RUN_ID),
    DEPLOYED_SOURCE_COMMIT,
    DEPLOYED_SOURCE_CI_RUN_ID,
  );
  verifyTransitionAuthorityEvidence();
  const deployment = await (dependencies.verifyDeployment ?? verifyDeployment)(config);
  const credentials = validateLocalCredentials(loadLocalEnvironment());
  const clerk = createClerkClient({ secretKey: credentials.clerkSecret });
  const redis = new Redis({ url: credentials.redisUrl, token: credentials.redisToken });
  const canary = await selectCanary(clerk);

  if (existsSync(STATE_PATH)) {
    const priorState = validateRestartState(
      readPrivateJson(STATE_PATH, "transition smoke restart state"),
      config,
    );
    await cleanupTransientState({ clerk, redis, state: priorState, userId: canary.id });
    unlinkSync(STATE_PATH);
  } else {
    const existing = await activeSessions(clerk, canary.id);
    if (existing.length !== 0) {
      throw new Error("operational canary had a pre-existing active Clerk session");
    }
  }

  const state = {
    version: 1,
    stage: "prepared",
    operatorCommit: config.operatorCommit,
    mainCiRunId: config.mainCiRunId,
    deployedSourceCommit: DEPLOYED_SOURCE_COMMIT,
    deploymentId: DEPLOYMENT_ID,
    signInTokenId: null,
    sessionId: null,
    listingNonceSha256: sha256(randomUUID()),
    startedAt: new Date().toISOString(),
  };
  writePrivateJson(STATE_PATH, state);

  let cleanup;
  let primaryFailure;
  let result;
  try {
    state.stage = "reset-review-limit";
    replacePrivateJson(STATE_PATH, state);
    await reviewLimiter(redis).resetUsedTokens(canary.id);

    const token = await createSession(clerk, credentials.clerkFrontendApi, canary.id, state);
    state.stage = "unauthenticated-review-denial";
    replacePrivateJson(STATE_PATH, state);
    const unauthenticated = await routeJson("/api/reviews", {
      body: { listingId: randomUUID(), ratingX2: 10 },
      method: "POST",
    });
    if (unauthenticated.status !== 401 || unauthenticated.body.error !== "Unauthorized") {
      throw new Error("unauthenticated review route did not deny access");
    }

    state.stage = "authenticated-account-page";
    replacePrivateJson(STATE_PATH, state);
    const account = await fetch(`${PRODUCTION_ORIGIN}/account`, {
      cache: "no-store",
      headers: { authorization: `Bearer ${token}` },
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
    const accountBody = await boundedText(account, MAX_PAGE_BYTES);
    if (account.status !== 200 || !accountBody.includes("My Account")) {
      throw new Error("authenticated account page did not render");
    }

    state.stage = "authoritative-review-eligibility";
    replacePrivateJson(STATE_PATH, state);
    const listingId = randomUUID();
    const review = await routeJson("/api/reviews", {
      body: { listingId, ratingX2: 10 },
      method: "POST",
      token,
    });
    if (
      review.status !== 403
      || review.body.error !== "You can leave a review after your order has been delivered."
    ) {
      throw new Error("authoritative review eligibility returned an unexpected result");
    }
    result = {
      accountPageStatus: account.status,
      authenticatedReviewDenialStatus: review.status,
      authoritativeEligibilityReached: true,
      unauthenticatedReviewStatus: unauthenticated.status,
    };
    state.stage = "route-proof-passed";
    replacePrivateJson(STATE_PATH, state);
  } catch (error) {
    primaryFailure = error;
    state.stage = `failed-${state.stage}`;
    try {
      replacePrivateJson(STATE_PATH, state);
    } catch {
      // Retain the last successfully written restart state.
    }
  } finally {
    try {
      cleanup = await cleanupTransientState({ clerk, redis, state, userId: canary.id });
    } catch (error) {
      if (!primaryFailure) primaryFailure = error;
    }
  }

  if (primaryFailure) throw primaryFailure;
  assert.ok(result);
  assert.ok(cleanup);
  if (cleanup.revokedSessions !== 1) {
    throw new Error("transition smoke did not revoke exactly its one Clerk session");
  }
  unlinkSync(STATE_PATH);
  const evidence = sanitizedEvidence({ cleanup, config, deployment, result });
  writePrivateJson(config.evidencePath, evidence);
  return evidence;
}
