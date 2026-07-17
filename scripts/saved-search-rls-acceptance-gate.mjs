#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  SAVED_SEARCH_RLS_POLICIES as AUDITED_SAVED_SEARCH_RLS_POLICIES,
  SAVED_SEARCH_RLS_FORCE_EXPECTED,
  collectSavedSearchPolicyIssues as collectAuditedSavedSearchPolicyIssues,
  collectTablePrivilegeAllowlistIssues,
  normalizeRlsPolicyExpression as normalizeAuditedRlsPolicyExpression,
  readSavedSearchPolicyState as readAuditedSavedSearchPolicyState,
} from "./audit-runtime-db-grants.mjs";

const { Client } = pg;

export const SAVED_SEARCH_RLS_GATE_CONFIRMATION = "staging-only";
export const DEFAULT_SAVED_SEARCH_RUNTIME_ROLE = "grainline_app_runtime";
export const SAVED_SEARCH_TABLE = Object.freeze({
  schema: "public",
  table: "SavedSearch",
});

export const SAVED_SEARCH_RLS_POLICIES = AUDITED_SAVED_SEARCH_RLS_POLICIES;
export const normalizeRlsPolicyExpression = normalizeAuditedRlsPolicyExpression;
export const readSavedSearchPolicyState = readAuditedSavedSearchPolicyState;

export function collectSavedSearchPolicyIssues(
  rows,
  runtimeRole = DEFAULT_SAVED_SEARCH_RUNTIME_ROLE,
) {
  return collectAuditedSavedSearchPolicyIssues(
    rows,
    runtimeRole,
    SAVED_SEARCH_RLS_FORCE_EXPECTED,
  );
}

const CONNECTION_TIMEOUT_MS = 10_000;
const STATEMENT_TIMEOUT_MS = 30_000;
const QUERY_TIMEOUT_MS = 35_000;
const FIXTURE_PREFIX = "rls-saved-search-";
const SYNTHETIC_ID_MAX_LENGTH = 96;
const EXPECTED_DENIAL_SQLSTATE = "42501";

const POSTGRES_URL_PATTERN = /\bpostgres(?:ql)?:\/\/[^\s"'`<>]+/gi;
const URL_USERINFO_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;
const DATABASE_URL_ASSIGNMENT_PATTERN =
  /["']?\b(?:DATABASE_URL|DIRECT_URL|SAVED_SEARCH_RLS_GATE_(?:DATABASE_URL|ADMIN_DATABASE_URL))\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const PASSWORD_ASSIGNMENT_PATTERN =
  /["']?\b(?:PGPASSWORD|password|pass|pwd)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const QUERY_PAYLOAD_PATTERN = /\b(?:detail|payload|query payload)\s*[:=]\s*[^\n]*/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const FIXTURE_ID_PATTERN = /\brls-saved-search-[a-z0-9-]+\b/gi;

class GateAssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = "GateAssertionError";
  }
}

function required(value, name) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseBooleanFlag(env, name) {
  return env[name] === "1" || env[name] === "true";
}

function assertSafeRoleName(value) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) {
    throw new Error("SAVED_SEARCH_RLS_GATE_RUNTIME_ROLE must be a lowercase PostgreSQL identifier");
  }
  return value;
}

function decodedUrlPart(value, label) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`${label} contains invalid percent encoding`);
  }
}

function containsEncodedUserContext(value) {
  let decoded = String(value);
  for (let pass = 0; pass < 3; pass += 1) {
    if (decoded.toLowerCase().includes("app.user_id")) return true;
    try {
      const next = decodeURIComponent(decoded.replaceAll("+", " "));
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded.toLowerCase().includes("app.user_id");
}

function assertRuntimeUrlDoesNotPreseedUserContext(value) {
  const parsed = new URL(value);
  for (const [name, parameterValue] of parsed.searchParams) {
    if (containsEncodedUserContext(name) || containsEncodedUserContext(parameterValue)) {
      throw new Error(
        "SAVED_SEARCH_RLS_GATE_DATABASE_URL must not pre-seed app.user_id through URL query parameters or options",
      );
    }
  }
}

function parseExpectedDatabaseIdentity(env) {
  const endpointId = required(
    env.SAVED_SEARCH_RLS_GATE_EXPECTED_DATABASE_ENDPOINT_ID,
    "SAVED_SEARCH_RLS_GATE_EXPECTED_DATABASE_ENDPOINT_ID",
  );
  const productionEndpointId = required(
    env.SAVED_SEARCH_RLS_GATE_PRODUCTION_DATABASE_ENDPOINT_ID,
    "SAVED_SEARCH_RLS_GATE_PRODUCTION_DATABASE_ENDPOINT_ID",
  );
  const databaseName = required(
    env.SAVED_SEARCH_RLS_GATE_EXPECTED_DATABASE_NAME,
    "SAVED_SEARCH_RLS_GATE_EXPECTED_DATABASE_NAME",
  );
  const region = required(
    env.SAVED_SEARCH_RLS_GATE_EXPECTED_DATABASE_REGION,
    "SAVED_SEARCH_RLS_GATE_EXPECTED_DATABASE_REGION",
  );
  if (!/^ep-[a-z0-9-]{1,60}$/.test(endpointId)) {
    throw new Error("SAVED_SEARCH_RLS_GATE_EXPECTED_DATABASE_ENDPOINT_ID must be a bounded Neon endpoint id");
  }
  if (!/^ep-[a-z0-9-]{1,60}$/.test(productionEndpointId)) {
    throw new Error("SAVED_SEARCH_RLS_GATE_PRODUCTION_DATABASE_ENDPOINT_ID must be a bounded Neon endpoint id");
  }
  if (endpointId === productionEndpointId) {
    throw new Error("reviewed staging endpoint must differ from the independently supplied production endpoint");
  }
  if (databaseName.length > 63 || !/^[A-Za-z0-9_-]+$/.test(databaseName)) {
    throw new Error("SAVED_SEARCH_RLS_GATE_EXPECTED_DATABASE_NAME must be a bounded PostgreSQL database name");
  }
  if (region.length > 64 || !/^[a-z0-9][a-z0-9.-]*$/.test(region)) {
    throw new Error("SAVED_SEARCH_RLS_GATE_EXPECTED_DATABASE_REGION must be a bounded Neon region identity");
  }
  return { databaseName, endpointId, productionEndpointId, region };
}

function assertExpectedDatabaseIdentity(actual, expected, label) {
  if (actual.endpointId !== expected.endpointId) {
    throw new Error(`${label} endpoint id does not match the reviewed staging endpoint`);
  }
  if (actual.databaseName !== expected.databaseName) {
    throw new Error(`${label} database name does not match the reviewed staging database`);
  }
  if (actual.region !== expected.region) {
    throw new Error(`${label} region does not match the reviewed staging database region`);
  }
}

export function parseNeonDatabaseIdentity(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL URL`);
  }
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) {
    throw new Error(`${label} must use the postgres/postgresql protocol`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname.endsWith(".neon.tech")) {
    throw new Error(`${label} must identify a Neon endpoint`);
  }
  const hostnameParts = hostname.split(".");
  const endpointLabel = hostnameParts[0];
  if (!/^ep-[a-z0-9-]+$/.test(endpointLabel)) {
    throw new Error(`${label} must contain a valid Neon endpoint hostname`);
  }
  const isPooler = endpointLabel.endsWith("-pooler");
  const directEndpointLabel = isPooler
    ? endpointLabel.slice(0, -"-pooler".length)
    : endpointLabel;
  if (directEndpointLabel === "ep-" || directEndpointLabel.length < 4) {
    throw new Error(`${label} must contain a valid Neon endpoint hostname`);
  }
  const region = hostnameParts.slice(1, -2).join(".");
  if (!region) throw new Error(`${label} must contain a Neon region identity`);

  const username = decodedUrlPart(parsed.username, `${label} username`);
  if (!username) throw new Error(`${label} must include a database username`);
  const databaseName = decodedUrlPart(parsed.pathname.slice(1), `${label} database name`);
  if (!databaseName || databaseName.includes("/")) {
    throw new Error(`${label} must name exactly one database`);
  }

  return {
    databaseName,
    endpointId: directEndpointLabel,
    hostname,
    isPooler,
    normalizedEndpoint: [directEndpointLabel, ...hostnameParts.slice(1)].join("."),
    region,
    username,
  };
}

function optionalEvidencePath(env) {
  const value = env.SAVED_SEARCH_RLS_GATE_EVIDENCE_PATH;
  if (value === undefined || value === "") return undefined;
  if (value.includes("\0")) {
    throw new Error("SAVED_SEARCH_RLS_GATE_EVIDENCE_PATH must not contain null bytes");
  }
  return value;
}

export function parseGateConfig(env = process.env) {
  if (env.SAVED_SEARCH_RLS_GATE_CONFIRM !== SAVED_SEARCH_RLS_GATE_CONFIRMATION) {
    throw new Error(
      `SAVED_SEARCH_RLS_GATE_CONFIRM=${SAVED_SEARCH_RLS_GATE_CONFIRMATION} is required before running the staging-only gate`,
    );
  }

  const databaseUrl = required(
    env.SAVED_SEARCH_RLS_GATE_DATABASE_URL,
    "SAVED_SEARCH_RLS_GATE_DATABASE_URL",
  );
  const adminDatabaseUrl = required(
    env.SAVED_SEARCH_RLS_GATE_ADMIN_DATABASE_URL,
    "SAVED_SEARCH_RLS_GATE_ADMIN_DATABASE_URL",
  );
  const runtimeRole = assertSafeRoleName(
    env.SAVED_SEARCH_RLS_GATE_RUNTIME_ROLE ?? DEFAULT_SAVED_SEARCH_RUNTIME_ROLE,
  );
  const allowNonPooler = parseBooleanFlag(env, "SAVED_SEARCH_RLS_GATE_ALLOW_NON_POOLER");
  const allowNoEvidenceForDevelopment = parseBooleanFlag(
    env,
    "SAVED_SEARCH_RLS_GATE_ALLOW_NO_EVIDENCE_FOR_DEVELOPMENT",
  );
  const evidencePath = optionalEvidencePath(env);
  if (!evidencePath && !allowNoEvidenceForDevelopment) {
    throw new Error(
      "SAVED_SEARCH_RLS_GATE_EVIDENCE_PATH is required; set SAVED_SEARCH_RLS_GATE_ALLOW_NO_EVIDENCE_FOR_DEVELOPMENT=1 only for non-acceptance development checks",
    );
  }
  const expectedDatabaseIdentity = parseExpectedDatabaseIdentity(env);
  const runtimeIdentity = parseNeonDatabaseIdentity(
    databaseUrl,
    "SAVED_SEARCH_RLS_GATE_DATABASE_URL",
  );
  assertRuntimeUrlDoesNotPreseedUserContext(databaseUrl);
  const adminIdentity = parseNeonDatabaseIdentity(
    adminDatabaseUrl,
    "SAVED_SEARCH_RLS_GATE_ADMIN_DATABASE_URL",
  );

  assertExpectedDatabaseIdentity(
    runtimeIdentity,
    expectedDatabaseIdentity,
    "SAVED_SEARCH_RLS_GATE_DATABASE_URL",
  );
  assertExpectedDatabaseIdentity(
    adminIdentity,
    expectedDatabaseIdentity,
    "SAVED_SEARCH_RLS_GATE_ADMIN_DATABASE_URL",
  );

  if (!runtimeIdentity.isPooler && !allowNonPooler) {
    throw new Error(
      "SAVED_SEARCH_RLS_GATE_DATABASE_URL must use the pooled Neon runtime endpoint; set SAVED_SEARCH_RLS_GATE_ALLOW_NON_POOLER=1 only for development checks",
    );
  }
  if (adminIdentity.isPooler) {
    throw new Error("SAVED_SEARCH_RLS_GATE_ADMIN_DATABASE_URL must use the direct non-pooler Neon endpoint");
  }
  if (runtimeIdentity.normalizedEndpoint !== adminIdentity.normalizedEndpoint) {
    throw new Error("runtime and owner URLs must resolve to the same Neon endpoint after removing -pooler");
  }
  if (runtimeIdentity.databaseName !== adminIdentity.databaseName) {
    throw new Error("runtime and owner URLs must name the same database");
  }
  if (runtimeIdentity.username !== runtimeRole) {
    throw new Error("runtime URL username must exactly match SAVED_SEARCH_RLS_GATE_RUNTIME_ROLE");
  }
  if (runtimeIdentity.username === adminIdentity.username) {
    throw new Error("runtime and owner URLs must use different database usernames");
  }

  return {
    acceptanceEligible:
      runtimeIdentity.isPooler && !allowNoEvidenceForDevelopment,
    adminDatabaseUrl,
    adminUsername: adminIdentity.username,
    allowNoEvidenceForDevelopment,
    allowNonPooler,
    databaseName: runtimeIdentity.databaseName,
    databaseUrl,
    evidencePath,
    expectedDatabaseEndpointId: expectedDatabaseIdentity.endpointId,
    expectedDatabaseRegion: expectedDatabaseIdentity.region,
    normalizedEndpoint: runtimeIdentity.normalizedEndpoint,
    productionDatabaseEndpointId: expectedDatabaseIdentity.productionEndpointId,
    runtimeTransport: runtimeIdentity.isPooler ? "pooled" : "direct-development-only",
    runtimeRole,
  };
}

export function collectSavedSearchCatalogIssues(state, config) {
  const issues = [];
  const runtimeIdentity = state.runtimeIdentityRows?.[0];
  if (!runtimeIdentity) {
    issues.push("runtime connection identity could not be read");
  } else {
    if (runtimeIdentity.current_user_name !== config.runtimeRole) {
      issues.push("runtime connection current_user does not match the configured runtime role");
    }
    if (runtimeIdentity.session_user_name !== config.runtimeRole) {
      issues.push("runtime connection session_user does not match the configured runtime role");
    }
    if (runtimeIdentity.database_name !== config.databaseName) {
      issues.push("runtime connection reached an unexpected database");
    }
  }

  const ownerIdentity = state.ownerIdentityRows?.[0];
  if (!ownerIdentity) {
    issues.push("owner connection identity could not be read");
  } else {
    if (ownerIdentity.current_user_name !== config.adminUsername) {
      issues.push("owner connection current_user does not match the direct URL username");
    }
    if (ownerIdentity.session_user_name !== config.adminUsername) {
      issues.push("owner connection session_user does not match the direct URL username");
    }
    if (ownerIdentity.database_name !== config.databaseName) {
      issues.push("owner connection reached an unexpected database");
    }
  }

  const runtimeRole = state.runtimeRoleRows?.[0];
  if (!runtimeRole) {
    issues.push(`runtime role ${config.runtimeRole} does not exist`);
  } else {
    if (runtimeRole.rolsuper) issues.push(`runtime role ${config.runtimeRole} is SUPERUSER`);
    if (runtimeRole.rolbypassrls) issues.push(`runtime role ${config.runtimeRole} has BYPASSRLS`);
    if (runtimeRole.rolcreatedb) issues.push(`runtime role ${config.runtimeRole} has CREATEDB`);
    if (runtimeRole.rolcreaterole) issues.push(`runtime role ${config.runtimeRole} has CREATEROLE`);
    if (runtimeRole.rolreplication) issues.push(`runtime role ${config.runtimeRole} has REPLICATION`);
    if (!runtimeRole.rolcanlogin) issues.push(`runtime role ${config.runtimeRole} must have LOGIN`);
    if (runtimeRole.rolinherit) issues.push(`runtime role ${config.runtimeRole} must have NOINHERIT`);
  }
  if ((state.membershipRows?.length ?? 0) > 0) {
    issues.push(`runtime role ${config.runtimeRole} must be membership-free`);
  }

  const privileges = state.privilegeRows?.[0];
  if (!privileges) {
    issues.push("runtime SavedSearch privilege state could not be read");
  } else {
    if (!privileges.schema_usage) issues.push("runtime role lacks USAGE on schema public");
    for (const privilege of ["select", "insert", "update", "delete"]) {
      if (!privileges[`${privilege}_priv`]) {
        issues.push(`runtime role lacks ${privilege.toUpperCase()} on public.\"SavedSearch\"`);
      }
    }
    issues.push(
      ...collectTablePrivilegeAllowlistIssues(privileges, 'public."SavedSearch"'),
    );
  }

  const table = state.tableRows?.[0];
  if (!table) {
    issues.push('public."SavedSearch" does not exist');
  } else {
    if (table.owner_name === config.runtimeRole) {
      issues.push(`runtime role ${config.runtimeRole} must not own public."SavedSearch"`);
    }
    if (table.owner_name !== config.adminUsername) {
      issues.push('public."SavedSearch" owner must match the direct owner URL username');
    }
  }

  issues.push(...collectSavedSearchPolicyIssues(state.policyRows, config.runtimeRole));
  return issues;
}

async function readCatalogState(ownerClient, runtimeClient, config) {
  const [
    runtimeIdentity,
    ownerIdentity,
    runtimeRole,
    memberships,
    privileges,
    table,
    policyRows,
  ] =
    await Promise.all([
      runtimeClient.query(
        "SELECT current_user AS current_user_name, session_user AS session_user_name, current_database() AS database_name",
      ),
      ownerClient.query(
        "SELECT current_user AS current_user_name, session_user AS session_user_name, current_database() AS database_name",
      ),
      ownerClient.query(
        `SELECT
           rolname,
           rolsuper,
           rolbypassrls,
           rolcreatedb,
           rolcreaterole,
           rolreplication,
           rolcanlogin,
           rolinherit
           FROM pg_roles
          WHERE rolname = $1`,
        [config.runtimeRole],
      ),
      ownerClient.query(
        `WITH RECURSIVE memberships AS (
            SELECT parent.oid, parent.rolname
              FROM pg_auth_members membership
              JOIN pg_roles child ON child.oid = membership.member
              JOIN pg_roles parent ON parent.oid = membership.roleid
             WHERE child.rolname = $1
            UNION
            SELECT parent.oid, parent.rolname
              FROM memberships current_membership
              JOIN pg_auth_members membership ON membership.member = current_membership.oid
              JOIN pg_roles parent ON parent.oid = membership.roleid
          )
          SELECT rolname AS role_name
            FROM memberships
           ORDER BY rolname`,
        [config.runtimeRole],
      ),
      ownerClient.query(
        `SELECT
           has_schema_privilege($1, 'public', 'USAGE') AS schema_usage,
           has_table_privilege($1, 'public."SavedSearch"', 'SELECT') AS select_priv,
           has_table_privilege($1, 'public."SavedSearch"', 'INSERT') AS insert_priv,
           has_table_privilege($1, 'public."SavedSearch"', 'UPDATE') AS update_priv,
           has_table_privilege($1, 'public."SavedSearch"', 'DELETE') AS delete_priv,
           ARRAY(
             SELECT DISTINCT upper(acl.privilege_type)
               FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
               CROSS JOIN LATERAL aclexplode(
                 COALESCE(c.relacl, acldefault('r', c.relowner))
               ) AS acl
              WHERE n.nspname = 'public'
                AND c.relname = 'SavedSearch'
                AND c.relkind IN ('r', 'p')
                AND acl.grantee = (SELECT oid FROM pg_roles WHERE rolname = $1)
              ORDER BY 1
           ) AS runtime_privileges,
           ARRAY(
             SELECT DISTINCT upper(acl.privilege_type)
               FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
               CROSS JOIN LATERAL aclexplode(
                 COALESCE(c.relacl, acldefault('r', c.relowner))
               ) AS acl
              WHERE n.nspname = 'public'
                AND c.relname = 'SavedSearch'
                AND c.relkind IN ('r', 'p')
                AND acl.grantee = (SELECT oid FROM pg_roles WHERE rolname = $1)
                AND acl.is_grantable
              ORDER BY 1
           ) AS runtime_grant_option_privileges,
           ARRAY(
             SELECT DISTINCT upper(acl.privilege_type)
               FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
               CROSS JOIN LATERAL aclexplode(
                 COALESCE(c.relacl, acldefault('r', c.relowner))
               ) AS acl
              WHERE n.nspname = 'public'
                AND c.relname = 'SavedSearch'
                AND c.relkind IN ('r', 'p')
                AND acl.grantee = 0
              ORDER BY 1
           ) AS public_privileges,
           ARRAY(
             SELECT DISTINCT upper(acl.privilege_type)
               FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
               CROSS JOIN LATERAL aclexplode(
                 COALESCE(c.relacl, acldefault('r', c.relowner))
               ) AS acl
              WHERE n.nspname = 'public'
                AND c.relname = 'SavedSearch'
                AND c.relkind IN ('r', 'p')
                AND acl.grantee = 0
                AND acl.is_grantable
              ORDER BY 1
           ) AS public_grant_option_privileges,
           ARRAY(
             SELECT DISTINCT format('%I:%s', a.attname, upper(acl.privilege_type))
               FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
               JOIN pg_attribute a ON a.attrelid = c.oid
               CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
              WHERE n.nspname = 'public'
                AND c.relname = 'SavedSearch'
                AND c.relkind IN ('r', 'p')
                AND a.attnum > 0
                AND NOT a.attisdropped
                AND acl.grantee = (SELECT oid FROM pg_roles WHERE rolname = $1)
              ORDER BY 1
           ) AS runtime_column_privileges,
           ARRAY(
             SELECT DISTINCT format('%I:%s', a.attname, upper(acl.privilege_type))
               FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
               JOIN pg_attribute a ON a.attrelid = c.oid
               CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
              WHERE n.nspname = 'public'
                AND c.relname = 'SavedSearch'
                AND c.relkind IN ('r', 'p')
                AND a.attnum > 0
                AND NOT a.attisdropped
                AND acl.grantee = (SELECT oid FROM pg_roles WHERE rolname = $1)
                AND acl.is_grantable
              ORDER BY 1
           ) AS runtime_column_grant_option_privileges,
           ARRAY(
             SELECT DISTINCT format('%I:%s', a.attname, upper(acl.privilege_type))
               FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
               JOIN pg_attribute a ON a.attrelid = c.oid
               CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
              WHERE n.nspname = 'public'
                AND c.relname = 'SavedSearch'
                AND c.relkind IN ('r', 'p')
                AND a.attnum > 0
                AND NOT a.attisdropped
                AND acl.grantee = 0
              ORDER BY 1
           ) AS public_column_privileges,
           ARRAY(
             SELECT DISTINCT format('%I:%s', a.attname, upper(acl.privilege_type))
               FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
               JOIN pg_attribute a ON a.attrelid = c.oid
               CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
              WHERE n.nspname = 'public'
                AND c.relname = 'SavedSearch'
                AND c.relkind IN ('r', 'p')
                AND a.attnum > 0
                AND NOT a.attisdropped
                AND acl.grantee = 0
                AND acl.is_grantable
              ORDER BY 1
           ) AS public_column_grant_option_privileges`,
        [config.runtimeRole],
      ),
      ownerClient.query(
        `SELECT pg_get_userbyid(c.relowner) AS owner_name
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1
            AND c.relname = $2
            AND c.relkind IN ('r', 'p')`,
        [SAVED_SEARCH_TABLE.schema, SAVED_SEARCH_TABLE.table],
      ),
      readSavedSearchPolicyState(ownerClient),
    ]);

  return {
    membershipRows: memberships.rows,
    ownerIdentityRows: ownerIdentity.rows,
    policyRows,
    privilegeRows: privileges.rows,
    runtimeIdentityRows: runtimeIdentity.rows,
    runtimeRoleRows: runtimeRole.rows,
    tableRows: table.rows,
  };
}

function assertSyntheticId(value, label) {
  if (
    value.length > SYNTHETIC_ID_MAX_LENGTH
    || !value.startsWith(FIXTURE_PREFIX)
    || !/^[a-z0-9-]+$/.test(value)
  ) {
    throw new Error(`${label} must be a bounded ${FIXTURE_PREFIX} synthetic identifier`);
  }
  return value;
}

export function buildFixtureIds(suffix = randomUUID().replaceAll("-", "").slice(0, 16)) {
  if (!/^[a-f0-9]{12,24}$/.test(suffix)) {
    throw new Error("fixture suffix must contain 12 to 24 lowercase hexadecimal characters");
  }
  const prefix = `${FIXTURE_PREFIX}${suffix}`;
  const fixture = {
    changedQuery: `${prefix}-changed-query`,
    foreignInsertSearchId: `${prefix}-foreign-insert`,
    noContextInsertSearchId: `${prefix}-no-context-insert`,
    ownInsertSearchId: `${prefix}-own-insert`,
    seedSearchAId: `${prefix}-seed-a`,
    seedSearchBId: `${prefix}-seed-b`,
    seedQueryA: `${prefix}-query-a`,
    seedQueryB: `${prefix}-query-b`,
    userA: {
      clerkId: `${prefix}-clerk-a`,
      email: `${prefix}-a@example.invalid`,
      id: `${prefix}-user-a`,
    },
    userB: {
      clerkId: `${prefix}-clerk-b`,
      email: `${prefix}-b@example.invalid`,
      id: `${prefix}-user-b`,
    },
    wrongUserId: `${prefix}-user-wrong`,
  };

  for (const [label, value] of Object.entries(fixture)) {
    if (typeof value === "string" && label !== "changedQuery" && !label.startsWith("seedQuery")) {
      assertSyntheticId(value, label);
    }
  }
  for (const [label, user] of [["userA", fixture.userA], ["userB", fixture.userB]]) {
    assertSyntheticId(user.id, `${label}.id`);
    assertSyntheticId(user.clerkId, `${label}.clerkId`);
    if (user.email.length > 254 || !user.email.startsWith(FIXTURE_PREFIX)) {
      throw new Error(`${label}.email must be a bounded synthetic email`);
    }
  }

  return Object.freeze({
    ...fixture,
    allSearchIds: Object.freeze([
      fixture.seedSearchAId,
      fixture.seedSearchBId,
      fixture.ownInsertSearchId,
      fixture.foreignInsertSearchId,
      fixture.noContextInsertSearchId,
    ]),
    allUserIds: Object.freeze([fixture.userA.id, fixture.userB.id]),
  });
}

export function validateFixture(fixture) {
  if (!fixture || typeof fixture !== "object") {
    throw new Error("synthetic fixture must be an object");
  }
  for (const field of [
    "foreignInsertSearchId",
    "noContextInsertSearchId",
    "ownInsertSearchId",
    "seedSearchAId",
    "seedSearchBId",
    "wrongUserId",
  ]) {
    assertSyntheticId(required(fixture[field], `fixture.${field}`), `fixture.${field}`);
  }
  for (const label of ["userA", "userB"]) {
    const user = fixture[label];
    if (!user || typeof user !== "object") throw new Error(`fixture.${label} is required`);
    assertSyntheticId(required(user.id, `fixture.${label}.id`), `fixture.${label}.id`);
    assertSyntheticId(
      required(user.clerkId, `fixture.${label}.clerkId`),
      `fixture.${label}.clerkId`,
    );
    if (
      typeof user.email !== "string"
      || user.email.length > 254
      || !user.email.startsWith(FIXTURE_PREFIX)
      || !user.email.endsWith("@example.invalid")
    ) {
      throw new Error(`fixture.${label}.email must be a bounded synthetic example.invalid email`);
    }
  }
  for (const field of ["changedQuery", "seedQueryA", "seedQueryB"]) {
    const value = fixture[field];
    if (
      typeof value !== "string"
      || value.length > 200
      || !value.startsWith(FIXTURE_PREFIX)
    ) {
      throw new Error(`fixture.${field} must be a bounded synthetic query marker`);
    }
  }

  const expectedSearchIds = [
    fixture.seedSearchAId,
    fixture.seedSearchBId,
    fixture.ownInsertSearchId,
    fixture.foreignInsertSearchId,
    fixture.noContextInsertSearchId,
  ];
  const expectedUserIds = [fixture.userA.id, fixture.userB.id];
  if (
    !Array.isArray(fixture.allSearchIds)
    || fixture.allSearchIds.length !== expectedSearchIds.length
    || fixture.allSearchIds.some((id, index) => id !== expectedSearchIds[index])
    || new Set(fixture.allSearchIds).size !== fixture.allSearchIds.length
  ) {
    throw new Error("fixture.allSearchIds must exactly match the unique synthetic search IDs");
  }
  if (
    !Array.isArray(fixture.allUserIds)
    || fixture.allUserIds.length !== expectedUserIds.length
    || fixture.allUserIds.some((id, index) => id !== expectedUserIds[index])
    || new Set(fixture.allUserIds).size !== fixture.allUserIds.length
  ) {
    throw new Error("fixture.allUserIds must exactly match the unique synthetic user IDs");
  }
  if (fixture.userA.id === fixture.userB.id) {
    throw new Error("synthetic fixture users must differ");
  }
  return fixture;
}

function createClient(connectionString) {
  return new Client({
    application_name: "grainline-saved-search-rls-gate",
    connectionString,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
  });
}

async function assertNoUserFixtureCollision(ownerClient, fixture) {
  const result = await ownerClient.query(
    `SELECT count(*)::int AS user_count
       FROM public."User"
      WHERE id = ANY($1::text[])
         OR "clerkId" = ANY($2::text[])
         OR email = ANY($3::text[])`,
    [
      fixture.allUserIds,
      [fixture.userA.clerkId, fixture.userB.clerkId],
      [fixture.userA.email, fixture.userB.email],
    ],
  );
  const row = result.rows[0];
  if (Number(row?.user_count ?? -1) !== 0) {
    throw new GateAssertionError("synthetic User fixture collision detected; no rows were changed");
  }
}

async function seedOwnerUsers(ownerClient, fixture) {
  await ownerClient.query("BEGIN");
  try {
    await ownerClient.query(
      `INSERT INTO public."User" (id, "clerkId", email, "updatedAt")
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP), ($4, $5, $6, CURRENT_TIMESTAMP)`,
      [
        fixture.userA.id,
        fixture.userA.clerkId,
        fixture.userA.email,
        fixture.userB.id,
        fixture.userB.clerkId,
        fixture.userB.email,
      ],
    );
    await ownerClient.query("COMMIT");
  } catch (error) {
    await ownerClient.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function assertOwnerUsers(ownerClient, fixture) {
  const result = await ownerClient.query(
    `SELECT id, "clerkId", email
       FROM public."User"
      WHERE id = ANY($1::text[])
      ORDER BY id`,
    [fixture.allUserIds],
  );
  const expected = [fixture.userA, fixture.userB]
    .map((user) => ({ clerkId: user.clerkId, email: user.email, id: user.id }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const actual = result.rows
    .map((user) => ({ clerkId: user.clerkId, email: user.email, id: user.id }))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (
    actual.length !== expected.length
    || actual.some((user, index) => (
      user.id !== expected[index].id
      || user.clerkId !== expected[index].clerkId
      || user.email !== expected[index].email
    ))
  ) {
    throw new GateAssertionError("owner User verification did not match the two synthetic users");
  }
}

async function cleanupUsersOnClient(cleanupClient, fixture) {
  await cleanupClient.query("ROLLBACK").catch(() => {});
  await cleanupClient.query("BEGIN");
  try {
    await cleanupClient.query(
      `DELETE FROM public."User"
        WHERE id = ANY($1::text[])
          AND id LIKE 'rls-saved-search-%'`,
      [fixture.allUserIds],
    );
    await cleanupClient.query("COMMIT");
  } catch (error) {
    await cleanupClient.query("ROLLBACK").catch(() => {});
    throw error;
  }

  const verification = await cleanupClient.query(
    `SELECT count(*)::int AS user_count
       FROM public."User"
      WHERE id = ANY($1::text[])`,
    [fixture.allUserIds],
  );
  const row = verification.rows[0];
  if (Number(row?.user_count ?? -1) !== 0) {
    throw new GateAssertionError("owner cleanup did not verify zero remaining synthetic User rows");
  }
}

async function cleanupUsers(config, fixture, existingOwnerClient) {
  if (existingOwnerClient) {
    try {
      await cleanupUsersOnClient(existingOwnerClient, fixture);
      return;
    } catch {
      // Retry once on a fresh direct owner connection. This covers a broken or
      // transaction-aborted long-lived client without broadening row scope.
    }
  }

  const cleanupClient = createClient(config.adminDatabaseUrl);
  await cleanupClient.connect();
  try {
    await cleanupUsersOnClient(cleanupClient, fixture);
  } finally {
    await cleanupClient.end().catch(() => {});
  }
}

async function readRuntimeContext(runtimeClient) {
  const result = await runtimeClient.query(
    "SELECT current_setting('app.user_id', true) AS user_id",
  );
  return result.rows[0]?.user_id ?? null;
}

async function assertInitialRuntimeContextUnset(runtimeClient) {
  const context = await readRuntimeContext(runtimeClient);
  if (context !== null && context !== "") {
    throw new GateAssertionError("runtime connection starts with app.user_id already set");
  }
}

async function readVisibleFixtureRows(runtimeClient, fixture) {
  const result = await runtimeClient.query(
    `SELECT id, "userId"
       FROM public."SavedSearch"
      WHERE id = ANY($1::text[])
      ORDER BY id`,
    [fixture.allSearchIds],
  );
  return result.rows;
}

function assertExactVisibleRows(rows, expectedIds, label) {
  const actualIds = rows.map((row) => row.id).sort();
  const sortedExpectedIds = [...expectedIds].sort();
  if (
    actualIds.length !== sortedExpectedIds.length
    || actualIds.some((id, index) => id !== sortedExpectedIds[index])
  ) {
    throw new GateAssertionError(
      `${label} returned ${actualIds.length} fixture rows, expected ${sortedExpectedIds.length}`,
    );
  }
}

function assertResetContext(value, label) {
  if (value !== null && value !== "") {
    throw new GateAssertionError(`${label} retained transaction-local app.user_id`);
  }
}

async function setLocalUser(runtimeClient, userId) {
  const result = await runtimeClient.query(
    "SELECT set_config('app.user_id', $1, true) AS user_id",
    [userId],
  );
  if (result.rows[0]?.user_id !== userId) {
    throw new GateAssertionError("transaction-local app.user_id was not set to the requested synthetic user");
  }
}

async function withRuntimeTransaction(runtimeClient, fn, finish = "ROLLBACK") {
  await runtimeClient.query("BEGIN");
  try {
    const result = await fn();
    await runtimeClient.query(finish);
    return result;
  } catch (error) {
    await runtimeClient.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function withUserContext(runtimeClient, userId, fn, finish = "ROLLBACK") {
  return withRuntimeTransaction(runtimeClient, async () => {
    await setLocalUser(runtimeClient, userId);
    return fn();
  }, finish);
}

async function assertRuntimeConnectionRole(runtimeClient, runtimeRole) {
  const result = await runtimeClient.query(
    "SELECT current_user AS current_user_name, session_user AS session_user_name",
  );
  const row = result.rows[0];
  if (row?.current_user_name !== runtimeRole || row?.session_user_name !== runtimeRole) {
    throw new GateAssertionError("runtime cleanup connection role does not match the configured runtime role");
  }
}

async function assertNoSavedSearchFixtureCollision(runtimeClient, fixture) {
  for (const userId of [fixture.userA.id, fixture.userB.id]) {
    await withUserContext(runtimeClient, userId, async () => {
      assertExactVisibleRows(
        await readVisibleFixtureRows(runtimeClient, fixture),
        [],
        "runtime SavedSearch fixture preflight",
      );
    });
  }
}

async function verifySavedSearchCleanupOnClient(runtimeClient, fixture, runtimeRole) {
  await runtimeClient.query("ROLLBACK").catch(() => {});
  await assertRuntimeConnectionRole(runtimeClient, runtimeRole);
  await assertNoSavedSearchFixtureCollision(runtimeClient, fixture);
}

async function seedRuntimeSavedSearches(runtimeClient, fixture) {
  await withRuntimeTransaction(runtimeClient, async () => {
    await setLocalUser(runtimeClient, fixture.userA.id);
    const insertedA = await runtimeClient.query(
      `INSERT INTO public."SavedSearch" (id, "userId", query)
       VALUES ($1, $2, $3)`,
      [fixture.seedSearchAId, fixture.userA.id, fixture.seedQueryA],
    );
    await setLocalUser(runtimeClient, fixture.userB.id);
    const insertedB = await runtimeClient.query(
      `INSERT INTO public."SavedSearch" (id, "userId", query)
       VALUES ($1, $2, $3)`,
      [fixture.seedSearchBId, fixture.userB.id, fixture.seedQueryB],
    );
    if (insertedA.rowCount !== 1 || insertedB.rowCount !== 1) {
      throw new GateAssertionError("runtime seed transaction did not create both synthetic SavedSearch rows");
    }
  }, "COMMIT");
}

async function cleanupSavedSearchesOnClient(runtimeClient, fixture, runtimeRole) {
  await runtimeClient.query("ROLLBACK").catch(() => {});
  await assertRuntimeConnectionRole(runtimeClient, runtimeRole);
  for (const userId of [fixture.userA.id, fixture.userB.id]) {
    await withUserContext(runtimeClient, userId, async () => {
      await runtimeClient.query(
        `DELETE FROM public."SavedSearch"
          WHERE id = ANY($1::text[])
            AND id LIKE 'rls-saved-search-%'`,
        [fixture.allSearchIds],
      );
    }, "COMMIT");
  }
  await verifySavedSearchCleanupOnClient(runtimeClient, fixture, runtimeRole);
}

async function cleanupSavedSearches(config, fixture, existingRuntimeClient) {
  if (existingRuntimeClient) {
    try {
      await cleanupSavedSearchesOnClient(existingRuntimeClient, fixture, config.runtimeRole);
      return;
    } catch {
      // Retry once through a fresh pooled runtime-role connection. All DML
      // remains constrained by the exact A/B RLS contexts and fixture IDs.
    }
  }

  const cleanupClient = createClient(config.databaseUrl);
  await cleanupClient.connect();
  try {
    await cleanupSavedSearchesOnClient(cleanupClient, fixture, config.runtimeRole);
  } finally {
    await cleanupClient.end().catch(() => {});
  }
}

async function verifySavedSearchCleanup(config, fixture, existingRuntimeClient) {
  if (existingRuntimeClient) {
    try {
      await verifySavedSearchCleanupOnClient(
        existingRuntimeClient,
        fixture,
        config.runtimeRole,
      );
      return;
    } catch {
      // Retry once through a fresh pooled runtime-role connection so a broken
      // long-lived client cannot prevent the final bounded zero-row proof.
    }
  }

  const verificationClient = createClient(config.databaseUrl);
  await verificationClient.connect();
  try {
    await verifySavedSearchCleanupOnClient(
      verificationClient,
      fixture,
      config.runtimeRole,
    );
  } finally {
    await verificationClient.end().catch(() => {});
  }
}

async function expectRlsDenial(queryFn, label) {
  try {
    await queryFn();
  } catch (error) {
    if (error?.code === EXPECTED_DENIAL_SQLSTATE) return;
    throw new GateAssertionError(
      `${label} failed with unexpected SQLSTATE ${typeof error?.code === "string" ? error.code : "unknown"}`,
    );
  }
  throw new GateAssertionError(`${label} unexpectedly succeeded`);
}

async function readRuntimeSearch(runtimeClient, searchId) {
  const result = await runtimeClient.query(
    `SELECT id, "userId", query
       FROM public."SavedSearch"
      WHERE id = $1`,
    [searchId],
  );
  return result.rows;
}

function assertRuntimeSearch(rows, expectedUserId, expectedQuery, label) {
  if (
    rows.length !== 1
    || rows[0].userId !== expectedUserId
    || rows[0].query !== expectedQuery
  ) {
    throw new GateAssertionError(`${label} did not match the expected synthetic runtime-visible row`);
  }
}

async function runBehaviorProbes(runtimeClient, fixture, recordCheck) {
  await recordCheck("missing context sees zero fixture rows", async () => {
    assertResetContext(await readRuntimeContext(runtimeClient), "missing-context probe");
    assertExactVisibleRows(await readVisibleFixtureRows(runtimeClient, fixture), [], "missing-context probe");
  });

  await recordCheck("empty context sees zero fixture rows", async () => {
    await withRuntimeTransaction(runtimeClient, async () => {
      await setLocalUser(runtimeClient, "");
      assertExactVisibleRows(await readVisibleFixtureRows(runtimeClient, fixture), [], "empty-context probe");
    });
  });

  await recordCheck("wrong context sees zero fixture rows", async () => {
    await withRuntimeTransaction(runtimeClient, async () => {
      await setLocalUser(runtimeClient, fixture.wrongUserId);
      assertExactVisibleRows(await readVisibleFixtureRows(runtimeClient, fixture), [], "wrong-context probe");
    });
  });

  await recordCheck("correct user A context sees only its row", async () => {
    await withRuntimeTransaction(runtimeClient, async () => {
      await setLocalUser(runtimeClient, fixture.userA.id);
      assertExactVisibleRows(
        await readVisibleFixtureRows(runtimeClient, fixture),
        [fixture.seedSearchAId],
        "correct user A probe",
      );
    });
  });

  await recordCheck("correct user B context sees only its row", async () => {
    await withRuntimeTransaction(runtimeClient, async () => {
      await setLocalUser(runtimeClient, fixture.userB.id);
      assertExactVisibleRows(
        await readVisibleFixtureRows(runtimeClient, fixture),
        [fixture.seedSearchBId],
        "correct user B probe",
      );
    });
  });

  await recordCheck("commit resets transaction-local context", async () => {
    await withRuntimeTransaction(runtimeClient, async () => {
      await setLocalUser(runtimeClient, fixture.userA.id);
      assertExactVisibleRows(
        await readVisibleFixtureRows(runtimeClient, fixture),
        [fixture.seedSearchAId],
        "commit locality probe",
      );
    }, "COMMIT");
    assertResetContext(await readRuntimeContext(runtimeClient), "post-commit probe");
    assertExactVisibleRows(await readVisibleFixtureRows(runtimeClient, fixture), [], "post-commit probe");
  });

  await recordCheck("rollback resets transaction-local context", async () => {
    await withRuntimeTransaction(runtimeClient, async () => {
      await setLocalUser(runtimeClient, fixture.userB.id);
      assertExactVisibleRows(
        await readVisibleFixtureRows(runtimeClient, fixture),
        [fixture.seedSearchBId],
        "rollback locality probe",
      );
    });
    assertResetContext(await readRuntimeContext(runtimeClient), "post-rollback probe");
    assertExactVisibleRows(await readVisibleFixtureRows(runtimeClient, fixture), [], "post-rollback probe");
  });

  await recordCheck("own insert succeeds", async () => {
    await withRuntimeTransaction(runtimeClient, async () => {
      await setLocalUser(runtimeClient, fixture.userA.id);
      const inserted = await runtimeClient.query(
        `INSERT INTO public."SavedSearch" (id, "userId", query)
         VALUES ($1, $2, $3)`,
        [fixture.ownInsertSearchId, fixture.userA.id, fixture.seedQueryA],
      );
      if (inserted.rowCount !== 1) {
        throw new GateAssertionError("own insert did not create exactly one synthetic row");
      }
    }, "COMMIT");
    await withUserContext(runtimeClient, fixture.userA.id, async () => {
      assertRuntimeSearch(
        await readRuntimeSearch(runtimeClient, fixture.ownInsertSearchId),
        fixture.userA.id,
        fixture.seedQueryA,
        "own insert",
      );
    });
  });

  await recordCheck("foreign insert is denied", async () => {
    await withRuntimeTransaction(runtimeClient, async () => {
      await setLocalUser(runtimeClient, fixture.userA.id);
      await expectRlsDenial(
        () => runtimeClient.query(
          `INSERT INTO public."SavedSearch" (id, "userId", query)
           VALUES ($1, $2, $3)`,
          [fixture.foreignInsertSearchId, fixture.userB.id, fixture.seedQueryB],
        ),
        "foreign insert",
      );
    });
    await withUserContext(runtimeClient, fixture.userB.id, async () => {
      assertExactVisibleRows(
        await readRuntimeSearch(runtimeClient, fixture.foreignInsertSearchId),
        [],
        "foreign insert user B verification",
      );
    });
  });

  await recordCheck("no-context insert is denied", async () => {
    await withRuntimeTransaction(runtimeClient, async () => {
      assertResetContext(await readRuntimeContext(runtimeClient), "no-context insert probe");
      await expectRlsDenial(
        () => runtimeClient.query(
          `INSERT INTO public."SavedSearch" (id, "userId", query)
           VALUES ($1, $2, $3)`,
          [fixture.noContextInsertSearchId, fixture.userA.id, fixture.seedQueryA],
        ),
        "no-context insert",
      );
    });
    await withUserContext(runtimeClient, fixture.userA.id, async () => {
      assertExactVisibleRows(
        await readRuntimeSearch(runtimeClient, fixture.noContextInsertSearchId),
        [],
        "no-context insert user A verification",
      );
    });
  });

  await recordCheck("foreign delete affects zero rows and preserves the row", async () => {
    await withRuntimeTransaction(runtimeClient, async () => {
      await setLocalUser(runtimeClient, fixture.userA.id);
      const deleted = await runtimeClient.query(
        `DELETE FROM public."SavedSearch"
          WHERE id = $1`,
        [fixture.seedSearchBId],
      );
      if (deleted.rowCount !== 0) {
        throw new GateAssertionError("foreign delete affected a synthetic row");
      }
    }, "COMMIT");
    await withUserContext(runtimeClient, fixture.userB.id, async () => {
      assertRuntimeSearch(
        await readRuntimeSearch(runtimeClient, fixture.seedSearchBId),
        fixture.userB.id,
        fixture.seedQueryB,
        "foreign delete user B preservation",
      );
    });
  });

  await recordCheck("own delete succeeds", async () => {
    await withRuntimeTransaction(runtimeClient, async () => {
      await setLocalUser(runtimeClient, fixture.userA.id);
      const deleted = await runtimeClient.query(
        `DELETE FROM public."SavedSearch"
          WHERE id = $1`,
        [fixture.ownInsertSearchId],
      );
      if (deleted.rowCount !== 1) {
        throw new GateAssertionError("own delete did not remove exactly one synthetic row");
      }
    }, "COMMIT");
    await withUserContext(runtimeClient, fixture.userA.id, async () => {
      assertExactVisibleRows(
        await readRuntimeSearch(runtimeClient, fixture.ownInsertSearchId),
        [],
        "own delete user A verification",
      );
    });
  });

  await recordCheck("update is denied or affects zero rows and leaves data unchanged", async () => {
    let outcome;
    await runtimeClient.query("BEGIN");
    try {
      await setLocalUser(runtimeClient, fixture.userA.id);
      const updated = await runtimeClient.query(
        `UPDATE public."SavedSearch"
            SET query = $1
          WHERE id = $2`,
        [fixture.changedQuery, fixture.seedSearchAId],
      );
      outcome = { kind: "row-count", rowCount: updated.rowCount };
      await runtimeClient.query("COMMIT");
    } catch (error) {
      await runtimeClient.query("ROLLBACK").catch(() => {});
      if (error?.code !== EXPECTED_DENIAL_SQLSTATE) throw error;
      outcome = { kind: "denied" };
    }

    await withUserContext(runtimeClient, fixture.userA.id, async () => {
      assertRuntimeSearch(
        await readRuntimeSearch(runtimeClient, fixture.seedSearchAId),
        fixture.userA.id,
        fixture.seedQueryA,
        "update user A unchanged verification",
      );
    });
    if (outcome.kind === "row-count" && outcome.rowCount !== 0) {
      throw new GateAssertionError("update affected a synthetic row despite the absent UPDATE policy");
    }
  });
}

function errorSummary(error) {
  if (error instanceof GateAssertionError) return error.message;
  if (typeof error?.code === "string" && /^[A-Z0-9]{5}$/.test(error.code)) {
    return `database operation failed with SQLSTATE ${error.code}`;
  }
  const message = error instanceof Error ? error.message : String(error);
  return redactEvidenceText(message).slice(0, 300) || "unknown gate error";
}

export async function runSavedSearchRlsAcceptanceGate(config, { fixture = buildFixtureIds() } = {}) {
  validateFixture(fixture);
  const issues = [];
  const checks = [];
  const ownerClient = createClient(config.adminDatabaseUrl);
  const runtimeClient = createClient(config.databaseUrl);
  let cleanupAuthorized = false;
  let ownerConnected = false;
  let runtimeConnected = false;

  async function recordCheck(name, fn) {
    try {
      await fn();
      checks.push({ name, status: "passed" });
      return true;
    } catch (error) {
      const summary = errorSummary(error);
      issues.push(`${name}: ${summary}`);
      checks.push({ name, status: "failed", summary });
      return false;
    }
  }

  try {
    await ownerClient.connect();
    ownerConnected = true;
    await runtimeClient.connect();
    runtimeConnected = true;

    const initialContextClean = await recordCheck(
      "runtime connection initial app.user_id preflight",
      async () => {
        await assertInitialRuntimeContextUnset(runtimeClient);
      },
    );
    if (initialContextClean) {
      const catalogState = await readCatalogState(ownerClient, runtimeClient, config);
      const catalogIssues = collectSavedSearchCatalogIssues(catalogState, config);
      if (catalogIssues.length > 0) {
        issues.push(...catalogIssues);
        checks.push({
          name: "runtime role and exact SavedSearch catalog state",
          status: "failed",
          summary: `${catalogIssues.length} catalog issues`,
        });
      } else {
        checks.push({ name: "runtime role and exact SavedSearch catalog state", status: "passed" });

        const collisionFree = await recordCheck("synthetic User fixture collision preflight", async () => {
          await assertNoUserFixtureCollision(ownerClient, fixture);
        });
        if (collisionFree) {
          cleanupAuthorized = true;
          const usersSeeded = await recordCheck("owner User seed transaction", async () => {
            await seedOwnerUsers(ownerClient, fixture);
          });
          const usersVerified = usersSeeded && await recordCheck("owner User fixture verification", async () => {
            await assertOwnerUsers(ownerClient, fixture);
          });
          const searchesCollisionFree = usersVerified && await recordCheck(
            "runtime SavedSearch fixture collision preflight",
            async () => {
              await assertNoSavedSearchFixtureCollision(runtimeClient, fixture);
            },
          );
          const searchesSeeded = searchesCollisionFree && await recordCheck(
            "runtime A/B SavedSearch seed transaction",
            async () => {
              await seedRuntimeSavedSearches(runtimeClient, fixture);
            },
          );
          if (searchesSeeded) {
            await runBehaviorProbes(runtimeClient, fixture, recordCheck);
          }
        }
      }
    }
  } catch (error) {
    const summary = errorSummary(error);
    issues.push(`gate orchestration: ${summary}`);
    checks.push({ name: "gate orchestration", status: "failed", summary });
  } finally {
    if (cleanupAuthorized) {
      await recordCheck(
        "runtime A/B SavedSearch cleanup zero verification",
        async () => {
          await cleanupSavedSearches(
            config,
            fixture,
            runtimeConnected ? runtimeClient : undefined,
          );
        },
      );
      await recordCheck("owner User cleanup zero verification", async () => {
        await cleanupUsers(config, fixture, ownerConnected ? ownerClient : undefined);
      });
      await recordCheck("post-user-delete SavedSearch zero verification", async () => {
        await verifySavedSearchCleanup(
          config,
          fixture,
          runtimeConnected ? runtimeClient : undefined,
        );
      });
    }
    if (runtimeConnected) await runtimeClient.end().catch(() => {});
    if (ownerConnected) await ownerClient.end().catch(() => {});
  }

  return {
    checks,
    cleanupVerified: [
      "owner User cleanup zero verification",
      "post-user-delete SavedSearch zero verification",
    ].every((name) => checks.some((check) => check.name === name && check.status === "passed")),
    issues,
  };
}

export function redactEvidenceText(value) {
  return String(value)
    .replace(DATABASE_URL_ASSIGNMENT_PATTERN, "[redacted-database-url]")
    .replace(PASSWORD_ASSIGNMENT_PATTERN, "[redacted-password]")
    .replace(POSTGRES_URL_PATTERN, "[redacted-postgres-url]")
    .replace(URL_USERINFO_PATTERN, "$1[redacted-credentials]@")
    .replace(QUERY_PAYLOAD_PATTERN, "[redacted-query-payload]")
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .replace(FIXTURE_ID_PATTERN, "[redacted-fixture-id]");
}

export function buildEvidencePayload(
  config,
  result,
  { finishedAt, startedAt, status = result.issues.length === 0 ? "passed" : "failed" },
) {
  const evidenceStatus = status === "passed" && !config.acceptanceEligible
    ? "development_only_passed"
    : status;
  return {
    generatedAt: finishedAt,
    run: {
      acceptanceEligible: config.acceptanceEligible,
      finishedAt,
      startedAt,
      status: evidenceStatus,
    },
    target: {
      databaseName: config.databaseName,
      expectedDatabaseEndpointId: config.expectedDatabaseEndpointId,
      expectedDatabaseRegion: config.expectedDatabaseRegion,
      runtimeTransport: config.runtimeTransport,
      runtimeRole: config.runtimeRole,
      forceRlsExpected: SAVED_SEARCH_RLS_FORCE_EXPECTED,
      schema: SAVED_SEARCH_TABLE.schema,
      table: SAVED_SEARCH_TABLE.table,
    },
    result: {
      checkCount: result.checks.length,
      checks: result.checks.map((check) => ({
        name: redactEvidenceText(check.name),
        status: check.status,
        ...(check.summary ? { summary: redactEvidenceText(check.summary) } : {}),
      })),
      cleanupVerified: result.cleanupVerified,
      issueCount: result.issues.length,
      issues: result.issues.map((issue) => redactEvidenceText(issue)),
    },
  };
}

export function writeEvidencePayload(evidencePath, payload) {
  if (!evidencePath) return;
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  if (
    /postgres(?:ql)?:\/\//i.test(serialized)
    || /\b(?:PGPASSWORD|password|pass|pwd)\b\s*[:=]/i.test(serialized)
  ) {
    throw new Error("refusing to write unsanitized SavedSearch RLS evidence");
  }
  writeFileSync(evidencePath, serialized, { encoding: "utf8", mode: 0o600 });
  chmodSync(evidencePath, 0o600);
}

function printUsage(logger) {
  logger.error("Usage:");
  logger.error(
    "  SAVED_SEARCH_RLS_GATE_CONFIRM=staging-only SAVED_SEARCH_RLS_GATE_EXPECTED_DATABASE_ENDPOINT_ID='<reviewed staging ep-* id>' SAVED_SEARCH_RLS_GATE_PRODUCTION_DATABASE_ENDPOINT_ID='<independently reviewed production ep-* id>' SAVED_SEARCH_RLS_GATE_EXPECTED_DATABASE_NAME='<reviewed staging database>' SAVED_SEARCH_RLS_GATE_EXPECTED_DATABASE_REGION='<reviewed staging region>' SAVED_SEARCH_RLS_GATE_DATABASE_URL='<pooled staging runtime URL>' SAVED_SEARCH_RLS_GATE_ADMIN_DATABASE_URL='<direct staging owner URL>' SAVED_SEARCH_RLS_GATE_EVIDENCE_PATH='<outside-repository path>' node scripts/saved-search-rls-acceptance-gate.mjs",
  );
  logger.error(
    "Optional: SAVED_SEARCH_RLS_GATE_RUNTIME_ROLE=grainline_app_runtime; development only: SAVED_SEARCH_RLS_GATE_ALLOW_NON_POOLER=1 SAVED_SEARCH_RLS_GATE_ALLOW_NO_EVIDENCE_FOR_DEVELOPMENT=1",
  );
}

export async function main(env = process.env, logger = console) {
  let config;
  try {
    config = parseGateConfig(env);
  } catch (error) {
    logger.error(redactEvidenceText(error instanceof Error ? error.message : String(error)));
    printUsage(logger);
    process.exitCode = 2;
    return { status: "configuration-error" };
  }

  const startedAt = new Date().toISOString();
  const result = await runSavedSearchRlsAcceptanceGate(config);
  const finishedAt = new Date().toISOString();
  const status = result.issues.length > 0
    ? "failed"
    : config.acceptanceEligible
      ? "passed"
      : "development_only_passed";
  const evidence = buildEvidencePayload(config, result, { finishedAt, startedAt, status });
  writeEvidencePayload(config.evidencePath, evidence);

  if (status === "failed") {
    logger.error("SavedSearch RLS staging acceptance gate failed.");
    for (const issue of evidence.result.issues) logger.error(`- ${issue}`);
    process.exitCode = 1;
  } else if (status === "passed") {
    logger.log("SavedSearch RLS staging acceptance gate passed with runtime A/B and owner cleanup verified at zero rows.");
  } else {
    logger.log("SavedSearch RLS development-only gate passed; this run is not acceptance evidence.");
  }
  return { evidence, result, status };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(redactEvidenceText(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}
