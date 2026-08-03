#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  DIRECT_UPLOAD_ACTIVATION_FUNCTIONS,
  DIRECT_UPLOAD_ACTIVATION_INVOKER_FUNCTION_NAMES,
  DIRECT_UPLOAD_ACTIVATION_PRIVATE_FUNCTION_NAMES,
  DIRECT_UPLOAD_ACTIVATION_RUNTIME_FUNCTION_NAMES,
  DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES,
  DIRECT_UPLOAD_CLEANUP_ROLE,
  hasReviewedDirectUploadCleanupMemberPosture,
} from "./direct-upload-activation-catalog.mjs";
import {
  extractDirectUploadActivationReadOnlyPreflight,
  LISTING_VARIANTS_HISTORICAL_LEDGER_ALIAS,
  LISTING_VARIANTS_REVIEWED_MIGRATION,
  summarizeListingVariantsLedgerAlias,
} from "./direct-upload-activation-failure-inspect.mjs";
import {
  collectDirectUploadCleanupRoleProvisionIssues,
  readDirectUploadCleanupRoleProvisionSnapshot,
} from "./direct-upload-cleanup-role-production-provision.mjs";
import {
  directUploadFunctionSourceHashes,
} from "./direct-upload-function-source-catalog.mjs";
import {
  validateCurrentSavedSearchRlsDeployShape,
} from "./guard-saved-search-rls-deploy.mjs";
import {
  PRODUCTION_MIGRATION_CONFIRMATION,
  REVIEWED_MIGRATION_ROLE,
  REVIEWED_RUNTIME_ROLE,
  assertProductionMigrationDatabaseState,
  assertProductionMigrationGitState,
  parseProductionMigrationEnvironment,
  readProductionMigrationGitState,
} from "./guard-production-migration-runner.mjs";
import {
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";
import {
  DIRECT_UPLOAD_ACTIVATION_RELEASE,
  FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
  verifyDirectUploadActivationRelease,
} from "./verify-direct-upload-activation-release.mjs";

const { Client } = pg;

export const DIRECT_UPLOAD_ACTIVATION_PRODUCTION_RECOVERY_CONFIRMATION =
  "recover-failed-direct-upload-activation-exact";
export const DIRECT_UPLOAD_ACTIVATION_FAILED_PRODUCTION_RUN_ID =
  "30729632410";
export const DIRECT_UPLOAD_ACTIVATION_RECOVERY_PROOF_RUN_ID =
  "30734098369";
const REVIEWED_REPOSITORY = "Drewyoung910/grainline";
const MODES = Object.freeze(["inspect", "resolved", "activated"]);
const SAFE_RUN_ID_PATTERN = /^[1-9][0-9]{0,19}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const MIGRATION_PATH = path.join(
  "prisma",
  "migrations",
  DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName,
  "migration.sql",
);
const LISTING_VARIANTS_MIGRATION_PATH = path.join(
  "prisma",
  "migrations",
  LISTING_VARIANTS_REVIEWED_MIGRATION,
  "migration.sql",
);
const FORBIDDEN_ENVIRONMENT_KEYS = Object.freeze([
  "DATABASE_URL",
  "GRANT_AUDIT_DATABASE_URL",
  "PRODUCTION_MIGRATION_DIRECT_URL",
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

function parseMode(argv) {
  if (argv.length !== 1 || !argv[0]?.startsWith("--")) {
    throw new Error("DirectUpload production recovery requires one exact mode");
  }
  const mode = argv[0].slice(2);
  if (!MODES.includes(mode)) {
    throw new Error("DirectUpload production recovery mode is invalid");
  }
  return mode;
}

function parseRunId(env, key) {
  const value = required(env, key);
  if (!SAFE_RUN_ID_PATTERN.test(value)) {
    throw new Error(`${key} must be one positive GitHub Actions run id`);
  }
  return value;
}

export function parseDirectUploadActivationProductionRecoveryConfig(
  env = process.env,
  argv = process.argv.slice(2),
) {
  const mode = parseMode(argv);
  if (
    env.DIRECT_UPLOAD_ACTIVATION_RECOVERY_CONFIRM
      !== DIRECT_UPLOAD_ACTIVATION_PRODUCTION_RECOVERY_CONFIRMATION
  ) {
    throw new Error("DirectUpload production recovery confirmation is invalid");
  }
  if (env.GITHUB_REPOSITORY !== REVIEWED_REPOSITORY) {
    throw new Error("DirectUpload production recovery repository is invalid");
  }
  const forbidden = FORBIDDEN_ENVIRONMENT_KEYS.filter((key) =>
    Object.hasOwn(env, key),
  );
  if (forbidden.length > 0) {
    throw new Error(
      `DirectUpload production recovery contains forbidden credentials: ${forbidden.join(", ")}`,
    );
  }

  const releaseCommit = required(
    env,
    "DIRECT_UPLOAD_ACTIVATION_RECOVERY_RELEASE_COMMIT",
  );
  if (!COMMIT_PATTERN.test(releaseCommit)) {
    throw new Error("DirectUpload production recovery commit is invalid");
  }
  const failedMigrationRunId = parseRunId(
    env,
    "DIRECT_UPLOAD_ACTIVATION_FAILED_MIGRATION_RUN_ID",
  );
  const recoveryProofRunId = parseRunId(
    env,
    "DIRECT_UPLOAD_ACTIVATION_RECOVERY_PROOF_RUN_ID",
  );
  const mainCiRunId = parseRunId(
    env,
    "DIRECT_UPLOAD_ACTIVATION_RECOVERY_MAIN_CI_RUN_ID",
  );
  const recoveryRunId = parseRunId(env, "GITHUB_RUN_ID");
  if (
    failedMigrationRunId !== DIRECT_UPLOAD_ACTIVATION_FAILED_PRODUCTION_RUN_ID
    || recoveryProofRunId !== DIRECT_UPLOAD_ACTIVATION_RECOVERY_PROOF_RUN_ID
    || new Set([
      failedMigrationRunId,
      recoveryProofRunId,
      mainCiRunId,
      recoveryRunId,
    ]).size !== 4
  ) {
    throw new Error("DirectUpload production recovery run bindings are invalid");
  }

  const owner = parseProductionMigrationEnvironment({
    ...env,
    PRODUCTION_MIGRATION_CONFIRM: PRODUCTION_MIGRATION_CONFIRMATION,
    PRODUCTION_MIGRATION_RELEASE_COMMIT: releaseCommit,
  });
  const runnerTemp = path.resolve(required(env, "RUNNER_TEMP"));
  const evidencePath = path.resolve(
    required(env, "DIRECT_UPLOAD_ACTIVATION_RECOVERY_EVIDENCE_PATH"),
  );
  const expectedEvidencePath = path.join(
    runnerTemp,
    `direct-upload-activation-production-recovery-${releaseCommit}-${mode}.json`,
  );
  if (evidencePath !== expectedEvidencePath || existsSync(evidencePath)) {
    throw new Error(
      "DirectUpload production recovery evidence path is not fresh and exact",
    );
  }

  return Object.freeze({
    ...owner,
    evidencePath,
    failedMigrationRunId,
    mainCiRunId,
    mode,
    recoveryProofRunId,
    recoveryRunId,
  });
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
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

function isDate(value) {
  return value instanceof Date && !Number.isNaN(value.valueOf());
}

export function classifyDirectUploadActivationProductionRecoveryLedger(rows) {
  if (!Array.isArray(rows)) {
    throw new Error("DirectUpload recovery ledger rows are invalid");
  }
  const failedRows = rows.filter(
    (row) => row.checksum === FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
  );
  const correctedRows = rows.filter(
    (row) => row.checksum === DIRECT_UPLOAD_ACTIVATION_RELEASE.sha256,
  );
  if (
    failedRows.length !== 1
    || failedRows[0].finished_at !== null
    || !isDate(failedRows[0].started_at)
    || Number(failedRows[0].applied_steps_count) !== 0
    || rows.length !== failedRows.length + correctedRows.length
  ) {
    throw new Error("DirectUpload production recovery failed ledger row drifted");
  }
  const failed = failedRows[0];
  if (failed.rolled_back_at === null && correctedRows.length === 0) {
    return "failed";
  }
  if (!isDate(failed.rolled_back_at)) {
    throw new Error("DirectUpload production recovery rollback marker drifted");
  }
  if (correctedRows.length === 0 && rows.length === 1) {
    return "resolved";
  }
  if (correctedRows.length !== 1 || rows.length !== 2) {
    throw new Error("DirectUpload production recovery corrected ledger row drifted");
  }
  const corrected = correctedRows[0];
  if (
    !isDate(corrected.started_at)
    || !isDate(corrected.finished_at)
    || corrected.rolled_back_at !== null
    || Number(corrected.applied_steps_count) !== 1
  ) {
    throw new Error("DirectUpload production recovery corrected ledger row drifted");
  }
  return "activated";
}

export function collectDirectUploadRecoveryMigrationTreeIssues({
  listingVariantsChecksum,
  ledgerSummaries,
  migrationNames,
  state,
} = {}) {
  const issues = [];
  if (
    !Array.isArray(migrationNames)
    || migrationNames.length === 0
    || new Set(migrationNames).size !== migrationNames.length
    || migrationNames.at(-1) !== DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName
  ) {
    issues.push("reviewed migration tree order is not exact");
    return issues;
  }
  const rows = Array.isArray(ledgerSummaries) ? ledgerSummaries : [];
  const expectedLedgerNames = [
    ...migrationNames,
    LISTING_VARIANTS_HISTORICAL_LEDGER_ALIAS,
  ];
  if (!exactStrings(
    rows.map((row) => row.migration_name),
    expectedLedgerNames,
  )) {
    issues.push(
      "production migration ledger names do not match the reviewed tree and exact historical alias",
    );
    return issues;
  }
  const listingVariantsAlias = summarizeListingVariantsLedgerAlias({
    expectedChecksum: listingVariantsChecksum,
    ledgerSummaries: rows.filter((row) => [
      LISTING_VARIANTS_REVIEWED_MIGRATION,
      LISTING_VARIANTS_HISTORICAL_LEDGER_ALIAS,
    ].includes(row.migration_name)),
  });
  if (!listingVariantsAlias.exact) {
    issues.push("historical listing-variants ledger alias is not exact");
  }
  for (const row of rows) {
    if (
      row.migration_name === LISTING_VARIANTS_REVIEWED_MIGRATION
      || row.migration_name === LISTING_VARIANTS_HISTORICAL_LEDGER_ALIAS
    ) {
      continue;
    }
    const isActivation =
      row.migration_name === DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName;
    const appliedExpected = isActivation && state !== "activated" ? 0 : 1;
    const incompleteExpected = isActivation && state === "failed" ? 1 : 0;
    const rolledBackExpected = isActivation && state !== "failed" ? 1 : 0;
    const applied = Number(row.applied_count);
    const incomplete = Number(row.incomplete_count);
    const rolledBack = Number(row.rolled_back_count);
    const rowCount = Number(row.row_count);
    const countsAreExact = [applied, incomplete, rolledBack, rowCount]
      .every((value) => Number.isSafeInteger(value) && value >= 0)
      && rowCount === applied + incomplete + rolledBack;
    const stateIsExact = isActivation
      ? applied === appliedExpected
        && incomplete === incompleteExpected
        && rolledBack === rolledBackExpected
      : applied === 1
        && incomplete === 0
        && rolledBack === 0
        && rowCount === 1;
    if (!countsAreExact || !stateIsExact) {
      issues.push(`${row.migration_name} ledger summary is not exact`);
    }
  }
  const pending = rows
    .filter((row) =>
      migrationNames.includes(row.migration_name)
      && Number(row.applied_count) === 0)
    .map((row) => row.migration_name);
  const expectedPending = state === "activated"
    ? []
    : [DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName];
  if (!exactStrings(pending, expectedPending)) {
    issues.push("DirectUpload activation is not the sole pending migration");
  }
  return issues;
}

function collectCleanupRoleBaseIssues(snapshot) {
  const issues = [];
  if (
    snapshot?.currentUser !== REVIEWED_MIGRATION_ROLE
    || snapshot?.sessionUser !== REVIEWED_MIGRATION_ROLE
    || snapshot?.transactionReadOnly !== "on"
  ) {
    issues.push("owner recovery proof identity or read-only mode is not exact");
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
  if (!hasReviewedDirectUploadCleanupMemberPosture(snapshot)) {
    issues.push("cleanup role member-role posture is not exact");
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
  return issues;
}

export function collectDirectUploadActivatedRecoveryIssues(
  snapshot,
  detailedFunctions,
) {
  const issues = collectCleanupRoleBaseIssues(snapshot);
  if (Number(snapshot?.incompleteMigrationCount) !== 0) {
    issues.push("production migration ledger contains an incomplete migration");
  }

  const tableRows = Array.isArray(snapshot?.tables) ? snapshot.tables : [];
  for (const tableName of ["DirectUpload", "DirectUploadReference"]) {
    const rows = tableRows.filter((row) => row.table_name === tableName);
    if (rows.length !== 1) {
      issues.push(`${tableName} catalog row is not exact`);
      continue;
    }
    const row = rows[0];
    if (
      row.owner_name !== REVIEWED_MIGRATION_ROLE
      || row.rls_enabled !== true
      || row.rls_forced !== true
      || Number(row.policy_count) !== 0
      || row.runtime_select !== false
      || row.runtime_insert !== false
      || row.runtime_update !== false
      || row.runtime_delete !== false
      || row.cleanup_select !== false
      || row.cleanup_insert !== false
      || row.cleanup_update !== false
      || row.cleanup_delete !== false
    ) {
      issues.push(`${tableName} activated service-table posture drifted`);
    }
  }

  const functionRows = Array.isArray(detailedFunctions)
    ? detailedFunctions
    : [];
  const expectedNames = DIRECT_UPLOAD_ACTIVATION_FUNCTIONS
    .map((entry) => entry.name);
  if (!exactStrings(functionRows.map((row) => row.function_name), expectedNames)) {
    issues.push("DirectUpload activated function catalog is not exact");
  }
  const expectedFunctions = new Map(
    DIRECT_UPLOAD_ACTIVATION_FUNCTIONS.map((entry) => [entry.name, entry]),
  );
  const invokerNames = new Set(DIRECT_UPLOAD_ACTIVATION_INVOKER_FUNCTION_NAMES);
  const privateNames = new Set(DIRECT_UPLOAD_ACTIVATION_PRIVATE_FUNCTION_NAMES);
  const runtimeNames = new Set(DIRECT_UPLOAD_ACTIVATION_RUNTIME_FUNCTION_NAMES);
  const cleanupNames = new Set(DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES);
  const expectedSourceHashes = directUploadFunctionSourceHashes();
  for (const row of functionRows) {
    const expected = expectedFunctions.get(row.function_name);
    if (!expected || row.identity_arguments !== expected.identityArguments) {
      issues.push(`${row.function_name} identity arguments are not exact`);
    }
    if (
      row.owner_name !== REVIEWED_MIGRATION_ROLE
      || typeof row.function_source !== "string"
      || sha256(row.function_source) !== expectedSourceHashes[row.function_name]
    ) {
      issues.push(`${row.function_name} owner or source hash drifted`);
    }
    if (
      row.public_execute !== false
      || row.leakproof !== false
      || row.function_kind !== "f"
      || row.security_definer !== !invokerNames.has(row.function_name)
      || !exactStrings(row.function_config, ["search_path=pg_catalog"])
    ) {
      issues.push(`${row.function_name} execution mode drifted`);
    }
    const runtimeExpected = runtimeNames.has(row.function_name);
    const cleanupExpected = cleanupNames.has(row.function_name);
    if (
      row.runtime_execute !== runtimeExpected
      || row.runtime_direct_execute !== runtimeExpected
      || row.runtime_execute_grantable !== false
      || row.cleanup_execute !== cleanupExpected
      || row.cleanup_direct_execute !== cleanupExpected
      || row.cleanup_execute_grantable !== false
      || normalizedStrings(row.other_role_execute).length > 0
      || normalizedStrings(row.other_role_execute_grantable).length > 0
    ) {
      issues.push(`${row.function_name} execution grants drifted`);
    }
    if (
      privateNames.has(row.function_name)
      && (runtimeExpected || cleanupExpected)
    ) {
      issues.push(`${row.function_name} private classification drifted`);
    }
  }
  return issues;
}

async function readRole(client, roleName) {
  return (await client.query(`
    SELECT
      role.rolname, role.rolsuper, role.rolcreatedb, role.rolcreaterole,
      role.rolinherit, role.rolcanlogin, role.rolreplication,
      role.rolbypassrls,
      (
        SELECT COALESCE(
          pg_catalog.array_agg(parent.rolname::text ORDER BY parent.rolname),
          ARRAY[]::text[]
        )
        FROM pg_catalog.pg_auth_members AS membership
        JOIN pg_catalog.pg_roles AS parent
          ON parent.oid = membership.roleid
        WHERE membership.member = role.oid
      ) AS memberships,
      (
        SELECT COALESCE(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'role', parent.rolname,
              'adminOption', membership.admin_option,
              'inheritOption', membership.inherit_option,
              'setOption', membership.set_option
            ) ORDER BY parent.rolname
          ),
          '[]'::jsonb
        )
        FROM pg_catalog.pg_auth_members AS membership
        JOIN pg_catalog.pg_roles AS parent
          ON parent.oid = membership.roleid
        WHERE membership.member = role.oid
      ) AS membership_options
    FROM pg_catalog.pg_roles AS role
    WHERE role.rolname = $1
  `, [roleName])).rows[0];
}

async function readProductionBaseState(client, incompleteMigrationCount) {
  const identity = (await client.query(`
    SELECT
      pg_catalog.current_database() AS database_name,
      CURRENT_USER AS current_user_name,
      SESSION_USER AS session_user_name
  `)).rows[0];
  const savedSearch = (await client.query(`
    SELECT
      class.relrowsecurity AS rls_enabled,
      class.relforcerowsecurity AS rls_forced,
      pg_catalog.pg_get_userbyid(class.relowner) AS owner_name,
      (
        SELECT pg_catalog.count(*)::integer
        FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
      ) AS policy_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public'
      AND class.relname = 'SavedSearch'
      AND class.relkind IN ('r', 'p')
  `)).rows[0];
  return {
    identity,
    incompleteMigrationCount,
    ownerRole: await readRole(client, REVIEWED_MIGRATION_ROLE),
    runtimeRole: await readRole(client, REVIEWED_RUNTIME_ROLE),
    savedSearch,
  };
}

async function readDetailedFunctions(client) {
  return (await client.query(`
    SELECT
      procedure.proname AS function_name,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid)
        AS identity_arguments,
      pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
      procedure.prosrc AS function_source,
      procedure.prosecdef AS security_definer,
      procedure.proleakproof AS leakproof,
      procedure.prokind AS function_kind,
      procedure.proconfig AS function_config,
      pg_catalog.has_function_privilege($1, procedure.oid, 'EXECUTE')
        AS cleanup_execute,
      pg_catalog.has_function_privilege($2, procedure.oid, 'EXECUTE')
        AS runtime_execute,
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
    ORDER BY procedure.proname
  `, [DIRECT_UPLOAD_CLEANUP_ROLE, REVIEWED_RUNTIME_ROLE])).rows;
}

function summarizeTables(rows) {
  return Object.fromEntries((rows ?? []).map((row) => [
    row.table_name,
    Object.freeze({
      cleanupCrud: [
        row.cleanup_select,
        row.cleanup_insert,
        row.cleanup_update,
        row.cleanup_delete,
      ].some(Boolean),
      policyCount: Number(row.policy_count),
      rlsEnabled: row.rls_enabled,
      rlsForced: row.rls_forced,
      runtimeCrud: [
        row.runtime_select,
        row.runtime_insert,
        row.runtime_update,
        row.runtime_delete,
      ].some(Boolean),
    }),
  ]));
}

export function writeDirectUploadActivationProductionRecoveryEvidence(
  pathname,
  evidence,
) {
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (
    /postgres(?:ql)?:\/\/|DIRECT_URL|PASSWORD|SECRET_ACCESS_KEY|"(?:logs|rows|function_source)"\s*:/iu
      .test(serialized)
  ) {
    throw new Error("DirectUpload production recovery evidence contains sensitive-shaped data");
  }
  const descriptor = openSync(pathname, "wx", 0o600);
  try {
    writeFileSync(descriptor, serialized, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(pathname, 0o600);
  const stat = lstatSync(pathname);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) {
    throw new Error("DirectUpload production recovery evidence is not mode 0600");
  }
}

export async function runDirectUploadActivationProductionRecoveryProof(config) {
  const git = assertProductionMigrationGitState(
    readProductionMigrationGitState(),
    config.releaseCommit,
  );
  const release = verifyDirectUploadActivationRelease();
  validateCurrentSavedSearchRlsDeployShape({
    phase: "direct-upload-activation-reviewed",
  });
  const migrationNames = readdirSync("prisma/migrations", {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const migrationSql = readFileSync(MIGRATION_PATH, "utf8");
  const listingVariantsChecksum = sha256(
    readFileSync(LISTING_VARIANTS_MIGRATION_PATH, "utf8"),
  );
  if (sha256(migrationSql) !== DIRECT_UPLOAD_ACTIVATION_RELEASE.sha256) {
    throw new Error("DirectUpload production recovery migration bytes drifted");
  }

  const client = new Client({
    connectionString: config.directUrl,
    application_name: `grainline-direct-upload-activation-recovery-${config.mode}`,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    ...postgresChannelBindingClientOptions(new URL(config.directUrl)),
  });
  let transactionOpen = false;
  try {
    await client.connect();
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    transactionOpen = true;
    const snapshot = await readDirectUploadCleanupRoleProvisionSnapshot(client);
    const ledger = (await client.query(`
      SELECT
        checksum,
        started_at,
        finished_at,
        rolled_back_at,
        applied_steps_count
      FROM public._prisma_migrations
      WHERE migration_name = $1
      ORDER BY started_at, id
    `, [DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName])).rows;
    const state = classifyDirectUploadActivationProductionRecoveryLedger(ledger);
    const ledgerSummaries = (await client.query(`
      SELECT
        migration_name,
        checksum,
        pg_catalog.count(*)::integer AS row_count,
        pg_catalog.count(*) FILTER (
          WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
        )::integer AS applied_count,
        pg_catalog.count(*) FILTER (
          WHERE finished_at IS NOT NULL
        )::integer AS finished_count,
        pg_catalog.count(*) FILTER (
          WHERE finished_at IS NULL AND rolled_back_at IS NULL
        )::integer AS incomplete_count,
        pg_catalog.count(*) FILTER (
          WHERE rolled_back_at IS NOT NULL
        )::integer AS rolled_back_count,
        coalesce(
          pg_catalog.sum(applied_steps_count),
          0
        )::bigint AS applied_steps_count
      FROM public._prisma_migrations
      GROUP BY migration_name, checksum
      ORDER BY migration_name, checksum
    `)).rows;
    const migrationTreeIssues = collectDirectUploadRecoveryMigrationTreeIssues({
      listingVariantsChecksum,
      ledgerSummaries,
      migrationNames,
      state,
    });
    if (migrationTreeIssues.length > 0) {
      throw new Error(
        `DirectUpload production recovery migration tree drifted: ${migrationTreeIssues.join("; ")}`,
      );
    }
    const expectedIncompleteCount = state === "failed" ? 1 : 0;
    if (Number(snapshot.incompleteMigrationCount) !== expectedIncompleteCount) {
      throw new Error("DirectUpload recovery contains another incomplete migration");
    }
    assertProductionMigrationDatabaseState({
      ...(await readProductionBaseState(client, 0)),
      incompleteMigrationCount: 0,
    });

    let authorityIssues;
    if (state === "activated") {
      authorityIssues = collectDirectUploadActivatedRecoveryIssues(
        snapshot,
        await readDetailedFunctions(client),
      );
    } else {
      authorityIssues = collectDirectUploadCleanupRoleProvisionIssues(snapshot)
        .filter((issue) => !(
          state === "failed"
          && issue === "production migration ledger contains an incomplete migration"
        ));
      await client.query(
        extractDirectUploadActivationReadOnlyPreflight(migrationSql),
      );
    }
    if (authorityIssues.length > 0) {
      throw new Error(
        `DirectUpload production recovery authority drifted: ${authorityIssues.join("; ")}`,
      );
    }
    if (config.mode !== "inspect" && config.mode !== state) {
      throw new Error(
        `DirectUpload production recovery expected ${config.mode}, found ${state}`,
      );
    }
    await client.query("ROLLBACK");
    transactionOpen = false;

    const evidence = Object.freeze({
      schemaVersion: 2,
      operation: "direct-upload-activation-production-recovery-proof",
      phase: config.mode,
      state,
      source: Object.freeze({ clean: git.clean, commit: git.head }),
      runs: Object.freeze({
        failedMigrationRunId: config.failedMigrationRunId,
        mainCiRunId: config.mainCiRunId,
        recoveryProofRunId: config.recoveryProofRunId,
        recoveryRunId: config.recoveryRunId,
      }),
      migration: Object.freeze({
        name: DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName,
        failedChecksum: FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
        correctedChecksum: release.migrationSha256,
        ledgerRows: ledger.length,
        incompleteMigrationCount: expectedIncompleteCount,
        migrationCount: migrationNames.length,
        pendingMigrationCount: state === "activated" ? 0 : 1,
        historicalListingVariantsAliasAccepted: true,
      }),
      authority: Object.freeze({
        functionCount: DIRECT_UPLOAD_ACTIVATION_FUNCTIONS.length,
        cleanupFunctionCount: DIRECT_UPLOAD_CLEANUP_FUNCTION_NAMES.length,
        runtimeFunctionCount:
          DIRECT_UPLOAD_ACTIVATION_RUNTIME_FUNCTION_NAMES.length,
        tables: summarizeTables(snapshot.tables),
      }),
      transaction: Object.freeze({
        isolation: "repeatable read",
        readOnly: true,
      }),
      retained: Object.freeze({
        credentials: false,
        databaseRows: false,
        migrationLogs: false,
        functionSources: false,
      }),
      productionChangedByProof: false,
      completedAt: new Date().toISOString(),
      status: "passed",
    });
    writeDirectUploadActivationProductionRecoveryEvidence(
      config.evidencePath,
      evidence,
    );
    return evidence;
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

async function main() {
  try {
    const config = parseDirectUploadActivationProductionRecoveryConfig();
    const evidence = await runDirectUploadActivationProductionRecoveryProof(
      config,
    );
    process.stdout.write(`${JSON.stringify({
      status: evidence.status,
      phase: evidence.phase,
      state: evidence.state,
      source: evidence.source,
      runs: evidence.runs,
      migration: evidence.migration,
      authority: evidence.authority,
      transaction: evidence.transaction,
      productionChangedByProof: evidence.productionChangedByProof,
    })}\n`);
  } catch (error) {
    process.stderr.write(
      `DirectUpload activation production recovery proof failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
