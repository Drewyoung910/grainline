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
import {
  DeleteObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import pg from "pg";
import {
  DIRECT_UPLOAD_ACTIVATION_FUNCTION_NAMES,
  DIRECT_UPLOAD_ACTIVATION_INVOKER_FUNCTION_NAMES,
  DIRECT_UPLOAD_ACTIVATION_PRIVATE_FUNCTION_NAMES,
  DIRECT_UPLOAD_ACTIVATION_RUNTIME_FUNCTION_NAMES,
  DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES,
  DIRECT_UPLOAD_CLEANUP_ROLE,
} from "./direct-upload-activation-catalog.mjs";
import {
  directUploadFunctionSourceHashes,
} from "./direct-upload-function-source-catalog.mjs";
import {
  assertDeterministicPostgresEnvironment,
  assertExplicitPostgresConnectionAuthority,
  assertReviewedPostgresConnectionParameters,
  parseCanonicalPostgresDatabaseName,
  parseExactPostgresUrl,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";

const { Client } = pg;

export const DIRECT_UPLOAD_CLEANUP_CONFIRMATION =
  "run-reviewed-direct-upload-cleanup";
export const DIRECT_UPLOAD_CLEANUP_BATCH_SIZE = 20;
export const DIRECT_UPLOAD_CLEANUP_MAX_BATCHES = 10;

const REVIEWED_TARGET = Object.freeze({
  databaseName: "neondb",
  endpointId: "ep-plain-river-aaqg8gj4",
  migrationRole: "neondb_owner",
  region: "westus3.azure",
  runtimeRole: "grainline_app_runtime",
  workerRole: DIRECT_UPLOAD_CLEANUP_ROLE,
});
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SAFE_RUN_ID_PATTERN = /^[1-9][0-9]{0,19}$/;
const SAFE_RUN_ATTEMPT_PATTERN = /^[1-9][0-9]{0,5}$/;
const SAFE_R2_ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/;
const SAFE_BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const FORBIDDEN_ENV_KEYS = Object.freeze([
  "DATABASE_URL",
  "DIRECT_URL",
  "GRANT_AUDIT_DATABASE_URL",
  "PRODUCTION_MIGRATION_DIRECT_URL",
  "CLOUDFLARE_R2_ACCESS_KEY_ID",
  "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
]);

function required(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${name} is required without surrounding whitespace`);
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function reviewedCleanupDatabaseIdentity(value) {
  const parsed = parseExactPostgresUrl(
    value,
    "DIRECT_UPLOAD_CLEANUP_DATABASE_URL",
  );
  const { username } = assertExplicitPostgresConnectionAuthority(
    parsed,
    "DIRECT_UPLOAD_CLEANUP_DATABASE_URL",
  );
  assertReviewedPostgresConnectionParameters(
    parsed,
    "DIRECT_UPLOAD_CLEANUP_DATABASE_URL",
  );
  const databaseName = parseCanonicalPostgresDatabaseName(
    parsed,
    "DIRECT_UPLOAD_CLEANUP_DATABASE_URL",
  );
  const match = parsed.hostname.toLowerCase().match(
    /^(ep-[a-z0-9-]+?)(-pooler)?\.([a-z0-9-]+)\.([a-z0-9-]+)\.neon\.tech$/,
  );
  if (!match) {
    throw new Error(
      "DIRECT_UPLOAD_CLEANUP_DATABASE_URL must identify one Neon endpoint",
    );
  }
  return Object.freeze({
    databaseName,
    endpointId: match[1],
    isPooler: Boolean(match[2]),
    parsed,
    region: `${match[3]}.${match[4]}`,
    username,
  });
}

export function parseDirectUploadCleanupWorkerConfig(env = process.env) {
  assertDeterministicPostgresEnvironment(env, "DirectUpload cleanup worker");
  if (
    env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_REF !== "refs/heads/main"
    || !new Set(["schedule", "workflow_dispatch"]).has(env.GITHUB_EVENT_NAME)
  ) {
    throw new Error(
      "DirectUpload cleanup requires a scheduled or manual main-branch GitHub Actions run",
    );
  }
  if (
    env.GITHUB_EVENT_NAME === "workflow_dispatch"
    && env.DIRECT_UPLOAD_CLEANUP_CONFIRM !== DIRECT_UPLOAD_CLEANUP_CONFIRMATION
  ) {
    throw new Error("manual DirectUpload cleanup confirmation is not exact");
  }
  const forbiddenPresent = FORBIDDEN_ENV_KEYS.filter((key) =>
    Object.hasOwn(env, key),
  );
  if (forbiddenPresent.length > 0) {
    throw new Error(
      `DirectUpload cleanup environment contains forbidden shared credentials: ${forbiddenPresent.join(", ")}`,
    );
  }

  const releaseCommit = required(env, "GITHUB_SHA");
  if (!COMMIT_PATTERN.test(releaseCommit)) {
    throw new Error("GITHUB_SHA must be one exact lowercase commit");
  }
  const runId = required(env, "GITHUB_RUN_ID");
  const runAttempt = required(env, "GITHUB_RUN_ATTEMPT");
  if (
    !SAFE_RUN_ID_PATTERN.test(runId)
    || !SAFE_RUN_ATTEMPT_PATTERN.test(runAttempt)
  ) {
    throw new Error("GitHub cleanup run identity is invalid");
  }

  const databaseUrl = required(
    env,
    "DIRECT_UPLOAD_CLEANUP_DATABASE_URL",
  );
  const databaseUrlSha256 = sha256(databaseUrl);
  const expectedDatabaseUrlSha256 = required(
    env,
    "DIRECT_UPLOAD_CLEANUP_DATABASE_URL_SHA256",
  );
  if (
    !SHA256_PATTERN.test(expectedDatabaseUrlSha256)
    || expectedDatabaseUrlSha256 !== databaseUrlSha256
  ) {
    throw new Error(
      "DirectUpload cleanup database URL does not match its protected digest",
    );
  }
  const identity = reviewedCleanupDatabaseIdentity(databaseUrl);
  if (
    identity.isPooler
    || identity.endpointId !== REVIEWED_TARGET.endpointId
    || identity.region !== REVIEWED_TARGET.region
    || identity.databaseName !== REVIEWED_TARGET.databaseName
    || identity.username !== REVIEWED_TARGET.workerRole
  ) {
    throw new Error(
      "DirectUpload cleanup database URL is not the reviewed direct production worker target",
    );
  }

  const r2AccountId = required(
    env,
    "DIRECT_UPLOAD_CLEANUP_R2_ACCOUNT_ID",
  );
  const r2AccessKeyId = required(
    env,
    "DIRECT_UPLOAD_CLEANUP_R2_ACCESS_KEY_ID",
  );
  const r2SecretAccessKey = required(
    env,
    "DIRECT_UPLOAD_CLEANUP_R2_SECRET_ACCESS_KEY",
  );
  const publicBucket = required(
    env,
    "DIRECT_UPLOAD_CLEANUP_R2_PUBLIC_BUCKET",
  );
  const privateBucket = required(
    env,
    "DIRECT_UPLOAD_CLEANUP_R2_PRIVATE_BUCKET",
  );
  if (!SAFE_R2_ACCOUNT_ID_PATTERN.test(r2AccountId)) {
    throw new Error("DirectUpload cleanup R2 account id is invalid");
  }
  if (
    !SAFE_BUCKET_PATTERN.test(publicBucket)
    || !SAFE_BUCKET_PATTERN.test(privateBucket)
    || publicBucket === privateBucket
  ) {
    throw new Error(
      "DirectUpload cleanup requires two distinct valid R2 bucket names",
    );
  }

  const runnerTemp = path.resolve(required(env, "RUNNER_TEMP"));
  const evidencePath = path.resolve(
    required(env, "DIRECT_UPLOAD_CLEANUP_EVIDENCE_PATH"),
  );
  const expectedEvidencePath = path.join(
    runnerTemp,
    `direct-upload-cleanup-${runId}-${runAttempt}.json`,
  );
  if (evidencePath !== expectedEvidencePath || existsSync(evidencePath)) {
    throw new Error(
      "DirectUpload cleanup evidence path is not the fresh reviewed runner path",
    );
  }

  return Object.freeze({
    databaseUrl,
    databaseUrlSha256,
    evidencePath,
    identity,
    privateBucket,
    privateBucketSha256: sha256(privateBucket),
    publicBucket,
    publicBucketSha256: sha256(publicBucket),
    r2AccessKeyId,
    r2AccountId,
    r2AccountIdSha256: sha256(r2AccountId),
    r2SecretAccessKey,
    releaseCommit,
    runAttempt,
    runId,
  });
}

export function readDirectUploadCleanupGitState(cwd = process.cwd()) {
  const run = (args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  return Object.freeze({
    head: run(["rev-parse", "HEAD"]),
    status: run(["status", "--porcelain=v1", "--untracked-files=all"]),
  });
}

export function assertDirectUploadCleanupGitState(state, releaseCommit) {
  if (state?.head !== releaseCommit || state.status !== "") {
    throw new Error(
      "DirectUpload cleanup checkout is not the exact clean main commit",
    );
  }
  return Object.freeze({ clean: true, head: state.head });
}

function normalizedStringArray(value) {
  return Array.isArray(value)
    ? value.map(String).sort((left, right) => left.localeCompare(right))
    : [];
}

export function collectDirectUploadCleanupAuthorityIssues(snapshot) {
  const issues = [];
  const role = snapshot?.role;
  if (!role || role.rolname !== REVIEWED_TARGET.workerRole) {
    issues.push("cleanup connection does not authenticate as the worker role");
  } else {
    for (const field of [
      "rolsuper",
      "rolcreatedb",
      "rolcreaterole",
      "rolinherit",
      "rolreplication",
      "rolbypassrls",
    ]) {
      if (role[field]) issues.push(`cleanup worker role has ${field}`);
    }
    if (!role.rolcanlogin) issues.push("cleanup worker role must have LOGIN");
  }
  if (
    snapshot?.currentUser !== REVIEWED_TARGET.workerRole
    || snapshot?.sessionUser !== REVIEWED_TARGET.workerRole
  ) {
    issues.push("cleanup connection role identity is not exact");
  }
  if (normalizedStringArray(snapshot?.memberships).length > 0) {
    issues.push("cleanup worker role must have zero memberships");
  }
  if (normalizedStringArray(snapshot?.memberRoles).length > 0) {
    issues.push("cleanup worker role must have zero member roles");
  }
  if (normalizedStringArray(snapshot?.defaultPrivileges).length > 0) {
    issues.push("cleanup worker role has default privilege grants");
  }
  if (!snapshot?.schemaUsage) {
    issues.push("cleanup worker lacks public schema USAGE");
  }
  if (snapshot?.schemaCreate || snapshot?.databaseCreate) {
    issues.push("cleanup worker has CREATE authority");
  }
  if (normalizedStringArray(snapshot?.tablePrivileges).length > 0) {
    issues.push("cleanup worker has effective table authority");
  }
  if (normalizedStringArray(snapshot?.columnPrivileges).length > 0) {
    issues.push("cleanup worker has effective column authority");
  }
  if (normalizedStringArray(snapshot?.sequencePrivileges).length > 0) {
    issues.push("cleanup worker has effective sequence authority");
  }
  if (
    normalizedStringArray(snapshot?.unexpectedFunctionPrivileges).length > 0
  ) {
    issues.push("cleanup worker has unexpected privileged function authority");
  }

  const tableRows = Array.isArray(snapshot?.rlsTables)
    ? snapshot.rlsTables
    : [];
  for (const tableName of ["DirectUpload", "DirectUploadReference"]) {
    const rows = tableRows.filter((row) => row.relname === tableName);
    if (rows.length !== 1) {
      issues.push(`${tableName} catalog row is not exact`);
      continue;
    }
    const row = rows[0];
    if (!row.relrowsecurity || !row.relforcerowsecurity) {
      issues.push(`${tableName} must have ENABLE plus FORCE RLS`);
    }
    if (Number(row.policy_count) !== 0) {
      issues.push(`${tableName} must retain zero policies`);
    }
  }

  const functionRows = Array.isArray(snapshot?.functions)
    ? snapshot.functions
    : [];
  const actualNames = functionRows.map((row) => row.function_name).sort();
  const expectedNames = [...DIRECT_UPLOAD_ACTIVATION_FUNCTION_NAMES].sort();
  if (
    actualNames.length !== expectedNames.length
    || actualNames.some((name, index) => name !== expectedNames[index])
  ) {
    issues.push("DirectUpload function catalog is not exact");
  }
  const workerNames = new Set(DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES);
  const runtimeNames = new Set(
    DIRECT_UPLOAD_ACTIVATION_RUNTIME_FUNCTION_NAMES,
  );
  const privateNames = new Set(
    DIRECT_UPLOAD_ACTIVATION_PRIVATE_FUNCTION_NAMES,
  );
  const invokerNames = new Set(
    DIRECT_UPLOAD_ACTIVATION_INVOKER_FUNCTION_NAMES,
  );
  const expectedSourceHashes = directUploadFunctionSourceHashes();
  for (const row of functionRows) {
    const name = row.function_name;
    if (row.owner_name !== REVIEWED_TARGET.migrationRole) {
      issues.push(`${name} has the wrong owner`);
    }
    if (
      typeof row.function_source !== "string"
      || sha256(row.function_source) !== expectedSourceHashes[name]
    ) {
      issues.push(`${name} source hash does not match the reviewed migration`);
    }
    if (row.public_execute) {
      issues.push(`${name} is PUBLIC-executable`);
    }
    if (row.leakproof) {
      issues.push(`${name} must not be LEAKPROOF`);
    }
    if (row.function_kind !== "f") {
      issues.push(`${name} must be an ordinary function`);
    }
    if (Boolean(row.security_definer) !== !invokerNames.has(name)) {
      issues.push(
        `${name} must be SECURITY ${invokerNames.has(name) ? "INVOKER" : "DEFINER"}`,
      );
    }
    if (row.worker_execute_grantable || row.runtime_execute_grantable) {
      issues.push(`${name} has grantable EXECUTE`);
    }
    if (normalizedStringArray(row.other_role_execute).length > 0) {
      issues.push(`${name} is executable by an unexpected role`);
    }
    if (normalizedStringArray(row.other_role_execute_grantable).length > 0) {
      issues.push(`${name} has unexpected grantable EXECUTE`);
    }
    const config = normalizedStringArray(row.function_config);
    if (config.length !== 1 || config[0] !== "search_path=pg_catalog") {
      issues.push(`${name} does not pin only search_path=pg_catalog`);
    }
    if (workerNames.has(name)) {
      if (!row.worker_execute || !row.worker_direct_execute) {
        issues.push(`${name} must be executable only by the cleanup worker`);
      }
      if (row.runtime_execute || row.runtime_direct_execute) {
        issues.push(`${name} must be runtime-inaccessible`);
      }
    } else {
      if (row.worker_execute || row.worker_direct_execute) {
        issues.push(`${name} must be cleanup-worker-inaccessible`);
      }
      if (runtimeNames.has(name)) {
        if (!row.runtime_execute || !row.runtime_direct_execute) {
          issues.push(`${name} must be runtime-executable`);
        }
      } else if (
        privateNames.has(name)
        && (row.runtime_execute || row.runtime_direct_execute)
      ) {
        issues.push(`${name} must be runtime-inaccessible`);
      }
    }
  }
  return issues;
}

export async function readDirectUploadCleanupAuthority(client) {
  const identity = await client.query(
    "SELECT current_user AS current_user, session_user AS session_user",
  );
  const role = await client.query(
    `SELECT
       rolname, rolsuper, rolcreatedb, rolcreaterole, rolinherit,
       rolcanlogin, rolreplication, rolbypassrls
     FROM pg_catalog.pg_roles
     WHERE rolname = current_user`,
  );
  const memberships = await client.query(
    `WITH RECURSIVE membership AS (
       SELECT parent.oid, parent.rolname
       FROM pg_catalog.pg_auth_members AS edge
       JOIN pg_catalog.pg_roles AS child ON child.oid = edge.member
       JOIN pg_catalog.pg_roles AS parent ON parent.oid = edge.roleid
       WHERE child.rolname = current_user
       UNION
       SELECT parent.oid, parent.rolname
       FROM membership AS child
       JOIN pg_catalog.pg_auth_members AS edge ON edge.member = child.oid
       JOIN pg_catalog.pg_roles AS parent ON parent.oid = edge.roleid
     )
     SELECT DISTINCT rolname FROM membership ORDER BY rolname`,
  );
  const memberRoles = await client.query(
    `WITH RECURSIVE membership AS (
       SELECT child.oid, child.rolname
       FROM pg_catalog.pg_auth_members AS edge
       JOIN pg_catalog.pg_roles AS parent ON parent.oid = edge.roleid
       JOIN pg_catalog.pg_roles AS child ON child.oid = edge.member
       WHERE parent.rolname = current_user
       UNION
       SELECT child.oid, child.rolname
       FROM membership AS parent
       JOIN pg_catalog.pg_auth_members AS edge ON edge.roleid = parent.oid
       JOIN pg_catalog.pg_roles AS child ON child.oid = edge.member
     )
     SELECT DISTINCT rolname FROM membership ORDER BY rolname`,
  );
  const defaultPrivileges = await client.query(
    `SELECT pg_catalog.format(
       '%s:%s:%s',
       owner.rolname,
       COALESCE(namespace.nspname, '*'),
       pg_catalog.upper(acl.privilege_type)
     ) AS privilege
     FROM pg_catalog.pg_default_acl AS defaults
     JOIN pg_catalog.pg_roles AS owner ON owner.oid = defaults.defaclrole
     LEFT JOIN pg_catalog.pg_namespace AS namespace
       ON namespace.oid = defaults.defaclnamespace
     CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) AS acl
     WHERE acl.grantee = (
       SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user
     )
     ORDER BY privilege`,
  );
  const namespace = await client.query(
    `SELECT
       pg_catalog.has_schema_privilege(current_user, 'public', 'USAGE')
         AS schema_usage,
       pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE')
         AS schema_create,
       pg_catalog.has_database_privilege(
         current_user, current_database(), 'CREATE'
       ) AS database_create`,
  );
  const tablePrivileges = await client.query(
    `SELECT class.relname
     FROM pg_catalog.pg_class AS class
     JOIN pg_catalog.pg_namespace AS namespace
       ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND CASE
         WHEN class.relkind IN ('r', 'p', 'v', 'm', 'f') THEN
           pg_catalog.has_table_privilege(
             current_user,
             class.oid,
             'SELECT,INSERT,UPDATE,DELETE,REFERENCES'
           )
         ELSE false
       END
     ORDER BY class.relname`,
  );
  const tableAdministrativePrivileges = await client.query(
    `SELECT class.relname
     FROM pg_catalog.pg_class AS class
     JOIN pg_catalog.pg_namespace AS namespace
       ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relkind IN ('r', 'p')
       AND CASE
         WHEN class.relkind IN ('r', 'p') THEN
           pg_catalog.has_table_privilege(
             current_user,
             class.oid,
             'TRUNCATE,TRIGGER'
           )
         ELSE false
       END
     ORDER BY class.relname`,
  );
  const columnPrivileges = await client.query(
    `SELECT pg_catalog.format(
       '%I.%I',
       class.relname,
       attribute.attname
     ) AS column_name
     FROM pg_catalog.pg_class AS class
     JOIN pg_catalog.pg_namespace AS namespace
       ON namespace.oid = class.relnamespace
     JOIN pg_catalog.pg_attribute AS attribute
       ON attribute.attrelid = class.oid
     WHERE namespace.nspname = 'public'
       AND class.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND CASE
         WHEN class.relkind IN ('r', 'p', 'v', 'm', 'f') THEN
           pg_catalog.has_column_privilege(
             current_user,
             class.oid,
             attribute.attnum,
             'SELECT,INSERT,UPDATE,REFERENCES'
           )
         ELSE false
       END
     ORDER BY class.relname, attribute.attnum`,
  );
  const sequencePrivileges = await client.query(
    `SELECT class.relname
     FROM pg_catalog.pg_class AS class
     JOIN pg_catalog.pg_namespace AS namespace
       ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relkind = 'S'
       AND CASE
         WHEN class.relkind = 'S' THEN
           pg_catalog.has_sequence_privilege(
             current_user, class.oid, 'USAGE,SELECT,UPDATE'
           )
         ELSE false
       END
     ORDER BY class.relname`,
  );
  const rlsTables = await client.query(
    `SELECT
       class.relname,
       class.relrowsecurity,
       class.relforcerowsecurity,
       pg_catalog.count(policy.oid)::integer AS policy_count
     FROM pg_catalog.pg_class AS class
     JOIN pg_catalog.pg_namespace AS namespace
       ON namespace.oid = class.relnamespace
     LEFT JOIN pg_catalog.pg_policy AS policy
       ON policy.polrelid = class.oid
     WHERE namespace.nspname = 'public'
       AND class.relname IN ('DirectUpload', 'DirectUploadReference')
       AND class.relkind IN ('r', 'p')
     GROUP BY
       class.relname, class.relrowsecurity, class.relforcerowsecurity
     ORDER BY class.relname`,
  );
  const functions = await client.query(
    `SELECT
       procedure.proname AS function_name,
       pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
       procedure.prosrc AS function_source,
       procedure.prosecdef AS security_definer,
       procedure.proleakproof AS leakproof,
       procedure.prokind AS function_kind,
       procedure.proconfig AS function_config,
       pg_catalog.has_function_privilege(
         $1, procedure.oid, 'EXECUTE'
       ) AS worker_execute,
       pg_catalog.has_function_privilege(
         $2, procedure.oid, 'EXECUTE'
       ) AS runtime_execute,
       EXISTS (
         SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
         WHERE acl.grantee = (
           SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1
         )
           AND acl.privilege_type = 'EXECUTE'
       ) AS worker_direct_execute,
       EXISTS (
         SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
         WHERE acl.grantee = (
           SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $2
         )
           AND acl.privilege_type = 'EXECUTE'
       ) AS runtime_direct_execute,
       EXISTS (
         SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
         WHERE acl.grantee = (
           SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1
         )
           AND acl.privilege_type = 'EXECUTE'
           AND acl.is_grantable
       ) AS worker_execute_grantable,
       EXISTS (
         SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
         WHERE acl.grantee = (
           SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $2
         )
           AND acl.privilege_type = 'EXECUTE'
           AND acl.is_grantable
       ) AS runtime_execute_grantable,
       EXISTS (
         SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
         WHERE acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
       ) AS public_execute,
       ARRAY(
         SELECT DISTINCT privilege_role.rolname
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
         JOIN pg_catalog.pg_roles AS privilege_role
           ON privilege_role.oid = acl.grantee
         WHERE acl.grantee <> procedure.proowner
           AND acl.grantee <> (
             SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1
           )
           AND acl.grantee <> (
             SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $2
           )
           AND acl.privilege_type = 'EXECUTE'
         ORDER BY privilege_role.rolname
       ) AS other_role_execute,
       ARRAY(
         SELECT DISTINCT privilege_role.rolname
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
         JOIN pg_catalog.pg_roles AS privilege_role
           ON privilege_role.oid = acl.grantee
         WHERE acl.grantee <> procedure.proowner
           AND acl.grantee <> (
             SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1
           )
           AND acl.grantee <> (
             SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $2
           )
           AND acl.privilege_type = 'EXECUTE'
           AND acl.is_grantable
         ORDER BY privilege_role.rolname
       ) AS other_role_execute_grantable
     FROM pg_catalog.pg_proc AS procedure
     JOIN pg_catalog.pg_namespace AS namespace
       ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.proname LIKE 'grainline\\_direct\\_upload\\_%'
             ESCAPE '\\'
     ORDER BY procedure.proname`,
    [
      REVIEWED_TARGET.workerRole,
      REVIEWED_TARGET.runtimeRole,
    ],
  );
  const unexpectedFunctionPrivileges = await client.query(
    `SELECT pg_catalog.format(
       '%I.%I(%s)',
       namespace.nspname,
       procedure.proname,
       pg_catalog.pg_get_function_identity_arguments(procedure.oid)
     ) AS function_signature
     FROM pg_catalog.pg_proc AS procedure
     JOIN pg_catalog.pg_namespace AS namespace
       ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND pg_catalog.has_function_privilege(
         current_user,
         procedure.oid,
         'EXECUTE'
       )
       AND procedure.prosecdef
       AND procedure.proname <> ALL ($1::text[])
     ORDER BY function_signature`,
    [DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES],
  );
  return Object.freeze({
    columnPrivileges: columnPrivileges.rows.map((row) => row.column_name),
    currentUser: identity.rows[0]?.current_user,
    databaseCreate: namespace.rows[0]?.database_create,
    defaultPrivileges: defaultPrivileges.rows.map((row) => row.privilege),
    functions: functions.rows,
    memberRoles: memberRoles.rows.map((row) => row.rolname),
    memberships: memberships.rows.map((row) => row.rolname),
    role: role.rows[0],
    rlsTables: rlsTables.rows,
    schemaCreate: namespace.rows[0]?.schema_create,
    schemaUsage: namespace.rows[0]?.schema_usage,
    sequencePrivileges: sequencePrivileges.rows.map((row) => row.relname),
    sessionUser: identity.rows[0]?.session_user,
    tablePrivileges: [
      ...tablePrivileges.rows.map((row) => row.relname),
      ...tableAdministrativePrivileges.rows.map((row) => row.relname),
    ],
    unexpectedFunctionPrivileges:
      unexpectedFunctionPrivileges.rows.map(
        (row) => row.function_signature,
      ),
  });
}

function assertCleanupRow(row) {
  if (
    !row
    || typeof row.id !== "string"
    || row.id.length < 1
    || row.id.length > 191
    || typeof row.key !== "string"
    || row.key.length < 1
    || row.key.length > 500
    || /[\u0000-\u001f\u007f]/.test(row.key)
    || !new Set(["PUBLIC", "PRIVATE"]).has(row.storageClass)
    || typeof row.leaseId !== "string"
    || row.leaseId.length < 1
    || row.leaseId.length > 64
  ) {
    throw new Error("cleanup lease returned an invalid bounded row");
  }
}

export function directUploadCleanupProviderErrorCode(error) {
  const status = Number(error?.$metadata?.httpStatusCode);
  const safeStatus = Number.isInteger(status) && status >= 400 && status <= 599
    ? String(status)
    : "UNKNOWN";
  const rawName = error instanceof Error ? error.name : "";
  const safeName = /^[A-Za-z][A-Za-z0-9]{0,49}$/.test(rawName)
    ? rawName.toUpperCase()
    : "ERROR";
  return `R2_DELETE_${safeStatus}_${safeName}`;
}

export async function runDirectUploadCleanup({
  client,
  deleteObject,
  batchSize = DIRECT_UPLOAD_CLEANUP_BATCH_SIZE,
  maxBatches = DIRECT_UPLOAD_CLEANUP_MAX_BATCHES,
}) {
  const result = {
    batches: 0,
    checked: 0,
    complete: false,
    deleted: 0,
    failureCodes: {},
    failed: 0,
    skipped: 0,
  };
  while (result.batches < maxBatches) {
    const leased = await client.query(
      `SELECT *
       FROM public.grainline_direct_upload_cleanup_lease($1)`,
      [batchSize],
    );
    result.batches += 1;
    result.checked += leased.rows.length;
    for (const row of leased.rows) {
      assertCleanupRow(row);
      let providerError;
      try {
        await deleteObject({
          key: row.key,
          storageClass: row.storageClass,
        });
      } catch (error) {
        providerError = error;
      }
      if (providerError) {
        const code = directUploadCleanupProviderErrorCode(providerError);
        const failure = await client.query(
          `SELECT public.grainline_direct_upload_cleanup_fail(
             $1, $2, $3
           ) AS failed`,
          [row.id, row.leaseId, code],
        );
        if (failure.rows[0]?.failed !== true) {
          throw new Error(
            "DirectUpload cleanup could not fence a provider failure",
          );
        }
        result.failed += 1;
        result.failureCodes[code] = (result.failureCodes[code] ?? 0) + 1;
        continue;
      }
      const completion = await client.query(
        `SELECT public.grainline_direct_upload_cleanup_complete(
           $1, $2
         ) AS completed`,
        [row.id, row.leaseId],
      );
      if (completion.rows[0]?.completed === true) result.deleted += 1;
      else result.skipped += 1;
    }
    if (leased.rows.length < batchSize) {
      result.complete = true;
      break;
    }
  }
  return Object.freeze({
    ...result,
    failureCodes: Object.freeze({ ...result.failureCodes }),
  });
}

function writeEvidence(pathname, evidence) {
  const descriptor = openSync(
    pathname,
    "wx",
    0o600,
  );
  try {
    writeFileSync(
      descriptor,
      `${JSON.stringify(evidence, null, 2)}\n`,
      "utf8",
    );
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(pathname, 0o600);
  if (
    !lstatSync(pathname).isFile()
    || (lstatSync(pathname).mode & 0o777) !== 0o600
  ) {
    throw new Error("DirectUpload cleanup evidence mode is not 0600");
  }
}

async function main() {
  const config = parseDirectUploadCleanupWorkerConfig(process.env);
  const git = assertDirectUploadCleanupGitState(
    readDirectUploadCleanupGitState(),
    config.releaseCommit,
  );
  const client = new Client({
    connectionString: config.databaseUrl,
    ...postgresChannelBindingClientOptions(config.identity.parsed),
    application_name: "grainline-direct-upload-cleanup",
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
  });
  const r2 = new S3Client({
    region: "auto",
    endpoint: `https://${config.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.r2AccessKeyId,
      secretAccessKey: config.r2SecretAccessKey,
    },
  });
  const startedAt = new Date().toISOString();
  let result;
  try {
    await client.connect();
    const authority = await readDirectUploadCleanupAuthority(client);
    const issues = collectDirectUploadCleanupAuthorityIssues(authority);
    if (issues.length > 0) {
      throw new Error(
        `DirectUpload cleanup authority is not activation-ready (${issues.length} issue(s))`,
      );
    }
    result = await runDirectUploadCleanup({
      client,
      deleteObject: ({ key, storageClass }) =>
        r2.send(
          new DeleteObjectCommand({
            Bucket:
              storageClass === "PRIVATE"
                ? config.privateBucket
                : config.publicBucket,
            Key: key,
          }),
        ),
    });
  } finally {
    await client.end().catch(() => {});
    r2.destroy();
  }

  const evidence = Object.freeze({
    schemaVersion: 1,
    operation: "direct-upload-cleanup",
    source: Object.freeze({
      clean: git.clean,
      commit: git.head,
    }),
    target: Object.freeze({
      databaseName: config.identity.databaseName,
      databaseUrlSha256: config.databaseUrlSha256,
      endpointId: config.identity.endpointId,
      privateBucketSha256: config.privateBucketSha256,
      publicBucketSha256: config.publicBucketSha256,
      r2AccountIdSha256: config.r2AccountIdSha256,
      region: config.identity.region,
      role: config.identity.username,
    }),
    run: Object.freeze({
      attempt: config.runAttempt,
      completedAt: new Date().toISOString(),
      id: config.runId,
      startedAt,
    }),
    result,
  });
  writeEvidence(config.evidencePath, evidence);
  process.stdout.write(
    `${JSON.stringify({
      batches: result.batches,
      checked: result.checked,
      complete: result.complete,
      deleted: result.deleted,
      failed: result.failed,
      skipped: result.skipped,
    })}\n`,
  );
  if (result.failed > 0 || result.skipped > 0) {
    throw new Error(
      `DirectUpload cleanup recorded ${result.failed} provider failure(s) and ${result.skipped} superseded completion(s)`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "unknown error";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
