#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { parseGuardedNeonDatabaseIdentity } from "./guard-saved-search-rls-deploy.mjs";
import {
  assertDeterministicPostgresEnvironment,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";

const { Client } = pg;

export const CONVERSATION_MESSAGE_LEGACY_INSPECTION_CONFIRMATION =
  "inspect-prelaunch-conversation-message-legacy-state";
export const CONVERSATION_MESSAGE_LEGACY_PREREQUISITE_CONFIRMATION =
  "notification-force-and-messaging-compatibility-migrations-passed";

const REVIEWED_TARGET = Object.freeze({
  endpointId: "ep-plain-river-aaqg8gj4",
  databaseName: "neondb",
  region: "westus3.azure",
  ownerRole: "neondb_owner",
  runtimeRole: "grainline_app_runtime",
});
const REVIEWED_MAIN_REF = "refs/heads/main";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function required(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${name} is required without surrounding whitespace`);
  }
  return value;
}

export function parseConversationMessageLegacyInspectionConfig(env = process.env) {
  assertDeterministicPostgresEnvironment(env, "Conversation/Message legacy inspection");
  if (
    env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_REF !== REVIEWED_MAIN_REF
  ) {
    throw new Error("Conversation/Message legacy inspection requires a manual main-branch GitHub Actions dispatch");
  }

  const releaseCommit = required(env, "CONVERSATION_MESSAGE_LEGACY_INSPECT_RELEASE_COMMIT");
  const githubCommit = required(env, "GITHUB_SHA");
  if (!COMMIT_PATTERN.test(releaseCommit) || releaseCommit !== githubCommit) {
    throw new Error("Conversation/Message legacy inspection commit must match the dispatched main commit");
  }
  if (
    env.CONVERSATION_MESSAGE_LEGACY_INSPECT_CONFIRM
      !== CONVERSATION_MESSAGE_LEGACY_INSPECTION_CONFIRMATION
  ) {
    throw new Error("Conversation/Message legacy inspection confirmation is not exact");
  }
  if (
    env.CONVERSATION_MESSAGE_LEGACY_PREREQUISITES_CONFIRMED
      !== CONVERSATION_MESSAGE_LEGACY_PREREQUISITE_CONFIRMATION
  ) {
    throw new Error("Conversation/Message legacy inspection prerequisites are not explicitly confirmed");
  }
  if (Object.hasOwn(env, "DATABASE_URL") || Object.hasOwn(env, "GRANT_AUDIT_DATABASE_URL")) {
    throw new Error("runtime and grant-audit URLs must remain absent from the owner-only inspection job");
  }

  const directUrl = required(env, "DIRECT_URL");
  const expectedDigest = required(env, "PRODUCTION_MIGRATION_DIRECT_URL_SHA256");
  const directUrlSha256 = createHash("sha256").update(directUrl, "utf8").digest("hex");
  if (!SHA256_PATTERN.test(expectedDigest) || expectedDigest !== directUrlSha256) {
    throw new Error("DIRECT_URL does not match the protected Production digest");
  }
  const migrationRole = required(env, "MIGRATION_DB_ROLE");
  const runtimeRole = required(env, "RUNTIME_DB_ROLE");
  const identity = parseGuardedNeonDatabaseIdentity(directUrl, "DIRECT_URL");
  if (
    identity.isPooler
    || identity.endpointId !== REVIEWED_TARGET.endpointId
    || identity.databaseName !== REVIEWED_TARGET.databaseName
    || identity.region !== REVIEWED_TARGET.region
    || identity.username !== REVIEWED_TARGET.ownerRole
    || migrationRole !== REVIEWED_TARGET.ownerRole
    || runtimeRole !== REVIEWED_TARGET.runtimeRole
  ) {
    throw new Error("DIRECT_URL is not the reviewed direct production owner target");
  }

  const runnerTemp = path.resolve(required(env, "RUNNER_TEMP"));
  const evidencePath = path.resolve(
    required(env, "CONVERSATION_MESSAGE_LEGACY_INSPECT_EVIDENCE_PATH"),
  );
  const expectedPath = path.join(
    runnerTemp,
    `conversation-message-legacy-inspection-${releaseCommit}.json`,
  );
  if (evidencePath !== expectedPath || existsSync(evidencePath)) {
    throw new Error("Conversation/Message evidence path is not the fresh reviewed runner path");
  }

  return Object.freeze({
    mode: "inspect",
    directUrl,
    directUrlSha256,
    evidencePath,
    identity,
    releaseCommit,
  });
}

export function readConversationMessageLegacyInspectionGitState(cwd = process.cwd()) {
  const run = (args) => execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return Object.freeze({
    head: run(["rev-parse", "HEAD"]),
    status: run(["status", "--porcelain=v1", "--untracked-files=all"]),
  });
}

export function assertConversationMessageLegacyInspectionGitState(state, releaseCommit) {
  if (state?.head !== releaseCommit || state.status !== "") {
    throw new Error("Conversation/Message legacy inspection checkout is not the exact clean dispatched commit");
  }
  return Object.freeze({ head: state.head, clean: true });
}

const COUNT_FIELDS = Object.freeze([
  "conversation_count",
  "self_conversation_count",
  "noncanonical_conversation_count",
  "duplicate_pair_group_count",
  "empty_conversation_count",
  "context_conversation_count",
  "archived_conversation_count",
  "invalid_conversation_time_count",
  "message_count",
  "invalid_message_pair_count",
  "self_message_count",
  "message_before_conversation_count",
  "message_after_conversation_update_count",
  "ordinary_message_count",
  "custom_request_count",
  "custom_link_count",
  "commission_interest_count",
  "unknown_kind_count",
  "user_authored_marked_system_count",
  "server_card_not_system_count",
  "message_listing_context_count",
  "invalid_message_listing_pair_count",
  "unresolved_thread_report_count",
  "orphan_unresolved_thread_report_count",
  "active_private_custom_listing_count",
  "invalid_private_custom_listing_pair_count",
]);

export function normalizeConversationMessageLegacyCounts(row) {
  const normalized = {};
  for (const field of COUNT_FIELDS) {
    const value = Number(row?.[field]);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError("Conversation/Message legacy inspection returned invalid aggregate counts");
    }
    normalized[field.replaceAll("_", " ").replace(/ (\w)/g, (_, c) => c.toUpperCase())] = value;
  }
  return Object.freeze(normalized);
}

async function readPosture(client) {
  const result = await client.query(`
    SELECT
      CURRENT_USER AS current_user,
      pg_catalog.current_database() AS database_name,
      owner_role.rolbypassrls AS owner_bypass_rls,
      runtime_role.rolbypassrls AS runtime_bypass_rls,
      runtime_role.rolsuper AS runtime_superuser,
      conversation.relrowsecurity AS conversation_rls_enabled,
      conversation.relforcerowsecurity AS conversation_rls_forced,
      message.relrowsecurity AS message_rls_enabled,
      message.relforcerowsecurity AS message_rls_forced,
      conversation_owner.rolname AS conversation_owner,
      message_owner.rolname AS message_owner,
      (SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_policy WHERE polrelid = conversation.oid) AS conversation_policy_count,
      (SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_policy WHERE polrelid = message.oid) AS message_policy_count,
      (
        pg_catalog.has_table_privilege('grainline_app_runtime', 'public."Conversation"', 'SELECT')
        AND pg_catalog.has_table_privilege('grainline_app_runtime', 'public."Conversation"', 'INSERT')
        AND pg_catalog.has_table_privilege('grainline_app_runtime', 'public."Conversation"', 'UPDATE')
        AND pg_catalog.has_table_privilege('grainline_app_runtime', 'public."Conversation"', 'DELETE')
      ) AS runtime_conversation_crud,
      (
        pg_catalog.has_table_privilege('grainline_app_runtime', 'public."Message"', 'SELECT')
        AND pg_catalog.has_table_privilege('grainline_app_runtime', 'public."Message"', 'INSERT')
        AND pg_catalog.has_table_privilege('grainline_app_runtime', 'public."Message"', 'UPDATE')
        AND pg_catalog.has_table_privilege('grainline_app_runtime', 'public."Message"', 'DELETE')
      ) AS runtime_message_crud,
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute
         WHERE attrelid = message.oid
           AND attname = 'contextListingId'
           AND attnum > 0
           AND NOT attisdropped
      ) AS message_context_column_present
    FROM pg_catalog.pg_class AS conversation
    JOIN pg_catalog.pg_namespace AS conversation_schema ON conversation_schema.oid = conversation.relnamespace
    JOIN pg_catalog.pg_roles AS conversation_owner ON conversation_owner.oid = conversation.relowner
    JOIN pg_catalog.pg_class AS message ON message.relname = 'Message'
    JOIN pg_catalog.pg_namespace AS message_schema ON message_schema.oid = message.relnamespace AND message_schema.nspname = 'public'
    JOIN pg_catalog.pg_roles AS message_owner ON message_owner.oid = message.relowner
    JOIN pg_catalog.pg_roles AS owner_role ON owner_role.rolname = 'neondb_owner'
    JOIN pg_catalog.pg_roles AS runtime_role ON runtime_role.rolname = 'grainline_app_runtime'
    WHERE conversation_schema.nspname = 'public'
      AND conversation.relname = 'Conversation'
      AND conversation.relkind = 'r'
      AND message.relkind = 'r'
  `);
  const row = result.rows[0];
  if (
    result.rows.length !== 1
    || row.current_user !== REVIEWED_TARGET.ownerRole
    || row.database_name !== REVIEWED_TARGET.databaseName
    || row.owner_bypass_rls !== true
    || row.runtime_bypass_rls !== false
    || row.runtime_superuser !== false
    || row.conversation_owner !== REVIEWED_TARGET.ownerRole
    || row.message_owner !== REVIEWED_TARGET.ownerRole
    || row.conversation_rls_enabled !== false
    || row.conversation_rls_forced !== false
    || row.message_rls_enabled !== false
    || row.message_rls_forced !== false
    || Number(row.conversation_policy_count) !== 0
    || Number(row.message_policy_count) !== 0
    || row.runtime_conversation_crud !== true
    || row.runtime_message_crud !== true
    || row.message_context_column_present !== true
  ) {
    throw new Error("Conversation/Message database posture is not the reviewed post-compatibility pre-RLS state");
  }
  return Object.freeze({
    currentUser: row.current_user,
    databaseName: row.database_name,
    tableOwner: row.conversation_owner,
    rlsEnabled: false,
    rlsForced: false,
    conversationPolicyCount: Number(row.conversation_policy_count),
    messagePolicyCount: Number(row.message_policy_count),
    legacyRuntimeCrudRetained: true,
    messageContextColumnPresent: true,
  });
}

async function readCounts(client) {
  const result = await client.query(`
    SELECT
      (SELECT pg_catalog.count(*) FROM public."Conversation") AS conversation_count,
      (SELECT pg_catalog.count(*) FROM public."Conversation" WHERE "userAId" = "userBId") AS self_conversation_count,
      (SELECT pg_catalog.count(*) FROM public."Conversation" WHERE "userAId" >= "userBId") AS noncanonical_conversation_count,
      (SELECT pg_catalog.count(*) FROM (
        SELECT LEAST("userAId", "userBId"), GREATEST("userAId", "userBId")
          FROM public."Conversation"
         GROUP BY 1, 2 HAVING pg_catalog.count(*) > 1
      ) AS duplicate_pair) AS duplicate_pair_group_count,
      (SELECT pg_catalog.count(*) FROM public."Conversation" AS c WHERE NOT EXISTS (
        SELECT 1 FROM public."Message" AS m WHERE m."conversationId" = c.id
      )) AS empty_conversation_count,
      (SELECT pg_catalog.count(*) FROM public."Conversation" WHERE "contextListingId" IS NOT NULL) AS context_conversation_count,
      (SELECT pg_catalog.count(*) FROM public."Conversation" WHERE "archivedAAt" IS NOT NULL OR "archivedBAt" IS NOT NULL) AS archived_conversation_count,
      (SELECT pg_catalog.count(*) FROM public."Conversation" WHERE "updatedAt" < "createdAt") AS invalid_conversation_time_count,
      (SELECT pg_catalog.count(*) FROM public."Message") AS message_count,
      (SELECT pg_catalog.count(*)
         FROM public."Message" AS m
         JOIN public."Conversation" AS c ON c.id = m."conversationId"
        WHERE NOT (
          (m."senderId" = c."userAId" AND m."recipientId" = c."userBId")
          OR (m."senderId" = c."userBId" AND m."recipientId" = c."userAId")
        )) AS invalid_message_pair_count,
      (SELECT pg_catalog.count(*) FROM public."Message" WHERE "senderId" = "recipientId") AS self_message_count,
      (SELECT pg_catalog.count(*) FROM public."Message" AS m JOIN public."Conversation" AS c ON c.id = m."conversationId" WHERE m."createdAt" < c."createdAt") AS message_before_conversation_count,
      (SELECT pg_catalog.count(*) FROM public."Message" AS m JOIN public."Conversation" AS c ON c.id = m."conversationId" WHERE m."createdAt" > c."updatedAt") AS message_after_conversation_update_count,
      (SELECT pg_catalog.count(*) FROM public."Message" WHERE kind IS NULL) AS ordinary_message_count,
      (SELECT pg_catalog.count(*) FROM public."Message" WHERE kind = 'custom_order_request') AS custom_request_count,
      (SELECT pg_catalog.count(*) FROM public."Message" WHERE kind = 'custom_order_link') AS custom_link_count,
      (SELECT pg_catalog.count(*) FROM public."Message" WHERE kind = 'commission_interest_card') AS commission_interest_count,
      (SELECT pg_catalog.count(*) FROM public."Message" WHERE kind IS NOT NULL AND kind NOT IN ('custom_order_request', 'custom_order_link', 'commission_interest_card')) AS unknown_kind_count,
      (SELECT pg_catalog.count(*) FROM public."Message" WHERE "isSystemMessage" = true AND (kind IS NULL OR kind = 'custom_order_request')) AS user_authored_marked_system_count,
      (SELECT pg_catalog.count(*) FROM public."Message" WHERE "isSystemMessage" = false AND kind IN ('custom_order_link', 'commission_interest_card')) AS server_card_not_system_count,
      (SELECT pg_catalog.count(*) FROM public."Message" WHERE "contextListingId" IS NOT NULL) AS message_listing_context_count,
      (SELECT pg_catalog.count(*)
         FROM public."Message" AS m
         JOIN public."Conversation" AS c ON c.id = m."conversationId"
         JOIN public."Listing" AS listing ON listing.id = m."contextListingId"
         JOIN public."SellerProfile" AS seller ON seller.id = listing."sellerId"
        WHERE m."contextListingId" IS NOT NULL
          AND (
            seller."userId" NOT IN (c."userAId", c."userBId")
            OR (listing."isPrivate" = true AND (
              listing."reservedForUserId" IS NULL
              OR listing."reservedForUserId" = seller."userId"
              OR listing."reservedForUserId" NOT IN (c."userAId", c."userBId")
            ))
          )) AS invalid_message_listing_pair_count,
      (SELECT pg_catalog.count(*) FROM public."UserReport" WHERE "targetType" = 'MESSAGE_THREAD' AND resolved = false) AS unresolved_thread_report_count,
      (SELECT pg_catalog.count(*) FROM public."UserReport" AS report WHERE report."targetType" = 'MESSAGE_THREAD' AND report.resolved = false AND NOT EXISTS (
        SELECT 1 FROM public."Conversation" AS c WHERE c.id = report."targetId"
      )) AS orphan_unresolved_thread_report_count,
      (SELECT pg_catalog.count(*) FROM public."Listing" WHERE "isPrivate" = true AND status = 'ACTIVE') AS active_private_custom_listing_count,
      (SELECT pg_catalog.count(*)
         FROM public."Listing" AS listing
         JOIN public."SellerProfile" AS seller ON seller.id = listing."sellerId"
         LEFT JOIN public."Conversation" AS c ON c.id = listing."customOrderConversationId"
        WHERE listing."isPrivate" = true
          AND listing.status = 'ACTIVE'
          AND (
            listing."reservedForUserId" IS NULL
            OR listing."reservedForUserId" = seller."userId"
            OR c.id IS NULL
            OR NOT (
              (c."userAId" = seller."userId" AND c."userBId" = listing."reservedForUserId")
              OR (c."userBId" = seller."userId" AND c."userAId" = listing."reservedForUserId")
            )
          )) AS invalid_private_custom_listing_pair_count
  `);
  return normalizeConversationMessageLegacyCounts(result.rows[0]);
}

export async function runConversationMessageLegacyInspection(config) {
  const parsedUrl = new URL(config.directUrl);
  const client = new Client({
    connectionString: config.directUrl,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-conversation-message-legacy-inspection",
    ...postgresChannelBindingClientOptions(parsedUrl),
  });
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const posture = await readPosture(client);
    const counts = await readCounts(client);
    await client.query("ROLLBACK");
    transactionOpen = false;
    return Object.freeze({
      mode: config.mode,
      releaseCommit: config.releaseCommit,
      directUrlSha256: config.directUrlSha256,
      posture,
      counts,
      transaction: Object.freeze({ isolation: "repeatable read", readOnly: true }),
      retained: Object.freeze({ rawRows: false, identifiers: false, messageBodies: false, credentials: false }),
    });
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

export function writeConversationMessageLegacyInspectionEvidence(filePath, evidence) {
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (/postgres(?:ql)?:\/\/|DIRECT_URL|password|"body"\s*:|"email"\s*:/i.test(serialized)) {
    throw new Error("Conversation/Message legacy inspection evidence contains sensitive-shaped data");
  }
  const fd = openSync(filePath, "wx", 0o600);
  try {
    writeFileSync(fd, serialized, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(filePath, 0o600);
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error("Conversation/Message legacy inspection evidence is not a private regular file");
  }
}

async function main() {
  try {
    const config = parseConversationMessageLegacyInspectionConfig(process.env);
    const git = assertConversationMessageLegacyInspectionGitState(
      readConversationMessageLegacyInspectionGitState(),
      config.releaseCommit,
    );
    const result = await runConversationMessageLegacyInspection(config);
    const evidence = Object.freeze({ generatedAt: new Date().toISOString(), status: "passed", git, ...result });
    writeConversationMessageLegacyInspectionEvidence(config.evidencePath, evidence);
    process.stdout.write(`${JSON.stringify({
      status: evidence.status,
      releaseCommit: evidence.releaseCommit,
      posture: evidence.posture,
      counts: evidence.counts,
      transaction: evidence.transaction,
      retained: evidence.retained,
      evidenceWritten: true,
    })}\n`);
  } catch {
    process.stderr.write("Conversation/Message legacy inspection failed closed.\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
