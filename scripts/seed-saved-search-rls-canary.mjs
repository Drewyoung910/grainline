#!/usr/bin/env node
import { chmodSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;

export const CANARY_SEED_CONFIRMATION = "reviewed-permanent-canary";
const RUNTIME_ROLE = "grainline_app_runtime";
const USER_ID_PATTERN = /^rls-saved-search-canary-([a-f0-9]{12,32})-user$/;
const SEARCH_ID_PATTERN = /^rls-saved-search-canary-([a-f0-9]{12,32})-search$/;
const CONNECTION_TIMEOUT_MS = 10_000;
const QUERY_TIMEOUT_MS = 35_000;
const STATEMENT_TIMEOUT_MS = 30_000;

function required(value, name) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseNeonIdentity(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL URL`);
  }
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) {
    throw new Error(`${label} must use PostgreSQL`);
  }
  const parts = parsed.hostname.toLowerCase().split(".");
  const endpointLabel = parts[0] ?? "";
  const pooled = endpointLabel.endsWith("-pooler");
  const endpointId = pooled
    ? endpointLabel.slice(0, -"-pooler".length)
    : endpointLabel;
  if (!/^ep-[a-z0-9-]+$/.test(endpointId) || !parsed.hostname.endsWith(".neon.tech")) {
    throw new Error(`${label} must identify a Neon endpoint`);
  }
  const region = parts.slice(1, -2).join(".");
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  const username = decodeURIComponent(parsed.username);
  if (!region || !databaseName || databaseName.includes("/") || !username) {
    throw new Error(`${label} has an invalid Neon database identity`);
  }
  return {
    databaseName,
    endpointId,
    pooled,
    region,
    username,
  };
}

function validateCanaryPair(userId, searchId) {
  const userMatch = USER_ID_PATTERN.exec(userId);
  const searchMatch = SEARCH_ID_PATTERN.exec(searchId);
  if (
    !userMatch
    || !searchMatch
    || userMatch[1] !== searchMatch[1]
    || userId !== userId.trim()
    || searchId !== searchId.trim()
  ) {
    throw new Error("SavedSearch RLS canary ids must be one matching synthetic pair");
  }
  return userMatch[1];
}

export function parseCanarySeedConfig(env = process.env) {
  if (env.SAVED_SEARCH_RLS_CANARY_SEED_CONFIRM !== CANARY_SEED_CONFIRMATION) {
    throw new Error(
      `SAVED_SEARCH_RLS_CANARY_SEED_CONFIRM=${CANARY_SEED_CONFIRMATION} is required`,
    );
  }
  const runtimeDatabaseUrl = required(
    env.SAVED_SEARCH_RLS_CANARY_SEED_DATABASE_URL,
    "SAVED_SEARCH_RLS_CANARY_SEED_DATABASE_URL",
  );
  const adminDatabaseUrl = required(
    env.SAVED_SEARCH_RLS_CANARY_SEED_ADMIN_DATABASE_URL,
    "SAVED_SEARCH_RLS_CANARY_SEED_ADMIN_DATABASE_URL",
  );
  const expectedEndpointId = required(
    env.SAVED_SEARCH_RLS_CANARY_SEED_EXPECTED_DATABASE_ENDPOINT_ID,
    "SAVED_SEARCH_RLS_CANARY_SEED_EXPECTED_DATABASE_ENDPOINT_ID",
  );
  const expectedDatabaseName = required(
    env.SAVED_SEARCH_RLS_CANARY_SEED_EXPECTED_DATABASE_NAME,
    "SAVED_SEARCH_RLS_CANARY_SEED_EXPECTED_DATABASE_NAME",
  );
  const expectedRegion = required(
    env.SAVED_SEARCH_RLS_CANARY_SEED_EXPECTED_DATABASE_REGION,
    "SAVED_SEARCH_RLS_CANARY_SEED_EXPECTED_DATABASE_REGION",
  );
  const evidencePath = required(
    env.SAVED_SEARCH_RLS_CANARY_SEED_EVIDENCE_PATH,
    "SAVED_SEARCH_RLS_CANARY_SEED_EVIDENCE_PATH",
  );
  const userId = required(
    env.SAVED_SEARCH_RLS_CANARY_USER_ID,
    "SAVED_SEARCH_RLS_CANARY_USER_ID",
  );
  const searchId = required(
    env.SAVED_SEARCH_RLS_CANARY_SEARCH_ID,
    "SAVED_SEARCH_RLS_CANARY_SEARCH_ID",
  );
  const nonce = validateCanaryPair(userId, searchId);
  const runtime = parseNeonIdentity(runtimeDatabaseUrl, "runtime database URL");
  const admin = parseNeonIdentity(adminDatabaseUrl, "admin database URL");
  for (const [label, identity] of [["runtime", runtime], ["admin", admin]]) {
    if (
      identity.endpointId !== expectedEndpointId
      || identity.databaseName !== expectedDatabaseName
      || identity.region !== expectedRegion
    ) {
      throw new Error(`${label} database identity does not match the reviewed target`);
    }
  }
  if (!runtime.pooled || admin.pooled) {
    throw new Error("canary seed requires a pooled runtime URL and direct admin URL");
  }
  if (runtime.username !== RUNTIME_ROLE || runtime.username === admin.username) {
    throw new Error("canary seed runtime/admin database roles are invalid");
  }
  if (evidencePath.includes("\0")) {
    throw new Error("canary seed evidence path contains a null byte");
  }
  return {
    adminDatabaseUrl,
    adminUsername: admin.username,
    clerkId: `rls-canary:${nonce}`,
    databaseName: expectedDatabaseName,
    email: `saved-search-rls-canary-${nonce}@example.invalid`,
    endpointId: expectedEndpointId,
    evidencePath,
    region: expectedRegion,
    runtimeDatabaseUrl,
    searchId,
    userId,
  };
}

function client(connectionString) {
  return new Client({
    application_name: "grainline-saved-search-rls-canary-seed",
    connectionString,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
  });
}

async function inspectIdentity(db, expectedUser, expectedDatabase) {
  const result = await db.query(
    `SELECT current_user AS current_user_name,
            session_user AS session_user_name,
            current_database() AS database_name`,
  );
  const row = result.rows[0];
  if (
    row?.current_user_name !== expectedUser
    || row?.session_user_name !== expectedUser
    || row?.database_name !== expectedDatabase
  ) {
    throw new Error("database connection identity mismatch");
  }
}

async function seedWithOwner(db, config) {
  await db.query("BEGIN");
  try {
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 71020260717))",
      [`grainline:saved-search-rls-canary:${config.userId}`],
    );
    const users = await db.query(
      `SELECT id, "clerkId", email, role::text AS role, banned, "deletedAt"
         FROM public."User"
        WHERE id = $1 OR "clerkId" = $2 OR email = $3
        FOR UPDATE`,
      [config.userId, config.clerkId, config.email],
    );
    if (users.rowCount > 1) throw new Error("synthetic canary User collision");
    if (users.rowCount === 0) {
      await db.query(
        `INSERT INTO public."User"
           (id, "clerkId", email, role, "createdAt", "updatedAt", banned,
            "bannedAt", "banReason")
         VALUES ($1, $2, $3, 'USER', now(), now(), true, now(),
                 'Permanent synthetic SavedSearch RLS canary')`,
        [config.userId, config.clerkId, config.email],
      );
    } else {
      const user = users.rows[0];
      if (
        user.id !== config.userId
        || user.clerkId !== config.clerkId
        || user.email !== config.email
        || user.role !== "USER"
        || user.banned !== true
        || user.deletedAt !== null
      ) {
        throw new Error("synthetic canary User collision");
      }
    }

    const searches = await db.query(
      `SELECT id, "userId", query, "notifyEmail"
         FROM public."SavedSearch"
        WHERE id = $1
        FOR UPDATE`,
      [config.searchId],
    );
    if (searches.rowCount === 0) {
      await db.query(
        `INSERT INTO public."SavedSearch"
           (id, "userId", query, tags, "notifyEmail", "createdAt")
         VALUES ($1, $2, '__grainline_rls_canary__', ARRAY[]::text[], false, now())`,
        [config.searchId, config.userId],
      );
    } else {
      const search = searches.rows[0];
      if (
        searches.rowCount !== 1
        || search.id !== config.searchId
        || search.userId !== config.userId
        || search.query !== "__grainline_rls_canary__"
        || search.notifyEmail !== false
      ) {
        throw new Error("synthetic canary SavedSearch collision");
      }
    }
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function verifyWithRuntime(db, config) {
  await db.query("BEGIN");
  try {
    const context = await db.query(
      "SELECT set_config('app.user_id', $1, true) AS user_id",
      [config.userId],
    );
    if (context.rows[0]?.user_id !== config.userId) {
      throw new Error("runtime canary context verification failed");
    }
    const result = await db.query(
      `SELECT id, "userId", query, "notifyEmail"
         FROM public."SavedSearch"
        WHERE id = $1 AND "userId" = $2`,
      [config.searchId, config.userId],
    );
    const row = result.rows[0];
    if (
      result.rowCount !== 1
      || row?.id !== config.searchId
      || row?.userId !== config.userId
      || row?.query !== "__grainline_rls_canary__"
      || row?.notifyEmail !== false
    ) {
      throw new Error("runtime canary row verification failed");
    }
    await db.query("COMMIT");
    const cleared = await db.query(
      "SELECT current_setting('app.user_id', true) AS user_id",
    );
    if ((cleared.rows[0]?.user_id ?? "") !== "") {
      throw new Error("runtime canary context leaked after commit");
    }
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

export async function seedAndVerifySavedSearchRlsCanary(config) {
  const admin = client(config.adminDatabaseUrl);
  const runtime = client(config.runtimeDatabaseUrl);
  let adminConnected = false;
  let runtimeConnected = false;
  try {
    await admin.connect();
    adminConnected = true;
    await runtime.connect();
    runtimeConnected = true;
    await inspectIdentity(admin, config.adminUsername, config.databaseName);
    await inspectIdentity(runtime, RUNTIME_ROLE, config.databaseName);
    await seedWithOwner(admin, config);
    await verifyWithRuntime(runtime, config);
    const catalog = await admin.query(
      `SELECT c.relrowsecurity AS rls_enabled,
              c.relforcerowsecurity AS rls_forced
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'SavedSearch'
          AND c.relkind IN ('r', 'p')`,
    );
    if (catalog.rowCount !== 1) throw new Error("SavedSearch catalog verification failed");
    return {
      rlsEnabled: catalog.rows[0].rls_enabled === true,
      rlsForced: catalog.rows[0].rls_forced === true,
      status: "healthy",
    };
  } finally {
    if (runtimeConnected) await runtime.end().catch(() => {});
    if (adminConnected) await admin.end().catch(() => {});
  }
}

export function writeCanarySeedEvidence(config, result, generatedAt) {
  const payload = {
    generatedAt,
    result: {
      issueCount: result.status === "healthy" ? 0 : 1,
      rlsEnabled: result.rlsEnabled,
      rlsForced: result.rlsForced,
      status: result.status,
    },
    target: {
      databaseName: config.databaseName,
      expectedDatabaseEndpointId: config.endpointId,
      expectedDatabaseRegion: config.region,
      runtimeRole: RUNTIME_ROLE,
    },
  };
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  writeFileSync(config.evidencePath, serialized, { encoding: "utf8", mode: 0o600 });
  chmodSync(config.evidencePath, 0o600);
  return payload;
}

export async function main(env = process.env, logger = console) {
  let config;
  try {
    config = parseCanarySeedConfig(env);
  } catch {
    logger.error("SavedSearch RLS canary seed configuration is invalid.");
    process.exitCode = 2;
    return { status: "configuration_error" };
  }
  try {
    const result = await seedAndVerifySavedSearchRlsCanary(config);
    const evidence = writeCanarySeedEvidence(
      config,
      result,
      new Date().toISOString(),
    );
    logger.log("SavedSearch RLS permanent canary is healthy.");
    return { evidence, status: "healthy" };
  } catch {
    writeCanarySeedEvidence(
      config,
      { rlsEnabled: false, rlsForced: false, status: "failed" },
      new Date().toISOString(),
    );
    logger.error("SavedSearch RLS permanent canary seed or verification failed.");
    process.exitCode = 1;
    return { status: "failed" };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
