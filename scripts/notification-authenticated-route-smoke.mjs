#!/usr/bin/env node
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
const MAX_JSON_BYTES = 128 * 1024;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const REVIEWED_TERMS_VERSION = "2026-06-14";

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

function exactCleanCommit() {
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
    || branch.stdout.trim() !== PROVIDER_PROOF_BRANCH
  ) {
    throw new Error("route smoke requires the exact clean disposable branch commit");
  }
  return head.stdout.trim();
}

function loadLocalEnvironment() {
  assertPrivateRegularFile(LOCAL_ENV_PATH, "local environment file");
  return parseDotenv(readFileSync(LOCAL_ENV_PATH));
}

function loadLiveClerkSecret() {
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
  return secret;
}

async function deletePreviewAccountStateCache(clerkId) {
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
  const namespace = `vercel-preview-${sha256(PROVIDER_PROOF_BRANCH).slice(0, 16)}`;
  const key = `account-state:${namespace}:clerk:${clerkId}`;
  const redis = new Redis({ url, token });
  await redis.del(key);
}

function validateState() {
  const state = readPrivateJson(PROVIDER_PROOF_STATE_PATH, "route smoke state");
  const bypass = readPrivateJson(PROVIDER_BYPASS_STATE_PATH, "route smoke bypass state");
  const commitSha = exactCleanCommit();
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
  return { bypass, commitSha, state };
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
    "x-vercel-protection-bypass": bypassSecret,
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

async function main() {
  const { bypass, commitSha, state } = validateState();
  const evidencePath = path.join(
    EVIDENCE_DIRECTORY,
    `notification-authenticated-route-smoke-${commitSha.slice(0, 12)}.json`,
  );
  if (existsSync(evidencePath)) throw new Error("route smoke evidence already exists");

  const baseUrl = `https://${state.deploymentUrl}`;
  const owner = new Client({ connectionString: state.adminDatabaseUrl });
  let stage = "connect-owner";
  let sessionId = null;
  let fixturesSeeded = false;
  let sessionRevoked = false;
  let fixturesDeleted = false;
  let childAccountStateAdjusted = false;
  let childAccountStateRestored = true;
  let previewCacheKeyDeleted = true;
  let result = null;
  let primaryFailure = null;
  let candidate;
  let fixture;
  let clerk;

  try {
    await owner.connect();
    stage = "select-test-identity";
    clerk = createClerkClient({ secretKey: loadLiveClerkSecret() });
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
    previewCacheKeyDeleted = false;
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

    stage = "create-short-lived-clerk-session";
    const session = await clerk.sessions.createSession({ userId: candidate.clerkId });
    if (!session?.id || session.userId !== candidate.clerkId || session.status !== "active") {
      throw new Error("Clerk did not create the expected active test session");
    }
    sessionId = session.id;
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
    if (sessionId && clerk) {
      try {
        const revoked = await clerk.sessions.revokeSession(sessionId);
        sessionRevoked = revoked?.id === sessionId && revoked?.status === "revoked";
      } catch {
        sessionRevoked = false;
      }
    } else {
      sessionRevoked = true;
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
        await deletePreviewAccountStateCache(candidate.clerkId);
        previewCacheKeyDeleted = true;
      } catch {
        previewCacheKeyDeleted = false;
      }
    }
    await owner.end().catch(() => {});
  }

  const status = !primaryFailure
    && sessionRevoked
    && fixturesDeleted
    && childAccountStateRestored
    && previewCacheKeyDeleted
    ? "passed"
    : "failed";
  const evidence = {
    generatedAt: new Date().toISOString(),
    scope: "notification-authenticated-route-smoke",
    status,
    commitSha,
    deploymentId: state.deploymentId,
    database: {
      endpointId: REVIEWED_STAGING_ENDPOINT_ID,
      name: REVIEWED_DATABASE_NAME,
      runtimeRole: REVIEWED_RUNTIME_ROLE,
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
      clerkUserDeleted: false,
      childAccountStateRestored,
      previewCacheKeyDeleted,
    },
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
  replacePrivateJson(PROVIDER_PROOF_STATE_PATH, {
    ...state,
    routeSmokeEvidencePath: evidencePath,
    routeSmokePassedAt: new Date().toISOString(),
  });
  console.log(JSON.stringify({
    authenticatedRouteSmoke: "passed",
    childAccountStateRestored: true,
    clerkSessionRevoked: true,
    fixtureRowsDeleted: true,
    previewCacheKeyDeleted: true,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "authenticated route smoke failed");
  process.exitCode = 1;
});
