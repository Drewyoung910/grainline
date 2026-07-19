#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  parseVercelRuntimeDatabaseIdentity,
  REVIEWED_PRODUCTION_RUNTIME_IDENTITY,
} from "./guard-runtime-db-env.mjs";
import {
  assertDeterministicPostgresEnvironment,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";

const { Client } = pg;

export const PRODUCTION_MIGRATION_CONFIRMATION =
  "run-reviewed-production-migrations-from-main";
export const REVIEWED_MIGRATION_ROLE = "neondb_owner";
export const REVIEWED_RUNTIME_ROLE = "grainline_app_runtime";
const REVIEWED_MAIN_REF = "refs/heads/main";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const REVIEWED_OWNER_MEMBERSHIP_OPTIONS = Object.freeze([
  Object.freeze({
    role: REVIEWED_RUNTIME_ROLE,
    adminOption: true,
    inheritOption: false,
    setOption: false,
  }),
  Object.freeze({
    role: "neon_superuser",
    adminOption: false,
    inheritOption: true,
    setOption: true,
  }),
]);

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

export function parseProductionMigrationEnvironment(env = process.env) {
  assertDeterministicPostgresEnvironment(env, "production migration runner");
  if (
    env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_REF !== REVIEWED_MAIN_REF
  ) {
    throw new Error("production migrations require the reviewed manual GitHub Actions main-branch context");
  }
  const releaseCommit = required(env, "PRODUCTION_MIGRATION_RELEASE_COMMIT");
  const githubCommit = required(env, "GITHUB_SHA");
  if (
    !COMMIT_PATTERN.test(releaseCommit)
    || releaseCommit !== githubCommit
    || env.PRODUCTION_MIGRATION_CONFIRM !== PRODUCTION_MIGRATION_CONFIRMATION
  ) {
    throw new Error("production migration release commit or confirmation does not match the dispatched main commit");
  }
  if (Object.hasOwn(env, "DATABASE_URL")) {
    throw new Error("DATABASE_URL must remain absent from the owner-only migration job");
  }
  if (Object.hasOwn(env, "GRANT_AUDIT_DATABASE_URL")) {
    throw new Error("GRANT_AUDIT_DATABASE_URL must remain absent during migration preflight");
  }
  if (
    env.RUNTIME_DB_ROLE !== REVIEWED_RUNTIME_ROLE
    || env.MIGRATION_DB_ROLE !== REVIEWED_MIGRATION_ROLE
  ) {
    throw new Error("production migration role declarations do not match the reviewed roles");
  }

  const directUrl = required(env, "DIRECT_URL");
  const expectedDirectUrlSha256 = required(
    env,
    "PRODUCTION_MIGRATION_DIRECT_URL_SHA256",
  );
  const actualDirectUrlSha256 = createHash("sha256")
    .update(directUrl, "utf8")
    .digest("hex");
  if (
    !SHA256_PATTERN.test(expectedDirectUrlSha256)
    || actualDirectUrlSha256 !== expectedDirectUrlSha256
  ) {
    throw new Error("DIRECT_URL does not match the protected environment digest");
  }
  const identity = parseVercelRuntimeDatabaseIdentity(directUrl, "DIRECT_URL");
  const runtimeIdentity = REVIEWED_PRODUCTION_RUNTIME_IDENTITY;
  if (
    identity.isPooler
    || identity.username !== REVIEWED_MIGRATION_ROLE
    || identity.endpointId !== runtimeIdentity.endpointId
    || identity.region !== runtimeIdentity.region
    || identity.databaseName !== runtimeIdentity.databaseName
  ) {
    throw new Error("DIRECT_URL does not match the reviewed production migration-owner identity");
  }
  return Object.freeze({
    releaseCommit,
    directUrl,
    directUrlSha256: actualDirectUrlSha256,
    identity,
  });
}

function sortedMemberships(role) {
  return Array.isArray(role?.memberships)
    ? [...role.memberships].sort((left, right) => left.localeCompare(right))
    : [];
}

function exactMembershipOptions(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((membership, index) => {
      const reviewed = expected[index];
      return membership?.role === reviewed.role
        && membership.adminOption === reviewed.adminOption
        && membership.inheritOption === reviewed.inheritOption
        && membership.setOption === reviewed.setOption;
    });
}

export function assertProductionMigrationDatabaseState(state) {
  const owner = state?.ownerRole;
  const runtime = state?.runtimeRole;
  const savedSearch = state?.savedSearch;
  if (
    state?.identity?.database_name !== REVIEWED_PRODUCTION_RUNTIME_IDENTITY.databaseName
    || state.identity.current_user_name !== REVIEWED_MIGRATION_ROLE
    || state.identity.session_user_name !== REVIEWED_MIGRATION_ROLE
    || owner?.rolname !== REVIEWED_MIGRATION_ROLE
    || owner.rolsuper !== false
    || owner.rolcreatedb !== true
    || owner.rolcreaterole !== true
    || owner.rolinherit !== true
    || owner.rolcanlogin !== true
    || owner.rolreplication !== true
    || owner.rolbypassrls !== true
    || JSON.stringify(sortedMemberships(owner))
      !== JSON.stringify([REVIEWED_RUNTIME_ROLE, "neon_superuser"])
    || !exactMembershipOptions(owner.membership_options, REVIEWED_OWNER_MEMBERSHIP_OPTIONS)
    || runtime?.rolname !== REVIEWED_RUNTIME_ROLE
    || runtime.rolsuper !== false
    || runtime.rolcreatedb !== false
    || runtime.rolcreaterole !== false
    || runtime.rolinherit !== false
    || runtime.rolcanlogin !== true
    || runtime.rolreplication !== false
    || runtime.rolbypassrls !== false
    || sortedMemberships(runtime).length !== 0
    || !Array.isArray(runtime.membership_options)
    || runtime.membership_options.length !== 0
    || savedSearch?.rls_enabled !== true
    || savedSearch.rls_forced !== true
    || savedSearch.owner_name !== REVIEWED_MIGRATION_ROLE
    || Number(savedSearch.policy_count) !== 3
    || Number(state.incompleteMigrationCount) !== 0
  ) {
    throw new Error("production database identity, role posture, Phase B state, or migration ledger drifted");
  }
  return Object.freeze({
    databaseName: state.identity.database_name,
    ownerRole: owner.rolname,
    runtimeRole: runtime.rolname,
    savedSearchRlsEnabled: savedSearch.rls_enabled,
    savedSearchRlsForced: savedSearch.rls_forced,
    savedSearchPolicyCount: Number(savedSearch.policy_count),
    incompleteMigrationCount: Number(state.incompleteMigrationCount),
  });
}

export function readProductionMigrationGitState(cwd = process.cwd()) {
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

export function assertProductionMigrationGitState(state, releaseCommit) {
  if (state?.head !== releaseCommit || state.status !== "") {
    throw new Error("production migration checkout is not the exact clean dispatched release commit");
  }
  return Object.freeze({ head: state.head, clean: true });
}

async function readRole(client, roleName) {
  return (await client.query(`
    SELECT r.rolname, r.rolsuper, r.rolcreatedb, r.rolcreaterole,
           r.rolinherit, r.rolcanlogin, r.rolreplication, r.rolbypassrls,
           (SELECT COALESCE(array_agg(parent.rolname::text ORDER BY parent.rolname),
                            ARRAY[]::text[])
              FROM pg_auth_members m
              JOIN pg_roles parent ON parent.oid = m.roleid
             WHERE m.member = r.oid) AS memberships,
           (SELECT COALESCE(
                     jsonb_agg(
                       jsonb_build_object(
                         'role', parent.rolname,
                         'adminOption', m.admin_option,
                         'inheritOption', m.inherit_option,
                         'setOption', m.set_option
                       ) ORDER BY parent.rolname
                     ),
                     '[]'::jsonb
                   )
              FROM pg_auth_members m
              JOIN pg_roles parent ON parent.oid = m.roleid
             WHERE m.member = r.oid) AS membership_options
      FROM pg_roles r
     WHERE r.rolname = $1
  `, [roleName])).rows[0];
}

export async function readProductionMigrationDatabaseState(connectionString) {
  const parsed = new URL(connectionString);
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-production-migration-preflight",
    ...postgresChannelBindingClientOptions(parsed),
  });
  await client.connect();
  try {
    const identity = (await client.query(`
      SELECT current_database() AS database_name,
             current_user AS current_user_name,
             session_user AS session_user_name
    `)).rows[0];
    const ownerRole = await readRole(client, REVIEWED_MIGRATION_ROLE);
    const runtimeRole = await readRole(client, REVIEWED_RUNTIME_ROLE);
    const savedSearch = (await client.query(`
      SELECT c.relrowsecurity AS rls_enabled,
             c.relforcerowsecurity AS rls_forced,
             pg_get_userbyid(c.relowner) AS owner_name,
             (SELECT COUNT(*)::integer FROM pg_policy p WHERE p.polrelid = c.oid)
               AS policy_count
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = 'SavedSearch'
         AND c.relkind IN ('r', 'p')
    `)).rows[0];
    const incompleteMigrationCount = Number((await client.query(`
      SELECT COUNT(*)::integer AS count
        FROM public._prisma_migrations
       WHERE finished_at IS NULL AND rolled_back_at IS NULL
    `)).rows[0]?.count);
    return { identity, ownerRole, runtimeRole, savedSearch, incompleteMigrationCount };
  } finally {
    await client.end();
  }
}

export async function runProductionMigrationPreflight(
  config,
  {
    readGitState = readProductionMigrationGitState,
    readDatabaseState = readProductionMigrationDatabaseState,
  } = {},
) {
  const git = assertProductionMigrationGitState(readGitState(), config.releaseCommit);
  const database = assertProductionMigrationDatabaseState(
    await readDatabaseState(config.directUrl),
  );
  return Object.freeze({
    status: "passed",
    releaseCommit: config.releaseCommit,
    directUrlSha256: config.directUrlSha256,
    git,
    database,
  });
}

async function main() {
  try {
    const config = parseProductionMigrationEnvironment(process.env);
    const result = await runProductionMigrationPreflight(config);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write("Production migration runner preflight failed.\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
