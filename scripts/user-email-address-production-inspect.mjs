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

export const USER_EMAIL_ADDRESS_INSPECTION_CONFIRMATION =
  "inspect-user-email-address-preparation";

export const REVIEWED_USER_EMAIL_ADDRESS_INSPECTION_TARGET = Object.freeze({
  endpointId: "ep-plain-river-aaqg8gj4",
  databaseName: "neondb",
  region: "westus3.azure",
  ownerRole: "neondb_owner",
  runtimeRole: "grainline_app_runtime",
});

const REVIEWED_MAIN_REF = "refs/heads/main";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/;

function required(env, name) {
  const value = env?.[name];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${name} is required without surrounding whitespace`);
  }
  return value;
}

export function parseUserEmailAddressInspectionConfig(env = process.env) {
  assertDeterministicPostgresEnvironment(
    env,
    "UserEmailAddress production inspection",
  );
  if (
    env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_REF !== REVIEWED_MAIN_REF
  ) {
    throw new Error(
      "UserEmailAddress inspection requires a manual main-branch GitHub Actions dispatch",
    );
  }
  const releaseCommit = required(
    env,
    "USER_EMAIL_ADDRESS_INSPECT_RELEASE_COMMIT",
  );
  const githubCommit = required(env, "GITHUB_SHA");
  if (!COMMIT_PATTERN.test(releaseCommit) || releaseCommit !== githubCommit) {
    throw new Error(
      "UserEmailAddress inspection commit must match the dispatched main commit",
    );
  }
  if (
    env.USER_EMAIL_ADDRESS_INSPECT_CONFIRM
    !== USER_EMAIL_ADDRESS_INSPECTION_CONFIRMATION
  ) {
    throw new Error("UserEmailAddress inspection confirmation is not exact");
  }
  if (Object.hasOwn(env, "DATABASE_URL")) {
    throw new Error("DATABASE_URL must remain absent from the owner-only inspection job");
  }
  if (Object.hasOwn(env, "GRANT_AUDIT_DATABASE_URL")) {
    throw new Error(
      "GRANT_AUDIT_DATABASE_URL must remain absent during the inspection",
    );
  }

  const directUrl = required(env, "DIRECT_URL");
  const expectedDirectUrlSha256 = required(
    env,
    "PRODUCTION_MIGRATION_DIRECT_URL_SHA256",
  );
  const directUrlSha256 = createHash("sha256")
    .update(directUrl, "utf8")
    .digest("hex");
  if (
    !SHA256_PATTERN.test(expectedDirectUrlSha256)
    || expectedDirectUrlSha256 !== directUrlSha256
  ) {
    throw new Error("DIRECT_URL does not match the protected environment digest");
  }

  const migrationRole = required(env, "MIGRATION_DB_ROLE");
  const runtimeRole = required(env, "RUNTIME_DB_ROLE");
  const identity = parseGuardedNeonDatabaseIdentity(directUrl, "DIRECT_URL");
  const target = REVIEWED_USER_EMAIL_ADDRESS_INSPECTION_TARGET;
  if (
    identity.isPooler
    || identity.endpointId !== target.endpointId
    || identity.databaseName !== target.databaseName
    || identity.region !== target.region
    || identity.username !== target.ownerRole
    || migrationRole !== target.ownerRole
    || runtimeRole !== target.runtimeRole
  ) {
    throw new Error("DIRECT_URL is not the reviewed direct production owner target");
  }

  const runnerTemp = path.resolve(required(env, "RUNNER_TEMP"));
  const evidencePath = path.resolve(
    required(env, "USER_EMAIL_ADDRESS_INSPECT_EVIDENCE_PATH"),
  );
  const expectedEvidencePath = path.join(
    runnerTemp,
    `user-email-address-production-inspection-${releaseCommit}.json`,
  );
  if (evidencePath !== expectedEvidencePath || existsSync(evidencePath)) {
    throw new Error(
      "UserEmailAddress inspection evidence path is not the fresh reviewed runner path",
    );
  }

  return Object.freeze({
    mode: "production-read-only",
    directUrl,
    directUrlSha256,
    evidencePath,
    identity,
    releaseCommit,
  });
}

export function readUserEmailAddressInspectionGitState(cwd = process.cwd()) {
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

export function assertUserEmailAddressInspectionGitState(state, releaseCommit) {
  if (state?.head !== releaseCommit || state.status !== "") {
    throw new Error(
      "UserEmailAddress inspection checkout is not the exact clean dispatched commit",
    );
  }
  return Object.freeze({ head: state.head, clean: true });
}

function nonnegativeInteger(value, name) {
  if (typeof value !== "string" || !INTEGER_PATTERN.test(value)) {
    throw new TypeError(`${name} is not a nonnegative PostgreSQL count`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(`${name} is outside the safe integer range`);
  }
  return parsed;
}

export function normalizeUserEmailAddressCounts(row) {
  const counts = Object.freeze({
    totalRows: nonnegativeInteger(row?.total_rows, "totalRows"),
    currentRows: nonnegativeInteger(row?.current_rows, "currentRows"),
    historicalRows: nonnegativeInteger(row?.historical_rows, "historicalRows"),
    usersWithRows: nonnegativeInteger(row?.users_with_rows, "usersWithRows"),
    duplicateCurrentUserGroups: nonnegativeInteger(
      row?.duplicate_current_user_groups,
      "duplicateCurrentUserGroups",
    ),
    duplicateCurrentRowExcess: nonnegativeInteger(
      row?.duplicate_current_row_excess,
      "duplicateCurrentRowExcess",
    ),
    currentRowsWithoutMatchingActiveUser: nonnegativeInteger(
      row?.current_rows_without_matching_active_user,
      "currentRowsWithoutMatchingActiveUser",
    ),
    activeUsersWithoutCurrentRow: nonnegativeInteger(
      row?.active_users_without_current_row,
      "activeUsersWithoutCurrentRow",
    ),
    activeSuppressionKeyCollisionGroups: nonnegativeInteger(
      row?.active_suppression_key_collision_groups,
      "activeSuppressionKeyCollisionGroups",
    ),
  });
  if (counts.totalRows !== counts.currentRows + counts.historicalRows) {
    throw new Error("UserEmailAddress current/history partition is inconsistent");
  }
  if (
    (counts.duplicateCurrentUserGroups === 0)
    !== (counts.duplicateCurrentRowExcess === 0)
  ) {
    throw new Error("UserEmailAddress duplicate-current aggregates disagree");
  }
  return counts;
}

function assertStringArray(value, name) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new TypeError(`${name} must be a string array`);
  }
  return Object.freeze([...value]);
}

export function verifyUserEmailAddressCatalog(catalog) {
  const target = REVIEWED_USER_EMAIL_ADDRESS_INSPECTION_TARGET;
  const identity = catalog?.identity;
  const table = catalog?.table;
  if (
    identity?.current_user !== target.ownerRole
    || identity?.session_user !== target.ownerRole
    || identity?.database_name !== target.databaseName
    || identity?.read_only !== "on"
    || identity?.isolation !== "repeatable read"
    || identity?.owner_bypass_rls !== true
    || identity?.runtime_bypass_rls !== false
    || identity?.runtime_superuser !== false
    || identity?.runtime_inherit !== false
  ) {
    throw new Error("UserEmailAddress database identity or transaction posture drifted");
  }
  if (
    table?.table_name !== "UserEmailAddress"
    || table?.owner_name !== target.ownerRole
    || typeof table?.rls_enabled !== "boolean"
    || typeof table?.rls_forced !== "boolean"
    || !Number.isSafeInteger(Number(table?.policy_count))
    || typeof table?.runtime_select !== "boolean"
    || typeof table?.runtime_insert !== "boolean"
    || typeof table?.runtime_update !== "boolean"
    || typeof table?.runtime_delete !== "boolean"
  ) {
    throw new Error("UserEmailAddress table catalog is incomplete");
  }
  for (const index of catalog.indexes ?? []) {
    if (
      typeof index?.table_name !== "string"
      || typeof index?.index_name !== "string"
      || typeof index?.valid !== "boolean"
      || typeof index?.ready !== "boolean"
      || typeof index?.live !== "boolean"
      || typeof index?.unique_index !== "boolean"
      || (index?.predicate !== null && typeof index?.predicate !== "string")
      || (index?.expression !== null && typeof index?.expression !== "string")
    ) {
      throw new Error("UserEmailAddress index catalog is incomplete");
    }
  }
  for (const entry of catalog.functions ?? []) {
    if (
      typeof entry?.function_name !== "string"
      || typeof entry?.identity_arguments !== "string"
      || typeof entry?.owner_name !== "string"
      || typeof entry?.source_md5 !== "string"
      || !/^[0-9a-f]{32}$/.test(entry.source_md5)
      || typeof entry?.security_definer !== "boolean"
      || typeof entry?.leakproof !== "boolean"
      || typeof entry?.contains_dynamic_execute !== "boolean"
    ) {
      throw new Error("UserEmailAddress dependent function catalog is incomplete");
    }
    assertStringArray(entry.function_config ?? [], `${entry.function_name} config`);
    assertStringArray(entry.nonowner_acl ?? [], `${entry.function_name} ACL`);
  }
  for (const trigger of catalog.triggers ?? []) {
    if (
      typeof trigger?.trigger_name !== "string"
      || typeof trigger?.function_name !== "string"
      || typeof trigger?.enabled !== "string"
      || typeof trigger?.internal !== "boolean"
    ) {
      throw new Error("UserEmailAddress trigger catalog is incomplete");
    }
  }
  const counts = normalizeUserEmailAddressCounts(catalog.counts);
  const names = new Set((catalog.indexes ?? []).map((entry) => entry.index_name));
  const preparedFunctions = new Set([
    "grainline_user_email_address_sync",
    "grainline_user_email_address_owner_rows",
    "grainline_user_email_address_delete_for_current_user",
    "grainline_user_email_address_newer_current_claim",
  ]);
  const liveFunctions = new Set(
    (catalog.functions ?? []).map((entry) => entry.function_name),
  );
  return Object.freeze({
    tableOwner: table.owner_name,
    rlsEnabled: table.rls_enabled,
    rlsForced: table.rls_forced,
    policyCount: Number(table.policy_count),
    runtimeCrud: Object.freeze({
      select: table.runtime_select,
      insert: table.runtime_insert,
      update: table.runtime_update,
      delete: table.runtime_delete,
    }),
    counts,
    duplicateCurrentRowsBlockIndex: counts.duplicateCurrentUserGroups > 0,
    currentHistoryDriftPresent:
      counts.currentRowsWithoutMatchingActiveUser > 0
      || counts.activeUsersWithoutCurrentRow > 0,
    supportingIndexesPresent: [
      "User_active_email_suppression_key_idx",
      "UserEmailAddress_current_suppression_key_idx",
      "UserEmailAddress_one_current_per_user_key",
    ].every((name) => names.has(name)),
    preparedAuthorityFunctionCount: [...preparedFunctions]
      .filter((name) => liveFunctions.has(name)).length,
    dependentFunctionCount: (catalog.functions ?? []).length,
    triggerCount: (catalog.triggers ?? []).length,
    aggregateRowDataOnly: true,
    productionChanged: false,
  });
}

export async function readUserEmailAddressCatalog(client) {
  const identityResult = await client.query(`
    SELECT
      CURRENT_USER::text AS current_user,
      SESSION_USER::text AS session_user,
      pg_catalog.current_database()::text AS database_name,
      pg_catalog.current_setting('transaction_read_only') AS read_only,
      pg_catalog.current_setting('transaction_isolation') AS isolation,
      owner_role.rolbypassrls AS owner_bypass_rls,
      runtime_role.rolbypassrls AS runtime_bypass_rls,
      runtime_role.rolsuper AS runtime_superuser,
      runtime_role.rolinherit AS runtime_inherit
    FROM pg_catalog.pg_roles AS owner_role
    JOIN pg_catalog.pg_roles AS runtime_role
      ON runtime_role.rolname = 'grainline_app_runtime'
    WHERE owner_role.rolname = CURRENT_USER
  `);
  if (identityResult.rows.length !== 1) {
    throw new Error("UserEmailAddress inspection database identity is missing");
  }

  const tableResult = await client.query(`
    SELECT
      class.relname::text AS table_name,
      pg_catalog.pg_get_userbyid(class.relowner)::text AS owner_name,
      class.relrowsecurity AS rls_enabled,
      class.relforcerowsecurity AS rls_forced,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid) AS policy_count,
      pg_catalog.has_table_privilege(
        'grainline_app_runtime', class.oid, 'SELECT'
      ) AS runtime_select,
      pg_catalog.has_table_privilege(
        'grainline_app_runtime', class.oid, 'INSERT'
      ) AS runtime_insert,
      pg_catalog.has_table_privilege(
        'grainline_app_runtime', class.oid, 'UPDATE'
      ) AS runtime_update,
      pg_catalog.has_table_privilege(
        'grainline_app_runtime', class.oid, 'DELETE'
      ) AS runtime_delete
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public'
      AND class.relname = 'UserEmailAddress'
      AND class.relkind = 'r'
  `);
  if (tableResult.rows.length !== 1) {
    throw new Error("UserEmailAddress table is missing or ambiguous");
  }

  const countsResult = await client.query(`
    WITH current_groups AS (
      SELECT address."userId", pg_catalog.count(*)::bigint AS row_count
      FROM public."UserEmailAddress" AS address
      WHERE address."isCurrent" = true
      GROUP BY address."userId"
    ),
    active_suppression_keys AS (
      SELECT
        CASE
          WHEN pg_catalog.lower(
            pg_catalog.split_part(pg_catalog.btrim(account_user.email), '@', 2)
          ) IN ('gmail.com', 'googlemail.com')
          THEN pg_catalog.replace(
            pg_catalog.split_part(
              pg_catalog.lower(
                pg_catalog.split_part(pg_catalog.btrim(account_user.email), '@', 1)
              ),
              '+',
              1
            ),
            '.',
            ''
          ) || '@gmail.com'
          ELSE pg_catalog.lower(pg_catalog.btrim(account_user.email))
        END AS suppression_key,
        pg_catalog.count(*)::bigint AS user_count
      FROM public."User" AS account_user
      WHERE account_user."deletedAt" IS NULL
      GROUP BY 1
    )
    SELECT
      (SELECT pg_catalog.count(*) FROM public."UserEmailAddress") AS total_rows,
      (SELECT pg_catalog.count(*) FROM public."UserEmailAddress"
        WHERE "isCurrent" = true) AS current_rows,
      (SELECT pg_catalog.count(*) FROM public."UserEmailAddress"
        WHERE "isCurrent" = false) AS historical_rows,
      (SELECT pg_catalog.count(DISTINCT "userId")
         FROM public."UserEmailAddress") AS users_with_rows,
      (SELECT pg_catalog.count(*) FROM current_groups
        WHERE row_count > 1) AS duplicate_current_user_groups,
      (SELECT COALESCE(pg_catalog.sum(row_count - 1), 0) FROM current_groups
        WHERE row_count > 1) AS duplicate_current_row_excess,
      (SELECT pg_catalog.count(*)
         FROM public."UserEmailAddress" AS address
         LEFT JOIN public."User" AS account_user
           ON account_user.id = address."userId"
          AND account_user."deletedAt" IS NULL
          AND account_user.email = address.email
        WHERE address."isCurrent" = true
          AND account_user.id IS NULL) AS current_rows_without_matching_active_user,
      (SELECT pg_catalog.count(*)
         FROM public."User" AS account_user
        WHERE account_user."deletedAt" IS NULL
          AND NOT EXISTS (
            SELECT 1
              FROM public."UserEmailAddress" AS address
             WHERE address."userId" = account_user.id
               AND address."isCurrent" = true
               AND address.email = account_user.email
          )) AS active_users_without_current_row,
      (SELECT pg_catalog.count(*) FROM active_suppression_keys
        WHERE user_count > 1) AS active_suppression_key_collision_groups
  `);
  if (countsResult.rows.length !== 1) {
    throw new Error("UserEmailAddress aggregate inspection did not return one row");
  }

  const indexesResult = await client.query(`
    SELECT
      table_class.relname::text AS table_name,
      index_class.relname::text AS index_name,
      index_row.indisvalid AS valid,
      index_row.indisready AS ready,
      index_row.indislive AS live,
      index_row.indisunique AS unique_index,
      pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid) AS predicate,
      pg_catalog.pg_get_expr(index_row.indexprs, index_row.indrelid) AS expression
    FROM pg_catalog.pg_index AS index_row
    JOIN pg_catalog.pg_class AS table_class
      ON table_class.oid = index_row.indrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = table_class.relnamespace
    JOIN pg_catalog.pg_class AS index_class
      ON index_class.oid = index_row.indexrelid
    WHERE namespace.nspname = 'public'
      AND (
        table_class.relname = 'UserEmailAddress'
        OR index_class.relname = 'User_active_email_suppression_key_idx'
      )
    ORDER BY table_class.relname, index_class.relname
  `);

  const functionsResult = await client.query(`
    SELECT
      procedure.proname::text AS function_name,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid)::text
        AS identity_arguments,
      pg_catalog.pg_get_userbyid(procedure.proowner)::text AS owner_name,
      language.lanname::text AS language_name,
      procedure.prokind AS function_kind,
      procedure.prosecdef AS security_definer,
      procedure.proleakproof AS leakproof,
      procedure.provolatile AS volatility,
      procedure.proparallel AS parallel_safety,
      COALESCE(procedure.proconfig, ARRAY[]::text[]) AS function_config,
      pg_catalog.md5(procedure.prosrc) AS source_md5,
      pg_catalog.strpos(pg_catalog.upper(procedure.prosrc), 'EXECUTE') > 0
        AS contains_dynamic_execute,
      ARRAY(
        SELECT pg_catalog.format(
          '%s:%s:%s',
          CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
               ELSE pg_catalog.pg_get_userbyid(acl.grantee) END,
          acl.privilege_type,
          CASE WHEN acl.is_grantable THEN 'true' ELSE 'false' END
        )
        FROM pg_catalog.aclexplode(
          COALESCE(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) AS acl
        WHERE acl.grantee <> procedure.proowner
        ORDER BY 1
      ) AS nonowner_acl
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    JOIN pg_catalog.pg_language AS language
      ON language.oid = procedure.prolang
    WHERE namespace.nspname = 'public'
      AND pg_catalog.strpos(procedure.prosrc, '"UserEmailAddress"') > 0
    ORDER BY procedure.proname, identity_arguments
  `);

  const triggersResult = await client.query(`
    SELECT
      trigger_row.tgname::text AS trigger_name,
      procedure.proname::text AS function_name,
      trigger_row.tgenabled AS enabled,
      trigger_row.tgisinternal AS internal
    FROM pg_catalog.pg_trigger AS trigger_row
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = trigger_row.tgfoid
    WHERE trigger_row.tgrelid = 'public."UserEmailAddress"'::pg_catalog.regclass
    ORDER BY trigger_row.tgname
  `);

  return Object.freeze({
    identity: Object.freeze(identityResult.rows[0]),
    table: Object.freeze(tableResult.rows[0]),
    counts: Object.freeze(countsResult.rows[0]),
    indexes: Object.freeze(indexesResult.rows.map((row) => Object.freeze(row))),
    functions: Object.freeze(functionsResult.rows.map((row) => Object.freeze(row))),
    triggers: Object.freeze(triggersResult.rows.map((row) => Object.freeze(row))),
  });
}

export async function runUserEmailAddressInspection(config) {
  const parsedUrl = new URL(config.directUrl);
  const client = new Client({
    connectionString: config.directUrl,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-user-email-address-production-inspection",
    ...postgresChannelBindingClientOptions(parsedUrl),
  });
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    transactionOpen = true;
    const catalog = await readUserEmailAddressCatalog(client);
    const result = verifyUserEmailAddressCatalog(catalog);
    await client.query("ROLLBACK");
    transactionOpen = false;
    return Object.freeze({
      mode: config.mode,
      releaseCommit: config.releaseCommit,
      directUrlSha256: config.directUrlSha256,
      result,
      catalog,
      transaction: Object.freeze({
        isolation: "repeatable read",
        readOnly: true,
        rolledBack: true,
      }),
      retained: Object.freeze({
        aggregateCountsOnly: true,
        rawRows: false,
        identifiers: false,
        credentials: false,
        functionBodies: false,
      }),
      productionChanged: false,
    });
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

export function writeUserEmailAddressInspectionEvidence(filePath, evidence) {
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (
    /postgres(?:ql)?:\/\/|DIRECT_URL|password|"(?:clerkId|userId|email)"\s*:|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(
      serialized,
    )
  ) {
    throw new Error("UserEmailAddress inspection evidence contains private data");
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
    throw new Error(
      "UserEmailAddress inspection evidence is not a private regular file",
    );
  }
}

async function main() {
  try {
    const config = parseUserEmailAddressInspectionConfig(process.env);
    const git = assertUserEmailAddressInspectionGitState(
      readUserEmailAddressInspectionGitState(),
      config.releaseCommit,
    );
    const result = await runUserEmailAddressInspection(config);
    const evidence = Object.freeze({
      generatedAt: new Date().toISOString(),
      status: "passed",
      git,
      ...result,
    });
    writeUserEmailAddressInspectionEvidence(config.evidencePath, evidence);
    process.stdout.write(`${JSON.stringify({
      status: evidence.status,
      releaseCommit: evidence.releaseCommit,
      result: evidence.result,
      transaction: evidence.transaction,
      retained: evidence.retained,
      productionChanged: evidence.productionChanged,
      evidenceWritten: true,
    })}\n`);
  } catch {
    process.stderr.write("UserEmailAddress production inspection failed closed.\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
