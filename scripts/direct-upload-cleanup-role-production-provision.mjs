#!/usr/bin/env node
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
import {
  DIRECT_UPLOAD_AUTHORITY_FUNCTIONS,
} from "./direct-upload-authority-catalog.mjs";
import {
  DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES,
  DIRECT_UPLOAD_CLEANUP_ROLE,
} from "./direct-upload-activation-catalog.mjs";
import {
  PRODUCTION_MIGRATION_CONFIRMATION,
  REVIEWED_MIGRATION_ROLE,
  REVIEWED_RUNTIME_ROLE,
  parseProductionMigrationEnvironment,
  runProductionMigrationPreflight,
} from "./guard-production-migration-runner.mjs";
import {
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";

const { Client } = pg;

export const DIRECT_UPLOAD_CLEANUP_ROLE_PROVISION_CONFIRMATION =
  "provision-reviewed-direct-upload-cleanup-role";

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SAFE_RUN_ID_PATTERN = /^[1-9][0-9]{0,19}$/;
const EVIDENCE_PREFIX = "direct-upload-cleanup-role-provision-";
const FORBIDDEN_ENVIRONMENT_KEYS = Object.freeze([
  "DATABASE_URL",
  "GRANT_AUDIT_DATABASE_URL",
  "DIRECT_UPLOAD_CLEANUP_DATABASE_URL",
  "DIRECT_UPLOAD_CLEANUP_R2_ACCESS_KEY_ID",
  "DIRECT_UPLOAD_CLEANUP_R2_SECRET_ACCESS_KEY",
  "CLOUDFLARE_R2_ACCESS_KEY_ID",
  "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
]);

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

export function parseDirectUploadCleanupRoleProvisionConfig(
  env = process.env,
) {
  if (
    env.DIRECT_UPLOAD_CLEANUP_ROLE_PROVISION_CONFIRM
      !== DIRECT_UPLOAD_CLEANUP_ROLE_PROVISION_CONFIRMATION
  ) {
    throw new Error("DirectUpload cleanup-role provision confirmation is invalid");
  }
  const forbiddenPresent = FORBIDDEN_ENVIRONMENT_KEYS.filter((key) =>
    Object.hasOwn(env, key),
  );
  if (forbiddenPresent.length > 0) {
    throw new Error(
      `DirectUpload cleanup-role provision environment contains forbidden credentials: ${forbiddenPresent.join(", ")}`,
    );
  }

  const releaseCommit = required(
    env,
    "DIRECT_UPLOAD_CLEANUP_ROLE_RELEASE_COMMIT",
  );
  if (!COMMIT_PATTERN.test(releaseCommit)) {
    throw new Error("DirectUpload cleanup-role release commit is invalid");
  }
  const runId = required(env, "GITHUB_RUN_ID");
  if (!SAFE_RUN_ID_PATTERN.test(runId)) {
    throw new Error("DirectUpload cleanup-role workflow run id is invalid");
  }
  const runnerTemp = path.resolve(required(env, "RUNNER_TEMP"));
  const evidencePath = path.resolve(
    required(env, "DIRECT_UPLOAD_CLEANUP_ROLE_EVIDENCE_PATH"),
  );
  if (
    evidencePath
      !== path.join(runnerTemp, `${EVIDENCE_PREFIX}${releaseCommit}.json`)
    || existsSync(evidencePath)
  ) {
    throw new Error(
      "DirectUpload cleanup-role evidence path is not the fresh reviewed runner path",
    );
  }

  const owner = parseProductionMigrationEnvironment({
    ...env,
    PRODUCTION_MIGRATION_CONFIRM: PRODUCTION_MIGRATION_CONFIRMATION,
    PRODUCTION_MIGRATION_RELEASE_COMMIT: releaseCommit,
  });
  return Object.freeze({
    ...owner,
    evidencePath,
    runId,
  });
}

function normalizedStrings(value) {
  return Array.isArray(value)
    ? value.map(String).sort((left, right) => left.localeCompare(right))
    : [];
}

function exactStrings(actual, expected) {
  const left = normalizedStrings(actual);
  const right = normalizedStrings(expected);
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

export function collectDirectUploadCleanupRoleProvisionIssues(snapshot) {
  const issues = [];
  if (
    snapshot?.currentUser !== REVIEWED_MIGRATION_ROLE
    || snapshot?.sessionUser !== REVIEWED_MIGRATION_ROLE
  ) {
    issues.push("postflight is not authenticated as the migration owner");
  }
  if (snapshot?.transactionReadOnly !== "on") {
    issues.push("postflight transaction is not read-only");
  }

  const role = snapshot?.role;
  if (
    !role
    || role.rolname !== DIRECT_UPLOAD_CLEANUP_ROLE
    || role.rolsuper !== false
    || role.rolcreatedb !== false
    || role.rolcreaterole !== false
    || role.rolinherit !== false
    || role.rolcanlogin !== true
    || role.rolreplication !== false
    || role.rolbypassrls !== false
  ) {
    issues.push("cleanup role attributes are not exact");
  }
  if (normalizedStrings(snapshot?.memberships).length > 0) {
    issues.push("cleanup role has a parent-role membership");
  }
  if (normalizedStrings(snapshot?.memberRoles).length > 0) {
    issues.push("cleanup role has a member role");
  }
  if (
    snapshot?.schemaUsage !== true
    || snapshot?.schemaCreate !== false
    || snapshot?.databaseCreate !== false
  ) {
    issues.push("cleanup role schema or database authority is not exact");
  }
  for (const [field, label] of [
    ["tablePrivileges", "table"],
    ["columnPrivileges", "column"],
    ["sequencePrivileges", "sequence"],
    ["defaultPrivileges", "default privilege"],
    ["unexpectedFunctionPrivileges", "unexpected privileged function"],
  ]) {
    if (normalizedStrings(snapshot?.[field]).length > 0) {
      issues.push(`cleanup role has ${label} authority`);
    }
  }

  const expectedFunctionNames = DIRECT_UPLOAD_AUTHORITY_FUNCTIONS
    .map((entry) => entry.name);
  const functionRows = Array.isArray(snapshot?.functions)
    ? snapshot.functions
    : [];
  if (
    !exactStrings(
      functionRows.map((row) => row.function_name),
      expectedFunctionNames,
    )
  ) {
    issues.push("DirectUpload function catalog is not exact");
  }
  const cleanupFunctions = new Set(DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES);
  const expectedRuntime = new Map(
    DIRECT_UPLOAD_AUTHORITY_FUNCTIONS.map((entry) => [
      entry.name,
      entry.runtimeExecute,
    ]),
  );
  for (const row of functionRows) {
    const name = row.function_name;
    const cleanupExpected = cleanupFunctions.has(name);
    const runtimeExpected = expectedRuntime.get(name);
    if (row.owner_name !== REVIEWED_MIGRATION_ROLE) {
      issues.push(`${name} has the wrong owner`);
    }
    if (row.public_execute !== false) {
      issues.push(`${name} is PUBLIC-executable`);
    }
    if (
      row.cleanup_execute !== cleanupExpected
      || row.cleanup_direct_execute !== cleanupExpected
      || row.cleanup_execute_grantable !== false
    ) {
      issues.push(`${name} cleanup-role EXECUTE authority is not exact`);
    }
    if (
      typeof runtimeExpected !== "boolean"
      || row.runtime_execute !== runtimeExpected
      || row.runtime_direct_execute !== runtimeExpected
      || row.runtime_execute_grantable !== false
    ) {
      issues.push(`${name} compatible runtime EXECUTE authority drifted`);
    }
  }

  const tableRows = Array.isArray(snapshot?.tables) ? snapshot.tables : [];
  const directUploadRows = tableRows.filter(
    (row) => row.table_name === "DirectUpload",
  );
  const referenceRows = tableRows.filter(
    (row) => row.table_name === "DirectUploadReference",
  );
  if (directUploadRows.length !== 1 || referenceRows.length !== 1) {
    issues.push("DirectUpload table catalog is not exact");
  } else {
    const directUpload = directUploadRows[0];
    if (
      directUpload.owner_name !== REVIEWED_MIGRATION_ROLE
      || directUpload.rls_enabled !== false
      || directUpload.rls_forced !== false
      || Number(directUpload.policy_count) !== 0
      || directUpload.runtime_select !== true
      || directUpload.runtime_insert !== true
      || directUpload.runtime_update !== true
      || directUpload.runtime_delete !== true
      || directUpload.cleanup_select !== false
      || directUpload.cleanup_insert !== false
      || directUpload.cleanup_update !== false
      || directUpload.cleanup_delete !== false
    ) {
      issues.push("DirectUpload compatible pre-activation posture drifted");
    }
    const reference = referenceRows[0];
    if (
      reference.owner_name !== REVIEWED_MIGRATION_ROLE
      || reference.rls_enabled !== true
      || reference.rls_forced !== true
      || Number(reference.policy_count) !== 0
      || reference.runtime_select !== false
      || reference.runtime_insert !== false
      || reference.runtime_update !== false
      || reference.runtime_delete !== false
      || reference.cleanup_select !== false
      || reference.cleanup_insert !== false
      || reference.cleanup_update !== false
      || reference.cleanup_delete !== false
    ) {
      issues.push("DirectUploadReference service-table posture drifted");
    }
  }
  if (Number(snapshot?.incompleteMigrationCount) !== 0) {
    issues.push("production migration ledger contains an incomplete migration");
  }
  return issues;
}

export async function readDirectUploadCleanupRoleProvisionSnapshot(client) {
  const identity = (await client.query(`
    SELECT
      CURRENT_USER AS current_user,
      SESSION_USER AS session_user,
      pg_catalog.current_setting('transaction_read_only')
        AS transaction_read_only
  `)).rows[0];
  const role = (await client.query(`
    SELECT
      rolname, rolsuper, rolcreatedb, rolcreaterole, rolinherit,
      rolcanlogin, rolreplication, rolbypassrls
    FROM pg_catalog.pg_roles
    WHERE rolname = $1
  `, [DIRECT_UPLOAD_CLEANUP_ROLE])).rows[0];
  const memberships = await client.query(`
    WITH RECURSIVE membership AS (
      SELECT parent.oid, parent.rolname
      FROM pg_catalog.pg_auth_members AS edge
      JOIN pg_catalog.pg_roles AS child ON child.oid = edge.member
      JOIN pg_catalog.pg_roles AS parent ON parent.oid = edge.roleid
      WHERE child.rolname = $1
      UNION
      SELECT parent.oid, parent.rolname
      FROM membership AS child
      JOIN pg_catalog.pg_auth_members AS edge ON edge.member = child.oid
      JOIN pg_catalog.pg_roles AS parent ON parent.oid = edge.roleid
    )
    SELECT DISTINCT rolname FROM membership ORDER BY rolname
  `, [DIRECT_UPLOAD_CLEANUP_ROLE]);
  const memberRoles = await client.query(`
    WITH RECURSIVE membership AS (
      SELECT child.oid, child.rolname
      FROM pg_catalog.pg_auth_members AS edge
      JOIN pg_catalog.pg_roles AS parent ON parent.oid = edge.roleid
      JOIN pg_catalog.pg_roles AS child ON child.oid = edge.member
      WHERE parent.rolname = $1
      UNION
      SELECT child.oid, child.rolname
      FROM membership AS parent
      JOIN pg_catalog.pg_auth_members AS edge ON edge.roleid = parent.oid
      JOIN pg_catalog.pg_roles AS child ON child.oid = edge.member
    )
    SELECT DISTINCT rolname FROM membership ORDER BY rolname
  `, [DIRECT_UPLOAD_CLEANUP_ROLE]);
  const namespace = (await client.query(`
    SELECT
      pg_catalog.has_schema_privilege($1, 'public', 'USAGE')
        AS schema_usage,
      pg_catalog.has_schema_privilege($1, 'public', 'CREATE')
        AS schema_create,
      pg_catalog.has_database_privilege($1, CURRENT_DATABASE(), 'CREATE')
        AS database_create
  `, [DIRECT_UPLOAD_CLEANUP_ROLE])).rows[0];
  const tablePrivileges = await client.query(`
    SELECT pg_catalog.format('%I.%I:%s', namespace.nspname, class.relname, privilege)
      AS privilege
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
    CROSS JOIN (
      VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
             ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
    ) AS requested(privilege)
    WHERE namespace.nspname = 'public'
      AND class.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND CASE
        WHEN class.relkind IN ('r', 'p') THEN
          pg_catalog.has_table_privilege($1, class.oid, privilege)
        WHEN privilege IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REFERENCES') THEN
          pg_catalog.has_table_privilege($1, class.oid, privilege)
        ELSE false
      END
    ORDER BY privilege
  `, [DIRECT_UPLOAD_CLEANUP_ROLE]);
  const columnPrivileges = await client.query(`
    SELECT pg_catalog.format(
      '%I.%I.%I:%s',
      namespace.nspname,
      class.relname,
      attribute.attname,
      requested.privilege
    ) AS privilege
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
    JOIN pg_catalog.pg_attribute AS attribute ON attribute.attrelid = class.oid
    CROSS JOIN (
      VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')
    ) AS requested(privilege)
    WHERE namespace.nspname = 'public'
      AND class.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND CASE
        WHEN class.relkind IN ('r', 'p', 'v', 'm', 'f') THEN
          pg_catalog.has_column_privilege(
            $1, class.oid, attribute.attnum, requested.privilege
          )
        ELSE false
      END
    ORDER BY privilege
  `, [DIRECT_UPLOAD_CLEANUP_ROLE]);
  const sequencePrivileges = await client.query(`
    SELECT pg_catalog.format(
      '%I.%I:%s',
      namespace.nspname,
      class.relname,
      requested.privilege
    ) AS privilege
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
    CROSS JOIN (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) AS requested(privilege)
    WHERE namespace.nspname = 'public'
      AND class.relkind = 'S'
      AND CASE
        WHEN class.relkind = 'S' THEN
          pg_catalog.has_sequence_privilege($1, class.oid, requested.privilege)
        ELSE false
      END
    ORDER BY privilege
  `, [DIRECT_UPLOAD_CLEANUP_ROLE]);
  const defaultPrivileges = await client.query(`
    SELECT pg_catalog.format(
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
      SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1
    )
    ORDER BY privilege
  `, [DIRECT_UPLOAD_CLEANUP_ROLE]);
  const functions = await client.query(`
    SELECT
      procedure.proname AS function_name,
      pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
      pg_catalog.has_function_privilege(
        $1, procedure.oid, 'EXECUTE'
      ) AS cleanup_execute,
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
        WHERE acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
      ) AS public_execute,
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
      ) AS cleanup_direct_execute,
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
      ) AS cleanup_execute_grantable,
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
      ) AS runtime_execute_grantable
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname LIKE 'grainline\_direct\_upload\_%' ESCAPE '\'
    ORDER BY procedure.proname
  `, [DIRECT_UPLOAD_CLEANUP_ROLE, REVIEWED_RUNTIME_ROLE]);
  const unexpectedFunctionPrivileges = await client.query(`
    SELECT pg_catalog.format(
      '%I.%I(%s)',
      namespace.nspname,
      procedure.proname,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid)
    ) AS function_signature
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND pg_catalog.has_function_privilege($1, procedure.oid, 'EXECUTE')
      AND procedure.prosecdef
      AND procedure.proname <> ALL ($2::text[])
    ORDER BY function_signature
  `, [DIRECT_UPLOAD_CLEANUP_ROLE, DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES]);
  const tables = await client.query(`
    SELECT
      class.relname AS table_name,
      class.relrowsecurity AS rls_enabled,
      class.relforcerowsecurity AS rls_forced,
      pg_catalog.pg_get_userbyid(class.relowner) AS owner_name,
      (
        SELECT pg_catalog.count(*)::integer
        FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
      ) AS policy_count,
      pg_catalog.has_table_privilege($1, class.oid, 'SELECT')
        AS cleanup_select,
      pg_catalog.has_table_privilege($1, class.oid, 'INSERT')
        AS cleanup_insert,
      pg_catalog.has_table_privilege($1, class.oid, 'UPDATE')
        AS cleanup_update,
      pg_catalog.has_table_privilege($1, class.oid, 'DELETE')
        AS cleanup_delete,
      pg_catalog.has_table_privilege($2, class.oid, 'SELECT')
        AS runtime_select,
      pg_catalog.has_table_privilege($2, class.oid, 'INSERT')
        AS runtime_insert,
      pg_catalog.has_table_privilege($2, class.oid, 'UPDATE')
        AS runtime_update,
      pg_catalog.has_table_privilege($2, class.oid, 'DELETE')
        AS runtime_delete
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public'
      AND class.relkind IN ('r', 'p')
      AND class.relname IN ('DirectUpload', 'DirectUploadReference')
    ORDER BY class.relname
  `, [DIRECT_UPLOAD_CLEANUP_ROLE, REVIEWED_RUNTIME_ROLE]);
  const incompleteMigrationCount = Number((await client.query(`
    SELECT pg_catalog.count(*)::integer AS count
    FROM public._prisma_migrations
    WHERE finished_at IS NULL AND rolled_back_at IS NULL
  `)).rows[0]?.count);
  return Object.freeze({
    columnPrivileges: columnPrivileges.rows.map((row) => row.privilege),
    currentUser: identity.current_user,
    databaseCreate: namespace.database_create,
    defaultPrivileges: defaultPrivileges.rows.map((row) => row.privilege),
    functions: functions.rows,
    incompleteMigrationCount,
    memberRoles: memberRoles.rows.map((row) => row.rolname),
    memberships: memberships.rows.map((row) => row.rolname),
    role,
    schemaCreate: namespace.schema_create,
    schemaUsage: namespace.schema_usage,
    sequencePrivileges: sequencePrivileges.rows.map((row) => row.privilege),
    sessionUser: identity.session_user,
    tablePrivileges: tablePrivileges.rows.map((row) => row.privilege),
    tables: tables.rows,
    transactionReadOnly: identity.transaction_read_only,
    unexpectedFunctionPrivileges:
      unexpectedFunctionPrivileges.rows.map((row) => row.function_signature),
  });
}

function writeEvidence(pathname, evidence) {
  const descriptor = openSync(pathname, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(pathname, 0o600);
  if (
    !lstatSync(pathname).isFile()
    || (lstatSync(pathname).mode & 0o777) !== 0o600
  ) {
    throw new Error("DirectUpload cleanup-role evidence mode is not 0600");
  }
}

export function writeDirectUploadCleanupRoleProvisionEvidence(
  pathname,
  evidence,
) {
  writeEvidence(pathname, evidence);
}

async function runPreflight(config) {
  const result = await runProductionMigrationPreflight(config);
  process.stdout.write(`${JSON.stringify({
    status: result.status,
    releaseCommit: result.releaseCommit,
    directUrlSha256: result.directUrlSha256,
    databaseName: result.database.databaseName,
    ownerRole: result.database.ownerRole,
    runtimeRole: result.database.runtimeRole,
  })}\n`);
}

async function runPostflight(config) {
  const source = await runProductionMigrationPreflight(config);
  const parsed = new URL(config.directUrl);
  const client = new Client({
    connectionString: config.directUrl,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-direct-upload-cleanup-role-postflight",
    ...postgresChannelBindingClientOptions(parsed),
  });
  let transactionOpen = false;
  let snapshot;
  try {
    await client.connect();
    await client.query("BEGIN TRANSACTION READ ONLY");
    transactionOpen = true;
    snapshot = await readDirectUploadCleanupRoleProvisionSnapshot(client);
    const issues = collectDirectUploadCleanupRoleProvisionIssues(snapshot);
    if (issues.length > 0) {
      throw new Error(
        `DirectUpload cleanup-role production postflight failed: ${issues.join("; ")}`,
      );
    }
    await client.query("ROLLBACK");
    transactionOpen = false;
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }

  const completedAt = new Date().toISOString();
  const evidence = Object.freeze({
    schemaVersion: 1,
    operation: "direct-upload-cleanup-role-provision",
    source: Object.freeze({
      clean: source.git.clean,
      commit: source.git.head,
    }),
    target: Object.freeze({
      cleanupRole: DIRECT_UPLOAD_CLEANUP_ROLE,
      databaseName: source.database.databaseName,
      directUrlSha256: config.directUrlSha256,
      ownerRole: REVIEWED_MIGRATION_ROLE,
      runtimeRole: REVIEWED_RUNTIME_ROLE,
    }),
    run: Object.freeze({
      completedAt,
      id: config.runId,
    }),
    proof: Object.freeze({
      cleanupFunctionCount: DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES.length,
      cleanupRoleHasCreateAuthority: false,
      cleanupRoleHasDefaultPrivileges: false,
      cleanupRoleHasMemberships: false,
      cleanupRoleHasTableColumnOrSequenceAuthority: false,
      directUploadFunctionCount: snapshot.functions.length,
      directUploadReferenceForced: true,
      directUploadRlsStillOff: true,
      incompleteMigrationCount: snapshot.incompleteMigrationCount,
      postflightReadOnly: true,
      runtimeCompatibleAuthorityRetained: true,
    }),
    productionChangedByPostflight: false,
    provisioningConvergedExistingRole: true,
  });
  writeEvidence(config.evidencePath, evidence);
  process.stdout.write(`${JSON.stringify({
    status: "passed",
    releaseCommit: source.releaseCommit,
    cleanupRole: DIRECT_UPLOAD_CLEANUP_ROLE,
    cleanupFunctionCount: DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES.length,
    directUploadFunctionCount: snapshot.functions.length,
    directUploadRlsStillOff: true,
    postflightReadOnly: true,
    productionChangedByPostflight: false,
  })}\n`);
}

async function main() {
  try {
    const config = parseDirectUploadCleanupRoleProvisionConfig(process.env);
    if (process.argv.includes("--preflight")) {
      await runPreflight(config);
      return;
    }
    if (process.argv.includes("--postflight")) {
      await runPostflight(config);
      return;
    }
    throw new Error("DirectUpload cleanup-role provision mode is required");
  } catch {
    process.stderr.write("DirectUpload cleanup-role production operator failed.\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
