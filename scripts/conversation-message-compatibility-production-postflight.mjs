#!/usr/bin/env node
// Authenticated compatibility, initial-activation, and post-FORCE proof for
// the Conversation/Message authority conversion. This operator creates a
// bounded synthetic fixture, exercises the deployed recipient routes with the
// retained operational Clerk canary, and removes every exact fixture before
// success.
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
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
import pg from "pg";
import {
  collectConversationPolicyIssues,
  collectMessagePolicyIssues,
  readConversationPolicyState,
  readMessagePolicyState,
} from "./audit-runtime-db-grants.mjs";
import { NOTIFICATION_CANARY_EXTERNAL_ID } from "./notification-operational-canary.mjs";

const { Client } = pg;
const POST_ACTIVATION_FLAG = "--post-activation";
const POST_FORCE_FLAG = "--post-force";
const CLEANUP_FLAG = "--cleanup";
const POST_ACTIVATION = process.argv.includes(POST_ACTIVATION_FLAG);
const POST_FORCE = process.argv.includes(POST_FORCE_FLAG);
const ACTIVATED = POST_ACTIVATION || POST_FORCE;
const COMPATIBILITY_OPERATOR_BRANCH =
  "agent/conversation-message-compatibility-postflight-20260726";
const POST_ACTIVATION_OPERATOR_BRANCH =
  "agent/conversation-message-postactivation-20260726";
const POST_FORCE_OPERATOR_BRANCH =
  "agent/conversation-message-force-postflight-20260726";
const COMPATIBILITY_RELEASE_COMMIT =
  "650d1dd818ac3694f7fd6da9954aaf053786cc40";
const POST_ACTIVATION_RELEASE_COMMIT =
  "448d5233ed3aad4fc3d88812e98d8ae299a62a42";
const POST_FORCE_RELEASE_COMMIT =
  "f23ac2da6843671d1353bbbbeada65530b575cc8";
const POST_ACTIVATION_MIGRATION_RUN_ID = 30194195844;
const POST_FORCE_MIGRATION_RUN_ID = 30207825683;
const POST_FORCE_MIGRATION_NAME =
  "20260726140000_force_conversation_message_rls";
const POST_FORCE_MIGRATION_SHA256 =
  "c7f6bbb65c1b0b05c43c2ad450235523587de16f4c8b5ca3289bbff28df33a35";
const MODE_FLAG = POST_FORCE
  ? POST_FORCE_FLAG
  : POST_ACTIVATION
    ? POST_ACTIVATION_FLAG
    : null;
const OPERATOR_BRANCH = POST_FORCE
  ? POST_FORCE_OPERATOR_BRANCH
  : POST_ACTIVATION
    ? POST_ACTIVATION_OPERATOR_BRANCH
    : COMPATIBILITY_OPERATOR_BRANCH;
const RELEASE_COMMIT = POST_FORCE
  ? POST_FORCE_RELEASE_COMMIT
  : POST_ACTIVATION
    ? POST_ACTIVATION_RELEASE_COMMIT
    : COMPATIBILITY_RELEASE_COMMIT;
const MIGRATION_RUN_ID = POST_FORCE
  ? POST_FORCE_MIGRATION_RUN_ID
  : POST_ACTIVATION
    ? POST_ACTIVATION_MIGRATION_RUN_ID
    : null;
const POSTFLIGHT_SLUG = POST_FORCE
  ? "force"
  : POST_ACTIVATION
    ? "activation"
    : "compatibility";
const DEPLOYMENT_ID = "dpl_C1rXvRMMJetR25Na4X5yHSa91HpM";
const DEPLOYMENT_HOST = "thegrainline.com";
const DEPLOYMENT_URL = `https://${DEPLOYMENT_HOST}`;
const DATABASE_NAME = "neondb";
const DATABASE_ENDPOINT_ID = "ep-plain-river-aaqg8gj4";
const RUNTIME_ROLE = "grainline_app_runtime";
const CLERK_FRONTEND_API = "clerk.thegrainline.com";
const LOCAL_ENV_PATH = "/Users/drewyoung/grainline/.env.local";
const OWNER_ENV_PATH = "/Users/drewyoung/grainline/.env.migration-owner.local";
const PRIVATE_STATE_DIRECTORY = "/Users/drewyoung/grainline/.codex/private-state";
const EVIDENCE_DIRECTORY = "/Users/drewyoung/grainline-rollout-evidence";
const VERCEL_AUTH_PATH =
  "/Users/drewyoung/Library/Application Support/com.vercel.cli/auth.json";
const VERCEL_PROJECT_PATH = path.join(process.cwd(), ".vercel/project.json");
const RECOVERY_PATH = path.join(
  PRIVATE_STATE_DIRECTORY,
  `conversation-message-${POSTFLIGHT_SLUG}-postflight-${RELEASE_COMMIT.slice(0, 12)}.json`,
);
const MAX_JSON_BYTES = 256 * 1024;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;

function assertPrivateRegularFile(filePath, label) {
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error(`${label} must be a private regular file`);
  }
}

function ensurePrivateDirectory(directoryPath) {
  mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directoryPath);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error(`${path.basename(directoryPath)} must be a private directory`);
  }
}

function writePrivateJson(filePath, value) {
  if (existsSync(filePath)) throw new Error(`refusing to overwrite ${filePath}`);
  ensurePrivateDirectory(path.dirname(filePath));
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
  assertPrivateRegularFile(filePath, path.basename(filePath));
}

function readPrivateJson(filePath, label) {
  assertPrivateRegularFile(filePath, label);
  const value = JSON.parse(readFileSync(filePath, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  return value;
}

function exactCleanOperatorHead() {
  const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    encoding: "utf8",
  });
  const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  const branch = spawnSync("git", ["branch", "--show-current"], { encoding: "utf8" });
  const ancestor = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", RELEASE_COMMIT, "HEAD"],
    { encoding: "utf8" },
  );
  if (
    status.status !== 0
    || status.stdout.trim() !== ""
    || head.status !== 0
    || !/^[a-f0-9]{40}$/.test(head.stdout.trim())
    || branch.status !== 0
    || branch.stdout.trim() !== OPERATOR_BRANCH
    || ancestor.status !== 0
  ) {
    throw new Error("postflight requires the exact clean reviewed operator branch");
  }
  return head.stdout.trim();
}

async function verifyProductionDeployment() {
  assertPrivateRegularFile(VERCEL_AUTH_PATH, "Vercel CLI authentication");
  const projectStat = lstatSync(VERCEL_PROJECT_PATH);
  if (!projectStat.isFile() || projectStat.isSymbolicLink()) {
    throw new Error("Vercel project binding must be a regular file");
  }
  const auth = JSON.parse(readFileSync(VERCEL_AUTH_PATH, "utf8"));
  const project = JSON.parse(readFileSync(VERCEL_PROJECT_PATH, "utf8"));
  if (
    typeof auth?.token !== "string"
    || auth.token.length < 16
    || !/^team_[A-Za-z0-9]+$/.test(String(project?.orgId ?? ""))
    || !/^prj_[A-Za-z0-9]+$/.test(String(project?.projectId ?? ""))
  ) {
    throw new Error("Vercel CLI authentication or project binding drifted");
  }
  const headers = { authorization: `Bearer ${auth.token}` };
  const teamQuery = new URLSearchParams({ teamId: project.orgId });
  const deploymentResponse = await fetch(
    `https://api.vercel.com/v13/deployments/${DEPLOYMENT_ID}?${teamQuery}`,
    { headers, signal: AbortSignal.timeout(15_000) },
  );
  const deployment = await boundedJson(deploymentResponse);
  const aliasResponse = await fetch(
    `https://api.vercel.com/v4/aliases/${DEPLOYMENT_HOST}?${teamQuery}`,
    { headers, signal: AbortSignal.timeout(15_000) },
  );
  const alias = await boundedJson(aliasResponse);
  if (
    deploymentResponse.status !== 200
    || deployment.id !== DEPLOYMENT_ID
    || deployment.projectId !== project.projectId
    || deployment.readyState !== "READY"
    || deployment.target !== "production"
    || !Array.isArray(deployment.alias)
    || !deployment.alias.includes(DEPLOYMENT_HOST)
    || aliasResponse.status !== 200
    || alias.alias !== DEPLOYMENT_HOST
    || alias.deploymentId !== DEPLOYMENT_ID
    || alias.projectId !== project.projectId
  ) {
    throw new Error("production deployment identity, readiness, or alias drifted");
  }
}

function loadEnvironment() {
  assertPrivateRegularFile(LOCAL_ENV_PATH, "local environment file");
  assertPrivateRegularFile(OWNER_ENV_PATH, "migration-owner environment file");
  const local = parseDotenv(readFileSync(LOCAL_ENV_PATH, "utf8"));
  const owner = parseDotenv(readFileSync(OWNER_ENV_PATH, "utf8"));
  const runtimeDatabaseUrl = local.DATABASE_URL;
  const ownerDatabaseUrl = owner.DIRECT_URL;
  const clerkSecretKey = local.CLERK_SECRET_KEY;
  const clerkPublishableKey = local.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const redisUrl = local.UPSTASH_REDIS_REST_URL;
  const redisToken = local.UPSTASH_REDIS_REST_TOKEN;
  if (
    typeof runtimeDatabaseUrl !== "string"
    || typeof ownerDatabaseUrl !== "string"
    || typeof clerkSecretKey !== "string"
    || typeof clerkPublishableKey !== "string"
    || typeof redisUrl !== "string"
    || typeof redisToken !== "string"
  ) {
    throw new Error("postflight credentials are incomplete");
  }
  const runtimeUrl = new URL(runtimeDatabaseUrl);
  const ownerUrl = new URL(ownerDatabaseUrl);
  const clerkKey = parsePublishableKey(clerkPublishableKey);
  if (
    runtimeUrl.protocol !== "postgresql:"
    || runtimeUrl.username !== RUNTIME_ROLE
    || runtimeUrl.hostname !== `${DATABASE_ENDPOINT_ID}-pooler.westus3.azure.neon.tech`
    || runtimeUrl.pathname !== `/${DATABASE_NAME}`
    || !runtimeUrl.password
    || runtimeUrl.searchParams.get("sslmode") !== "verify-full"
    || runtimeUrl.searchParams.get("channel_binding") !== "require"
  ) {
    throw new Error("runtime database identity drifted");
  }
  if (
    ownerUrl.protocol !== "postgresql:"
    || ownerUrl.username !== "neondb_owner"
    || ownerUrl.hostname !== `${DATABASE_ENDPOINT_ID}.westus3.azure.neon.tech`
    || ownerUrl.pathname !== `/${DATABASE_NAME}`
    || !ownerUrl.password
    || ownerUrl.searchParams.get("sslmode") !== "verify-full"
    || ownerUrl.searchParams.get("channel_binding") !== "require"
  ) {
    throw new Error("owner database identity drifted");
  }
  if (
    !clerkSecretKey.startsWith("sk_live_")
    || !clerkPublishableKey.startsWith("pk_live_")
    || clerkKey.instanceType !== "production"
    || clerkKey.frontendApi !== CLERK_FRONTEND_API
    || !redisUrl.startsWith("https://")
    || redisToken.length < 16
  ) {
    throw new Error("Clerk or Redis production identity drifted");
  }
  return {
    clerkSecretKey,
    ownerDatabaseUrl,
    redisToken,
    redisUrl,
    runtimeDatabaseUrl,
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
    if (
      separator <= 0
      || !/^[A-Za-z0-9_]+$/.test(name)
      || content.length < 1
      || content.length > 8_192
    ) {
      throw new Error("Clerk returned an invalid cookie shape");
    }
    jar.set(name, content);
  }
}

function clerkCookieHeader(jar) {
  const value = [...jar].map(([name, content]) => `${name}=${content}`).join("; ");
  if (!value || value.length > 24_000) {
    throw new Error("Clerk cookie jar exceeded its reviewed bound");
  }
  return value;
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

function requestHeaders(token, origin) {
  return {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    "cache-control": "no-store",
    ...(origin ? { origin } : {}),
  };
}

async function fetchJson(pathname, {
  method = "GET",
  origin,
  token,
} = {}) {
  const response = await fetch(`${DEPLOYMENT_URL}${pathname}`, {
    headers: requestHeaders(token, origin),
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  return { body: await boundedJson(response), status: response.status };
}

async function fetchPage(pathname, token) {
  const response = await fetch(`${DEPLOYMENT_URL}${pathname}`, {
    headers: requestHeaders(token),
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  return {
    body: await boundedText(response, MAX_PAGE_BYTES),
    location: response.headers.get("location"),
    status: response.status,
  };
}

async function exactCanary(clerk, owner) {
  const clerkCandidates = await clerk.users.getUserList({
    externalId: [NOTIFICATION_CANARY_EXTERNAL_ID],
    limit: 2,
  });
  if (clerkCandidates.totalCount !== 1 || clerkCandidates.data.length !== 1) {
    throw new Error("expected exactly one operational Clerk canary");
  }
  const clerkUser = clerkCandidates.data[0];
  if (
    clerkUser.externalId !== NOTIFICATION_CANARY_EXTERNAL_ID
    || clerkUser.banned === true
    || clerkUser.locked === true
    || clerkUser.publicMetadata?.grainlineOperationalCanary
      !== "notification-rls-route-and-production-canary"
  ) {
    throw new Error("operational Clerk canary shape drifted");
  }
  const local = await owner.query(
    `SELECT id, "clerkId", "termsAcceptedAt", "ageAttestedAt"
       FROM public."User"
      WHERE "clerkId" = $1
        AND "deletedAt" IS NULL
        AND banned = false`,
    [clerkUser.id],
  );
  if (
    local.rowCount !== 1
    || local.rows[0].clerkId !== clerkUser.id
    || !local.rows[0].termsAcceptedAt
    || !local.rows[0].ageAttestedAt
  ) {
    throw new Error("operational canary database row drifted");
  }
  return { clerkUser, localUser: local.rows[0] };
}

function newFixture() {
  const nonce = randomUUID();
  const short = nonce.replaceAll("-", "").slice(0, 12);
  return {
    nonce,
    userIds: [
      `route-smoke-peer:${short}`,
      `route-smoke-foreign-a:${short}`,
      `route-smoke-foreign-b:${short}`,
    ],
    clerkIds: [
      `route_smoke_peer_${short}`,
      `route_smoke_foreign_a_${short}`,
      `route_smoke_foreign_b_${short}`,
    ],
    emails: [
      `conversation-route-smoke-peer-${short}@example.invalid`,
      `conversation-route-smoke-foreign-a-${short}@example.invalid`,
      `conversation-route-smoke-foreign-b-${short}@example.invalid`,
    ],
    conversationIds: [randomUUID(), randomUUID()],
    messageIds: [randomUUID(), randomUUID(), randomUUID()],
    markers: {
      incoming: `compat-incoming-${short}`,
      outgoing: `compat-outgoing-${short}`,
      foreign: `compat-foreign-${short}`,
    },
  };
}

async function assertDatabasePosture(owner, runtime) {
  const ownerIdentity = await owner.query(
    `SELECT current_user AS "currentUser", current_database() AS "databaseName"`,
  );
  const runtimeIdentity = await runtime.query(
    `SELECT
       current_user AS "currentUser",
       session_user AS "sessionUser",
       current_database() AS "databaseName",
       role.rolsuper AS "superuser",
       role.rolbypassrls AS "bypassRls",
       role.rolinherit AS "inheritsRoles",
       pg_catalog.pg_has_role(
         current_user,
         'neondb_owner',
         'MEMBER'
       ) AS "memberOfOwner"
       FROM pg_catalog.pg_roles AS role
      WHERE role.rolname = current_user`,
  );
  if (
    ownerIdentity.rows[0]?.currentUser !== "neondb_owner"
    || ownerIdentity.rows[0]?.databaseName !== DATABASE_NAME
    || runtimeIdentity.rows[0]?.currentUser !== RUNTIME_ROLE
    || runtimeIdentity.rows[0]?.sessionUser !== RUNTIME_ROLE
    || runtimeIdentity.rows[0]?.databaseName !== DATABASE_NAME
    || runtimeIdentity.rows[0]?.superuser !== false
    || runtimeIdentity.rows[0]?.bypassRls !== false
    || runtimeIdentity.rows[0]?.inheritsRoles !== false
    || runtimeIdentity.rows[0]?.memberOfOwner !== false
  ) {
    throw new Error("database session identity drifted");
  }
  if (POST_FORCE) {
    const migration = await owner.query(
      `SELECT migration_name AS "migrationName",
              checksum,
              finished_at IS NOT NULL AS "completed",
              rolled_back_at IS NULL AS "notRolledBack",
              applied_steps_count AS "appliedSteps"
         FROM public._prisma_migrations
        WHERE migration_name = $1`,
      [POST_FORCE_MIGRATION_NAME],
    );
    if (
      migration.rowCount !== 1
      || migration.rows[0]?.migrationName !== POST_FORCE_MIGRATION_NAME
      || migration.rows[0]?.checksum !== POST_FORCE_MIGRATION_SHA256
      || migration.rows[0]?.completed !== true
      || migration.rows[0]?.notRolledBack !== true
      || migration.rows[0]?.appliedSteps !== 1
    ) {
      throw new Error("FORCE migration identity or completion drifted");
    }
  }
  const catalog = await owner.query(
    `SELECT class.relname AS "tableName",
            class.relrowsecurity AS "rlsEnabled",
            class.relforcerowsecurity AS "rlsForced",
            (SELECT pg_catalog.count(*)::integer
               FROM pg_catalog.pg_policy AS policy
              WHERE policy.polrelid = class.oid) AS "policyCount",
            pg_catalog.has_table_privilege($1, class.oid, 'SELECT') AS "canSelect",
            pg_catalog.has_table_privilege($1, class.oid, 'INSERT') AS "canInsert",
            pg_catalog.has_table_privilege($1, class.oid, 'UPDATE') AS "canUpdate",
            pg_catalog.has_table_privilege($1, class.oid, 'DELETE') AS "canDelete"
       FROM pg_catalog.pg_class AS class
       JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = class.relnamespace
      WHERE namespace.nspname = 'public'
        AND class.relname = ANY($2::text[])
      ORDER BY class.relname`,
    [RUNTIME_ROLE, ["Conversation", "Message"]],
  );
  if (
    catalog.rowCount !== 2
    || (
      ACTIVATED
      && catalog.rows.some((row) => (
        row.rlsEnabled !== true
        || row.rlsForced !== POST_FORCE
        || row.policyCount !== 1
        || row.canSelect !== true
        || row.canInsert !== false
        || row.canUpdate !== false
        || row.canDelete !== false
      ))
    )
    || (
      !ACTIVATED
      && catalog.rows.some((row) => (
        row.rlsEnabled !== false
        || row.rlsForced !== false
        || row.policyCount !== 0
        || row.canSelect !== true
        || row.canInsert !== true
        || row.canUpdate !== true
        || row.canDelete !== true
      ))
    )
  ) {
    throw new Error(
      POST_FORCE
        ? "FORCE RLS catalog posture drifted"
        : POST_ACTIVATION
          ? "initial RLS activation catalog posture drifted"
          : "RLS-off compatibility catalog posture drifted",
    );
  }
  if (ACTIVATED) {
    const policyIssues = [
      ...collectConversationPolicyIssues(
        await readConversationPolicyState(owner),
        RUNTIME_ROLE,
        POST_FORCE,
      ),
      ...collectMessagePolicyIssues(
        await readMessagePolicyState(owner),
        RUNTIME_ROLE,
        POST_FORCE,
      ),
    ];
    if (policyIssues.length > 0) {
      throw new Error(
        `${POST_FORCE ? "FORCE" : "initial"} RLS activation policy catalog drifted: ${policyIssues.join("; ")}`,
      );
    }
  }
  const callable = await runtime.query(
    `SELECT
       pg_catalog.has_function_privilege(
         current_user,
         'public.grainline_conversation_start(text,text,text,text)',
         'EXECUTE'
       ) AS "canStart",
       pg_catalog.has_function_privilege(
         current_user,
         'public.grainline_message_send_ordinary(text,text,text,text,text,text)',
         'EXECUTE'
       ) AS "canSend",
       pg_catalog.has_function_privilege(
         current_user,
         'public.grainline_message_list(text,text,text,timestamp,text,integer)',
         'EXECUTE'
       ) AS "canList",
       pg_catalog.has_function_privilege(
         current_user,
         'public.grainline_message_mark_read(text,text)',
         'EXECUTE'
       ) AS "canMarkRead"`,
  );
  if (
    callable.rows[0]?.canStart !== true
    || callable.rows[0]?.canSend !== true
    || callable.rows[0]?.canList !== true
    || callable.rows[0]?.canMarkRead !== true
  ) {
    throw new Error("runtime authority function grants drifted");
  }
}

async function assertCanaryIsEmpty(owner, canaryId) {
  const counts = await owner.query(
    `SELECT
       (SELECT pg_catalog.count(*)::integer
          FROM public."Conversation" AS conversation
         WHERE $1 IN (conversation."userAId", conversation."userBId")) AS conversations,
       (SELECT pg_catalog.count(*)::integer
          FROM public."Message" AS message
         WHERE $1 IN (message."senderId", message."recipientId")) AS messages`,
    [canaryId],
  );
  if (
    counts.rows[0]?.conversations !== 0
    || counts.rows[0]?.messages !== 0
  ) {
    throw new Error("operational canary unexpectedly has message activity");
  }
}

async function seedFixture(owner, runtime, canaryId, fixture, setStage) {
  setStage("seed-synthetic-users");
  await owner.query("BEGIN");
  try {
    const inserted = await owner.query(
      `INSERT INTO public."User" (
         id, "clerkId", email, name,
         "termsAcceptedAt", "termsVersion", "ageAttestedAt",
         "createdAt", "updatedAt"
       )
       SELECT source.id, source."clerkId", source.email, source.name,
              pg_catalog.timezone('UTC', pg_catalog.clock_timestamp()),
              '2026-06-14',
              pg_catalog.timezone('UTC', pg_catalog.clock_timestamp()),
              pg_catalog.timezone('UTC', pg_catalog.clock_timestamp()),
              pg_catalog.timezone('UTC', pg_catalog.clock_timestamp())
         FROM unnest(
           $1::text[], $2::text[], $3::text[], $4::text[]
         ) AS source(id, "clerkId", email, name)
       RETURNING id`,
      [
        fixture.userIds,
        fixture.clerkIds,
        fixture.emails,
        ["Compatibility Peer", "Foreign A", "Foreign B"],
      ],
    );
    if (inserted.rowCount !== 3) throw new Error("synthetic user seed count drifted");
    await owner.query("COMMIT");
  } catch (error) {
    await owner.query("ROLLBACK").catch(() => {});
    throw error;
  }

  setStage("seed-own-conversation");
  const startOwn = await runtime.query(
    `SELECT * FROM public.grainline_conversation_start($1, $2, $3, NULL)`,
    [fixture.conversationIds[0], canaryId, fixture.userIds[0]],
  );
  setStage("seed-foreign-conversation");
  const startForeign = await runtime.query(
    `SELECT * FROM public.grainline_conversation_start($1, $2, $3, NULL)`,
    [fixture.conversationIds[1], fixture.userIds[1], fixture.userIds[2]],
  );
  if (
    startOwn.rowCount !== 1
    || startOwn.rows[0]?.conversationId !== fixture.conversationIds[0]
    || startOwn.rows[0]?.created !== true
    || startForeign.rowCount !== 1
    || startForeign.rows[0]?.conversationId !== fixture.conversationIds[1]
    || startForeign.rows[0]?.created !== true
  ) {
    throw new Error("synthetic conversation seed drifted");
  }

  setStage("seed-messages");
  const sends = [
    [fixture.messageIds[0], canaryId, fixture.conversationIds[0], fixture.markers.outgoing],
    [fixture.messageIds[1], fixture.userIds[0], fixture.conversationIds[0], fixture.markers.incoming],
    [fixture.messageIds[2], fixture.userIds[1], fixture.conversationIds[1], fixture.markers.foreign],
  ];
  for (const [messageId, actorId, conversationId, body] of sends) {
    const sent = await runtime.query(
      `SELECT * FROM public.grainline_message_send_ordinary(
         $1, $2, $3, $4, NULL, NULL
       )`,
      [messageId, actorId, conversationId, body],
    );
    if (sent.rowCount !== 1 || sent.rows[0]?.messageId !== messageId) {
      throw new Error("synthetic message seed drifted");
    }
  }
}

async function assertActivatedRuntimeBoundary(runtime, canaryId, fixture) {
  if (!ACTIVATED) return;

  const context = await runtime.query(
    `SELECT pg_catalog.current_setting('app.user_id', true) AS "userId"`,
  );
  if (![null, ""].includes(context.rows[0]?.userId ?? null)) {
    throw new Error("pooled runtime retained unexpected app.user_id context");
  }

  const directRows = await runtime.query(
    `SELECT
       (SELECT pg_catalog.count(*)::integer
          FROM public."Conversation"
         WHERE id = ANY($1::text[])) AS conversations,
       (SELECT pg_catalog.count(*)::integer
          FROM public."Message"
         WHERE id = ANY($2::text[])) AS messages`,
    [fixture.conversationIds, fixture.messageIds],
  );
  if (
    directRows.rows[0]?.conversations !== 0
    || directRows.rows[0]?.messages !== 0
  ) {
    throw new Error("pooled runtime without user context crossed participant RLS");
  }

  const deniedConversationId = `${fixture.conversationIds[0]}-direct-denial`;
  const probes = [
    {
      label: "insert",
      sql: `INSERT INTO public."Conversation" (
              id, "userAId", "userBId", "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, $3,
              pg_catalog.timezone('UTC', pg_catalog.clock_timestamp()),
              pg_catalog.timezone('UTC', pg_catalog.clock_timestamp())
            )`,
      values: [deniedConversationId, canaryId, fixture.userIds[0]],
    },
    {
      label: "update",
      sql: `UPDATE public."Conversation"
               SET "updatedAt" =
                 pg_catalog.timezone('UTC', pg_catalog.clock_timestamp())
             WHERE id = $1`,
      values: [fixture.conversationIds[0]],
    },
    {
      label: "delete",
      sql: `DELETE FROM public."Message" WHERE id = $1`,
      values: [fixture.messageIds[0]],
    },
  ];
  for (const probe of probes) {
    await runtime.query("BEGIN");
    let caught;
    try {
      await runtime.query(probe.sql, probe.values);
    } catch (error) {
      caught = error;
    } finally {
      await runtime.query("ROLLBACK").catch(() => {});
    }
    if (caught?.code !== "42501") {
      throw new Error(
        `pooled runtime direct ${probe.label} did not fail with insufficient_privilege`,
      );
    }
  }
}

async function cleanupFixture(owner, state, { allowPartial = false } = {}) {
  await owner.query("BEGIN");
  try {
    const messages = await owner.query(
      `DELETE FROM public."Message"
        WHERE id = ANY($1::text[])`,
      [state.fixture.messageIds],
    );
    const conversations = await owner.query(
      `DELETE FROM public."Conversation"
        WHERE id = ANY($1::text[])`,
      [state.fixture.conversationIds],
    );
    const users = await owner.query(
      `DELETE FROM public."User"
        WHERE id = ANY($1::text[])`,
      [state.fixture.userIds],
    );
    const exactCounts = messages.rowCount === state.fixture.messageIds.length
      && conversations.rowCount === state.fixture.conversationIds.length
      && users.rowCount === state.fixture.userIds.length;
    const boundedPartialCounts = messages.rowCount <= state.fixture.messageIds.length
      && conversations.rowCount <= state.fixture.conversationIds.length
      && users.rowCount <= state.fixture.userIds.length;
    if ((!allowPartial && !exactCounts) || (allowPartial && !boundedPartialCounts)) {
      throw new Error("exact fixture cleanup count drifted");
    }
    const residue = await owner.query(
      `SELECT
         (SELECT pg_catalog.count(*)::integer
            FROM public."Message" WHERE id = ANY($1::text[])) AS messages,
         (SELECT pg_catalog.count(*)::integer
            FROM public."Conversation" WHERE id = ANY($2::text[])) AS conversations,
         (SELECT pg_catalog.count(*)::integer
            FROM public."User" WHERE id = ANY($3::text[])) AS users`,
      [
        state.fixture.messageIds,
        state.fixture.conversationIds,
        state.fixture.userIds,
      ],
    );
    if (
      residue.rows[0]?.messages !== 0
      || residue.rows[0]?.conversations !== 0
      || residue.rows[0]?.users !== 0
    ) {
      throw new Error("synthetic fixture residue remained");
    }
    await owner.query("COMMIT");
  } catch (error) {
    await owner.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function clearOperationalCacheAndRateLimits(environment, canary) {
  const redis = new Redis({
    url: environment.redisUrl,
    token: environment.redisToken,
  });
  const accountKey = `account-state:vercel-production:clerk:${canary.clerkUser.id}`;
  await redis.del(accountKey);
  const messageList = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(240, "60 m"),
    prefix: "rl:message_list",
  });
  const markRead = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(60, "60 m"),
    prefix: "rl:mark_read",
  });
  await Promise.all([
    messageList.resetUsedTokens(canary.clerkUser.id),
    markRead.resetUsedTokens(`message:${canary.localUser.id}`),
  ]);
}

async function createCanarySession(clerk, canary, persistRecoveryState) {
  const active = await clerk.sessions.getSessionList({
    limit: 100,
    status: "active",
    userId: canary.clerkUser.id,
  });
  if (active.totalCount !== 0 || active.data.length !== 0) {
    throw new Error("operational canary has a pre-existing active session");
  }
  const signInToken = await clerk.signInTokens.createSignInToken({
    expiresInSeconds: 60,
    userId: canary.clerkUser.id,
  });
  if (
    !/^sit_[A-Za-z0-9]+$/.test(String(signInToken?.id ?? ""))
    || signInToken.userId !== canary.clerkUser.id
    || typeof signInToken.token !== "string"
    || signInToken.token.length < 32
    || signInToken.token.length > 4_096
  ) {
    throw new Error("Clerk did not create the expected bounded sign-in token");
  }
  persistRecoveryState({
    signInTokenId: signInToken.id,
    signInTokenConsumed: false,
  });
  const cookies = new Map();
  const clientResponse = await fetch(`https://${CLERK_FRONTEND_API}/v1/client`, {
    body: "",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: DEPLOYMENT_URL,
    },
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  absorbClerkResponseCookies(clientResponse, cookies);
  const clientPayload = await boundedJson(clientResponse);
  if (
    clientResponse.status !== 200
    || (clientPayload.response ?? clientPayload).object !== "client"
  ) {
    throw new Error("Clerk client handshake failed");
  }
  const exchangeResponse = await fetch(
    `https://${CLERK_FRONTEND_API}/v1/client/sign_ins`,
    {
      body: new URLSearchParams({ strategy: "ticket", ticket: signInToken.token }),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: clerkCookieHeader(cookies),
        origin: DEPLOYMENT_URL,
      },
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    },
  );
  absorbClerkResponseCookies(exchangeResponse, cookies);
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
    throw new Error("Clerk ticket exchange did not complete");
  }
  persistRecoveryState({
    sessionId,
    signInTokenConsumed: true,
  });
  const session = await clerk.sessions.getSession(sessionId);
  if (session.userId !== canary.clerkUser.id || session.status !== "active") {
    throw new Error("Clerk session identity drifted");
  }
  const token = await clerk.sessions.getToken(sessionId, undefined, 300);
  if (typeof token?.jwt !== "string" || token.jwt.split(".").length !== 3) {
    throw new Error("Clerk did not return a bounded session token");
  }
  return {
    jwt: token.jwt,
    sessionId,
    signInTokenId: signInToken.id,
  };
}

async function revokeCanarySession(clerk, canary, state) {
  let sessionRevoked = true;
  let signInTokenDisposed = true;
  if (canary) {
    try {
      const active = await clerk.sessions.getSessionList({
        limit: 100,
        status: "active",
        userId: canary.clerkUser.id,
      });
      for (const session of active.data) {
        const revoked = await clerk.sessions.revokeSession(session.id);
        if (revoked?.id !== session.id || revoked?.status !== "revoked") {
          sessionRevoked = false;
        }
      }
      const after = await clerk.sessions.getSessionList({
        limit: 100,
        status: "active",
        userId: canary.clerkUser.id,
      });
      sessionRevoked = sessionRevoked
        && after.totalCount === 0
        && after.data.length === 0;
    } catch {
      sessionRevoked = false;
    }
  }
  if (state.signInTokenId && !state.signInTokenConsumed) {
    try {
      const revoked = await clerk.signInTokens.revokeSignInToken(state.signInTokenId);
      signInTokenDisposed = revoked?.id === state.signInTokenId
        && revoked?.status === "revoked";
    } catch {
      signInTokenDisposed = false;
    }
  }
  return { sessionRevoked, signInTokenDisposed };
}

async function exerciseRoutes(token, fixture, setStage) {
  const ownConversationId = encodeURIComponent(fixture.conversationIds[0]);
  const foreignConversationId = encodeURIComponent(fixture.conversationIds[1]);
  setStage("route-unauthenticated-list");
  const unauthenticated = await fetchJson(`/api/messages/${ownConversationId}/list`);
  if (
    unauthenticated.status !== 401
    || unauthenticated.body.error !== "Unauthorized"
    || Object.hasOwn(unauthenticated.body, "ok")
  ) {
    throw new Error("unauthenticated message list did not deny access");
  }

  setStage("route-unread-before");
  const unreadBefore = await fetchJson("/api/messages/unread-count", { token });
  if (unreadBefore.status !== 200 || unreadBefore.body.count !== 1) {
    throw new Error("authenticated unread count drifted");
  }

  setStage("route-own-list");
  const ownList = await fetchJson(`/api/messages/${ownConversationId}/list`, { token });
  const ownIds = Array.isArray(ownList.body.messages)
    ? ownList.body.messages.map((message) => message?.id)
    : [];
  const ownBody = JSON.stringify(ownList.body);
  if (
    ownList.status !== 200
    || ownList.body.ok !== true
    || ownIds.length !== 2
    || !fixture.messageIds.slice(0, 2).every((id) => ownIds.includes(id))
    || ownIds.includes(fixture.messageIds[2])
    || !ownBody.includes(fixture.markers.incoming)
    || !ownBody.includes(fixture.markers.outgoing)
    || ownBody.includes(fixture.markers.foreign)
  ) {
    throw new Error("authenticated message list failed participant isolation");
  }

  setStage("route-foreign-list");
  const foreignList = await fetchJson(`/api/messages/${foreignConversationId}/list`, { token });
  if (foreignList.status !== 403 || foreignList.body.ok !== false) {
    throw new Error("foreign message list did not deny access");
  }

  setStage("route-invalid-cursor");
  const invalidCursor = await fetchJson(
    `/api/messages/${ownConversationId}/list?before=bad&beforeId=bad`,
    { token },
  );
  if (invalidCursor.status !== 400 || invalidCursor.body.error !== "Invalid message cursor") {
    throw new Error("message cursor validation drifted");
  }

  setStage("route-inbox-page");
  const inbox = await fetchPage("/messages", token);
  if (
    inbox.status !== 200
    || !inbox.body.includes(fixture.markers.incoming)
    || inbox.body.includes(fixture.markers.foreign)
  ) {
    throw new Error("authenticated inbox failed participant isolation");
  }

  setStage("route-own-thread-page");
  const thread = await fetchPage(`/messages/${ownConversationId}`, token);
  if (
    thread.status !== 200
    || !thread.body.includes(fixture.markers.incoming)
    || !thread.body.includes(fixture.markers.outgoing)
    || thread.body.includes(fixture.markers.foreign)
  ) {
    throw new Error("authenticated thread page failed participant isolation");
  }

  setStage("route-foreign-thread-page");
  const foreignThread = await fetchPage(`/messages/${foreignConversationId}`, token);
  if (
    ![200, 404].includes(foreignThread.status)
    || !foreignThread.body.includes("Looks like this page got sanded down.")
    || foreignThread.body.includes(fixture.markers.incoming)
    || foreignThread.body.includes(fixture.markers.outgoing)
    || foreignThread.body.includes(fixture.markers.foreign)
  ) {
    throw new Error("foreign thread page did not render an isolated not-found result");
  }

  setStage("route-cross-origin-read");
  const crossOriginRead = await fetchJson(`/api/messages/${ownConversationId}/read`, {
    method: "POST",
    origin: "https://example.invalid",
    token,
  });
  if (crossOriginRead.status !== 403 || crossOriginRead.body.error !== "Forbidden") {
    throw new Error("message read mutation did not reject cross-origin POST");
  }

  setStage("route-own-read");
  const ownRead = await fetchJson(`/api/messages/${ownConversationId}/read`, {
    method: "POST",
    origin: DEPLOYMENT_URL,
    token,
  });
  if (ownRead.status !== 200 || ownRead.body.ok !== true) {
    throw new Error("own message read mutation failed");
  }

  setStage("route-unread-after");
  const unreadAfter = await fetchJson("/api/messages/unread-count", { token });
  if (unreadAfter.status !== 200 || unreadAfter.body.count !== 0) {
    throw new Error("post-read unread count drifted");
  }

  return {
    authenticatedInboxStatus: inbox.status,
    authenticatedThreadStatus: thread.status,
    crossOriginStatus: crossOriginRead.status,
    foreignListStatus: foreignList.status,
    foreignThreadStatus: foreignThread.status,
    initialUnreadCount: unreadBefore.body.count,
    invalidCursorStatus: invalidCursor.status,
    ownListRows: ownIds.length,
    ownReadStatus: ownRead.status,
    finalUnreadCount: unreadAfter.body.count,
    unauthenticatedStatus: unauthenticated.status,
  };
}

async function verifyDatabasePostcondition(owner, canaryId, fixture) {
  const messages = await owner.query(
    `SELECT id, "senderId", "recipientId", "readAt"
       FROM public."Message"
      WHERE id = ANY($1::text[])
      ORDER BY id`,
    [fixture.messageIds],
  );
  const byId = new Map(messages.rows.map((message) => [message.id, message]));
  if (
    messages.rowCount !== 3
    || byId.get(fixture.messageIds[0])?.senderId !== canaryId
    || byId.get(fixture.messageIds[1])?.recipientId !== canaryId
    || !byId.get(fixture.messageIds[1])?.readAt
    || byId.get(fixture.messageIds[2])?.readAt !== null
  ) {
    throw new Error("message database postcondition drifted");
  }
  const notificationCount = await owner.query(
    `SELECT pg_catalog.count(*)::integer AS count
       FROM public."Notification"
      WHERE "sourceId" = ANY($1::text[])`,
    [fixture.messageIds],
  );
  if (notificationCount.rows[0]?.count !== 0) {
    throw new Error("direct postflight fixture unexpectedly created notifications");
  }
}

async function cleanupOnly() {
  if (!existsSync(RECOVERY_PATH)) {
    throw new Error(`no ${POSTFLIGHT_SLUG}-postflight recovery state exists`);
  }
  const environment = loadEnvironment();
  const state = readPrivateJson(
    RECOVERY_PATH,
    `${POSTFLIGHT_SLUG}-postflight recovery state`,
  );
  if (
    state.releaseCommit !== RELEASE_COMMIT
    || state.deploymentId !== DEPLOYMENT_ID
    || !Array.isArray(state.fixture?.userIds)
    || state.fixture.userIds.length !== 3
    || !Array.isArray(state.fixture?.conversationIds)
    || state.fixture.conversationIds.length !== 2
    || !Array.isArray(state.fixture?.messageIds)
    || state.fixture.messageIds.length !== 3
  ) {
    throw new Error(`${POSTFLIGHT_SLUG}-postflight recovery state drifted`);
  }
  const owner = new Client({ connectionString: environment.ownerDatabaseUrl });
  const clerk = createClerkClient({ secretKey: environment.clerkSecretKey });
  try {
    await owner.connect();
    await cleanupFixture(owner, state, { allowPartial: true });
    const canary = await exactCanary(clerk, owner);
    const sessionCleanup = await revokeCanarySession(clerk, canary, state);
    await clearOperationalCacheAndRateLimits(environment, canary);
    if (!sessionCleanup.sessionRevoked || !sessionCleanup.signInTokenDisposed) {
      throw new Error("Clerk cleanup did not confirm disposal");
    }
    unlinkSync(RECOVERY_PATH);
  } finally {
    await owner.end().catch(() => {});
  }
  console.log(JSON.stringify({
    cleanup: "passed",
    fixtureRowsDeleted: true,
    clerkSessionRevoked: true,
    rateLimitCountersReset: true,
  }));
}

async function main() {
  const args = process.argv.slice(2);
  if (POST_ACTIVATION && POST_FORCE) {
    throw new Error("--post-activation and --post-force are mutually exclusive");
  }
  const cleanupRequested = args.includes(CLEANUP_FLAG);
  const expectedArgs = [
    ...(cleanupRequested ? [CLEANUP_FLAG] : []),
    ...(MODE_FLAG ? [MODE_FLAG] : []),
  ].sort();
  if (
    args.length !== expectedArgs.length
    || [...args].sort().some((argument, index) => argument !== expectedArgs[index])
  ) {
    throw new Error(
      "Usage: node scripts/conversation-message-compatibility-production-postflight.mjs [--cleanup] [--post-activation|--post-force]",
    );
  }
  if (cleanupRequested) {
    await cleanupOnly();
    return;
  }
  if (existsSync(RECOVERY_PATH)) {
    throw new Error(
      `recovery state exists; run the exact --cleanup${
        MODE_FLAG ? ` ${MODE_FLAG}` : ""
      } command first`,
    );
  }

  const operatorCommit = exactCleanOperatorHead();
  const evidencePath = path.join(
    EVIDENCE_DIRECTORY,
    `conversation-message-${POSTFLIGHT_SLUG}-postflight-${RELEASE_COMMIT.slice(0, 12)}-${operatorCommit.slice(0, 12)}.json`,
  );
  if (existsSync(evidencePath)) {
    throw new Error(
      `${POSTFLIGHT_SLUG}-postflight evidence already exists for this operator commit`,
    );
  }
  await verifyProductionDeployment();
  const environment = loadEnvironment();
  const owner = new Client({ connectionString: environment.ownerDatabaseUrl });
  const runtime = new Client({ connectionString: environment.runtimeDatabaseUrl });
  const clerk = createClerkClient({ secretKey: environment.clerkSecretKey });
  const fixture = newFixture();
  let stage = "connect-database";
  let state = {
    releaseCommit: RELEASE_COMMIT,
    deploymentId: DEPLOYMENT_ID,
    fixture,
    sessionId: null,
    signInTokenId: null,
    signInTokenConsumed: false,
  };
  let fixtureRowsDeleted = false;
  let sessionRevoked = false;
  let signInTokenDisposed = false;
  let accountStateCacheKeyDeleted = false;
  let rateLimitCountersReset = false;
  let result = null;
  let primaryFailure = null;
  let canary = null;
  let fixtureSeeded = false;

  writePrivateJson(RECOVERY_PATH, state);
  try {
    await owner.connect();
    await runtime.connect();
    stage = "verify-production-posture";
    await assertDatabasePosture(owner, runtime);
    canary = await exactCanary(clerk, owner);
    await assertCanaryIsEmpty(owner, canary.localUser.id);
    await clearOperationalCacheAndRateLimits(environment, canary);

    await seedFixture(owner, runtime, canary.localUser.id, fixture, (nextStage) => {
      stage = nextStage;
    });
    fixtureSeeded = true;

    stage = POST_FORCE
      ? "verify-post-force-runtime-boundary"
      : "verify-post-activation-runtime-boundary";
    await assertActivatedRuntimeBoundary(
      runtime,
      canary.localUser.id,
      fixture,
    );

    stage = "create-clerk-session";
    const session = await createCanarySession(clerk, canary, (patch) => {
      state = { ...state, ...patch };
      replacePrivateJson(RECOVERY_PATH, state);
    });

    stage = "exercise-authenticated-routes";
    result = await exerciseRoutes(session.jwt, fixture, (nextStage) => {
      stage = nextStage;
    });

    stage = "verify-database-postcondition";
    await verifyDatabasePostcondition(owner, canary.localUser.id, fixture);
  } catch (error) {
    primaryFailure = error;
  } finally {
    if (canary) {
      const sessionCleanup = await revokeCanarySession(clerk, canary, state);
      sessionRevoked = sessionCleanup.sessionRevoked;
      signInTokenDisposed = sessionCleanup.signInTokenDisposed;
    } else {
      sessionRevoked = state.sessionId === null;
      signInTokenDisposed = state.signInTokenId === null;
    }
    if (fixtureSeeded) {
      try {
        await cleanupFixture(owner, state);
        fixtureRowsDeleted = true;
      } catch {
        fixtureRowsDeleted = false;
      }
    } else {
      try {
        const partial = await owner.query(
          `SELECT
             (SELECT pg_catalog.count(*)::integer
                FROM public."Message" WHERE id = ANY($1::text[])) AS messages,
             (SELECT pg_catalog.count(*)::integer
                FROM public."Conversation" WHERE id = ANY($2::text[])) AS conversations,
             (SELECT pg_catalog.count(*)::integer
                FROM public."User" WHERE id = ANY($3::text[])) AS users`,
          [fixture.messageIds, fixture.conversationIds, fixture.userIds],
        );
        const hasPartial = partial.rows[0]?.messages > 0
          || partial.rows[0]?.conversations > 0
          || partial.rows[0]?.users > 0;
        if (hasPartial) {
          await cleanupFixture(owner, state, { allowPartial: true });
        }
        fixtureRowsDeleted = true;
      } catch {
        fixtureRowsDeleted = false;
      }
    }
    if (canary) {
      try {
        await clearOperationalCacheAndRateLimits(environment, canary);
        accountStateCacheKeyDeleted = true;
        rateLimitCountersReset = true;
      } catch {
        accountStateCacheKeyDeleted = false;
        rateLimitCountersReset = false;
      }
    }
    await runtime.end().catch(() => {});
    await owner.end().catch(() => {});
  }

  const status = !primaryFailure
    && fixtureRowsDeleted
    && sessionRevoked
    && signInTokenDisposed
    && accountStateCacheKeyDeleted
    && rateLimitCountersReset
    ? "passed"
    : "failed";
  const evidence = {
    generatedAt: new Date().toISOString(),
    scope: POST_FORCE
      ? "conversation-message-force-rls-postflight"
      : POST_ACTIVATION
        ? "conversation-message-initial-rls-activation-postflight"
        : "conversation-message-rls-off-compatibility-postflight",
    status,
    operatorCommit,
    releaseCommit: RELEASE_COMMIT,
    migrationRunId: MIGRATION_RUN_ID,
    deploymentId: DEPLOYMENT_ID,
    database: {
      endpointId: DATABASE_ENDPOINT_ID,
      name: DATABASE_NAME,
      runtimeRole: RUNTIME_ROLE,
      migrationName: POST_FORCE ? POST_FORCE_MIGRATION_NAME : null,
      migrationSha256: POST_FORCE ? POST_FORCE_MIGRATION_SHA256 : null,
      rlsEnabled: ACTIVATED,
      rlsForced: POST_FORCE,
      policyCount: ACTIVATED ? 2 : 0,
      directTablePrivileges: ACTIVATED
        ? ["SELECT"]
        : ["SELECT", "INSERT", "UPDATE", "DELETE"],
      legacyTableCrudRetained: !ACTIVATED,
    },
    identity: {
      operationalCanaryReused: Boolean(canary),
      newClerkUserCreated: false,
      retainedIdentifier: false,
    },
    result,
    cleanup: {
      accountStateCacheKeyDeleted,
      clerkSessionRevoked: sessionRevoked,
      clerkSignInTokenConsumedOrRevoked: signInTokenDisposed,
      fixtureConversationRowsDeleted: fixtureRowsDeleted,
      fixtureMessageRowsDeleted: fixtureRowsDeleted,
      fixtureUserRowsDeleted: fixtureRowsDeleted,
      rateLimitCountersReset,
      standardRateLimitAnalyticsRetentionUnchanged: true,
    },
    directSideEffects: {
      emailsSent: 0,
      notificationsCreated: 0,
    },
    failureStage: status === "failed" ? stage : null,
    failureSqlstate: status === "failed"
      && /^[0-9A-Z]{5}$/.test(String(primaryFailure?.code ?? ""))
      ? primaryFailure.code
      : null,
    secretsRetained: false,
  };
  const serialized = JSON.stringify(evidence);
  for (const sensitive of [
    environment.ownerDatabaseUrl,
    environment.runtimeDatabaseUrl,
    environment.clerkSecretKey,
    environment.redisToken,
    canary?.localUser.id,
    canary?.clerkUser.id,
    fixture.nonce,
    ...fixture.userIds,
    ...fixture.clerkIds,
    ...fixture.emails,
    ...fixture.conversationIds,
    ...fixture.messageIds,
    ...Object.values(fixture.markers),
  ]) {
    if (sensitive && serialized.includes(sensitive)) {
      throw new Error("postflight evidence retained a secret or synthetic identifier");
    }
  }
  writePrivateJson(evidencePath, evidence);
  if (status === "passed") {
    unlinkSync(RECOVERY_PATH);
  }
  if (status !== "passed") {
    throw new Error(
      `${POSTFLIGHT_SLUG} postflight failed closed at ${stage}; private recovery state is retained`,
      { cause: primaryFailure },
    );
  }
  console.log(JSON.stringify({
    postflight: POST_FORCE
      ? "force-passed"
      : POST_ACTIVATION
        ? "activation-passed"
        : "compatibility-passed",
    authenticatedRoutesProved: true,
    pooledRuntimeDirectWritesDenied: ACTIVATED,
    pooledRuntimeNoContextRows: ACTIVATED ? 0 : null,
    fixtureRowsDeleted: true,
    clerkSessionRevoked: true,
    notificationsCreated: 0,
    emailsSent: 0,
    rlsEnabled: ACTIVATED,
    rlsForced: POST_FORCE,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "message postflight failed");
  process.exitCode = 1;
});
