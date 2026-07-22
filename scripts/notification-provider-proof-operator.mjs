#!/usr/bin/env node
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { parseGuardedNeonDatabaseIdentity } from "./guard-saved-search-rls-deploy.mjs";

const { Client } = pg;

export const PROVIDER_PROOF_BRANCH = "codex/rls-notification-route-smoke-20260722";
export const REVIEWED_GITHUB_REPOSITORY = "Drewyoung910/grainline";
export const REVIEWED_VERCEL_PROJECT_ID = "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp";
export const REVIEWED_VERCEL_TEAM_ID = "team_wvQeQHZGwCSwinC1uB7xbpjr";
export const REVIEWED_VERCEL_PROJECT_NAME = "grainline";
export const REVIEWED_PRODUCTION_DEPLOYMENT_ID = "dpl_6Y6C3NT81zbhLc6eHJAveCH1Ave8";
export const REVIEWED_NEON_PROJECT_ID = "icy-unit-96812898";
export const REVIEWED_NEON_ORG_ID = "org-raspy-frost-18952075";
export const REVIEWED_PRODUCTION_BRANCH_ID = "br-hidden-mouse-aaugn2wr";
export const REVIEWED_STAGING_BRANCH_ID = "br-sparkling-unit-aa90szxd";
export const REVIEWED_STAGING_BRANCH_NAME = "notification-route-smoke-3-20260722";
export const REVIEWED_STAGING_ENDPOINT_ID = "ep-empty-breeze-aans7eqe";
export const REVIEWED_DATABASE_NAME = "neondb";
export const REVIEWED_DATABASE_REGION = "westus3.azure";
export const REVIEWED_NEON_REGION_ID = "azure-westus3";
export const REVIEWED_OWNER_ROLE = "neondb_owner";
export const REVIEWED_RUNTIME_ROLE = "grainline_app_runtime";
export const REVIEWED_EXECUTION_REGION = "sfo1";
export const REVIEWED_NOTIFICATION_MIGRATIONS = Object.freeze({
  activation: Object.freeze({
    path: "prisma/migrations/20260722052000_enable_notification_rls/migration.sql",
    sha256: "e40994886a143101141c7114ed8ea2f92917ccdd349fe96a0874a2cb79561329",
  }),
  preparation: Object.freeze({
    path: "prisma/migrations/20260722051500_prepare_notification_rls/migration.sql",
    sha256: "83f49cec2589c359cda5413282a492f68b26cca760f54861cd29a9a3bfb579f9",
  }),
});
export const PROVIDER_PROOF_STATE_PATH =
  "/private/tmp/grainline-notification-route-smoke-3-state-20260722.json";
export const PROVIDER_BYPASS_STATE_PATH =
  "/private/tmp/grainline-notification-route-smoke-3-bypass-20260722.json";
export const EVIDENCE_DIRECTORY = "/Users/drewyoung/grainline-rollout-evidence";

const REVIEWED_NEON_CLI_PATH =
  "/Users/drewyoung/.npm/_npx/74274893b9fe65d3/node_modules/neonctl/dist/cli.js";
const REVIEWED_NEON_CLI_VERSION = "2.35.1";
const REVIEWED_PRISMA_CLI_VERSION = "7.9.0";
const REVIEWED_TSX_VERSION = "4.21.0";
const REVIEWED_TSX_CLI_PATH =
  "/Users/drewyoung/.npm/_npx/69f9afb961c37556/node_modules/tsx/dist/cli.mjs";
const REVIEWED_NEON_CREDENTIAL_PATH =
  "/Users/drewyoung/.config/neonctl/credentials.json";
const VERCEL_AUTH_PATH =
  "/Users/drewyoung/Library/Application Support/com.vercel.cli/auth.json";
const GATE_SCRIPT_PATH = path.resolve("scripts/rls-context-acceptance-gate.mjs");
const LOCAL_PREFLIGHT_SCRIPT_PATH = path.resolve(
  "scripts/notification-provider-local-preflight.ts",
);
const MAX_API_BYTES = 2 * 1024 * 1024;
const MAX_PROVIDER_RESPONSE_BYTES = 512 * 1024;
const CLEANUP_CONFIRMATION = "delete-disposable-preview-and-staging";
const ABORT_CONFIRMATION = "delete-failed-disposable-preview-and-staging";
const ROUTE_SMOKE_CLEANUP_CONFIRMATION = "delete-auth-route-smoke-preview-and-staging";

export const PROVIDER_ENVIRONMENT_VALUES = Object.freeze({
  RLS_CONTEXT_GATE_CONFIRM: "staging-only",
  RLS_CONTEXT_GATE_LOCALITY_CONFIRM: "production-runtime",
  RLS_CONTEXT_GATE_EXPECTED_EXECUTION_REGION: REVIEWED_EXECUTION_REGION,
  RLS_CONTEXT_GATE_EXPECTED_DATABASE_REGION: REVIEWED_DATABASE_REGION,
  RLS_CONTEXT_GATE_EXPECTED_DATABASE_ENDPOINT_ID: REVIEWED_STAGING_ENDPOINT_ID,
  RLS_CONTEXT_GATE_EXPECTED_DATABASE_NAME: REVIEWED_DATABASE_NAME,
  RLS_CONTEXT_GATE_RUNTIME_ROLE: REVIEWED_RUNTIME_ROLE,
  RLS_CONTEXT_GATE_REQUESTS: "500",
  RLS_CONTEXT_GATE_WARMUP_REQUESTS: "50",
  RLS_CONTEXT_GATE_TURNOVER_REQUESTS: "64",
  RLS_CONTEXT_GATE_TARGET_CONCURRENCY: "8",
  RLS_CONTEXT_GATE_BURST_CONCURRENCY: "16",
  RLS_CONTEXT_GATE_POOL_SIZE: "16",
  RLS_CONTEXT_GATE_CONNECTION_TIMEOUT_MS: "10000",
  RLS_CONTEXT_GATE_STATEMENT_TIMEOUT_MS: "30000",
  RLS_CONTEXT_GATE_QUERY_TIMEOUT_MS: "35000",
  RLS_CONTEXT_GATE_TX_TIMEOUT_MS: "5000",
  RLS_CONTEXT_GATE_SCHEMA: "grainline_rls_canary",
  RLS_CONTEXT_GATE_TABLE: "context_canary",
  NOTIFICATION_RLS_PROVIDER_REQUESTS: "120",
  NOTIFICATION_RLS_PROVIDER_WARMUP_REQUESTS: "12",
  NOTIFICATION_RLS_PROVIDER_TARGET_CONCURRENCY: "8",
  NOTIFICATION_RLS_PROVIDER_BURST_CONCURRENCY: "16",
});

export const PROVIDER_ENVIRONMENT_KEYS = Object.freeze([
  "DATABASE_URL",
  "RLS_CONTEXT_GATE_DATABASE_URL",
  "RLS_CONTEXT_GATE_TRIGGER_SECRET",
  "RLS_CONTEXT_GATE_RUN_ID",
  "RLS_CONTEXT_GATE_ALLOWED_COMMIT_SHA",
  ...Object.keys(PROVIDER_ENVIRONMENT_VALUES),
]);

export const FORBIDDEN_PROVIDER_ENVIRONMENT_KEYS = Object.freeze([
  "DIRECT_URL",
  "RLS_CONTEXT_GATE_ADMIN_DATABASE_URL",
  "RLS_CONTEXT_GATE_EVIDENCE_PATH",
  "RLS_CONTEXT_GATE_PREPARE",
  "RLS_CONTEXT_GATE_ROLLBACK_PROBE",
  "RLS_CONTEXT_GATE_TEARDOWN_RPC_PROBE",
  "RLS_CONTEXT_GATE_ALLOW_NON_POOLER",
  "RLS_CONTEXT_GATE_ALLOW_CUSTOM_USER_IDS",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "PGOPTIONS",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function cleanEnvironment(env = process.env) {
  const child = { ...env, CI: "1", NO_COLOR: "1" };
  for (const [key, value] of Object.entries(child)) {
    if (
      key === "DATABASE_URL"
      || key === "DIRECT_URL"
      || key === "VERCEL_AUTOMATION_BYPASS_SECRET"
      || key === "RLS_CONTEXT_GATE_TRIGGER_SECRET"
      || /^PG[A-Z0-9_]*$/.test(key)
      || /(?:^|_)(?:DIRECT_URL|DATABASE_URL|DB_ADMIN_URL)$/.test(key)
      || (typeof value === "string" && /^postgres(?:ql)?:\/\//i.test(value.trim()))
    ) {
      delete child[key];
    }
  }
  return child;
}

function assertPrivateRegularFile(filePath, label) {
  const file = lstatSync(filePath);
  if (!file.isFile() || file.isSymbolicLink() || (file.mode & 0o077) !== 0) {
    throw new Error(`${label} must be a private regular file`);
  }
  return file;
}

function assertPrivateEvidenceDirectory() {
  const directory = lstatSync(EVIDENCE_DIRECTORY);
  if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) !== 0) {
    throw new Error("rollout evidence directory must be a private real directory");
  }
}

function writePrivateJson(filePath, payload) {
  if (existsSync(filePath)) throw new Error(`refusing to overwrite ${filePath}`);
  const fd = openSync(filePath, "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8" });
  } finally {
    closeSync(fd);
  }
  chmodSync(filePath, 0o600);
  assertPrivateRegularFile(filePath, path.basename(filePath));
}

function replacePrivateState(payload) {
  const nextPath = `${PROVIDER_PROOF_STATE_PATH}.next`;
  if (existsSync(nextPath)) throw new Error("stale provider proof state update exists");
  writePrivateJson(nextPath, payload);
  renameSync(nextPath, PROVIDER_PROOF_STATE_PATH);
  chmodSync(PROVIDER_PROOF_STATE_PATH, 0o600);
}

function readPrivateJson(filePath, label) {
  assertPrivateRegularFile(filePath, label);
  const payload = JSON.parse(readFileSync(filePath, "utf8"));
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`${label} did not contain an object`);
  }
  return payload;
}

function readProviderState() {
  const state = readPrivateJson(PROVIDER_PROOF_STATE_PATH, "provider proof state");
  if (
    state.branch !== PROVIDER_PROOF_BRANCH
    || state.projectId !== REVIEWED_VERCEL_PROJECT_ID
    || state.teamId !== REVIEWED_VERCEL_TEAM_ID
    || state.neonBranchId !== REVIEWED_STAGING_BRANCH_ID
    || state.neonEndpointId !== REVIEWED_STAGING_ENDPOINT_ID
    || !/^[a-f0-9]{40}$/.test(state.commitSha)
    || !/^[A-Za-z0-9._:-]{32,128}$/.test(state.runId)
    || !/^[A-Za-z0-9_-]{32,256}$/.test(state.triggerSecret)
  ) {
    throw new Error("provider proof state does not match the reviewed target");
  }
  validateDatabaseUrl(state.runtimeDatabaseUrl, { pooled: true, role: REVIEWED_RUNTIME_ROLE });
  validateDatabaseUrl(state.adminDatabaseUrl, { pooled: false, role: REVIEWED_OWNER_ROLE });
  return state;
}

function readBypassState() {
  const state = readPrivateJson(PROVIDER_BYPASS_STATE_PATH, "provider bypass state");
  if (
    state.projectId !== REVIEWED_VERCEL_PROJECT_ID
    || state.teamId !== REVIEWED_VERCEL_TEAM_ID
    || !/^[A-Za-z0-9_-]{24,256}$/.test(state.bypassSecret)
    || !/^[a-f0-9]{64}$/.test(state.bypassSecretSha256)
    || sha256(state.bypassSecret) !== state.bypassSecretSha256
    || ![
      "existing-sole-active-automation-bypass",
      "generated-sole-active-automation-bypass",
    ].includes(state.source)
  ) {
    throw new Error("provider bypass state does not match the reviewed project");
  }
  return state;
}

function reviewedCliPackage(cliPath, expectedName, expectedVersion) {
  const packagePath = path.resolve(path.dirname(cliPath), "..", "package.json");
  const metadata = JSON.parse(readFileSync(packagePath, "utf8"));
  if (metadata.name !== expectedName || metadata.version !== expectedVersion) {
    throw new Error(`${expectedName} CLI package does not match the reviewed version`);
  }
}

function assertReviewedNeonCli() {
  reviewedCliPackage(REVIEWED_NEON_CLI_PATH, "neonctl", REVIEWED_NEON_CLI_VERSION);
  assertPrivateRegularFile(REVIEWED_NEON_CREDENTIAL_PATH, "Neon credential file");
}

function runNeonApi(pathname, method = "GET") {
  assertReviewedNeonCli();
  const result = spawnSync(
    process.execPath,
    [
      REVIEWED_NEON_CLI_PATH,
      "api",
      pathname,
      "--method",
      method,
      "--output",
      "json",
      "--no-color",
      "--no-analytics",
    ],
    {
      encoding: "utf8",
      env: cleanEnvironment(),
      maxBuffer: MAX_API_BYTES,
      timeout: 60_000,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(`reviewed Neon ${method} request failed`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("reviewed Neon response was not valid JSON");
  }
}

function readVercelAuthToken() {
  const auth = readPrivateJson(VERCEL_AUTH_PATH, "Vercel auth file");
  if (typeof auth.token !== "string" || auth.token.length < 20 || auth.token.length > 1024) {
    throw new Error("Vercel auth token does not have the reviewed shape");
  }
  return auth.token;
}

async function boundedJsonResponse(response, limit = MAX_API_BYTES) {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > limit) {
    throw new Error("provider response exceeded the reviewed size bound");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("provider response was not valid JSON");
  }
}

async function vercelApi(pathname, { body, expectedStatuses = [200], method = "GET", query = {} } = {}) {
  const target = new URL(`https://api.vercel.com${pathname}`);
  target.searchParams.set("teamId", REVIEWED_VERCEL_TEAM_ID);
  for (const [key, value] of Object.entries(query)) target.searchParams.set(key, String(value));
  const response = await fetch(target, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${readVercelAuthToken()}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    method,
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await boundedJsonResponse(response);
  if (!expectedStatuses.includes(response.status)) {
    throw new Error(`Vercel ${method} request failed with HTTP ${response.status}`);
  }
  return { payload, status: response.status };
}

export function validateDatabaseUrl(value, { pooled, role }) {
  if (typeof value !== "string" || value !== value.trim()) {
    throw new Error("database URL must be a non-empty exact string");
  }
  const parsed = new URL(value);
  const identity = parseGuardedNeonDatabaseIdentity(value, "provider proof database URL");
  const expectedHost = `${REVIEWED_STAGING_ENDPOINT_ID}${pooled ? "-pooler" : ""}.${REVIEWED_DATABASE_REGION}.neon.tech`;
  if (
    parsed.hostname !== expectedHost
    || parsed.port !== "5432"
    || parsed.pathname !== `/${REVIEWED_DATABASE_NAME}`
    || parsed.username !== role
    || !parsed.password
    || identity.endpointId !== REVIEWED_STAGING_ENDPOINT_ID
    || identity.databaseName !== REVIEWED_DATABASE_NAME
    || identity.region !== REVIEWED_DATABASE_REGION
    || identity.username !== role
    || identity.isPooler !== pooled
    || identity.port !== "5432"
    || parsed.searchParams.size !== 2
    || parsed.searchParams.get("sslmode") !== "verify-full"
    || parsed.searchParams.get("channel_binding") !== "require"
  ) {
    throw new Error("database URL does not match the reviewed staging identity");
  }
  return value;
}

export function buildStagingDatabaseUrl(role, password, { pooled }) {
  if (
    ![REVIEWED_OWNER_ROLE, REVIEWED_RUNTIME_ROLE].includes(role)
    || typeof password !== "string"
    || !/^[A-Za-z0-9_-]{16,128}$/.test(password)
  ) {
    throw new Error("Neon role or password did not have the reviewed shape");
  }
  const host = `${REVIEWED_STAGING_ENDPOINT_ID}${pooled ? "-pooler" : ""}.${REVIEWED_DATABASE_REGION}.neon.tech`;
  const target = new URL(
    `postgresql://${role}:placeholder@${host}:5432/${REVIEWED_DATABASE_NAME}`
      + "?sslmode=verify-full&channel_binding=require",
  );
  target.password = password;
  return validateDatabaseUrl(target.toString(), { pooled, role });
}

function providerFixtures() {
  return [1, 2].map((runSlot) => {
    const suffix = `slot-${runSlot}`;
    const prefix = "notification-provider-real";
    return Object.freeze({
      actorUserId: `${prefix}-actor-${suffix}`,
      conversationId: `${prefix}-conversation-${suffix}`,
      deletedNotificationIds: Object.freeze([
        `${prefix}-foreign-${suffix}`,
        `${prefix}-low-stock-${suffix}`,
        `${prefix}-message-${suffix}`,
        `${prefix}-order-${suffix}`,
        `${prefix}-read-${suffix}`,
      ]),
      followId: `${prefix}-follow-${suffix}`,
      foreignNotificationId: `${prefix}-foreign-${suffix}`,
      lowStockId: `${prefix}-low-stock-${suffix}`,
      lowStockLink: `/listing/${prefix}-listing-${suffix}`,
      messageId: `${prefix}-message-${suffix}`,
      orderId: `${prefix}-order-${suffix}`,
      readId: `${prefix}-read-${suffix}`,
      runSlot,
      sellerProfileId: `${prefix}-seller-profile-${suffix}`,
      sellerUserId: `${prefix}-seller-${suffix}`,
    });
  });
}

function assertReviewedMigrationBytes() {
  for (const migration of Object.values(REVIEWED_NOTIFICATION_MIGRATIONS)) {
    if (!existsSync(migration.path) || sha256(readFileSync(migration.path)) !== migration.sha256) {
      throw new Error("Notification provider migration bytes drifted from disposable proof");
    }
  }
}

function stageReviewedCandidateMigrations() {
  if (Object.values(REVIEWED_NOTIFICATION_MIGRATIONS).some((migration) => existsSync(migration.path))) {
    throw new Error("stale Notification provider migration candidate exists before staging");
  }
  const common = {
    encoding: "utf8",
    env: {
      ...cleanEnvironment(),
      DIRECT_URL: "postgresql://ci:ci@127.0.0.1:5432/grainline_ci",
      NOTIFICATION_RLS_DISPOSABLE_MIGRATION_ACK:
        "I_ACKNOWLEDGE_DISPOSABLE_LOOPBACK_NOTIFICATION_MIGRATION",
    },
    maxBuffer: 2 * 1024 * 1024,
    timeout: 30_000,
  };
  for (const mode of ["--stage-preparation", "--stage-activation"]) {
    const result = spawnSync(
      process.execPath,
      [path.resolve("scripts/stage-notification-rls-candidate-migration.mjs"), mode],
      common,
    );
    if (result.error || result.status !== 0) {
      throw new Error("reviewed Notification provider migration staging failed");
    }
  }
  assertReviewedMigrationBytes();
}

function removeStagedCandidateMigrations() {
  for (const migration of Object.values(REVIEWED_NOTIFICATION_MIGRATIONS).reverse()) {
    if (existsSync(migration.path)) unlinkSync(migration.path);
    const directory = path.dirname(migration.path);
    if (existsSync(directory)) rmdirSync(directory);
  }
}

function reviewedPrismaArgs() {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  if (
    packageJson.devDependencies?.prisma !== `^${REVIEWED_PRISMA_CLI_VERSION}`
    || packageLock.packages?.[""]?.devDependencies?.prisma
      !== `^${REVIEWED_PRISMA_CLI_VERSION}`
    || packageLock.packages?.["node_modules/prisma"]?.version
      !== REVIEWED_PRISMA_CLI_VERSION
  ) {
    throw new Error("locked Prisma CLI version drifted from the reviewed provider input");
  }
  const prismaArgs = [
    "exec",
    "--yes",
    `--package=prisma@${REVIEWED_PRISMA_CLI_VERSION}`,
    "--",
    "prisma",
  ];
  const version = spawnSync("npm", [...prismaArgs, "--version"], {
    encoding: "utf8",
    env: cleanEnvironment(),
    maxBuffer: 2 * 1024 * 1024,
    timeout: 2 * 60_000,
  });
  const expectedVersion = REVIEWED_PRISMA_CLI_VERSION.replaceAll(".", "\\.");
  if (
    version.error
    || version.status !== 0
    || !new RegExp(`prisma\\s*:\\s*${expectedVersion}(?:\\s|$)`).test(version.stdout)
  ) {
    throw new Error("exact reviewed Prisma CLI was unavailable");
  }
  return prismaArgs;
}

function runReviewedPrismaMigrationDeploy(adminDatabaseUrl) {
  assertReviewedMigrationBytes();
  const prismaArgs = reviewedPrismaArgs();
  const result = spawnSync(
    "npm",
    [...prismaArgs, "migrate", "deploy"],
    {
      encoding: "utf8",
      env: {
        ...cleanEnvironment(),
        DATABASE_URL: adminDatabaseUrl,
        DIRECT_URL: adminDatabaseUrl,
      },
      maxBuffer: 4 * 1024 * 1024,
      timeout: 10 * 60_000,
    },
  );
  if (result.error || result.status !== 0) {
    const detail = sanitizedProviderDiagnostic(
      `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
      { adminDatabaseUrl, runtimeDatabaseUrl: adminDatabaseUrl },
    ).replace(/\s+/g, " ").trim().slice(-2_000);
    throw new Error(
      `reviewed Prisma provider migration deploy failed${detail ? `: ${detail}` : ""}`,
    );
  }
}

function sanitizedProviderDiagnostic(value, state) {
  let result = String(value ?? "");
  for (const sensitive of [
    state.adminDatabaseUrl,
    state.runtimeDatabaseUrl,
    new URL(state.adminDatabaseUrl).password,
    new URL(state.runtimeDatabaseUrl).password,
  ]) {
    if (sensitive) result = result.split(sensitive).join("[REDACTED]");
  }
  return result
    .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, "[REDACTED_DATABASE_URL]")
    .slice(-16_000);
}

function prismaStatusDiagnostic() {
  const state = readProviderState();
  stageReviewedCandidateMigrations();
  try {
    const result = spawnSync(
      "npm",
      [...reviewedPrismaArgs(), "migrate", "status"],
      {
        encoding: "utf8",
        env: {
          ...cleanEnvironment(),
          DATABASE_URL: state.adminDatabaseUrl,
          DIRECT_URL: state.adminDatabaseUrl,
        },
        maxBuffer: 4 * 1024 * 1024,
        timeout: 2 * 60_000,
      },
    );
    console.log(JSON.stringify({
      exitStatus: result.status,
      output: sanitizedProviderDiagnostic(
        `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
        state,
      ),
      subprocessError: Boolean(result.error),
    }, null, 2));
  } finally {
    removeStagedCandidateMigrations();
  }
}

function runReviewedRuntimeGrantAudit(adminDatabaseUrl) {
  const result = spawnSync(
    process.execPath,
    [path.resolve("scripts/audit-runtime-db-grants.mjs")],
    {
      encoding: "utf8",
      env: {
        ...cleanEnvironment(),
        GRANT_AUDIT_DATABASE_URL: adminDatabaseUrl,
        MIGRATION_DB_ROLE: REVIEWED_OWNER_ROLE,
        RUNTIME_DB_ROLE: REVIEWED_RUNTIME_ROLE,
      },
      maxBuffer: 4 * 1024 * 1024,
      timeout: 2 * 60_000,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error("reviewed Notification provider grant audit failed");
  }
}

async function seedNotificationProviderFixtures(adminDatabaseUrl) {
  const owner = new Client({
    application_name: "notification-provider-owner-setup",
    connectionString: adminDatabaseUrl,
  });
  await owner.connect();
  try {
    await owner.query("BEGIN");
    for (const fixture of providerFixtures()) {
      await owner.query(
        `INSERT INTO public."User" (id, "clerkId", email, name, "updatedAt") VALUES
           ($1, $2, $3, $4, pg_catalog.clock_timestamp()),
           ($5, $6, $7, $8, pg_catalog.clock_timestamp())`,
        [
          fixture.sellerUserId,
          `clerk_${fixture.sellerUserId}`,
          `${fixture.sellerUserId}@example.invalid`,
          `Provider Seller ${fixture.runSlot}`,
          fixture.actorUserId,
          `clerk_${fixture.actorUserId}`,
          `${fixture.actorUserId}@example.invalid`,
          `Provider Actor ${fixture.runSlot}`,
        ],
      );
      await owner.query(
        `INSERT INTO public."SellerProfile" (
           id, "userId", "displayName", "displayNameNormalized", "chargesEnabled", "updatedAt"
         ) VALUES ($1, $2, $3, $4, true, pg_catalog.clock_timestamp())`,
        [
          fixture.sellerProfileId,
          fixture.sellerUserId,
          `Provider Seller ${fixture.runSlot}`,
          `provider seller ${fixture.runSlot}`,
        ],
      );
      await owner.query(
        `INSERT INTO public."Follow" (id, "followerId", "sellerProfileId")
         VALUES ($1, $2, $3)`,
        [fixture.followId, fixture.actorUserId, fixture.sellerProfileId],
      );
      await owner.query(
        `INSERT INTO public."Notification" (
           id, "userId", type, title, body, link, "sourceType", "sourceId",
           "dedupKey", "relatedUserId", read, "createdAt"
         ) VALUES
           ($1::text, $6::text, 'NEW_MESSAGE', 'Provider message', 'Provider message body', $8::text,
            'message', $1::text, $11::text, $7::text, false, pg_catalog.clock_timestamp() - interval '4 minutes'),
           ($2::text, $6::text, 'LOW_STOCK', 'Provider low stock', 'Provider low stock body', $9::text,
            'manual_low_stock', $2::text, $12::text, $7::text, false, pg_catalog.clock_timestamp() - interval '3 minutes'),
           ($3::text, $6::text, 'NEW_ORDER', 'Provider order', 'Provider order body', $10::text,
            'order', $3::text, $13::text, $7::text, false, pg_catalog.clock_timestamp() - interval '2 minutes'),
           ($4::text, $6::text, 'NEW_FAVORITE', 'Provider read', 'Provider read body', $9::text,
            'favorite', $4::text, $14::text, $7::text, true, pg_catalog.clock_timestamp() - interval '1 minute'),
           ($5::text, $7::text, 'ACCOUNT_WARNING', 'Provider foreign', 'Provider foreign body', NULL,
            'account_warning', $5::text, $15::text, $6::text, false, pg_catalog.clock_timestamp() - interval '5 minutes')`,
        [
          fixture.messageId,
          fixture.lowStockId,
          fixture.orderId,
          fixture.readId,
          fixture.foreignNotificationId,
          fixture.sellerUserId,
          fixture.actorUserId,
          `/messages/${fixture.conversationId}`,
          fixture.lowStockLink,
          `/dashboard/orders/${fixture.orderId}`,
          `${fixture.messageId}-dedup`,
          `${fixture.lowStockId}-dedup`,
          `${fixture.orderId}-dedup`,
          `${fixture.readId}-dedup`,
          `${fixture.foreignNotificationId}-dedup`,
        ],
      );
    }
    const catalog = await owner.query(
      `SELECT
         class.relrowsecurity,
         class.relforcerowsecurity,
         (SELECT pg_catalog.count(*)::integer
            FROM pg_catalog.pg_policy AS policy
           WHERE policy.polrelid = class.oid) AS policy_count
        FROM pg_catalog.pg_class AS class
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
       WHERE namespace.nspname = 'public' AND class.relname = 'Notification'`,
    );
    const fixtureCount = await owner.query(
      `SELECT pg_catalog.count(*)::integer AS count
         FROM public."Notification"
        WHERE "userId" = ANY($1::text[])`,
      [providerFixtures().flatMap((fixture) => [fixture.sellerUserId, fixture.actorUserId])],
    );
    if (
      catalog.rows.length !== 1
      || catalog.rows[0].relrowsecurity !== true
      || catalog.rows[0].relforcerowsecurity !== false
      || catalog.rows[0].policy_count !== 2
      || fixtureCount.rows[0].count !== 10
    ) {
      throw new Error("Notification provider database did not reach the reviewed active fixture state");
    }
    await owner.query("COMMIT");
  } catch (error) {
    await owner.query("ROLLBACK");
    throw error;
  } finally {
    await owner.end();
  }
}

async function teardownNotificationProviderFixtures(adminDatabaseUrl) {
  const owner = new Client({
    application_name: "notification-provider-owner-teardown",
    connectionString: adminDatabaseUrl,
  });
  await owner.connect();
  try {
    await owner.query("BEGIN");
    for (const fixture of [...providerFixtures()].reverse()) {
      await owner.query(
        `DELETE FROM public."Notification"
          WHERE id = ANY($1::text[])
             OR (
               "sourceType" = 'follow'
               AND "sourceId" = $2
               AND "userId" = $3
               AND "relatedUserId" = $4
             )`,
        [
          fixture.deletedNotificationIds,
          fixture.sellerProfileId,
          fixture.sellerUserId,
          fixture.actorUserId,
        ],
      );
      await owner.query('DELETE FROM public."Follow" WHERE id = $1', [fixture.followId]);
      await owner.query('DELETE FROM public."SellerProfile" WHERE id = $1', [
        fixture.sellerProfileId,
      ]);
      await owner.query(
        `DELETE FROM public."User" WHERE id = ANY($1::text[])`,
        [[fixture.sellerUserId, fixture.actorUserId]],
      );
    }
    const residue = await owner.query(
      `SELECT
         (SELECT pg_catalog.count(*)::integer FROM public."User"
           WHERE id = ANY($1::text[])) AS users,
         (SELECT pg_catalog.count(*)::integer FROM public."Notification"
           WHERE "userId" = ANY($1::text[])
              OR "relatedUserId" = ANY($1::text[])) AS notifications`,
      [providerFixtures().flatMap((fixture) => [fixture.sellerUserId, fixture.actorUserId])],
    );
    if (residue.rows[0].users !== 0 || residue.rows[0].notifications !== 0) {
      throw new Error("Notification provider fixtures remained after owner teardown");
    }
    await owner.query("COMMIT");
  } catch (error) {
    await owner.query("ROLLBACK");
    throw error;
  } finally {
    await owner.end();
  }
}

async function verifyNeonStagingTarget() {
  if (REVIEWED_STAGING_BRANCH_ID === REVIEWED_PRODUCTION_BRANCH_ID) {
    throw new Error("staging and production Neon branch ids must differ");
  }
  const project = runNeonApi(`/projects/${REVIEWED_NEON_PROJECT_ID}`)?.project;
  const branch = runNeonApi(
    `/projects/${REVIEWED_NEON_PROJECT_ID}/branches/${REVIEWED_STAGING_BRANCH_ID}`,
  )?.branch;
  const endpoints = runNeonApi(`/projects/${REVIEWED_NEON_PROJECT_ID}/endpoints`)?.endpoints;
  const roles = runNeonApi(
    `/projects/${REVIEWED_NEON_PROJECT_ID}/branches/${REVIEWED_STAGING_BRANCH_ID}/roles`,
  )?.roles;
  const databases = runNeonApi(
    `/projects/${REVIEWED_NEON_PROJECT_ID}/branches/${REVIEWED_STAGING_BRANCH_ID}/databases`,
  )?.databases;
  const endpoint = Array.isArray(endpoints)
    ? endpoints.find((candidate) => candidate?.id === REVIEWED_STAGING_ENDPOINT_ID)
    : null;
  const roleNames = Array.isArray(roles) ? roles.map((role) => role?.name).sort() : [];
  const database = Array.isArray(databases)
    ? databases.find((candidate) => candidate?.name === REVIEWED_DATABASE_NAME)
    : null;
  if (
    project?.id !== REVIEWED_NEON_PROJECT_ID
    || project.org_id !== REVIEWED_NEON_ORG_ID
    || project.region_id !== REVIEWED_NEON_REGION_ID
    || branch?.id !== REVIEWED_STAGING_BRANCH_ID
    || branch.name !== REVIEWED_STAGING_BRANCH_NAME
    || branch.parent_id !== REVIEWED_PRODUCTION_BRANCH_ID
    || branch.primary !== false
    || branch.default !== false
    || branch.current_state !== "ready"
    || endpoint?.branch_id !== REVIEWED_STAGING_BRANCH_ID
    || endpoint.region_id !== REVIEWED_NEON_REGION_ID
    || endpoint.type !== "read_write"
    || endpoint.disabled !== false
    || !["idle", "active"].includes(endpoint.current_state)
    || JSON.stringify(roleNames) !== JSON.stringify([REVIEWED_RUNTIME_ROLE, REVIEWED_OWNER_ROLE].sort())
    || roles.some((role) => role?.branch_id !== REVIEWED_STAGING_BRANCH_ID || role?.authentication_method !== "password")
    || database?.branch_id !== REVIEWED_STAGING_BRANCH_ID
    || database.owner_name !== REVIEWED_OWNER_ROLE
  ) {
    throw new Error("Neon staging target metadata drifted from the reviewed non-production identity");
  }
  return { branch, endpoint };
}

function revealNeonRolePassword(role) {
  const password = runNeonApi(
    `/projects/${REVIEWED_NEON_PROJECT_ID}`
      + `/branches/${REVIEWED_STAGING_BRANCH_ID}`
      + `/roles/${role}/reveal_password`,
  )?.password;
  if (typeof password !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(password)) {
    throw new Error("Neon role reveal did not return a bounded password");
  }
  return password;
}

function gitResult(args) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    env: cleanEnvironment(),
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
  });
  if (result.error || result.status !== 0) throw new Error("Git proof precondition failed");
  return result.stdout.trim();
}

function assertExactCleanCommit(expectedCommitSha) {
  const branch = gitResult(["branch", "--show-current"]);
  const commitSha = gitResult(["rev-parse", "HEAD"]);
  const status = gitResult(["status", "--porcelain"]);
  if (
    branch !== PROVIDER_PROOF_BRANCH
    || status !== ""
    || !/^[a-f0-9]{40}$/.test(commitSha)
    || (expectedCommitSha && commitSha !== expectedCommitSha)
  ) {
    throw new Error("provider proof must run from the exact clean disposable branch commit");
  }
  return commitSha;
}

function gateEnvironment(state, mode) {
  const environment = {
    ...cleanEnvironment(),
    ...PROVIDER_ENVIRONMENT_VALUES,
    RLS_CONTEXT_GATE_DATABASE_URL: state.runtimeDatabaseUrl,
    RLS_CONTEXT_GATE_LOCALITY_CONFIRM: "diagnostic-only",
  };
  if (mode === "prepare") {
    environment.RLS_CONTEXT_GATE_PREPARE = "1";
    environment.RLS_CONTEXT_GATE_ADMIN_DATABASE_URL = state.adminDatabaseUrl;
    environment.RLS_CONTEXT_GATE_EVIDENCE_PATH = state.setupEvidencePath;
  } else if (mode === "teardown") {
    environment.RLS_CONTEXT_GATE_TEARDOWN_RPC_PROBE = "1";
    environment.RLS_CONTEXT_GATE_ADMIN_DATABASE_URL = state.adminDatabaseUrl;
    environment.RLS_CONTEXT_GATE_EVIDENCE_PATH = state.teardownEvidencePath;
  } else {
    throw new Error("unknown owner-only gate mode");
  }
  return environment;
}

function runOwnerOnlyGate(state, mode) {
  const result = spawnSync(process.execPath, [GATE_SCRIPT_PATH], {
    encoding: "utf8",
    env: gateEnvironment(state, mode),
    maxBuffer: 4 * 1024 * 1024,
    timeout: 10 * 60_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`owner-only provider ${mode} gate failed`);
  }
  const evidencePath = mode === "prepare" ? state.setupEvidencePath : state.teardownEvidencePath;
  const evidence = readPrivateJson(evidencePath, `${mode} evidence`);
  if (
    evidence.run?.status !== "setup_passed"
    || evidence.result?.issueCount !== 0
    || evidence.locality?.acceptanceEligible !== false
    || evidence.database?.expectedDatabaseEndpointId !== REVIEWED_STAGING_ENDPOINT_ID
    || evidence.database?.expectedDatabaseName !== REVIEWED_DATABASE_NAME
    || evidence.database?.runtimeRole !== REVIEWED_RUNTIME_ROLE
    || evidence.config?.[mode === "prepare" ? "prepare" : "teardownRpcProbe"] !== true
  ) {
    throw new Error(`owner-only provider ${mode} evidence did not pass validation`);
  }
  return evidence;
}

async function branchEnvironmentInventory() {
  const { payload } = await vercelApi(
    `/v10/projects/${REVIEWED_VERCEL_PROJECT_ID}/env`,
    {
      query: { gitBranch: PROVIDER_PROOF_BRANCH, target: "preview" },
    },
  );
  if (!Array.isArray(payload.envs)) throw new Error("Vercel environment inventory shape drifted");
  return payload.envs;
}

export function providerEnvironmentEntries(state) {
  const values = {
    DATABASE_URL: state.runtimeDatabaseUrl,
    RLS_CONTEXT_GATE_DATABASE_URL: state.runtimeDatabaseUrl,
    RLS_CONTEXT_GATE_TRIGGER_SECRET: state.triggerSecret,
    RLS_CONTEXT_GATE_RUN_ID: state.runId,
    RLS_CONTEXT_GATE_ALLOWED_COMMIT_SHA: state.commitSha,
    ...PROVIDER_ENVIRONMENT_VALUES,
  };
  const entries = Object.entries(values).map(([key, value]) => ({
    comment: "Disposable Notification provider proof; remove after counted slots",
    gitBranch: PROVIDER_PROOF_BRANCH,
    key,
    target: ["preview"],
    type: "sensitive",
    value,
  }));
  if (
    entries.length !== PROVIDER_ENVIRONMENT_KEYS.length
    || JSON.stringify(entries.map((entry) => entry.key)) !== JSON.stringify(PROVIDER_ENVIRONMENT_KEYS)
    || entries.some((entry) => FORBIDDEN_PROVIDER_ENVIRONMENT_KEYS.includes(entry.key))
  ) {
    throw new Error("provider environment manifest drifted from the reviewed exact-variable shape");
  }
  return entries;
}

export function parseLastJsonObject(stdout) {
  const lines = String(stdout).split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) throw new Error("preflight output was empty");
  const parsed = JSON.parse(lines.at(-1));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("preflight final output line was not a JSON object");
  }
  return { lineCount: lines.length, payload: parsed };
}

function assertExactEnvironmentInventory(inventory) {
  const expected = [...PROVIDER_ENVIRONMENT_KEYS].sort();
  const actual = inventory.map((entry) => entry?.key).sort();
  if (
    inventory.length !== PROVIDER_ENVIRONMENT_KEYS.length
    || JSON.stringify(actual) !== JSON.stringify(expected)
    || inventory.some((entry) => (
      !/^[A-Za-z0-9_-]{8,128}$/.test(entry?.id)
      || entry.gitBranch !== PROVIDER_PROOF_BRANCH
      || entry.type !== "sensitive"
      || !Array.isArray(entry.target)
      || entry.target.length !== 1
      || entry.target[0] !== "preview"
      || FORBIDDEN_PROVIDER_ENVIRONMENT_KEYS.includes(entry.key)
    ))
  ) {
    throw new Error("Vercel branch environment inventory did not match the exact reviewed manifest");
  }
  return inventory;
}

async function configureProviderEnvironment(state) {
  const before = await branchEnvironmentInventory();
  if (before.length !== 0) {
    throw new Error("disposable provider branch already has environment variables");
  }
  const entries = providerEnvironmentEntries(state);
  const { payload } = await vercelApi(
    `/v10/projects/${REVIEWED_VERCEL_PROJECT_ID}/env`,
    {
      body: entries,
      expectedStatuses: [201],
      method: "POST",
    },
  );
  if (Array.isArray(payload.failed) && payload.failed.length > 0) {
    throw new Error("one or more Vercel branch variables failed to create");
  }
  const inventory = assertExactEnvironmentInventory(await branchEnvironmentInventory());
  return inventory.map((entry) => entry.id).sort();
}

async function listDeployments() {
  const { payload } = await vercelApi("/v6/deployments", {
    query: { limit: 100, projectId: REVIEWED_VERCEL_PROJECT_ID },
  });
  if (!Array.isArray(payload.deployments)) throw new Error("Vercel deployment list shape drifted");
  return payload.deployments;
}

async function readDeployment(deploymentId, expectedStatuses = [200]) {
  return vercelApi(`/v13/deployments/${deploymentId}`, { expectedStatuses });
}

function validateProviderDeploymentIdentity(deployment, state) {
  if (
    deployment?.id !== state.deploymentId
    || deployment.id === REVIEWED_PRODUCTION_DEPLOYMENT_ID
    || deployment.projectId !== REVIEWED_VERCEL_PROJECT_ID
    || deployment.project?.id !== REVIEWED_VERCEL_PROJECT_ID
    || deployment.name !== REVIEWED_VERCEL_PROJECT_NAME
    || deployment.source !== "git"
    || deployment.target !== null
    || deployment.gitSource?.type !== "github"
    || deployment.gitSource.sha !== state.commitSha
    || deployment.gitSource.ref !== PROVIDER_PROOF_BRANCH
    || deployment.meta?.githubCommitSha !== state.commitSha
    || deployment.meta?.githubCommitRef !== PROVIDER_PROOF_BRANCH
    || deployment.meta?.githubCommitOrg !== "Drewyoung910"
    || deployment.meta?.githubCommitRepo !== "grainline"
    || deployment.meta?.githubDeployment !== "1"
    || !Array.isArray(deployment.regions)
    || deployment.regions.length !== 1
    || deployment.regions[0] !== REVIEWED_EXECUTION_REGION
    || deployment.originCacheRegion !== REVIEWED_EXECUTION_REGION
    || deployment.createdIn !== REVIEWED_EXECUTION_REGION
    || deployment.projectSettings?.nodeVersion !== "22.x"
    || typeof deployment.url !== "string"
    || !deployment.url.endsWith(".vercel.app")
  ) {
    throw new Error("Vercel provider deployment did not match the exact Git-integrated Preview identity");
  }
  return deployment;
}

function validateProviderDeployment(deployment, state) {
  validateProviderDeploymentIdentity(deployment, state);
  if (deployment.readyState !== "READY") {
    throw new Error("Vercel provider deployment was not ready");
  }
  return deployment;
}

async function assertProductionDeploymentUnchanged() {
  const { payload } = await readDeployment(REVIEWED_PRODUCTION_DEPLOYMENT_ID);
  if (
    payload?.id !== REVIEWED_PRODUCTION_DEPLOYMENT_ID
    || payload.projectId !== REVIEWED_VERCEL_PROJECT_ID
    || payload.readyState !== "READY"
    || payload.target !== "production"
  ) {
    throw new Error("reviewed production deployment identity or readiness changed");
  }
  return {
    deploymentId: payload.id,
    readyState: payload.readyState,
    target: payload.target,
  };
}

function automationBypassSecrets(project) {
  const protectionBypass = project?.protectionBypass ?? {};
  if (
    typeof protectionBypass !== "object"
    || protectionBypass === null
    || Array.isArray(protectionBypass)
  ) {
    throw new Error("Vercel protection-bypass inventory shape drifted");
  }
  return Object.entries(protectionBypass)
    .filter(([, metadata]) => metadata?.scope === "automation-bypass")
    .map(([secret]) => secret)
    .sort();
}

async function currentAutomationBypassSecrets() {
  const { payload } = await vercelApi(`/v9/projects/${REVIEWED_VERCEL_PROJECT_ID}`);
  return automationBypassSecrets(payload);
}

async function bootstrapBypassState() {
  if (existsSync(PROVIDER_BYPASS_STATE_PATH)) {
    throw new Error("provider bypass state already exists");
  }
  const secrets = await currentAutomationBypassSecrets();
  if (secrets.length !== 1) {
    throw new Error("provider proof requires exactly one existing automation bypass secret");
  }
  const bypassSecret = secrets[0];
  if (!/^[A-Za-z0-9_-]{24,256}$/.test(bypassSecret)) {
    throw new Error("existing automation bypass secret did not have the reviewed shape");
  }
  writePrivateJson(PROVIDER_BYPASS_STATE_PATH, {
    bootstrapAt: new Date().toISOString(),
    bypassSecret,
    bypassSecretSha256: sha256(bypassSecret),
    projectId: REVIEWED_VERCEL_PROJECT_ID,
    source: "existing-sole-active-automation-bypass",
    teamId: REVIEWED_VERCEL_TEAM_ID,
  });
  console.log(JSON.stringify({ bypassStateReady: true, activeAutomationSecretCount: 1 }));
}

async function createBypassState() {
  if (existsSync(PROVIDER_BYPASS_STATE_PATH) || existsSync(PROVIDER_PROOF_STATE_PATH)) {
    throw new Error("provider proof or bypass state already exists");
  }
  if ((await currentAutomationBypassSecrets()).length !== 0) {
    throw new Error("provider proof requires zero automation bypass secrets before generation");
  }
  await vercelApi(
    `/v1/projects/${REVIEWED_VERCEL_PROJECT_ID}/protection-bypass`,
    { body: { generate: {} }, method: "PATCH" },
  );
  const secrets = await currentAutomationBypassSecrets();
  if (secrets.length !== 1 || !/^[A-Za-z0-9_-]{24,256}$/.test(secrets[0])) {
    throw new Error("generated automation bypass inventory did not have the reviewed shape");
  }
  const bypassSecret = secrets[0];
  writePrivateJson(PROVIDER_BYPASS_STATE_PATH, {
    bootstrapAt: new Date().toISOString(),
    bypassSecret,
    bypassSecretSha256: sha256(bypassSecret),
    projectId: REVIEWED_VERCEL_PROJECT_ID,
    source: "generated-sole-active-automation-bypass",
    teamId: REVIEWED_VERCEL_TEAM_ID,
  });
  console.log(JSON.stringify({ bypassStateReady: true, activeAutomationSecretCount: 1 }));
}

async function currentBypassIsActive(bypassState) {
  const active = await currentAutomationBypassSecrets();
  if (active.length !== 1 || active[0] !== bypassState.bypassSecret) {
    throw new Error("rotated Vercel automation bypass is no longer the sole active value");
  }
}

async function revokeProviderBypass(bypassState) {
  const active = await currentAutomationBypassSecrets();
  if (active.length === 0) return true;
  if (active.length !== 1 || active[0] !== bypassState.bypassSecret) {
    throw new Error("automation bypass inventory drifted before proof cleanup");
  }
  await vercelApi(
    `/v1/projects/${REVIEWED_VERCEL_PROJECT_ID}/protection-bypass`,
    {
      body: { revoke: { regenerate: false, secret: bypassState.bypassSecret } },
      method: "PATCH",
    },
  );
  if ((await currentAutomationBypassSecrets()).length !== 0) {
    throw new Error("automation bypass remained after proof cleanup revocation");
  }
  return true;
}

async function revokeBypassStateOnly() {
  if (existsSync(PROVIDER_PROOF_STATE_PATH)) {
    throw new Error("provider proof state exists; use full cleanup or cleanup-abort");
  }
  const bypassState = readBypassState();
  await revokeProviderBypass(bypassState);
  unlinkSync(PROVIDER_BYPASS_STATE_PATH);
  console.log(JSON.stringify({ bypassRevoked: true, activeAutomationSecretCount: 0 }));
}

function evidencePath(kind, commitSha, slot) {
  const suffix = slot ? `-slot-${slot}` : "";
  return path.join(
    EVIDENCE_DIRECTORY,
    `notification-route-smoke-support-${kind}${suffix}-${commitSha.slice(0, 12)}.json`,
  );
}

function assertNoSensitiveEvidence(payload, state, bypassState) {
  const serialized = JSON.stringify(payload);
  for (const value of [
    state.runtimeDatabaseUrl,
    state.adminDatabaseUrl,
    state.triggerSecret,
    state.runId,
    bypassState?.bypassSecret,
  ]) {
    if (value && serialized.includes(value)) {
      throw new Error("sanitized provider evidence retained a temporary secret");
    }
  }
  if (/postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/i.test(serialized)) {
    throw new Error("sanitized provider evidence retained database credentials");
  }
}

function validateProviderEvidence(payload, state, runSlot) {
  if (
    payload.proofMode !== "provider-runtime-real-notification-candidate"
    || payload.status !== "passed"
    || payload.run?.status !== "runtime_candidate_passed"
    || payload.run.commitSha !== state.commitSha
    || payload.run.deploymentId !== state.deploymentId
    || payload.result?.issueCount !== 0
    || payload.locality?.runtimeEvidenceCandidate !== true
    || payload.locality?.acceptanceEligible !== false
    || payload.locality?.providerRuntimeMetadataPresent !== true
    || payload.locality?.observedExecutionRegion !== REVIEWED_EXECUTION_REGION
    || payload.locality?.observedDatabaseRegion !== REVIEWED_DATABASE_REGION
    || payload.database?.expectedDatabaseEndpointId !== REVIEWED_STAGING_ENDPOINT_ID
    || payload.database?.expectedDatabaseName !== REVIEWED_DATABASE_NAME
    || payload.database?.runtimeRole !== REVIEWED_RUNTIME_ROLE
    || payload.database?.databaseHost !== `${REVIEWED_STAGING_ENDPOINT_ID}-pooler.${REVIEWED_DATABASE_REGION}.neon.tech`
    || payload.config?.measuredRequests !== 120
    || payload.config?.targetConcurrency !== 8
    || payload.config?.burstConcurrency !== 16
    || payload.config?.prismaPoolSize !== 10
    || payload.result?.runSlot !== runSlot
    || payload.result?.correctness?.bellRows !== 4
    || payload.result?.correctness?.foreignRows !== 1
    || payload.result?.correctness?.statementLocalContextReset !== true
    || payload.result?.correctness?.serviceReplayStable !== true
    || payload.runner?.runSlot !== runSlot
    || !/^v24\./.test(payload.runner?.nodeVersion)
    || payload.runner?.runIdSha256 !== sha256(state.runId)
  ) {
    throw new Error(`provider slot ${runSlot} did not produce passing counted evidence`);
  }
  return payload;
}

async function invokeProviderSlot(state, bypassState, runSlot) {
  await currentBypassIsActive(bypassState);
  const response = await fetch(
    `https://${state.deploymentUrl}/api/internal/rls-context-gate`,
    {
      body: JSON.stringify({ runSlot, token: state.triggerSecret }),
      headers: {
        "Content-Type": "application/json",
        "x-vercel-protection-bypass": bypassState.bypassSecret,
      },
      method: "POST",
      signal: AbortSignal.timeout(340_000),
    },
  );
  const payload = await boundedJsonResponse(response, MAX_PROVIDER_RESPONSE_BYTES);
  const outputPath = evidencePath("response", state.commitSha, runSlot);
  assertNoSensitiveEvidence(payload, state, bypassState);
  writePrivateJson(outputPath, {
    capturedAt: new Date().toISOString(),
    httpStatus: response.status,
    response: payload,
  });
  if (response.status !== 200) {
    throw new Error(`provider slot ${runSlot} returned HTTP ${response.status}; the slot must not be replayed`);
  }
  validateProviderEvidence(payload, state, runSlot);
  return outputPath;
}

async function prepare() {
  if (existsSync(PROVIDER_PROOF_STATE_PATH)) {
    throw new Error("provider proof state already exists; inspect or clean it before preparing again");
  }
  assertPrivateEvidenceDirectory();
  readBypassState();
  const commitSha = assertExactCleanCommit();
  if ((await branchEnvironmentInventory()).length !== 0) {
    throw new Error("provider branch environment is not empty before preparation");
  }
  const matchingDeployments = (await listDeployments()).filter(
    (deployment) => deployment.meta?.githubCommitRef === PROVIDER_PROOF_BRANCH
      || deployment.meta?.githubCommitSha === commitSha,
  );
  if (matchingDeployments.length !== 0) {
    throw new Error("provider branch or commit already has a Vercel deployment before attestation setup");
  }
  await verifyNeonStagingTarget();
  const runtimeDatabaseUrl = buildStagingDatabaseUrl(
    REVIEWED_RUNTIME_ROLE,
    revealNeonRolePassword(REVIEWED_RUNTIME_ROLE),
    { pooled: true },
  );
  const adminDatabaseUrl = buildStagingDatabaseUrl(
    REVIEWED_OWNER_ROLE,
    revealNeonRolePassword(REVIEWED_OWNER_ROLE),
    { pooled: false },
  );
  const runId = `notification-b-${randomUUID()}`;
  const triggerSecret = randomBytes(48).toString("base64url");
  const setupEvidencePath = evidencePath("setup", commitSha);
  if (existsSync(setupEvidencePath)) throw new Error("setup evidence path already exists");
  const state = {
    adminDatabaseUrl,
    branch: PROVIDER_PROOF_BRANCH,
    commitSha,
    createdAt: new Date().toISOString(),
    neonBranchId: REVIEWED_STAGING_BRANCH_ID,
    neonEndpointId: REVIEWED_STAGING_ENDPOINT_ID,
    projectId: REVIEWED_VERCEL_PROJECT_ID,
    runId,
    runtimeDatabaseUrl,
    setupEvidencePath,
    teamId: REVIEWED_VERCEL_TEAM_ID,
    triggerSecret,
  };
  writePrivateJson(PROVIDER_PROOF_STATE_PATH, state);
  stageReviewedCandidateMigrations();
  try {
    runReviewedPrismaMigrationDeploy(adminDatabaseUrl);
    runReviewedRuntimeGrantAudit(adminDatabaseUrl);
  } finally {
    removeStagedCandidateMigrations();
  }
  await seedNotificationProviderFixtures(adminDatabaseUrl);
  runOwnerOnlyGate(state, "prepare");
  replacePrivateState({
    ...state,
    databasePreparedAt: new Date().toISOString(),
    setupCompletedAt: new Date().toISOString(),
  });
  console.log(JSON.stringify({ commitSha, prepared: true, setupEvidenceMode: "0600" }));
}

async function configure() {
  const state = readProviderState();
  assertExactCleanCommit(state.commitSha);
  if (!state.setupCompletedAt || !state.localPreflightAt || state.configuredAt) {
    throw new Error("provider state is not ready for one-time environment configuration");
  }
  const environmentIds = await configureProviderEnvironment(state);
  replacePrivateState({
    ...state,
    configuredAt: new Date().toISOString(),
    environmentIds,
  });
  console.log(JSON.stringify({ commitSha: state.commitSha, configuredVariables: environmentIds.length }));
}

async function localPreflight() {
  let state = readProviderState();
  const bypassState = readBypassState();
  assertExactCleanCommit(state.commitSha);
  if (
    !state.setupCompletedAt
    || state.configuredAt
    || state.localPreflightAt
    || state.deploymentId
    || state.slot1EvidencePath
    || state.slot2EvidencePath
  ) {
    throw new Error("provider state is not eligible for local preflight");
  }
  const firstOutputPath = evidencePath("local-preflight", state.commitSha);
  const retryOutputPath = evidencePath("local-preflight-2", state.commitSha);
  if (
    state.priorLocalPreflightCommitSha
    && !existsSync(evidencePath("local-preflight", state.priorLocalPreflightCommitSha))
  ) {
    throw new Error("prior failed local preflight evidence is missing before retry");
  }
  const outputPath = state.priorLocalPreflightCommitSha || existsSync(firstOutputPath)
    ? retryOutputPath
    : firstOutputPath;
  if (existsSync(outputPath)) {
    throw new Error("both bounded local preflight evidence attempts already exist");
  }
  reviewedCliPackage(REVIEWED_TSX_CLI_PATH, "tsx", REVIEWED_TSX_VERSION);
  const result = spawnSync(process.execPath, [
    REVIEWED_TSX_CLI_PATH,
    LOCAL_PREFLIGHT_SCRIPT_PATH,
  ], {
    encoding: "utf8",
    env: {
      ...cleanEnvironment(),
      DATABASE_URL: state.runtimeDatabaseUrl,
      NODE_ENV: "production",
    },
    maxBuffer: 2 * 1024 * 1024,
    timeout: 5 * 60_000,
  });
  let outputLineCount = 0;
  let payload;
  try {
    const parsed = parseLastJsonObject(result.stdout);
    outputLineCount = parsed.lineCount;
    payload = parsed.payload;
  } catch {
    payload = { error: { message: "preflight output was not valid JSON" }, status: "failed" };
  }
  assertNoSensitiveEvidence(payload, state, bypassState);
  writePrivateJson(outputPath, {
    capturedAt: new Date().toISOString(),
    exitStatus: result.status,
    outputLineCount,
    result: payload,
  });
  await teardownNotificationProviderFixtures(state.adminDatabaseUrl);
  await seedNotificationProviderFixtures(state.adminDatabaseUrl);
  if (
    result.error
    || result.status !== 0
    || payload?.status !== "passed"
    || payload?.metricErrorCount !== 0
    || !Array.isArray(payload?.nonPerformanceIssues)
    || payload.nonPerformanceIssues.length !== 0
  ) {
    throw new Error("local Notification provider preflight failed after fixture reset");
  }
  state = {
    ...state,
    localPreflightAt: new Date().toISOString(),
    localPreflightEvidencePath: outputPath,
  };
  replacePrivateState(state);
  console.log(JSON.stringify({ localPreflightPassed: true, fixturesReset: true }));
}

async function rebindConfiguredCommit() {
  const state = readProviderState();
  const commitSha = assertExactCleanCommit();
  if (
    !state.setupCompletedAt
    || !state.configuredAt
    || state.attestedAt
    || state.deploymentId
    || state.slot1EvidencePath
    || state.slot2EvidencePath
    || state.commitSha === commitSha
  ) {
    throw new Error("provider state is not eligible for configured commit rebinding");
  }
  const inventory = assertExactEnvironmentInventory(await branchEnvironmentInventory());
  const ids = inventory.map((entry) => entry.id).sort();
  if (JSON.stringify(ids) !== JSON.stringify([...state.environmentIds].sort())) {
    throw new Error("branch environment IDs drifted before configured commit rebinding");
  }
  const deployments = (await listDeployments()).filter(
    (deployment) => deployment.meta?.githubCommitRef === PROVIDER_PROOF_BRANCH,
  );
  if (deployments.length !== 0) {
    throw new Error("provider deployment exists before configured commit rebinding");
  }
  const allowedSha = inventory.find(
    (entry) => entry.key === "RLS_CONTEXT_GATE_ALLOWED_COMMIT_SHA",
  );
  if (!allowedSha) throw new Error("allowed commit environment record is missing");
  await vercelApi(
    `/v10/projects/${REVIEWED_VERCEL_PROJECT_ID}/env/${allowedSha.id}`,
    {
      body: {
        gitBranch: PROVIDER_PROOF_BRANCH,
        target: ["preview"],
        type: "sensitive",
        value: commitSha,
      },
      method: "PATCH",
    },
  );
  assertExactEnvironmentInventory(await branchEnvironmentInventory());
  replacePrivateState({
    ...state,
    commitSha,
    configuredCommitReboundAt: new Date().toISOString(),
    preparedCommitSha: state.preparedCommitSha ?? state.commitSha,
    priorDeploymentCommitSha: state.commitSha,
  });
  console.log(JSON.stringify({
    commitRebound: true,
    deploymentCommitSha: commitSha,
    priorDeploymentCommitSha: state.commitSha,
  }));
}

async function rebindPredeploymentCommit() {
  const state = readProviderState();
  const commitSha = assertExactCleanCommit();
  if (
    !state.setupCompletedAt
    || !state.localPreflightAt
    || state.configuredAt
    || state.deploymentId
    || state.slot1EvidencePath
    || state.slot2EvidencePath
    || state.preparedCommitSha
    || state.commitSha === commitSha
  ) {
    throw new Error("provider state is not eligible for one-time predeployment commit rebinding");
  }
  readPrivateJson(state.setupEvidencePath, "provider setup evidence");
  if ((await branchEnvironmentInventory()).length !== 0) {
    throw new Error("provider branch environment must remain empty before commit rebinding");
  }
  const deployments = (await listDeployments()).filter(
    (deployment) => deployment.meta?.githubCommitRef === PROVIDER_PROOF_BRANCH,
  );
  if (deployments.length !== 0) {
    throw new Error("provider deployment exists before commit rebinding");
  }
  replacePrivateState({
    ...state,
    commitSha,
    preparedCommitSha: state.commitSha,
    reboundAt: new Date().toISOString(),
  });
  console.log(JSON.stringify({
    commitRebound: true,
    deploymentCommitSha: commitSha,
    preparedCommitSha: state.commitSha,
  }));
}

async function rebindLocalPreflightRetryCommit() {
  const state = readProviderState();
  const bypassState = readBypassState();
  const commitSha = assertExactCleanCommit();
  const firstOutputPath = evidencePath("local-preflight", state.commitSha);
  const retryOutputPath = evidencePath("local-preflight-2", commitSha);
  if (
    !state.setupCompletedAt
    || state.localPreflightAt
    || state.configuredAt
    || state.deploymentId
    || state.slot1EvidencePath
    || state.slot2EvidencePath
    || state.commitSha === commitSha
    || !existsSync(firstOutputPath)
    || existsSync(retryOutputPath)
  ) {
    throw new Error("provider state is not eligible for one bounded local-preflight retry rebind");
  }
  const firstEvidence = readPrivateJson(firstOutputPath, "first local preflight evidence");
  if (firstEvidence.exitStatus === 0 || firstEvidence.result?.status !== "failed") {
    throw new Error("first local preflight evidence is not a failed attempt");
  }
  if ((await branchEnvironmentInventory()).length !== 0) {
    throw new Error("provider branch environment must remain empty before local-preflight retry");
  }
  const deployments = (await listDeployments()).filter(
    (deployment) => deployment.meta?.githubCommitRef === PROVIDER_PROOF_BRANCH,
  );
  if (deployments.length !== 0) {
    throw new Error("provider deployment exists before local-preflight retry");
  }
  await currentBypassIsActive(bypassState);
  await verifyNeonStagingTarget();
  stageReviewedCandidateMigrations();
  try {
    runReviewedRuntimeGrantAudit(state.adminDatabaseUrl);
  } finally {
    removeStagedCandidateMigrations();
  }
  await teardownNotificationProviderFixtures(state.adminDatabaseUrl);
  await seedNotificationProviderFixtures(state.adminDatabaseUrl);
  const rebindEvidencePath = evidencePath("local-preflight-rebind", commitSha);
  if (existsSync(rebindEvidencePath)) {
    throw new Error("local-preflight retry rebind evidence already exists");
  }
  writePrivateJson(rebindEvidencePath, {
    capturedAt: new Date().toISOString(),
    databaseTarget: {
      branchId: REVIEWED_STAGING_BRANCH_ID,
      endpointId: REVIEWED_STAGING_ENDPOINT_ID,
    },
    fixturesReset: true,
    newCommitSha: commitSha,
    priorCommitSha: state.commitSha,
  });
  replacePrivateState({
    ...state,
    commitSha,
    localPreflightRetryRebindAt: new Date().toISOString(),
    localPreflightRetryRebindEvidencePath: rebindEvidencePath,
    priorLocalPreflightCommitSha: state.commitSha,
  });
  console.log(JSON.stringify({
    commitRebound: true,
    fixturesReset: true,
    localPreflightRetry: 2,
  }));
}

async function attest() {
  let state = readProviderState();
  assertExactCleanCommit(state.commitSha);
  if (!state.configuredAt || state.attestedAt) {
    throw new Error("provider state is not ready for one-time deployment attestation");
  }
  let candidate;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const deployments = await listDeployments();
    const matches = deployments.filter(
      (deployment) => deployment.meta?.githubCommitRef === PROVIDER_PROOF_BRANCH
        && deployment.meta?.githubCommitSha === state.commitSha,
    );
    if (matches.length > 1) throw new Error("more than one deployment exists for the attested provider commit");
    if (matches.length === 1) {
      candidate = matches[0];
      if (candidate.uid === REVIEWED_PRODUCTION_DEPLOYMENT_ID) {
        throw new Error("provider deployment unexpectedly matched production");
      }
      if (state.deploymentId && state.deploymentId !== candidate.uid) {
        throw new Error("provider deployment identity changed while awaiting readiness");
      }
      if (!state.deploymentId) {
        state = {
          ...state,
          deploymentId: candidate.uid,
          deploymentUrl: candidate.url,
          deploymentObservedAt: new Date().toISOString(),
        };
        replacePrivateState(state);
      }
      if (["ERROR", "CANCELED"].includes(candidate.readyState ?? candidate.state)) {
        throw new Error("Git-integrated provider Preview failed before readiness");
      }
      if ((candidate.readyState ?? candidate.state) === "READY") break;
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  if (!candidate || (candidate.readyState ?? candidate.state) !== "READY") {
    throw new Error("Git-integrated provider Preview did not become ready in ten minutes");
  }
  const { payload: deployment } = await readDeployment(state.deploymentId);
  validateProviderDeployment(deployment, state);
  const environment = assertExactEnvironmentInventory(await branchEnvironmentInventory());
  const production = await assertProductionDeploymentUnchanged();
  const bypassState = readBypassState();
  await currentBypassIsActive(bypassState);
  const packageNodeEngine = JSON.parse(readFileSync("package.json", "utf8")).engines?.node;
  if (packageNodeEngine !== ">=22") {
    throw new Error("provider proof package Node engine drifted from the reviewed build input");
  }
  const attestation = {
    generatedAt: new Date().toISOString(),
    scope: "real-notification-provider-candidate",
    project: {
      id: REVIEWED_VERCEL_PROJECT_ID,
      name: REVIEWED_VERCEL_PROJECT_NAME,
      teamId: REVIEWED_VERCEL_TEAM_ID,
    },
    deployment: {
      commitSha: state.commitSha,
      createdIn: deployment.createdIn,
      gitRef: PROVIDER_PROOF_BRANCH,
      id: deployment.id,
      configuredNodeVersion: deployment.projectSettings.nodeVersion,
      packageNodeEngine,
      originCacheRegion: deployment.originCacheRegion,
      readyState: deployment.readyState,
      regions: deployment.regions,
      source: deployment.source,
      url: deployment.url,
    },
    databasePreparationCommitSha: state.preparedCommitSha ?? state.commitSha,
    environment: {
      branch: PROVIDER_PROOF_BRANCH,
      forbiddenKeysPresent: environment
        .map((entry) => entry.key)
        .filter((key) => FORBIDDEN_PROVIDER_ENVIRONMENT_KEYS.includes(key)),
      keyCount: environment.length,
      keys: environment.map((entry) => entry.key).sort(),
      target: "preview",
      valuesRetained: false,
    },
    neon: {
      branchId: REVIEWED_STAGING_BRANCH_ID,
      branchName: REVIEWED_STAGING_BRANCH_NAME,
      databaseName: REVIEWED_DATABASE_NAME,
      endpointId: REVIEWED_STAGING_ENDPOINT_ID,
      parentBranchId: REVIEWED_PRODUCTION_BRANCH_ID,
      region: REVIEWED_DATABASE_REGION,
      runtimeRole: REVIEWED_RUNTIME_ROLE,
    },
    production,
    automationBypass: {
      cleanupRevocationRequired: true,
      secretRetainedInEvidence: false,
      soleActiveSecretVerified: true,
    },
  };
  assertNoSensitiveEvidence(attestation, state, bypassState);
  const attestationPath = evidencePath("attestation", state.commitSha);
  writePrivateJson(attestationPath, attestation);
  replacePrivateState({ ...state, attestationPath, attestedAt: new Date().toISOString() });
  console.log(JSON.stringify({ attested: true, commitSha: state.commitSha, deploymentId: state.deploymentId }));
}

async function invoke(runSlot) {
  const state = readProviderState();
  const bypassState = readBypassState();
  assertExactCleanCommit(state.commitSha);
  if (!state.attestedAt || state.failedSlot) {
    throw new Error("provider state is not eligible for a counted slot");
  }
  if (runSlot === 1 && (state.slot1EvidencePath || state.slot2EvidencePath)) {
    throw new Error("provider slot 1 has already been attempted");
  }
  if (runSlot === 2 && (!state.slot1EvidencePath || state.slot2EvidencePath)) {
    throw new Error("provider slot 2 requires exactly one passing slot 1 and no prior slot 2");
  }
  try {
    const outputPath = await invokeProviderSlot(state, bypassState, runSlot);
    replacePrivateState({
      ...state,
      [`slot${runSlot}CompletedAt`]: new Date().toISOString(),
      [`slot${runSlot}EvidencePath`]: outputPath,
    });
    console.log(JSON.stringify({ countedPass: true, runSlot }));
  } catch (error) {
    replacePrivateState({
      ...state,
      failedAt: new Date().toISOString(),
      failedSlot: runSlot,
    });
    throw error;
  }
}

async function removeProviderEnvironment(state) {
  const inventory = assertExactEnvironmentInventory(await branchEnvironmentInventory());
  const ids = inventory.map((entry) => entry.id).sort();
  if (
    !Array.isArray(state.environmentIds)
    || JSON.stringify([...state.environmentIds].sort()) !== JSON.stringify(ids)
  ) {
    throw new Error("branch environment IDs drifted before cleanup");
  }
  const { payload } = await vercelApi(
    `/v1/projects/${REVIEWED_VERCEL_PROJECT_ID}/env`,
    { body: { ids }, method: "DELETE" },
  );
  if (
    Number(payload.deleted) !== PROVIDER_ENVIRONMENT_KEYS.length
    || !Array.isArray(payload.ids)
    || JSON.stringify([...payload.ids].sort()) !== JSON.stringify(ids)
  ) {
    throw new Error("Vercel did not confirm deletion of every reviewed branch variable");
  }
  if ((await branchEnvironmentInventory()).length !== 0) {
    throw new Error("Vercel branch environment variables remained after cleanup");
  }
}

async function deleteProviderDeployment(state) {
  if (!state.deploymentId) return false;
  const { payload } = await readDeployment(state.deploymentId);
  validateProviderDeploymentIdentity(payload, state);
  await vercelApi(`/v13/deployments/${state.deploymentId}`, { method: "DELETE" });
  const after = await readDeployment(state.deploymentId, [404]);
  if (after.status !== 404) throw new Error("provider Preview remained after deletion");
  return true;
}

async function deleteNeonStagingBranch() {
  await verifyNeonStagingTarget();
  runNeonApi(
    `/projects/${REVIEWED_NEON_PROJECT_ID}/branches/${REVIEWED_STAGING_BRANCH_ID}`,
    "DELETE",
  );
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const branches = runNeonApi(`/projects/${REVIEWED_NEON_PROJECT_ID}/branches`)?.branches;
    if (!Array.isArray(branches)) throw new Error("Neon branch list shape drifted after deletion");
    const stagingPresent = branches.some((branch) => branch?.id === REVIEWED_STAGING_BRANCH_ID);
    const productionPresent = branches.some((branch) => branch?.id === REVIEWED_PRODUCTION_BRANCH_ID);
    if (!productionPresent) throw new Error("production Neon branch disappeared during staging cleanup");
    if (!stagingPresent) return true;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("Neon staging branch remained after deletion request");
}

function validateRetainedCountedEvidence(state) {
  for (const [slot, filePath] of [[1, state.slot1EvidencePath], [2, state.slot2EvidencePath]]) {
    const artifact = readPrivateJson(filePath, `provider slot ${slot} evidence`);
    if (artifact.httpStatus !== 200) throw new Error(`provider slot ${slot} evidence was not HTTP 200`);
    validateProviderEvidence(artifact.response, state, slot);
    assertNoSensitiveEvidence(artifact, state, null);
  }
}

function validateRetainedRouteSmokeEvidence(state) {
  if (!state.routeSmokePassedAt || !state.routeSmokeEvidencePath) {
    throw new Error("passing authenticated route-smoke state is missing");
  }
  const artifact = readPrivateJson(state.routeSmokeEvidencePath, "authenticated route-smoke evidence");
  if (
    artifact.status !== "passed"
    || artifact.scope !== "notification-authenticated-route-smoke"
    || artifact.commitSha !== state.commitSha
    || artifact.deploymentId !== state.deploymentId
    || artifact.cleanup?.fixtureRowsDeleted !== true
    || artifact.cleanup?.clerkSessionRevoked !== true
    || artifact.secretsRetained !== false
  ) {
    throw new Error("authenticated route-smoke evidence did not pass validation");
  }
}

async function cleanup({ requireSuccess, routeSmokeSuccess = false }) {
  let state = readProviderState();
  const bypassState = readBypassState();
  if (requireSuccess && routeSmokeSuccess) {
    throw new Error("cleanup mode cannot be both counted-provider and route-smoke success");
  }
  const expectedConfirmation = routeSmokeSuccess
    ? ROUTE_SMOKE_CLEANUP_CONFIRMATION
    : requireSuccess
      ? CLEANUP_CONFIRMATION
      : ABORT_CONFIRMATION;
  if (process.env.NOTIFICATION_PROVIDER_PROOF_CLEANUP_CONFIRM !== expectedConfirmation) {
    throw new Error(`NOTIFICATION_PROVIDER_PROOF_CLEANUP_CONFIRM=${expectedConfirmation} is required`);
  }
  if (requireSuccess) validateRetainedCountedEvidence(state);
  if (routeSmokeSuccess) validateRetainedRouteSmokeEvidence(state);
  if (state.deploymentId) {
    const { payload } = await readDeployment(state.deploymentId);
    if (payload.readyState === "READY") validateProviderDeployment(payload, state);
  }
  let ownerOnlyFixtureTeardownPassed = false;
  if (state.setupCompletedAt) {
    if (!state.teardownEvidencePath) {
      state = {
        ...state,
        teardownEvidencePath: evidencePath("teardown", state.commitSha),
      };
      replacePrivateState(state);
    }
    if (!existsSync(state.teardownEvidencePath)) runOwnerOnlyGate(state, "teardown");
    await teardownNotificationProviderFixtures(state.adminDatabaseUrl);
    ownerOnlyFixtureTeardownPassed = true;
  }
  replacePrivateState({
    ...state,
    fixtureTornDownAt: new Date().toISOString(),
    ownerOnlyFixtureTeardownPassed,
  });
  state = readProviderState();
  if (state.configuredAt) await removeProviderEnvironment(state);
  const deploymentDeleted = await deleteProviderDeployment(state);
  const automationBypassRevoked = await revokeProviderBypass(bypassState);
  const stagingBranchDeleted = await deleteNeonStagingBranch();
  const production = await assertProductionDeploymentUnchanged();
  const cleanupEvidencePath = evidencePath(
    routeSmokeSuccess ? "route-smoke-cleanup" : requireSuccess ? "cleanup" : "abort-cleanup",
    state.commitSha,
  );
  const cleanupEvidence = {
    generatedAt: new Date().toISOString(),
    scope: routeSmokeSuccess
      ? "disposable-notification-authenticated-route-smoke-cleanup"
      : "disposable-notification-provider-proof-cleanup",
    result: routeSmokeSuccess
      ? "route-smoke-cleanup-complete"
      : requireSuccess
        ? "proof-cleanup-complete"
        : "abort-cleanup-complete",
    commitSha: state.commitSha,
    databasePreparationCommitSha: state.preparedCommitSha ?? state.commitSha,
    deploymentId: state.deploymentId ?? null,
    deploymentDeleted,
    automationBypassRevoked,
    remainingAutomationBypassSecrets: 0,
    branchEnvironmentVariablesDeleted: state.configuredAt ? PROVIDER_ENVIRONMENT_KEYS.length : 0,
    ownerOnlyFixtureTeardownPassed,
    ownerOnlyFixtureTeardownNotRequired: !state.setupCompletedAt,
    neonStagingBranchId: REVIEWED_STAGING_BRANCH_ID,
    neonStagingBranchDeleted: stagingBranchDeleted,
    production,
    temporarySecretFilesDeletedAfterThisArtifact: [
      PROVIDER_PROOF_STATE_PATH,
      PROVIDER_BYPASS_STATE_PATH,
    ],
  };
  assertNoSensitiveEvidence(cleanupEvidence, state, bypassState);
  writePrivateJson(cleanupEvidencePath, cleanupEvidence);
  unlinkSync(PROVIDER_PROOF_STATE_PATH);
  unlinkSync(PROVIDER_BYPASS_STATE_PATH);
  console.log(JSON.stringify({ cleanupComplete: true, requireSuccess, routeSmokeSuccess }));
}

async function status() {
  const state = existsSync(PROVIDER_PROOF_STATE_PATH) ? readProviderState() : null;
  const inventory = await branchEnvironmentInventory();
  const deployments = await listDeployments();
  const providerDeployments = deployments.filter(
    (deployment) => deployment.meta?.githubCommitRef === PROVIDER_PROOF_BRANCH,
  );
  const branches = runNeonApi(`/projects/${REVIEWED_NEON_PROJECT_ID}/branches`)?.branches ?? [];
  console.log(JSON.stringify({
    statePresent: Boolean(state),
    state: state ? {
      attested: Boolean(state.attestedAt),
      commitSha: state.commitSha,
      configured: Boolean(state.configuredAt),
      deploymentId: state.deploymentId ?? null,
      failedSlot: state.failedSlot ?? null,
      prepared: Boolean(state.setupCompletedAt),
      slot1Passed: Boolean(state.slot1EvidencePath),
      slot2Passed: Boolean(state.slot2EvidencePath),
    } : null,
    branchEnvironmentVariableCount: inventory.length,
    providerDeployments: providerDeployments.map((deployment) => ({
      id: deployment.uid,
      readyState: deployment.readyState ?? deployment.state,
    })),
    stagingBranchPresent: branches.some((branch) => branch?.id === REVIEWED_STAGING_BRANCH_ID),
    productionBranchPresent: branches.some((branch) => branch?.id === REVIEWED_PRODUCTION_BRANCH_ID),
  }, null, 2));
}

async function databaseStatus() {
  const state = readProviderState();
  await verifyNeonStagingTarget();
  const owner = new Client({
    application_name: "notification-provider-status",
    connectionString: state.adminDatabaseUrl,
  });
  await owner.connect();
  try {
    const migrations = await owner.query(
      `SELECT migration_name,
              finished_at IS NOT NULL AS finished,
              rolled_back_at IS NOT NULL AS rolled_back,
              applied_steps_count
         FROM public._prisma_migrations
        WHERE migration_name = ANY($1::text[])
        ORDER BY migration_name`,
      [Object.values(REVIEWED_NOTIFICATION_MIGRATIONS).map((migration) => path.basename(path.dirname(migration.path)))],
    );
    const unresolvedMigrations = await owner.query(
      `SELECT migration_name, applied_steps_count
         FROM public._prisma_migrations
        WHERE finished_at IS NULL AND rolled_back_at IS NULL
        ORDER BY started_at, migration_name`,
    );
    const catalog = await owner.query(
      `SELECT class.relrowsecurity AS rls,
              class.relforcerowsecurity AS force_rls,
              (SELECT pg_catalog.count(*)::integer
                 FROM pg_catalog.pg_policy AS policy
                WHERE policy.polrelid = class.oid) AS policy_count,
              (SELECT pg_catalog.count(*)::integer
                 FROM pg_catalog.pg_attribute AS attribute
                WHERE attribute.attrelid = class.oid
                  AND attribute.attname = 'relatedUserId'
                  AND attribute.attnum > 0
                  AND NOT attribute.attisdropped) AS related_user_column_count
         FROM pg_catalog.pg_class AS class
         JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
        WHERE namespace.nspname = 'public' AND class.relname = 'Notification'`,
    );
    const functions = await owner.query(
      `SELECT pg_catalog.count(*)::integer AS count
         FROM pg_catalog.pg_proc AS procedure
         JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public'
          AND procedure.proname LIKE 'grainline\\_notification\\_%' ESCAPE '\\'`,
    );
    const grants = await owner.query(
      `SELECT privilege_type
         FROM information_schema.role_table_grants
        WHERE grantee = $1
          AND table_schema = 'public'
          AND table_name = 'Notification'
        ORDER BY privilege_type`,
      [REVIEWED_RUNTIME_ROLE],
    );
    console.log(JSON.stringify({
      candidateMigrations: migrations.rows,
      unresolvedMigrations: unresolvedMigrations.rows,
      catalog: catalog.rows[0] ?? null,
      notificationFunctionCount: functions.rows[0]?.count ?? null,
      runtimeTableGrants: grants.rows.map((row) => row.privilege_type),
    }, null, 2));
  } finally {
    await owner.end();
  }
}

function usage() {
  console.error("Usage: node scripts/notification-provider-proof-operator.mjs <create-bypass-state|bootstrap-bypass-state|revoke-bypass-state|prepare|local-preflight|rebind-local-preflight-retry|rebind-predeployment-commit|configure|rebind-configured-commit|attest|slot-1|slot-2|cleanup|cleanup-route-smoke|cleanup-abort|status|database-status|prisma-status>");
}

async function main() {
  switch (process.argv[2]) {
    case "create-bypass-state":
      await createBypassState();
      break;
    case "bootstrap-bypass-state":
      await bootstrapBypassState();
      break;
    case "revoke-bypass-state":
      await revokeBypassStateOnly();
      break;
    case "prepare":
      await prepare();
      break;
    case "local-preflight":
      await localPreflight();
      break;
    case "rebind-local-preflight-retry":
      await rebindLocalPreflightRetryCommit();
      break;
    case "rebind-predeployment-commit":
      await rebindPredeploymentCommit();
      break;
    case "configure":
      await configure();
      break;
    case "rebind-configured-commit":
      await rebindConfiguredCommit();
      break;
    case "attest":
      await attest();
      break;
    case "slot-1":
      await invoke(1);
      break;
    case "slot-2":
      await invoke(2);
      break;
    case "cleanup":
      await cleanup({ requireSuccess: true });
      break;
    case "cleanup-route-smoke":
      await cleanup({ requireSuccess: false, routeSmokeSuccess: true });
      break;
    case "cleanup-abort":
      await cleanup({ requireSuccess: false });
      break;
    case "status":
      await status();
      break;
    case "database-status":
      await databaseStatus();
      break;
    case "prisma-status":
      prismaStatusDiagnostic();
      break;
    default:
      usage();
      process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "notification provider proof operator failed");
    process.exitCode = 1;
  });
}
