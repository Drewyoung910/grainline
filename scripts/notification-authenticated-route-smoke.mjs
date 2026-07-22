#!/usr/bin/env node
// Authenticated Notification route proof for the completed disposable Preview
// gate and the separately pinned production postflight. No temporary HTTP
// operator route is required in either mode.
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
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
import { createClerkClient } from "@clerk/backend";
import { parsePublishableKey } from "@clerk/shared/keys";
import { Redis } from "@upstash/redis";
import { parse as parseDotenv } from "dotenv";
import pg from "pg";
import {
  EVIDENCE_DIRECTORY,
  PROVIDER_BYPASS_STATE_PATH,
  PROVIDER_PROOF_BRANCH,
  PROVIDER_PROOF_STATE_PATH,
  REVIEWED_DATABASE_NAME,
  REVIEWED_RUNTIME_ROLE,
  REVIEWED_STAGING_ENDPOINT_ID,
  REVIEWED_VERCEL_PROJECT_ID,
  REVIEWED_VERCEL_TEAM_ID,
} from "./notification-provider-proof-operator.mjs";
import { NOTIFICATION_CANARY_EXTERNAL_ID } from "./notification-operational-canary.mjs";

const { Client } = pg;
const LOCAL_ENV_PATH = "/Users/drewyoung/grainline/.env.local";
const OWNER_ENV_PATH = "/Users/drewyoung/grainline/.env.migration-owner.local";
const MAX_JSON_BYTES = 128 * 1024;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const REVIEWED_TERMS_VERSION = "2026-06-14";
const REVIEWED_CLERK_FRONTEND_API = "clerk.thegrainline.com";
const REVIEWED_CLERK_ORIGIN = "https://thegrainline.com";
const PRODUCTION_POSTFLIGHT_BRANCH = "codex/rls-notification-postflight-20260722";
const PRODUCTION_RELEASE_COMMIT = "aa3f2c3640c2cb62200c1d660a08ac217271a037";
const PRODUCTION_DEPLOYMENT_ID = "dpl_92rXcp1PqmoMPtgtAswbecAKWEt2";
const PRODUCTION_ENDPOINT_ID = "ep-plain-river-aaqg8gj4";
const PRODUCTION_CACHE_NAMESPACE = "vercel-production";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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

function exactCleanCommit(expectedBranch) {
  const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    encoding: "utf8",
  });
  const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  const branch = spawnSync("git", ["branch", "--show-current"], { encoding: "utf8" });
  if (
    status.status !== 0
    || status.stdout.trim() !== ""
    || head.status !== 0
    || branch.status !== 0
    || !/^[a-f0-9]{40}$/.test(head.stdout.trim())
    || branch.stdout.trim() !== expectedBranch
  ) {
    throw new Error("route smoke requires the exact clean reviewed operator branch commit");
  }
  return head.stdout.trim();
}

function loadLocalEnvironment() {
  assertPrivateRegularFile(LOCAL_ENV_PATH, "local environment file");
  return parseDotenv(readFileSync(LOCAL_ENV_PATH));
}

function loadProductionOwnerDatabaseUrl() {
  assertPrivateRegularFile(OWNER_ENV_PATH, "local migration-owner environment file");
  const values = parseDotenv(readFileSync(OWNER_ENV_PATH));
  const databaseUrl = values.DIRECT_URL;
  if (typeof databaseUrl !== "string") {
    throw new Error("production postflight owner URL is missing");
  }
  const parsed = new URL(databaseUrl);
  if (
    parsed.protocol !== "postgresql:"
    || parsed.username !== "neondb_owner"
    || parsed.hostname !== `${PRODUCTION_ENDPOINT_ID}.westus3.azure.neon.tech`
    || parsed.pathname !== `/${REVIEWED_DATABASE_NAME}`
    || !parsed.password
    || parsed.searchParams.get("sslmode") !== "verify-full"
    || parsed.searchParams.get("channel_binding") !== "require"
  ) {
    throw new Error("production postflight owner URL identity drifted");
  }
  return databaseUrl;
}

function loadLiveClerkCredentials() {
  const values = loadLocalEnvironment();
  const secret = values.CLERK_SECRET_KEY;
  const publishable = values.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (
    typeof secret !== "string"
    || !secret.startsWith("sk_live_")
    || typeof publishable !== "string"
    || !publishable.startsWith("pk_live_")
  ) {
    throw new Error("route smoke requires the reviewed live Clerk key pair");
  }
  const parsed = parsePublishableKey(publishable);
  if (
    parsed.instanceType !== "production"
    || parsed.frontendApi !== REVIEWED_CLERK_FRONTEND_API
  ) {
    throw new Error("route smoke Clerk Frontend API identity drifted");
  }
  return { frontendApi: parsed.frontendApi, secret };
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
      || content.length < 1
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

async function deleteAccountStateCache(clerkId, namespace) {
  const values = loadLocalEnvironment();
  const url = values.UPSTASH_REDIS_REST_URL;
  const token = values.UPSTASH_REDIS_REST_TOKEN;
  if (
    typeof url !== "string"
    || !url.startsWith("https://")
    || typeof token !== "string"
    || token.length < 16
  ) {
    throw new Error("route smoke requires the reviewed Redis REST credentials");
  }
  const key = `account-state:${namespace}:clerk:${clerkId}`;
  const redis = new Redis({ url, token });
  await redis.del(key);
}

function validatePreviewState() {
  const state = readPrivateJson(PROVIDER_PROOF_STATE_PATH, "route smoke state");
  const bypass = readPrivateJson(PROVIDER_BYPASS_STATE_PATH, "route smoke bypass state");
  const commitSha = exactCleanCommit(PROVIDER_PROOF_BRANCH);
  if (
    state.branch !== PROVIDER_PROOF_BRANCH
    || state.projectId !== REVIEWED_VERCEL_PROJECT_ID
    || state.teamId !== REVIEWED_VERCEL_TEAM_ID
    || state.commitSha !== commitSha
    || !state.attestedAt
    || !state.deploymentId
    || typeof state.deploymentUrl !== "string"
    || !state.deploymentUrl.endsWith(".vercel.app")
    || state.neonEndpointId !== REVIEWED_STAGING_ENDPOINT_ID
    || state.slot1EvidencePath
    || state.slot2EvidencePath
    || state.routeSmokePassedAt
  ) {
    throw new Error("route smoke state is not eligible for one authenticated run");
  }
  const adminUrl = new URL(state.adminDatabaseUrl);
  const runtimeUrl = new URL(state.runtimeDatabaseUrl);
  if (
    adminUrl.username !== "neondb_owner"
    || adminUrl.hostname !== `${REVIEWED_STAGING_ENDPOINT_ID}.westus3.azure.neon.tech`
    || runtimeUrl.username !== REVIEWED_RUNTIME_ROLE
    || runtimeUrl.hostname !== `${REVIEWED_STAGING_ENDPOINT_ID}-pooler.westus3.azure.neon.tech`
    || adminUrl.pathname !== `/${REVIEWED_DATABASE_NAME}`
    || runtimeUrl.pathname !== `/${REVIEWED_DATABASE_NAME}`
  ) {
    throw new Error("route smoke database identity drifted");
  }
  if (
    bypass.projectId !== REVIEWED_VERCEL_PROJECT_ID
    || bypass.teamId !== REVIEWED_VERCEL_TEAM_ID
    || typeof bypass.bypassSecret !== "string"
    || bypass.bypassSecret.length < 24
    || sha256(bypass.bypassSecret) !== bypass.bypassSecretSha256
  ) {
    throw new Error("route smoke bypass state drifted");
  }
  return {
    bypass,
    commitSha,
    state: {
      ...state,
      cacheNamespace: `vercel-preview-${sha256(PROVIDER_PROOF_BRANCH).slice(0, 16)}`,
      databaseName: REVIEWED_DATABASE_NAME,
      productionPostflight: false,
      runtimeRole: REVIEWED_RUNTIME_ROLE,
    },
  };
}

function validateProductionState() {
  const commitSha = exactCleanCommit(PRODUCTION_POSTFLIGHT_BRANCH);
  const values = loadLocalEnvironment();
  const runtimeDatabaseUrl = values.DATABASE_URL;
  if (typeof runtimeDatabaseUrl !== "string") {
    throw new Error("production postflight runtime URL is missing");
  }
  const runtimeUrl = new URL(runtimeDatabaseUrl);
  if (
    runtimeUrl.protocol !== "postgresql:"
    || runtimeUrl.username !== REVIEWED_RUNTIME_ROLE
    || runtimeUrl.hostname !== `${PRODUCTION_ENDPOINT_ID}-pooler.westus3.azure.neon.tech`
    || runtimeUrl.pathname !== `/${REVIEWED_DATABASE_NAME}`
    || !runtimeUrl.password
    || runtimeUrl.searchParams.get("sslmode") !== "verify-full"
    || runtimeUrl.searchParams.get("channel_binding") !== "require"
  ) {
    throw new Error("production postflight runtime URL identity drifted");
  }
  return {
    bypass: { bypassSecret: undefined },
    commitSha,
    state: {
      adminDatabaseUrl: loadProductionOwnerDatabaseUrl(),
      branch: PRODUCTION_POSTFLIGHT_BRANCH,
      cacheNamespace: PRODUCTION_CACHE_NAMESPACE,
      databaseName: REVIEWED_DATABASE_NAME,
      deploymentId: PRODUCTION_DEPLOYMENT_ID,
      deploymentUrl: "thegrainline.com",
      neonEndpointId: PRODUCTION_ENDPOINT_ID,
      productionPostflight: true,
      releaseCommit: PRODUCTION_RELEASE_COMMIT,
      runtimeDatabaseUrl,
      runtimeRole: REVIEWED_RUNTIME_ROLE,
    },
  };
}

async function boundedText(response, maxBytes) {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new Error("route response exceeded its reviewed size bound");
  }
  return text;
}

async function boundedJson(response) {
  const text = await boundedText(response, MAX_JSON_BYTES);
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("route response was not a JSON object");
  }
  return value;
}

function baseHeaders(bypassSecret, token) {
  return {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    "cache-control": "no-store",
    ...(bypassSecret ? { "x-vercel-protection-bypass": bypassSecret } : {}),
  };
}

async function fetchJson(baseUrl, pathname, {
  bypassSecret,
  body,
  method = "GET",
  origin,
  token,
} = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      ...baseHeaders(bypassSecret, token),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(origin ? { origin } : {}),
    },
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  return { body: await boundedJson(response), status: response.status };
}

function notificationIds(value) {
  if (!Array.isArray(value?.notifications)) {
    throw new Error("notification bell response omitted its notification array");
  }
  return value.notifications.map((notification) => notification?.id);
}

async function expectDatabaseError(operation, expectedCode, label) {
  try {
    await operation();
  } catch (error) {
    if (error?.code === expectedCode) return;
    throw new Error(`${label} failed with an unexpected database error`);
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

async function main() {
  const productionPostflight = process.argv[2] === "--production-postflight";
  if (process.argv[2] && !productionPostflight) {
    throw new Error("Usage: node scripts/notification-authenticated-route-smoke.mjs [--production-postflight]");
  }
  const { bypass, commitSha, state } = productionPostflight
    ? validateProductionState()
    : validatePreviewState();
  const evidencePath = path.join(
    EVIDENCE_DIRECTORY,
    productionPostflight
      ? `notification-production-postflight-${state.releaseCommit.slice(0, 12)}.json`
      : `notification-authenticated-route-smoke-${commitSha.slice(0, 12)}.json`,
  );
  if (existsSync(evidencePath)) throw new Error("route smoke evidence already exists");

  const baseUrl = `https://${state.deploymentUrl}`;
  const owner = new Client({ connectionString: state.adminDatabaseUrl });
  const runtime = new Client({ connectionString: state.runtimeDatabaseUrl });
  let stage = "connect-owner";
  let sessionId = null;
  let signInTokenId = null;
  let signInTokenConsumed = false;
  let signInTokenDisposed = false;
  let fixturesSeeded = false;
  let sessionRevoked = false;
  let fixturesDeleted = false;
  let childAccountStateAdjusted = false;
  let childAccountStateRestored = true;
  let accountStateCacheKeyDeleted = true;
  let result = null;
  let runtimeProof = null;
  let catalogProof = null;
  let primaryFailure = null;
  let candidate;
  let fixture;
  let clerk;

  try {
    await owner.connect();
    await runtime.connect();
    stage = "verify-database-posture";
    const ownerIdentity = await owner.query(
      `SELECT current_user AS "currentUser", current_database() AS "databaseName"`,
    );
    const runtimeIdentity = await runtime.query(
      `SELECT current_user AS "currentUser", current_database() AS "databaseName"`,
    );
    if (
      ownerIdentity.rows[0]?.currentUser !== "neondb_owner"
      || ownerIdentity.rows[0]?.databaseName !== state.databaseName
      || runtimeIdentity.rows[0]?.currentUser !== state.runtimeRole
      || runtimeIdentity.rows[0]?.databaseName !== state.databaseName
    ) {
      throw new Error("route smoke database session identity drifted");
    }
    if (productionPostflight) {
      const catalog = await owner.query(
        `SELECT class.relrowsecurity AS "rlsEnabled",
                class.relforcerowsecurity AS "rlsForced",
                pg_catalog.pg_get_userbyid(class.relowner) AS "tableOwner",
                (SELECT pg_catalog.count(*)::integer
                   FROM pg_catalog.pg_policy AS policy
                  WHERE policy.polrelid = class.oid) AS "policyCount",
                pg_catalog.has_table_privilege(
                  $1, 'public."Notification"', 'SELECT'
                ) AS "canSelect",
                pg_catalog.has_table_privilege(
                  $1, 'public."Notification"', 'INSERT'
                ) AS "canInsert",
                pg_catalog.has_table_privilege(
                  $1, 'public."Notification"', 'DELETE'
                ) AS "canDelete",
                pg_catalog.has_table_privilege(
                  $1, 'public."Notification"', 'UPDATE'
                ) AS "canUpdateTable",
                pg_catalog.has_column_privilege(
                  $1, 'public."Notification"', 'read', 'UPDATE'
                ) AS "canUpdateRead",
                pg_catalog.has_column_privilege(
                  $1, 'public."Notification"', 'title', 'UPDATE'
                ) AS "canUpdateTitle"
           FROM pg_catalog.pg_class AS class
           JOIN pg_catalog.pg_namespace AS namespace
             ON namespace.oid = class.relnamespace
          WHERE namespace.nspname = 'public'
            AND class.relname = 'Notification'
            AND class.relkind = 'r'`,
        [state.runtimeRole],
      );
      const row = catalog.rows[0];
      if (
        catalog.rowCount !== 1
        || row.rlsEnabled !== true
        || row.rlsForced !== false
        || row.tableOwner !== "neondb_owner"
        || row.policyCount !== 2
        || row.canSelect !== true
        || row.canInsert !== false
        || row.canDelete !== false
        || row.canUpdateTable !== false
        || row.canUpdateRead !== true
        || row.canUpdateTitle !== false
      ) {
        throw new Error("production Notification catalog or runtime grant posture drifted");
      }
      catalogProof = {
        canDelete: false,
        canInsert: false,
        canSelect: true,
        canUpdateRead: true,
        canUpdateTable: false,
        canUpdateTitle: false,
        policyCount: 2,
        rlsEnabled: true,
        rlsForced: false,
      };
    }
    stage = "select-test-identity";
    const clerkCredentials = loadLiveClerkCredentials();
    clerk = createClerkClient({ secretKey: clerkCredentials.secret });
    const clerkCandidates = await clerk.users.getUserList({
      externalId: [NOTIFICATION_CANARY_EXTERNAL_ID],
      limit: 2,
    });
    if (clerkCandidates.totalCount !== 1 || clerkCandidates.data.length !== 1) {
      throw new Error("expected exactly one Clerk-backed operational canary");
    }
    const clerkUser = clerkCandidates.data[0];
    if (
      clerkUser.externalId !== NOTIFICATION_CANARY_EXTERNAL_ID
      || clerkUser.banned === true
      || clerkUser.locked === true
      || clerkUser.publicMetadata?.grainlineOperationalCanary
        !== "notification-rls-route-and-production-canary"
    ) {
      throw new Error("operational canary Clerk identity drifted");
    }
    const candidates = await owner.query(
      `SELECT id, "clerkId", "termsAcceptedAt", "termsVersion", "ageAttestedAt"
         FROM public."User"
        WHERE "deletedAt" IS NULL
          AND banned = false
          AND "clerkId" = $1`,
      [clerkUser.id],
    );
    if (candidates.rowCount !== 1) {
      throw new Error("expected exactly one active dedicated test identity");
    }
    candidate = candidates.rows[0];
    accountStateCacheKeyDeleted = false;
    const foreign = await owner.query(
      `SELECT id
         FROM public."User"
        WHERE id <> $1
          AND "deletedAt" IS NULL
          AND banned = false
        ORDER BY "createdAt", id
        LIMIT 1`,
      [candidate.id],
    );
    if (foreign.rowCount !== 1) throw new Error("route smoke requires one foreign local user");

    stage = "validate-clerk-user";
    if (clerkUser.id !== candidate.clerkId) {
      throw new Error("dedicated Clerk test identity is not active");
    }
    const preexistingSessions = await clerk.sessions.getSessionList({
      limit: 100,
      status: "active",
      userId: candidate.clerkId,
    });
    if (preexistingSessions.totalCount !== 0 || preexistingSessions.data.length !== 0) {
      throw new Error("operational canary had a pre-existing active Clerk session");
    }

    stage = "adjust-child-account-state";
    const acceptedAt = new Date();
    const adjusted = await owner.query(
      `UPDATE public."User"
          SET "termsAcceptedAt" = $2,
              "termsVersion" = $3,
              "ageAttestedAt" = $2
        WHERE id = $1
        RETURNING id`,
      [candidate.id, acceptedAt, REVIEWED_TERMS_VERSION],
    );
    if (adjusted.rowCount !== 1) {
      throw new Error("dedicated test identity child-state adjustment failed");
    }
    childAccountStateAdjusted = true;
    childAccountStateRestored = false;

    stage = "seed-isolated-fixtures";
    const nonce = randomUUID();
    fixture = {
      foreignId: randomUUID(),
      foreignTitle: `route-smoke-foreign-${nonce.slice(0, 8)}`,
      ownIds: [randomUUID(), randomUUID(), randomUUID()],
      ownTitles: [0, 1, 2].map((index) => `route-smoke-own-${index}-${nonce.slice(0, 8)}`),
      sourceId: nonce,
    };
    const existing = await owner.query(
      `SELECT pg_catalog.count(*)::integer AS count
         FROM public."Notification"
        WHERE "userId" = $1`,
      [candidate.id],
    );
    if (existing.rows[0]?.count !== 0) {
      throw new Error("dedicated test identity retained notifications after candidate activation");
    }
    await owner.query("BEGIN");
    try {
      for (let index = 0; index < fixture.ownIds.length; index += 1) {
        await owner.query(
          `INSERT INTO public."Notification"
             (id, "userId", type, title, body, link, "sourceType", "sourceId", "dedupKey", read, "createdAt")
           VALUES ($1, $2, 'ACCOUNT_WARNING'::public."NotificationType", $3, $4, $5,
                   'RLS_ROUTE_SMOKE', $6, $7, $8, $9)`,
          [
            fixture.ownIds[index],
            candidate.id,
            fixture.ownTitles[index],
            `isolated route smoke owner fixture ${index}`,
            `/dashboard/notifications?route_smoke=${index}`,
            fixture.sourceId,
            sha256(`${fixture.sourceId}:own:${index}`),
            index === 2,
            new Date(Date.now() - index * 1000),
          ],
        );
      }
      await owner.query(
        `INSERT INTO public."Notification"
           (id, "userId", type, title, body, link, "sourceType", "sourceId", "dedupKey", read, "createdAt")
         VALUES ($1, $2, 'ACCOUNT_WARNING'::public."NotificationType", $3, $4, $5,
                 'RLS_ROUTE_SMOKE', $6, $7, false, $8)`,
        [
          fixture.foreignId,
          foreign.rows[0].id,
          fixture.foreignTitle,
          "isolated route smoke foreign fixture",
          "/dashboard/notifications?route_smoke=foreign",
          fixture.sourceId,
          sha256(`${fixture.sourceId}:foreign`),
          new Date(Date.now() + 1000),
        ],
      );
      await owner.query("COMMIT");
      fixturesSeeded = true;
    } catch (error) {
      await owner.query("ROLLBACK");
      throw error;
    }

    if (productionPostflight) {
      stage = "runtime-direct-denial";
      const withoutContext = await runtime.query(
        `SELECT pg_catalog.count(*)::integer AS count
           FROM public."Notification"`,
      );
      if (withoutContext.rows[0]?.count !== 0) {
        throw new Error("runtime without context observed Notification rows");
      }
      await expectDatabaseError(
        () => runtime.query(
          `INSERT INTO public."Notification"
             (id, "userId", type, title, body, "sourceType", "sourceId", "dedupKey")
           VALUES ($1, $2, 'ACCOUNT_WARNING'::public."NotificationType",
                   'forbidden', 'forbidden', 'RLS_ROUTE_SMOKE', $3, $4)`,
          [randomUUID(), candidate.id, fixture.sourceId, sha256(`${fixture.sourceId}:forbidden`)],
        ),
        "42501",
        "runtime direct Notification insert",
      );
      await expectDatabaseError(
        () => runtime.query(
          `DELETE FROM public."Notification" WHERE id = $1`,
          [fixture.ownIds[0]],
        ),
        "42501",
        "runtime direct Notification delete",
      );
      await expectDatabaseError(
        () => runtime.query(
          `UPDATE public."Notification" SET title = 'forbidden' WHERE id = $1`,
          [fixture.ownIds[0]],
        ),
        "42501",
        "runtime direct Notification title update",
      );
      await runtime.query("BEGIN");
      try {
        const context = await runtime.query(
          `SELECT pg_catalog.set_config('app.user_id', $1, true) AS value`,
          [candidate.id],
        );
        const visible = await runtime.query(
          `SELECT id
             FROM public."Notification"
            WHERE "sourceType" = 'RLS_ROUTE_SMOKE'
              AND "sourceId" = $1
            ORDER BY id`,
          [fixture.sourceId],
        );
        if (
          context.rows[0]?.value !== candidate.id
          || visible.rowCount !== fixture.ownIds.length
          || visible.rows.some((row) => !fixture.ownIds.includes(row.id))
          || visible.rows.some((row) => row.id === fixture.foreignId)
        ) {
          throw new Error("runtime context did not isolate the exact recipient rows");
        }
      } finally {
        await runtime.query("ROLLBACK").catch(() => {});
      }
      const afterRollback = await runtime.query(
        `SELECT pg_catalog.count(*)::integer AS count
           FROM public."Notification"`,
      );
      if (afterRollback.rows[0]?.count !== 0) {
        throw new Error("runtime local Notification context leaked after rollback");
      }
      runtimeProof = {
        contextLeakAfterRollback: false,
        directDeleteDenied: true,
        directInsertDenied: true,
        directTitleUpdateDenied: true,
        foreignRowHiddenWithRecipientContext: true,
        noContextVisibleRows: 0,
        ownRowsVisibleWithRecipientContext: fixture.ownIds.length,
      };
    }

    stage = "create-short-lived-clerk-ticket-session";
    const signInToken = await clerk.signInTokens.createSignInToken({
      expiresInSeconds: 60,
      userId: candidate.clerkId,
    });
    signInTokenId = signInToken?.id ?? null;
    if (
      !/^sit_[A-Za-z0-9]+$/.test(String(signInTokenId ?? ""))
      || signInToken.userId !== candidate.clerkId
      || typeof signInToken.token !== "string"
      || signInToken.token.length < 32
      || signInToken.token.length > 4_096
    ) {
      throw new Error("Clerk did not create the expected bounded sign-in token");
    }
    const clerkCookies = new Map();
    const clientResponse = await fetch(
      `https://${clerkCredentials.frontendApi}/v1/client`,
      {
        body: "",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: REVIEWED_CLERK_ORIGIN,
        },
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      },
    );
    absorbClerkResponseCookies(clientResponse, clerkCookies);
    const clientPayload = await boundedJson(clientResponse);
    const client = clientPayload.response ?? clientPayload;
    if (clientResponse.status !== 200 || client.object !== "client") {
      throw new Error("Clerk Frontend API client handshake failed");
    }
    const exchangeResponse = await fetch(
      `https://${clerkCredentials.frontendApi}/v1/client/sign_ins`,
      {
        body: new URLSearchParams({ strategy: "ticket", ticket: signInToken.token }),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: clerkCookieHeader(clerkCookies),
          origin: REVIEWED_CLERK_ORIGIN,
        },
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      },
    );
    absorbClerkResponseCookies(exchangeResponse, clerkCookies);
    const exchangePayload = await boundedJson(exchangeResponse);
    const signInAttempt = exchangePayload.response ?? exchangePayload;
    sessionId = /^sess_[A-Za-z0-9]+$/.test(String(signInAttempt.created_session_id ?? ""))
      ? signInAttempt.created_session_id
      : null;
    signInTokenConsumed = exchangeResponse.status === 200
      && signInAttempt.object === "sign_in_attempt"
      && signInAttempt.status === "complete"
      && Boolean(sessionId);
    if (!signInTokenConsumed) {
      throw new Error("Clerk Frontend API did not complete the one-use ticket exchange");
    }
    const session = await clerk.sessions.getSession(sessionId);
    if (session.userId !== candidate.clerkId || session.status !== "active") {
      throw new Error("Clerk ticket exchange did not create the expected active session");
    }
    const token = await clerk.sessions.getToken(sessionId, undefined, 300);
    if (typeof token?.jwt !== "string" || token.jwt.split(".").length !== 3) {
      throw new Error("Clerk did not return a bounded session token");
    }

    stage = "unauthenticated-denial";
    const unauthenticated = await fetchJson(baseUrl, "/api/notifications", {
      bypassSecret: bypass.bypassSecret,
    });
    if (unauthenticated.status !== 401 || unauthenticated.body.error !== "Unauthorized") {
      throw new Error("unauthenticated notification route did not deny access");
    }

    stage = "authenticated-bell";
    const bellBefore = await fetchJson(baseUrl, "/api/notifications", {
      bypassSecret: bypass.bypassSecret,
      token: token.jwt,
    });
    const bellBeforeIds = notificationIds(bellBefore.body);
    if (
      bellBefore.status !== 200
      || bellBefore.body.unreadCount !== 2
      || bellBeforeIds.length !== 3
      || fixture.ownIds.some((id) => !bellBeforeIds.includes(id))
      || bellBeforeIds.includes(fixture.foreignId)
      || JSON.stringify(bellBefore.body).includes(fixture.foreignTitle)
    ) {
      throw new Error("authenticated bell route failed owner/foreign isolation");
    }

    stage = "authenticated-page";
    const pageResponse = await fetch(`${baseUrl}/dashboard/notifications`, {
      headers: baseHeaders(bypass.bypassSecret, token.jwt),
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    const pageBody = await boundedText(pageResponse, MAX_PAGE_BYTES);
    if (
      pageResponse.status !== 200
      || fixture.ownTitles.some((title) => !pageBody.includes(title))
      || pageBody.includes(fixture.foreignTitle)
    ) {
      throw new Error("authenticated notification page failed owner/foreign isolation");
    }

    stage = "cross-origin-denial";
    const crossOrigin = await fetchJson(
      baseUrl,
      `/api/notifications/${encodeURIComponent(fixture.ownIds[0])}/read`,
      {
        bypassSecret: bypass.bypassSecret,
        method: "POST",
        origin: "https://example.invalid",
        token: token.jwt,
      },
    );
    if (crossOrigin.status !== 403 || crossOrigin.body.error !== "Forbidden") {
      throw new Error("notification mutation did not reject explicit cross-origin POST");
    }

    stage = "foreign-update-denial";
    const foreignUpdate = await fetchJson(
      baseUrl,
      `/api/notifications/${encodeURIComponent(fixture.foreignId)}/read`,
      {
        bypassSecret: bypass.bypassSecret,
        method: "POST",
        origin: baseUrl,
        token: token.jwt,
      },
    );
    if (foreignUpdate.status !== 200 || foreignUpdate.body.ok !== true) {
      throw new Error("foreign mark-one route did not return its non-enumerating response");
    }

    stage = "own-update";
    const ownUpdate = await fetchJson(
      baseUrl,
      `/api/notifications/${encodeURIComponent(fixture.ownIds[0])}/read`,
      {
        bypassSecret: bypass.bypassSecret,
        method: "POST",
        origin: baseUrl,
        token: token.jwt,
      },
    );
    if (ownUpdate.status !== 200 || ownUpdate.body.ok !== true) {
      throw new Error("own mark-one route failed");
    }

    stage = "read-all";
    const readAll = await fetchJson(baseUrl, "/api/notifications/read-all", {
      body: {},
      bypassSecret: bypass.bypassSecret,
      method: "POST",
      origin: baseUrl,
      token: token.jwt,
    });
    if (
      readAll.status !== 200
      || readAll.body.ok !== true
      || readAll.body.markedCount !== 1
      || readAll.body.cappedIds !== false
    ) {
      throw new Error("owner mark-all route returned an unexpected result");
    }

    stage = "post-mutation-bell";
    const bellAfter = await fetchJson(baseUrl, "/api/notifications", {
      bypassSecret: bypass.bypassSecret,
      token: token.jwt,
    });
    const bellAfterIds = notificationIds(bellAfter.body);
    if (
      bellAfter.status !== 200
      || bellAfter.body.unreadCount !== 0
      || bellAfterIds.length !== 3
      || fixture.ownIds.some((id) => !bellAfterIds.includes(id))
      || bellAfterIds.includes(fixture.foreignId)
    ) {
      throw new Error("post-mutation bell route failed exact owner projection");
    }

    stage = "database-postcondition";
    const postcondition = await owner.query(
      `SELECT id, read
         FROM public."Notification"
        WHERE id = ANY($1::text[])
        ORDER BY id`,
      [[...fixture.ownIds, fixture.foreignId]],
    );
    const byId = new Map(postcondition.rows.map((row) => [row.id, row.read]));
    if (
      postcondition.rowCount !== 4
      || fixture.ownIds.some((id) => byId.get(id) !== true)
      || byId.get(fixture.foreignId) !== false
    ) {
      throw new Error("database postcondition did not preserve foreign denial and owner updates");
    }

    result = {
      authenticatedBellRows: bellBeforeIds.length,
      authenticatedPageStatus: pageResponse.status,
      crossOriginStatus: crossOrigin.status,
      finalUnreadCount: bellAfter.body.unreadCount,
      foreignMutationPreservedUnread: true,
      markAllCount: readAll.body.markedCount,
      ownMutationCount: 1,
      unauthenticatedStatus: unauthenticated.status,
    };
  } catch (error) {
    primaryFailure = error;
  } finally {
    if (candidate && clerk) {
      try {
        const active = await clerk.sessions.getSessionList({
          limit: 100,
          status: "active",
          userId: candidate.clerkId,
        });
        for (const session of active.data) {
          const revoked = await clerk.sessions.revokeSession(session.id);
          if (revoked?.id !== session.id || revoked?.status !== "revoked") {
            throw new Error("Clerk canary session revoke did not confirm revocation");
          }
        }
        const after = await clerk.sessions.getSessionList({
          limit: 100,
          status: "active",
          userId: candidate.clerkId,
        });
        sessionRevoked = after.totalCount === 0 && after.data.length === 0;
      } catch {
        sessionRevoked = false;
      }
    } else {
      sessionRevoked = true;
    }
    if (signInTokenId && clerk && !signInTokenConsumed) {
      try {
        const revoked = await clerk.signInTokens.revokeSignInToken(signInTokenId);
        signInTokenDisposed = revoked?.id === signInTokenId && revoked?.status === "revoked";
      } catch {
        signInTokenDisposed = false;
      }
    } else {
      signInTokenDisposed = true;
    }
    if (fixturesSeeded && fixture) {
      try {
        const deleted = await owner.query(
          `DELETE FROM public."Notification"
            WHERE "sourceType" = 'RLS_ROUTE_SMOKE'
              AND "sourceId" = $1`,
          [fixture.sourceId],
        );
        fixturesDeleted = deleted.rowCount === 4;
      } catch {
        fixturesDeleted = false;
      }
    } else {
      fixturesDeleted = true;
    }
    if (childAccountStateAdjusted && candidate) {
      try {
        const restored = await owner.query(
          `UPDATE public."User"
              SET "termsAcceptedAt" = $2,
                  "termsVersion" = $3,
                  "ageAttestedAt" = $4
            WHERE id = $1
            RETURNING id`,
          [
            candidate.id,
            candidate.termsAcceptedAt,
            candidate.termsVersion,
            candidate.ageAttestedAt,
          ],
        );
        childAccountStateRestored = restored.rowCount === 1;
      } catch {
        childAccountStateRestored = false;
      }
    }
    if (candidate) {
      try {
        await deleteAccountStateCache(candidate.clerkId, state.cacheNamespace);
        accountStateCacheKeyDeleted = true;
      } catch {
        accountStateCacheKeyDeleted = false;
      }
    }
    await owner.end().catch(() => {});
    await runtime.end().catch(() => {});
  }

  const status = !primaryFailure
    && sessionRevoked
    && signInTokenDisposed
    && fixturesDeleted
    && childAccountStateRestored
    && accountStateCacheKeyDeleted
    && (!productionPostflight || (catalogProof && runtimeProof))
    ? "passed"
    : "failed";
  const evidence = {
    generatedAt: new Date().toISOString(),
    scope: productionPostflight
      ? "notification-production-postflight"
      : "notification-authenticated-route-smoke",
    status,
    commitSha,
    releaseCommit: state.releaseCommit ?? commitSha,
    deploymentId: state.deploymentId,
    database: {
      endpointId: state.neonEndpointId,
      name: state.databaseName,
      runtimeRole: state.runtimeRole,
    },
    identity: {
      activeDedicatedTestIdentityCount: candidate ? 1 : 0,
      existingUserUsed: Boolean(candidate),
      newUserCreated: false,
      retainedIdentifier: false,
    },
    cleanup: {
      fixtureRowsDeleted: fixturesDeleted,
      clerkSessionRevoked: sessionRevoked,
      clerkSignInTokenConsumedOrRevoked: signInTokenDisposed,
      clerkUserDeleted: false,
      childAccountStateRestored,
      accountStateCacheKeyDeleted,
    },
    catalogProof,
    runtimeProof,
    result,
    failureStage: status === "failed" ? stage : null,
    secretsRetained: false,
  };
  const serialized = JSON.stringify(evidence);
  for (const sensitive of [
    state.adminDatabaseUrl,
    state.runtimeDatabaseUrl,
    state.triggerSecret,
    bypass.bypassSecret,
    candidate?.id,
    candidate?.clerkId,
    fixture?.sourceId,
    fixture?.foreignId,
    ...(fixture?.ownIds ?? []),
  ]) {
    if (sensitive && serialized.includes(sensitive)) {
      throw new Error("route smoke evidence retained a temporary secret or identifier");
    }
  }
  writePrivateJson(evidencePath, evidence);
  if (status !== "passed") {
    throw new Error(`authenticated route smoke failed closed at ${stage}; cleanup status is retained`);
  }
  if (!productionPostflight) {
    replacePrivateJson(PROVIDER_PROOF_STATE_PATH, {
      ...state,
      routeSmokeEvidencePath: evidencePath,
      routeSmokePassedAt: new Date().toISOString(),
    });
  }
  console.log(JSON.stringify({
    authenticatedRouteSmoke: productionPostflight
      ? "production-postflight-passed"
      : "passed",
    accountStateCacheKeyDeleted: true,
    childAccountStateRestored: true,
    clerkSessionRevoked: true,
    clerkSignInTokenConsumedOrRevoked: true,
    fixtureRowsDeleted: true,
    runtimeDirectDenialProved: productionPostflight,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "authenticated route smoke failed");
  process.exitCode = 1;
});
