#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const REQUIRED_TABLE_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE"];
export const SAVED_SEARCH_PHASE_A_TABLE_PRIVILEGES = ["SELECT", "INSERT", "DELETE"];
export const REQUIRED_SEQUENCE_PRIVILEGES = ["USAGE", "SELECT"];
export const REQUIRED_FUNCTION_PRIVILEGES = ["EXECUTE"];
export const REQUIRED_TYPE_PRIVILEGES = ["USAGE"];
const AUDIT_CONNECTION_TIMEOUT_MS = 10_000;
const AUDIT_STATEMENT_TIMEOUT_MS = 30_000;
const AUDIT_QUERY_TIMEOUT_MS = 35_000;
export const SAVED_SEARCH_CATALOG_EVIDENCE_PREFIX =
  "SAVED_SEARCH_CATALOG_STATE=";
export const REQUIRE_DIRECT_URL_FLAG = "--require-direct-url";

const OBJECT_TYPE_TABLE = "r";
const OBJECT_TYPE_SEQUENCE = "S";
const OBJECT_TYPE_FUNCTION = "f";
const OBJECT_TYPE_TYPE = "T";
const REQUIRED_EXTENSION_RUNTIME_FUNCTIONS = {
  pg_trgm: ["public.similarity(text, text)"],
};
const REQUIRED_EXTENSION_RUNTIME_OPERATORS = {
  pg_trgm: [
    { schema: "public", name: "%", leftType: "text", rightType: "text" },
  ],
};

export const SAVED_SEARCH_RLS_POLICIES = Object.freeze({
  saved_search_owner_select: Object.freeze({
    command: "r",
    usingExpression: `"userId" = NULLIF(current_setting('app.user_id', true), '')`,
    checkExpression: null,
  }),
  saved_search_owner_insert: Object.freeze({
    command: "a",
    usingExpression: null,
    checkExpression: `"userId" = NULLIF(current_setting('app.user_id', true), '')`,
  }),
  saved_search_owner_delete: Object.freeze({
    command: "d",
    usingExpression: `"userId" = NULLIF(current_setting('app.user_id', true), '')`,
    checkExpression: null,
  }),
});

// Phase A protects the non-owner runtime role while Vercel's 12-hour skew
// window drains owner-backed application deployments. Change this only in the
// later, separately deployed FORCE migration commit.
export const SAVED_SEARCH_RLS_FORCE_EXPECTED = false;

export const SAVED_SEARCH_OWNER_RPC_FUNCTIONS = Object.freeze({
  grainline_saved_search_list: Object.freeze({
    identityArguments: "p_user_id text, p_take integer, p_search_id text",
    sourceSha256: "8fb745049da3f57fe116392124c13b7e55bb669d087a88a89a8126bad6b28d19",
  }),
  grainline_saved_search_delete_one: Object.freeze({
    identityArguments: "p_user_id text, p_search_id text",
    sourceSha256: "d34ee291a4ca9338b341f9e128249902e9d63b4330461e3fbed1dddce4ca3424",
  }),
});

function sortedUnique(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function mappedDbName(block, fallbackName) {
  const mapMatch = block.match(/^\s*@@map\("([^"]+)"\)/m);
  return mapMatch?.[1] ?? fallbackName;
}

function sqlStatements(sql) {
  // This is only a lightweight REVOKE detector for migration files, not a
  // general SQL parser. Do not reuse it for statements where dollar-quoted
  // function bodies or semicolon placement affects correctness.
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function readMigrationSql(rootDir) {
  const migrationsDir = path.join(rootDir, "prisma", "migrations");
  if (!existsSync(migrationsDir)) return "";
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(migrationsDir, entry.name, "migration.sql"))
    .filter((migrationPath) => existsSync(migrationPath))
    .map((migrationPath) => readFileSync(migrationPath, "utf8"))
    .join("\n");
}

function hasBalancedOuterParentheses(value) {
  if (!value.startsWith("(") || !value.endsWith(")")) return false;
  let depth = 0;
  let inSingleQuote = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "'" && value[index + 1] === "'") {
      index += 1;
      continue;
    }
    if (character === "'") {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (inSingleQuote) continue;
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth === 0 && index < value.length - 1) return false;
  }
  return depth === 0 && !inSingleQuote;
}

export function normalizeRlsPolicyExpression(expression) {
  if (expression === null || expression === undefined) return null;
  const value = String(expression);
  let normalized = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (inSingleQuote) {
      normalized += character;
      if (character === "'" && value[index + 1] === "'") {
        normalized += value[index + 1];
        index += 1;
      } else if (character === "'") {
        inSingleQuote = false;
      }
      continue;
    }
    if (inDoubleQuote) {
      normalized += character;
      if (character === '"' && value[index + 1] === '"') {
        normalized += value[index + 1];
        index += 1;
      } else if (character === '"') {
        inDoubleQuote = false;
      }
      continue;
    }
    if (character === "'") {
      inSingleQuote = true;
      normalized += character;
      continue;
    }
    if (character === '"') {
      inDoubleQuote = true;
      normalized += character;
      continue;
    }

    const castMatch = value.slice(index).match(/^::(?:text|character\s+varying)\b/i);
    if (castMatch) {
      index += castMatch[0].length - 1;
      continue;
    }
    if (/\s/.test(character)) {
      if (normalized.length > 0 && !normalized.endsWith(" ")) normalized += " ";
      continue;
    }
    normalized += character;
  }

  normalized = normalized.trim();
  while (hasBalancedOuterParentheses(normalized)) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized;
}

export function normalizeSavedSearchCatalogState(row) {
  if (!row || row.table_name !== "SavedSearch") {
    throw new Error("live catalog is missing public.SavedSearch");
  }
  if (
    typeof row.rls_enabled !== "boolean"
    || typeof row.rls_forced !== "boolean"
  ) {
    throw new Error("live SavedSearch RLS catalog flags are invalid");
  }

  const policyCount = Number(row.policy_count);
  if (!Number.isSafeInteger(policyCount) || policyCount < 0) {
    throw new Error("live SavedSearch policy count is invalid");
  }

  return Object.freeze({
    schema: "public",
    table: "SavedSearch",
    relrowsecurity: row.rls_enabled,
    relforcerowsecurity: row.rls_forced,
    policy_count: policyCount,
  });
}

export function formatSavedSearchCatalogEvidence(state) {
  const normalized = normalizeSavedSearchCatalogState({
    table_name: state?.table,
    rls_enabled: state?.relrowsecurity,
    rls_forced: state?.relforcerowsecurity,
    policy_count: state?.policy_count,
  });
  return `${SAVED_SEARCH_CATALOG_EVIDENCE_PREFIX}${JSON.stringify(normalized)}`;
}

export async function readSavedSearchCatalogState(client) {
  const result = await client.query(
    `SELECT
        c.relname AS table_name,
        c.relrowsecurity AS rls_enabled,
        c.relforcerowsecurity AS rls_forced,
        COUNT(p.oid)::integer AS policy_count
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_policy p ON p.polrelid = c.oid
      WHERE n.nspname = 'public'
        AND c.relname = 'SavedSearch'
        AND c.relkind IN ('r', 'p')
      GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity`,
  );
  if (result.rows.length !== 1) {
    throw new Error("live catalog must contain exactly one public.SavedSearch table");
  }
  return normalizeSavedSearchCatalogState(result.rows[0]);
}

export function resolveGrantAuditConnection(env, argv = []) {
  const directUrl = env.DIRECT_URL?.trim();
  const auditUrl = env.GRANT_AUDIT_DATABASE_URL?.trim();
  const requireDirectUrl = argv.includes(REQUIRE_DIRECT_URL_FLAG);

  if (requireDirectUrl) {
    if (!directUrl) {
      throw new Error("DIRECT_URL is required for guarded post-migration grant audit");
    }
    if (auditUrl && auditUrl !== directUrl) {
      throw new Error(
        "GRANT_AUDIT_DATABASE_URL must be absent or exactly match DIRECT_URL during guarded post-migration audit",
      );
    }
    return directUrl;
  }

  const connectionString = auditUrl || directUrl;
  if (!connectionString) {
    throw new Error("GRANT_AUDIT_DATABASE_URL or DIRECT_URL is required for grant audit");
  }
  return connectionString;
}

function normalizedPolicyRoles(value) {
  if (Array.isArray(value)) return sortedUnique(value.map(String));
  if (value === null || value === undefined) return [];
  return sortedUnique(String(value).replace(/^\{|\}$/g, "").split(",").filter(Boolean));
}

export function collectSavedSearchPolicyIssues(
  rows,
  runtimeRole,
  expectedForce = SAVED_SEARCH_RLS_FORCE_EXPECTED,
) {
  const issues = [];
  if (!Array.isArray(rows) || rows.length === 0) {
    return ['missing expected table SavedSearch for exact RLS policy audit'];
  }

  const tableState = rows[0];
  if (!tableState.rls_enabled) {
    issues.push('table SavedSearch must have ROW LEVEL SECURITY enabled');
  }
  if (Boolean(tableState.rls_forced) !== expectedForce) {
    issues.push(
      expectedForce
        ? 'table SavedSearch must have FORCE ROW LEVEL SECURITY enabled'
        : 'table SavedSearch must keep FORCE ROW LEVEL SECURITY disabled during phase A',
    );
  }

  const policies = rows.filter((row) => typeof row.policy_name === "string");
  const expectedNames = Object.keys(SAVED_SEARCH_RLS_POLICIES).sort();
  const actualNames = policies.map((row) => row.policy_name).sort();
  for (const missingName of missingItems(expectedNames, actualNames)) {
    issues.push(`SavedSearch is missing policy ${missingName}`);
  }
  for (const extraName of missingItems(actualNames, expectedNames)) {
    issues.push(`SavedSearch has unexpected policy ${extraName}`);
  }

  for (const policy of policies) {
    const expected = SAVED_SEARCH_RLS_POLICIES[policy.policy_name];
    if (!expected) continue;
    if (!policy.policy_permissive) {
      issues.push(`SavedSearch policy ${policy.policy_name} must be PERMISSIVE`);
    }
    if (policy.policy_command !== expected.command) {
      issues.push(
        `SavedSearch policy ${policy.policy_name} has command ${policy.policy_command ?? "unknown"}, expected ${expected.command}`,
      );
    }
    const roles = normalizedPolicyRoles(policy.policy_roles);
    if (roles.length !== 1 || roles[0] !== runtimeRole) {
      issues.push(
        `SavedSearch policy ${policy.policy_name} has roles ${roles.join(", ") || "none"}, expected only ${runtimeRole}`,
      );
    }
    const actualUsing = normalizeRlsPolicyExpression(policy.using_expression);
    const expectedUsing = normalizeRlsPolicyExpression(expected.usingExpression);
    if (actualUsing !== expectedUsing) {
      issues.push(`SavedSearch policy ${policy.policy_name} has an unexpected USING expression`);
    }
    const actualCheck = normalizeRlsPolicyExpression(policy.check_expression);
    const expectedCheck = normalizeRlsPolicyExpression(expected.checkExpression);
    if (actualCheck !== expectedCheck) {
      issues.push(`SavedSearch policy ${policy.policy_name} has an unexpected WITH CHECK expression`);
    }
  }

  return issues;
}

export async function readSavedSearchPolicyState(client) {
  const result = await client.query(
    `SELECT
        c.relrowsecurity AS rls_enabled,
        c.relforcerowsecurity AS rls_forced,
        p.polname AS policy_name,
        p.polcmd AS policy_command,
        p.polpermissive AS policy_permissive,
        CASE
          WHEN p.oid IS NULL THEN ARRAY[]::text[]
          ELSE ARRAY(
            SELECT CASE
                     WHEN policy_role.role_oid = 0 THEN 'PUBLIC'
                     ELSE pg_get_userbyid(policy_role.role_oid)::text
                   END
              FROM unnest(p.polroles) AS policy_role(role_oid)
             ORDER BY 1
          )
        END AS policy_roles,
        pg_get_expr(p.polqual, p.polrelid) AS using_expression,
        pg_get_expr(p.polwithcheck, p.polrelid) AS check_expression
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_policy p ON p.polrelid = c.oid
      WHERE n.nspname = 'public'
        AND c.relname = 'SavedSearch'
        AND c.relkind IN ('r', 'p')
      ORDER BY p.polname`,
  );
  return result.rows;
}

export function deriveGrantInventory(rootDir = ROOT_DIR) {
  const schema = readFileSync(path.join(rootDir, "prisma", "schema.prisma"), "utf8");
  const migrationSql = readMigrationSql(rootDir);

  const modelBlocks = [...schema.matchAll(/^model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)^}/gm)];
  const tables = sortedUnique(modelBlocks.map((match) => mappedDbName(match[2], match[1])));
  const enumBlocks = [...schema.matchAll(/^enum\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)^}/gm)];
  const enums = sortedUnique(
    enumBlocks.map((match) => mappedDbName(match[2], match[1])),
  );
  const fixedIntSingletonIds = sortedUnique(
    modelBlocks.flatMap((match) =>
      [...match[2].matchAll(/^\s+([A-Za-z_][A-Za-z0-9_]*)\s+Int\s+@id\s+@default\(1\)/gm)]
        .map((fieldMatch) => `${match[1]}.${fieldMatch[1]}`),
    ),
  );
  const autoincrementFields = sortedUnique(
    modelBlocks.flatMap((match) =>
      [...match[2].matchAll(/^\s+([A-Za-z_][A-Za-z0-9_]*)\s+\w+.*@default\(autoincrement\(\)\)/gm)]
        .map((fieldMatch) => `${match[1]}.${fieldMatch[1]}`),
    ),
  );
  const sequenceSqlReferences = sortedUnique(
    [
      ...migrationSql.matchAll(/\bCREATE\s+SEQUENCE\b|\bBIGSERIAL\b|\bSERIAL\b|\bnextval\s*\(/gi),
    ].map((match) => match[0].replace(/\s+/g, " ").trim().toUpperCase()),
  );
  const extensions = sortedUnique(
    [...migrationSql.matchAll(/\bCREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi)]
      .map((match) => match[1]),
  );
  const functions = sortedUnique(
    [...migrationSql.matchAll(
      /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?public"?\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?\s*\(/gi,
    )]
      .map((match) => match[1])
      .filter((name) => name.startsWith("grainline_")),
  );
  const publicRevokes = sortedUnique(
    sqlStatements(migrationSql)
      .filter(
        (statement) =>
          /\bREVOKE\b/i.test(statement) && /\bFROM\s+PUBLIC\b/i.test(statement),
      )
      .map((statement) => statement.replace(/\s+/g, " ").trim()),
  );
  const publicDefaultPrivilegeRevokes = publicRevokes.filter((statement) =>
    /\bALTER\s+DEFAULT\s+PRIVILEGES\b/i.test(statement),
  );
  const rlsPolicyTables = sortedUnique(
    [...migrationSql.matchAll(
      /\bCREATE\s+POLICY\s+(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s+ON\s+(?:public\.)?(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/gi,
    )].map((match) => match[1] ?? match[2]),
  );

  return {
    tables,
    enums,
    functions,
    fixedIntSingletonIds,
    autoincrementFields,
    sequenceSqlReferences,
    extensions,
    publicRevokes,
    publicDefaultPrivilegeRevokes,
    rlsPolicyTables,
  };
}

export function formatInventorySummary(inventory) {
  return [
    `${inventory.tables.length} tables`,
    `${inventory.enums.length} enums`,
    `${inventory.functions.length} grainline_* functions`,
    `${(inventory.extensions ?? []).length} extensions`,
    `${(inventory.rlsPolicyTables ?? []).length} RLS policy tables`,
    `${inventory.sequenceSqlReferences.length} sequence references`,
  ].join(", ");
}

export function defaultPrivilegeRequirements(inventory) {
  const requirements = [
    [OBJECT_TYPE_TABLE, REQUIRED_TABLE_PRIVILEGES],
    [OBJECT_TYPE_SEQUENCE, REQUIRED_SEQUENCE_PRIVILEGES],
  ];
  const publicDefaultPrivilegeRevokes = inventory.publicDefaultPrivilegeRevokes ?? [];

  if (publicDefaultPrivilegeRevokes.some((statement) => /\bFUNCTIONS?\b|\bROUTINES?\b/i.test(statement))) {
    requirements.push([OBJECT_TYPE_FUNCTION, REQUIRED_FUNCTION_PRIVILEGES]);
  }

  if (publicDefaultPrivilegeRevokes.some((statement) => /\bTYPES?\b/i.test(statement))) {
    requirements.push([OBJECT_TYPE_TYPE, REQUIRED_TYPE_PRIVILEGES]);
  }

  return requirements;
}

export function requiredRuntimeTablePrivileges(tableName, inventory) {
  return tableName === "SavedSearch"
    && (inventory.rlsPolicyTables ?? []).includes("SavedSearch")
    ? SAVED_SEARCH_PHASE_A_TABLE_PRIVILEGES
    : REQUIRED_TABLE_PRIVILEGES;
}

function missingItems(expected, actual) {
  const actualSet = new Set(actual);
  return expected.filter((item) => !actualSet.has(item));
}

function collectMissingPrivileges(rows, nameField, privileges) {
  const issues = [];
  for (const row of rows) {
    for (const privilege of privileges) {
      const field = `${privilege.toLowerCase()}_priv`;
      if (!row[field]) {
        issues.push(`${row[nameField]} lacks ${privilege}`);
      }
    }
  }
  return issues;
}

function normalizedPrivilegeArray(value) {
  if (!Array.isArray(value)) return [];
  return sortedUnique(value.map((privilege) => String(privilege).toUpperCase()));
}

function sha256(value) {
  if (typeof value !== "string") return null;
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function collectSavedSearchOwnerRpcIssues(rows, runtimeRole, migrationRole) {
  const issues = [];
  const rpcRows = Array.isArray(rows) ? rows : [];

  for (const [functionName, expected] of Object.entries(SAVED_SEARCH_OWNER_RPC_FUNCTIONS)) {
    const namedRows = rpcRows.filter((row) => row.function_name === functionName);
    const exactRow = namedRows.find(
      (row) => row.identity_arguments === expected.identityArguments,
    );
    const label = `${functionName}(${expected.identityArguments})`;

    if (!exactRow) {
      issues.push(`missing expected SavedSearch owner RPC ${label}`);
    }
    for (const row of namedRows) {
      if (row.identity_arguments !== expected.identityArguments) {
        issues.push(
          `SavedSearch owner RPC ${functionName} has unexpected overload (${row.identity_arguments ?? "unknown"})`,
        );
      }
    }
    if (!exactRow) continue;

    if (exactRow.owner_name !== migrationRole) {
      issues.push(`${label} owned by ${exactRow.owner_name ?? "unknown"}, expected ${migrationRole}`);
    }
    if (exactRow.owner_name === runtimeRole) {
      issues.push(`runtime role owns SavedSearch owner RPC ${label}`);
    }
    if (exactRow.security_definer) {
      issues.push(`${label} must be SECURITY INVOKER`);
    }
    if (exactRow.leakproof) {
      issues.push(`${label} must not be LEAKPROOF`);
    }
    if (exactRow.volatility !== "v") {
      issues.push(`${label} must be VOLATILE`);
    }
    if (exactRow.parallel_safety !== "u") {
      issues.push(`${label} must be PARALLEL UNSAFE`);
    }
    if (exactRow.function_kind !== "f") {
      issues.push(`${label} must be an ordinary function`);
    }
    if (exactRow.language_name !== "plpgsql") {
      issues.push(`${label} must use PL/pgSQL`);
    }
    if (!exactRow.return_contract_valid) {
      issues.push(`${label} has an unexpected return contract`);
    }
    if (typeof exactRow.function_source !== "string") {
      issues.push(`${label} function body source could not be read`);
    } else if (sha256(exactRow.function_source) !== expected.sourceSha256) {
      issues.push(`${label} body fingerprint changed`);
    }

    const functionConfig = Array.isArray(exactRow.function_config)
      ? [...exactRow.function_config].map(String).sort()
      : [];
    if (
      functionConfig.length !== 1 ||
      functionConfig[0] !== "search_path=pg_catalog"
    ) {
      issues.push(`${label} must set only search_path=pg_catalog`);
    }

    const runtimePrivileges = normalizedPrivilegeArray(exactRow.runtime_privileges);
    if (
      runtimePrivileges.length !== 1 ||
      runtimePrivileges[0] !== "EXECUTE"
    ) {
      issues.push(`${label} runtime role must have exactly direct EXECUTE`);
    }
    if (normalizedPrivilegeArray(exactRow.runtime_grant_option_privileges).length > 0) {
      issues.push(`${label} runtime EXECUTE must not be grantable`);
    }
    if (normalizedPrivilegeArray(exactRow.public_privileges).length > 0) {
      issues.push(`${label} must revoke all privileges from PUBLIC`);
    }
    if (normalizedPrivilegeArray(exactRow.public_grant_option_privileges).length > 0) {
      issues.push(`${label} PUBLIC privileges must not be grantable`);
    }
    if (normalizedPrivilegeArray(exactRow.other_role_privileges).length > 0) {
      issues.push(`${label} grants privileges to an unexpected role`);
    }
    if (normalizedPrivilegeArray(exactRow.other_role_grant_option_privileges).length > 0) {
      issues.push(`${label} grants grant-option privileges to an unexpected role`);
    }
  }

  return issues;
}

export async function readSavedSearchOwnerRpcState(client, runtimeRole) {
  const rpcNames = Object.keys(SAVED_SEARCH_OWNER_RPC_FUNCTIONS);
  const result = await client.query(
    `SELECT
        p.proname AS function_name,
        pg_get_function_identity_arguments(p.oid) AS identity_arguments,
        pg_get_userbyid(p.proowner) AS owner_name,
        p.prosecdef AS security_definer,
        p.proleakproof AS leakproof,
        p.provolatile AS volatility,
        p.proparallel AS parallel_safety,
        p.prokind AS function_kind,
        l.lanname AS language_name,
        p.proconfig AS function_config,
        p.prosrc AS function_source,
        CASE
          WHEN p.proname = 'grainline_saved_search_list'
            THEN p.proretset
              AND p.prorettype = 'public."SavedSearch"'::regtype
          WHEN p.proname = 'grainline_saved_search_delete_one'
            THEN NOT p.proretset
              AND p.prorettype = 'pg_catalog.int4'::regtype
          ELSE false
        END AS return_contract_valid,
        ARRAY(
          SELECT DISTINCT upper(acl.privilege_type)
            FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
           WHERE acl.grantee = (SELECT oid FROM pg_roles WHERE rolname = $1)
           ORDER BY 1
        ) AS runtime_privileges,
        ARRAY(
          SELECT DISTINCT upper(acl.privilege_type)
            FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
           WHERE acl.grantee = (SELECT oid FROM pg_roles WHERE rolname = $1)
             AND acl.is_grantable
           ORDER BY 1
        ) AS runtime_grant_option_privileges,
        ARRAY(
          SELECT DISTINCT upper(acl.privilege_type)
            FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
           WHERE acl.grantee = 0
           ORDER BY 1
        ) AS public_privileges,
        ARRAY(
          SELECT DISTINCT upper(acl.privilege_type)
            FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
           WHERE acl.grantee = 0
             AND acl.is_grantable
           ORDER BY 1
        ) AS public_grant_option_privileges,
        ARRAY(
          SELECT DISTINCT format('%s:%s', privilege_role.rolname, upper(acl.privilege_type))
            FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
            JOIN pg_roles privilege_role ON privilege_role.oid = acl.grantee
           WHERE acl.grantee <> p.proowner
             AND acl.grantee <> (SELECT oid FROM pg_roles WHERE rolname = $1)
           ORDER BY 1
        ) AS other_role_privileges,
        ARRAY(
          SELECT DISTINCT format('%s:%s', privilege_role.rolname, upper(acl.privilege_type))
            FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
            JOIN pg_roles privilege_role ON privilege_role.oid = acl.grantee
           WHERE acl.grantee <> p.proowner
             AND acl.grantee <> (SELECT oid FROM pg_roles WHERE rolname = $1)
             AND acl.is_grantable
           ORDER BY 1
        ) AS other_role_grant_option_privileges
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       JOIN pg_language l ON l.oid = p.prolang
      WHERE n.nspname = 'public'
        AND p.proname = ANY($2::text[])
      ORDER BY p.proname, identity_arguments`,
    [runtimeRole, rpcNames],
  );
  return result.rows;
}

export function collectTablePrivilegeAllowlistIssues(
  row,
  label,
  {
    checkColumnPrivileges = true,
    requiredPrivileges = REQUIRED_TABLE_PRIVILEGES,
  } = {},
) {
  if (!Array.isArray(row?.runtime_privileges)) {
    return [`${label} exact runtime-role table privilege state could not be read`];
  }
  if (!Array.isArray(row?.runtime_grant_option_privileges)) {
    return [`${label} runtime-role table grant-option state could not be read`];
  }
  if (!Array.isArray(row?.public_privileges)) {
    return [`${label} exact PUBLIC table privilege state could not be read`];
  }
  if (!Array.isArray(row?.public_grant_option_privileges)) {
    return [`${label} PUBLIC table grant-option state could not be read`];
  }
  if (checkColumnPrivileges && !Array.isArray(row?.runtime_column_privileges)) {
    return [`${label} runtime-role column privilege state could not be read`];
  }
  if (checkColumnPrivileges && !Array.isArray(row?.runtime_column_grant_option_privileges)) {
    return [`${label} runtime-role column grant-option state could not be read`];
  }
  if (checkColumnPrivileges && !Array.isArray(row?.public_column_privileges)) {
    return [`${label} PUBLIC column privilege state could not be read`];
  }
  if (checkColumnPrivileges && !Array.isArray(row?.public_column_grant_option_privileges)) {
    return [`${label} PUBLIC column grant-option state could not be read`];
  }
  const allowed = new Set(requiredPrivileges);
  const runtimePrivileges = normalizedPrivilegeArray(row.runtime_privileges);
  const missing = requiredPrivileges
    .filter((privilege) => !runtimePrivileges.includes(privilege));
  const unexpected = runtimePrivileges
    .filter((privilege) => !allowed.has(privilege));
  const runtimeGrantOptions = normalizedPrivilegeArray(row.runtime_grant_option_privileges);
  const publicPrivileges = normalizedPrivilegeArray(row.public_privileges);
  const publicGrantOptions = normalizedPrivilegeArray(row.public_grant_option_privileges);
  const runtimeColumnPrivileges = checkColumnPrivileges
    ? sortedUnique(row.runtime_column_privileges.map(String))
    : [];
  const runtimeColumnGrantOptions = checkColumnPrivileges
    ? sortedUnique(row.runtime_column_grant_option_privileges.map(String))
    : [];
  const publicColumnPrivileges = checkColumnPrivileges
    ? sortedUnique(row.public_column_privileges.map(String))
    : [];
  const publicColumnGrantOptions = checkColumnPrivileges
    ? sortedUnique(row.public_column_grant_option_privileges.map(String))
    : [];
  const issues = [];
  if (missing.length > 0) {
    issues.push(`${label} runtime role is missing direct table privileges: ${missing.join(", ")}`);
  }
  if (unexpected.length > 0) {
    issues.push(`${label} runtime role has unexpected table privileges: ${unexpected.join(", ")}`);
  }
  if (runtimeGrantOptions.length > 0) {
    issues.push(`${label} runtime role has grant options: ${runtimeGrantOptions.join(", ")}`);
  }
  if (publicPrivileges.length > 0) {
    issues.push(`${label} grants table privileges to PUBLIC: ${publicPrivileges.join(", ")}`);
  }
  if (publicGrantOptions.length > 0) {
    issues.push(`${label} grants table privileges with grant option to PUBLIC: ${publicGrantOptions.join(", ")}`);
  }
  if (runtimeColumnPrivileges.length > 0) {
    issues.push(`${label} runtime role has column privileges: ${runtimeColumnPrivileges.join(", ")}`);
  }
  if (runtimeColumnGrantOptions.length > 0) {
    issues.push(`${label} runtime role has column grant options: ${runtimeColumnGrantOptions.join(", ")}`);
  }
  if (publicColumnPrivileges.length > 0) {
    issues.push(`${label} PUBLIC has column privileges: ${publicColumnPrivileges.join(", ")}`);
  }
  if (publicColumnGrantOptions.length > 0) {
    issues.push(`${label} PUBLIC has column grant options: ${publicColumnGrantOptions.join(", ")}`);
  }
  return issues;
}

export async function auditLiveDatabase({ client, runtimeRole, migrationRole, inventory }) {
  const issues = [];
  const expectedRlsPolicyTables = new Set(inventory.rlsPolicyTables ?? []);

  const roleResult = await client.query(
    `SELECT
        rolname,
        rolbypassrls,
        rolsuper,
        rolcreatedb,
        rolcreaterole,
        rolreplication,
        rolcanlogin,
        rolinherit
       FROM pg_roles
      WHERE rolname = $1`,
    [runtimeRole],
  );
  if (roleResult.rowCount === 0) {
    return [`runtime role ${runtimeRole} does not exist`];
  }
  const migrationRoleResult = await client.query(
    `SELECT rolname
       FROM pg_roles
      WHERE rolname = $1`,
    [migrationRole],
  );
  if (migrationRoleResult.rowCount === 0) {
    return [`migration role ${migrationRole} does not exist`];
  }
  if (runtimeRole === migrationRole) {
    issues.push(`runtime role ${runtimeRole} must differ from migration role ${migrationRole}`);
  }

  const connectionRoleResult = await client.query(
    `SELECT current_user AS current_user_name, session_user AS session_user_name`,
  );
  const connectionRole = connectionRoleResult.rows[0];
  if (
    connectionRole?.current_user_name !== migrationRole ||
    connectionRole?.session_user_name !== migrationRole
  ) {
    issues.push(
      `audit connection uses current_user ${connectionRole?.current_user_name ?? "unknown"} ` +
        `and session_user ${connectionRole?.session_user_name ?? "unknown"}, expected migration role ${migrationRole}`,
    );
  }

  const role = roleResult.rows[0];
  for (const attr of ["rolbypassrls", "rolsuper", "rolcreatedb", "rolcreaterole", "rolreplication"]) {
    if (role[attr]) issues.push(`runtime role ${runtimeRole} has ${attr}`);
  }
  if (!role.rolcanlogin) issues.push(`runtime role ${runtimeRole} must have LOGIN`);
  if (role.rolinherit) issues.push(`runtime role ${runtimeRole} must have NOINHERIT`);

  const membershipResult = await client.query(
    `WITH RECURSIVE memberships AS (
        SELECT parent.oid, parent.rolname
          FROM pg_auth_members m
          JOIN pg_roles child ON child.oid = m.member
          JOIN pg_roles parent ON parent.oid = m.roleid
         WHERE child.rolname = $1
        UNION
        SELECT parent.oid, parent.rolname
          FROM memberships current_membership
          JOIN pg_auth_members m ON m.member = current_membership.oid
          JOIN pg_roles parent ON parent.oid = m.roleid
      )
      SELECT DISTINCT rolname AS role_name
        FROM memberships
       ORDER BY rolname`,
    [runtimeRole],
  );
  for (const row of membershipResult.rows) {
    issues.push(`runtime role ${runtimeRole} is member of role ${row.role_name}`);
  }

  const databaseResult = await client.query(
    `SELECT has_database_privilege($1, current_database(), 'CREATE') AS create_priv`,
    [runtimeRole],
  );
  if (databaseResult.rows[0]?.create_priv) {
    issues.push(`runtime role ${runtimeRole} has CREATE on current database`);
  }

  const schemaResult = await client.query(
    `SELECT
        has_schema_privilege($1, 'public', 'USAGE') AS usage_priv,
        has_schema_privilege($1, 'public', 'CREATE') AS create_priv`,
    [runtimeRole],
  );
  if (!schemaResult.rows[0]?.usage_priv) issues.push(`runtime role ${runtimeRole} lacks USAGE on schema public`);
  if (schemaResult.rows[0]?.create_priv) issues.push(`runtime role ${runtimeRole} has CREATE on schema public`);

  const nonPublicSchemaResult = await client.query(
    `SELECT
        n.nspname AS schema_name,
        has_schema_privilege($1, n.oid, 'CREATE') AS create_priv
       FROM pg_namespace n
      WHERE n.nspname <> 'public'
        AND n.nspname <> 'information_schema'
        AND n.nspname !~ '^pg_'
      ORDER BY n.nspname`,
    [runtimeRole],
  );
  for (const row of nonPublicSchemaResult.rows) {
    if (row.create_priv) {
      issues.push(`runtime role ${runtimeRole} has CREATE on non-public schema ${row.schema_name}`);
    }
  }

  const tableResult = await client.query(
    `SELECT
        c.relname AS table_name,
        pg_get_userbyid(c.relowner) AS owner_name,
        has_table_privilege($1, c.oid, 'SELECT') AS select_priv,
        has_table_privilege($1, c.oid, 'INSERT') AS insert_priv,
        has_table_privilege($1, c.oid, 'UPDATE') AS update_priv,
        has_table_privilege($1, c.oid, 'DELETE') AS delete_priv,
        ARRAY(
          SELECT DISTINCT upper(acl.privilege_type)
            FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
           WHERE acl.grantee = (SELECT oid FROM pg_roles WHERE rolname = $1)
           ORDER BY 1
        ) AS runtime_privileges,
        ARRAY(
          SELECT DISTINCT upper(acl.privilege_type)
            FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
           WHERE acl.grantee = (SELECT oid FROM pg_roles WHERE rolname = $1)
             AND acl.is_grantable
           ORDER BY 1
        ) AS runtime_grant_option_privileges,
        ARRAY(
          SELECT DISTINCT upper(acl.privilege_type)
            FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
           WHERE acl.grantee = 0
           ORDER BY 1
        ) AS public_privileges,
        ARRAY(
          SELECT DISTINCT upper(acl.privilege_type)
            FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
           WHERE acl.grantee = 0
             AND acl.is_grantable
           ORDER BY 1
        ) AS public_grant_option_privileges,
        ARRAY(
          SELECT DISTINCT format('%I:%s', a.attname, upper(acl.privilege_type))
            FROM pg_attribute a
            CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
           WHERE a.attrelid = c.oid
             AND a.attnum > 0
             AND NOT a.attisdropped
             AND acl.grantee = (SELECT oid FROM pg_roles WHERE rolname = $1)
           ORDER BY 1
        ) AS runtime_column_privileges,
        ARRAY(
          SELECT DISTINCT format('%I:%s', a.attname, upper(acl.privilege_type))
            FROM pg_attribute a
            CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
           WHERE a.attrelid = c.oid
             AND a.attnum > 0
             AND NOT a.attisdropped
             AND acl.grantee = (SELECT oid FROM pg_roles WHERE rolname = $1)
             AND acl.is_grantable
           ORDER BY 1
        ) AS runtime_column_grant_option_privileges,
        ARRAY(
          SELECT DISTINCT format('%I:%s', a.attname, upper(acl.privilege_type))
            FROM pg_attribute a
            CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
           WHERE a.attrelid = c.oid
             AND a.attnum > 0
             AND NOT a.attisdropped
             AND acl.grantee = 0
           ORDER BY 1
        ) AS public_column_privileges,
        ARRAY(
          SELECT DISTINCT format('%I:%s', a.attname, upper(acl.privilege_type))
            FROM pg_attribute a
            CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
           WHERE a.attrelid = c.oid
             AND a.attnum > 0
             AND NOT a.attisdropped
             AND acl.grantee = 0
             AND acl.is_grantable
           ORDER BY 1
        ) AS public_column_grant_option_privileges
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND c.relname = ANY($2::text[])
      ORDER BY c.relname`,
    [runtimeRole, inventory.tables],
  );
  issues.push(
    ...missingItems(inventory.tables, tableResult.rows.map((row) => row.table_name))
      .map((table) => `missing expected table ${table}`),
  );
  for (const row of tableResult.rows) {
    const requiredPrivileges = requiredRuntimeTablePrivileges(row.table_name, inventory);
    issues.push(...collectMissingPrivileges([row], "table_name", requiredPrivileges));
    issues.push(
      ...collectTablePrivilegeAllowlistIssues(row, `table ${row.table_name}`, {
        requiredPrivileges,
      }),
    );
    if (
      row.table_name === "SavedSearch"
      && expectedRlsPolicyTables.has("SavedSearch")
      && row.update_priv
    ) {
      issues.push("table SavedSearch must not grant effective UPDATE during phase A");
    }
    if (row.owner_name === runtimeRole) issues.push(`runtime role owns table ${row.table_name}`);
    if (row.owner_name !== migrationRole) {
      issues.push(`table ${row.table_name} owned by ${row.owner_name}, expected ${migrationRole}`);
    }
  }

  const rlsPolicyResult = await client.query(
    `SELECT
        c.relname AS table_name,
        c.relrowsecurity AS rls_enabled,
        c.relforcerowsecurity AS rls_forced,
        COUNT(p.oid)::integer AS policy_count,
        string_agg(p.polname::text, ', ' ORDER BY p.polname::text) AS policy_names
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_policy p ON p.polrelid = c.oid
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND c.relname = ANY($1::text[])
        AND (c.relrowsecurity OR c.relforcerowsecurity OR p.oid IS NOT NULL)
      GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
      ORDER BY c.relname`,
    [inventory.tables],
  );
  for (const row of rlsPolicyResult.rows) {
    const hasPolicies = Number(row.policy_count) > 0;
    const policyList = typeof row.policy_names === "string" && row.policy_names.length > 0
      ? row.policy_names
      : "none";
    if (hasPolicies && !expectedRlsPolicyTables.has(row.table_name)) {
      issues.push(
        `table ${row.table_name} has live RLS policies (${policyList}) absent from the reviewed migration inventory`,
      );
    }
    if (hasPolicies && !row.rls_enabled) {
      issues.push(
        `table ${row.table_name} has RLS policies (${policyList}) but ROW LEVEL SECURITY is not enabled`,
      );
    }
    if (row.rls_enabled && !hasPolicies) {
      issues.push(
        `table ${row.table_name} has ROW LEVEL SECURITY enabled but zero policies`,
      );
    }
    if (row.rls_forced && !hasPolicies) {
      issues.push(
        `table ${row.table_name} has FORCE ROW LEVEL SECURITY enabled but zero policies`,
      );
    }
    const savedSearchPhaseAExpected =
      row.table_name === "SavedSearch" && expectedRlsPolicyTables.has("SavedSearch");
    if (hasPolicies && !row.rls_forced && !savedSearchPhaseAExpected) {
      issues.push(
        `table ${row.table_name} has RLS policies (${policyList}) but FORCE ROW LEVEL SECURITY is not enabled`,
      );
    }
  }

  if (expectedRlsPolicyTables.has("SavedSearch")) {
    issues.push(
      ...collectSavedSearchPolicyIssues(
        await readSavedSearchPolicyState(client),
        runtimeRole,
      ),
    );
  }

  const untrackedTableResult = await client.query(
    `SELECT
        c.relname AS table_name,
        pg_get_userbyid(c.relowner) AS owner_name,
        has_table_privilege($1, c.oid, 'SELECT') AS select_priv,
        has_table_privilege($1, c.oid, 'INSERT') AS insert_priv,
        has_table_privilege($1, c.oid, 'UPDATE') AS update_priv,
        has_table_privilege($1, c.oid, 'DELETE') AS delete_priv,
        ARRAY(
          SELECT DISTINCT upper(acl.privilege_type)
            FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
           WHERE acl.grantee = (SELECT oid FROM pg_roles WHERE rolname = $1)
           ORDER BY 1
        ) AS runtime_privileges,
        ARRAY(
          SELECT DISTINCT upper(acl.privilege_type)
            FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
           WHERE acl.grantee = (SELECT oid FROM pg_roles WHERE rolname = $1)
             AND acl.is_grantable
           ORDER BY 1
        ) AS runtime_grant_option_privileges,
        ARRAY(
          SELECT DISTINCT upper(acl.privilege_type)
            FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
           WHERE acl.grantee = 0
           ORDER BY 1
        ) AS public_privileges,
        ARRAY(
          SELECT DISTINCT upper(acl.privilege_type)
            FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
           WHERE acl.grantee = 0
             AND acl.is_grantable
           ORDER BY 1
        ) AS public_grant_option_privileges,
        ARRAY(
          SELECT DISTINCT format('%I:%s', a.attname, upper(acl.privilege_type))
            FROM pg_attribute a
            CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
           WHERE a.attrelid = c.oid
             AND a.attnum > 0
             AND NOT a.attisdropped
             AND acl.grantee = (SELECT oid FROM pg_roles WHERE rolname = $1)
           ORDER BY 1
        ) AS runtime_column_privileges,
        ARRAY(
          SELECT DISTINCT format('%I:%s', a.attname, upper(acl.privilege_type))
            FROM pg_attribute a
            CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
           WHERE a.attrelid = c.oid
             AND a.attnum > 0
             AND NOT a.attisdropped
             AND acl.grantee = (SELECT oid FROM pg_roles WHERE rolname = $1)
             AND acl.is_grantable
           ORDER BY 1
        ) AS runtime_column_grant_option_privileges,
        ARRAY(
          SELECT DISTINCT format('%I:%s', a.attname, upper(acl.privilege_type))
            FROM pg_attribute a
            CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
           WHERE a.attrelid = c.oid
             AND a.attnum > 0
             AND NOT a.attisdropped
             AND acl.grantee = 0
           ORDER BY 1
        ) AS public_column_privileges,
        ARRAY(
          SELECT DISTINCT format('%I:%s', a.attname, upper(acl.privilege_type))
            FROM pg_attribute a
            CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
           WHERE a.attrelid = c.oid
             AND a.attnum > 0
             AND NOT a.attisdropped
             AND acl.grantee = 0
             AND acl.is_grantable
           ORDER BY 1
        ) AS public_column_grant_option_privileges
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND NOT (c.relname = ANY($2::text[]))
      ORDER BY c.relname`,
    [runtimeRole, inventory.tables],
  );
  for (const row of untrackedTableResult.rows) {
    const runtimeGranted = normalizedPrivilegeArray(row.runtime_privileges);
    if (runtimeGranted.length > 0) {
      issues.push(`runtime role has ${runtimeGranted.join("/")} on untracked public table ${row.table_name}`);
    }
    const publicGranted = normalizedPrivilegeArray(row.public_privileges);
    if (publicGranted.length > 0) {
      issues.push(`PUBLIC has ${publicGranted.join("/")} on untracked public table ${row.table_name}`);
    }
    const runtimeGrantOptions = normalizedPrivilegeArray(row.runtime_grant_option_privileges);
    if (runtimeGrantOptions.length > 0) {
      issues.push(`runtime role has grant options ${runtimeGrantOptions.join("/")} on untracked public table ${row.table_name}`);
    }
    const publicGrantOptions = normalizedPrivilegeArray(row.public_grant_option_privileges);
    if (publicGrantOptions.length > 0) {
      issues.push(`PUBLIC has grant options ${publicGrantOptions.join("/")} on untracked public table ${row.table_name}`);
    }
    const runtimeColumnPrivileges = sortedUnique((row.runtime_column_privileges ?? []).map(String));
    if (runtimeColumnPrivileges.length > 0) {
      issues.push(`runtime role has column privileges ${runtimeColumnPrivileges.join(", ")} on untracked public table ${row.table_name}`);
    }
    const publicColumnPrivileges = sortedUnique((row.public_column_privileges ?? []).map(String));
    if (publicColumnPrivileges.length > 0) {
      issues.push(`PUBLIC has column privileges ${publicColumnPrivileges.join(", ")} on untracked public table ${row.table_name}`);
    }
    const runtimeColumnGrantOptions = sortedUnique((row.runtime_column_grant_option_privileges ?? []).map(String));
    if (runtimeColumnGrantOptions.length > 0) {
      issues.push(`runtime role has column grant options ${runtimeColumnGrantOptions.join(", ")} on untracked public table ${row.table_name}`);
    }
    const publicColumnGrantOptions = sortedUnique((row.public_column_grant_option_privileges ?? []).map(String));
    if (publicColumnGrantOptions.length > 0) {
      issues.push(`PUBLIC has column grant options ${publicColumnGrantOptions.join(", ")} on untracked public table ${row.table_name}`);
    }
    if (row.owner_name === runtimeRole) issues.push(`runtime role owns untracked public table ${row.table_name}`);
  }

  const sequenceResult = await client.query(
    `SELECT
        c.relname AS sequence_name,
        pg_get_userbyid(c.relowner) AS owner_name,
        has_sequence_privilege($1, c.oid, 'USAGE') AS usage_priv,
        has_sequence_privilege($1, c.oid, 'SELECT') AS select_priv
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'S'
      ORDER BY c.relname`,
    [runtimeRole],
  );
  if (inventory.sequenceSqlReferences.length === 0 && sequenceResult.rows.length > 0) {
    issues.push(`live DB has public sequences not represented in source inventory: ${sequenceResult.rows.map((row) => row.sequence_name).join(", ")}`);
  }
  issues.push(...collectMissingPrivileges(sequenceResult.rows, "sequence_name", REQUIRED_SEQUENCE_PRIVILEGES));
  for (const row of sequenceResult.rows) {
    if (row.owner_name === runtimeRole) issues.push(`runtime role owns sequence ${row.sequence_name}`);
    if (row.owner_name !== migrationRole) {
      issues.push(`sequence ${row.sequence_name} owned by ${row.owner_name}, expected ${migrationRole}`);
    }
  }

  const functionResult = await client.query(
    `SELECT
        p.proname AS function_name,
        pg_get_function_identity_arguments(p.oid) AS args,
        pg_get_userbyid(p.proowner) AS owner_name,
        has_function_privilege($1, p.oid, 'EXECUTE') AS execute_priv
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname LIKE 'grainline\\_%' ESCAPE '\\'
      ORDER BY p.proname, args`,
    [runtimeRole],
  );
  const functionNames = sortedUnique(functionResult.rows.map((row) => row.function_name));
  issues.push(
    ...missingItems(inventory.functions, functionNames).map((fn) => `missing expected function ${fn}`),
  );
  issues.push(
    ...functionNames.filter((fn) => !inventory.functions.includes(fn)).map((fn) => `live DB has untracked grainline_* function ${fn}`),
  );
  for (const row of functionResult.rows) {
    if (!row.execute_priv) issues.push(`${row.function_name}(${row.args}) lacks EXECUTE`);
    if (row.owner_name === runtimeRole) issues.push(`runtime role owns function ${row.function_name}(${row.args})`);
    if (row.owner_name !== migrationRole) {
      issues.push(`function ${row.function_name}(${row.args}) owned by ${row.owner_name}, expected ${migrationRole}`);
    }
  }

  const savedSearchOwnerRpcNames = Object.keys(SAVED_SEARCH_OWNER_RPC_FUNCTIONS);
  if (savedSearchOwnerRpcNames.every((name) => inventory.functions.includes(name))) {
    issues.push(
      ...collectSavedSearchOwnerRpcIssues(
        await readSavedSearchOwnerRpcState(client, runtimeRole),
        runtimeRole,
        migrationRole,
      ),
    );
  }

  const requiredExtensions = inventory.extensions ?? [];
  if (requiredExtensions.length > 0) {
    const extensionResult = await client.query(
      `SELECT
          extname AS extension_name,
          pg_get_userbyid(extowner) AS owner_name
         FROM pg_extension
        WHERE extname = ANY($1::text[])
        ORDER BY extname`,
      [requiredExtensions],
    );
    const liveExtensions = sortedUnique(extensionResult.rows.map((row) => row.extension_name));
    issues.push(
      ...missingItems(requiredExtensions, liveExtensions).map((extension) => `missing expected extension ${extension}`),
    );
    for (const row of extensionResult.rows) {
      if (row.owner_name === runtimeRole) issues.push(`runtime role owns extension ${row.extension_name}`);
      if (row.owner_name !== migrationRole) {
        issues.push(`extension ${row.extension_name} owned by ${row.owner_name}, expected ${migrationRole}`);
      }
    }

    const extensionFunctionResult = await client.query(
      `SELECT
          e.extname AS extension_name,
          format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS function_signature,
          pg_get_userbyid(p.proowner) AS owner_name,
          has_function_privilege($1, p.oid, 'EXECUTE') AS execute_priv,
          has_function_privilege($3, p.oid, 'EXECUTE WITH GRANT OPTION') AS migration_grant_option_priv
         FROM pg_extension e
         JOIN pg_depend d ON d.refclassid = 'pg_extension'::regclass
                           AND d.refobjid = e.oid
                           AND d.classid = 'pg_proc'::regclass
                           AND d.deptype = 'e'
         JOIN pg_proc p ON p.oid = d.objid
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE e.extname = ANY($2::text[])
        ORDER BY e.extname, function_signature`,
      [runtimeRole, requiredExtensions, migrationRole],
    );
    for (const row of extensionFunctionResult.rows) {
      if (!row.execute_priv) {
        if (row.migration_grant_option_priv) {
          issues.push(`extension ${row.extension_name} function ${row.function_signature} lacks EXECUTE`);
        } else {
          issues.push(
            `extension ${row.extension_name} function ${row.function_signature} lacks EXECUTE and ` +
              `is not grantable by migration role ${migrationRole} (owner ${row.owner_name})`,
          );
        }
      }
    }

    const runtimeFunctionTargets = requiredExtensions.flatMap((extension) =>
      (REQUIRED_EXTENSION_RUNTIME_FUNCTIONS[extension] ?? [])
        .map((signature) => ({ extension, signature })),
    );
    if (runtimeFunctionTargets.length > 0) {
      const runtimeFunctionResult = await client.query(
        `SELECT
            target.extension_name,
            target.signature AS function_signature,
            target.function_oid IS NOT NULL AS exists_priv,
            CASE
              WHEN target.function_oid IS NULL THEN false
              ELSE has_function_privilege($1, target.function_oid, 'EXECUTE')
            END AS execute_priv,
            CASE
              WHEN target.function_oid IS NULL THEN true
              ELSE has_function_privilege($4, target.function_oid, 'EXECUTE WITH GRANT OPTION')
            END AS migration_grant_option_priv,
            pg_get_userbyid(p.proowner) AS owner_name
           FROM (
             SELECT extension_name, signature, to_regprocedure(signature) AS function_oid
               FROM unnest($2::text[], $3::text[]) AS target(extension_name, signature)
           ) target
           LEFT JOIN pg_proc p ON p.oid = target.function_oid
          ORDER BY target.extension_name, target.signature`,
        [
          runtimeRole,
          runtimeFunctionTargets.map((target) => target.extension),
          runtimeFunctionTargets.map((target) => target.signature),
          migrationRole,
        ],
      );
      for (const row of runtimeFunctionResult.rows) {
        if (!row.exists_priv) {
          issues.push(`missing required extension ${row.extension_name} runtime function ${row.function_signature}`);
        } else if (!row.execute_priv) {
          if (row.migration_grant_option_priv) {
            issues.push(`extension ${row.extension_name} runtime function ${row.function_signature} lacks EXECUTE`);
          } else {
            issues.push(
              `extension ${row.extension_name} runtime function ${row.function_signature} lacks EXECUTE and ` +
                `is not grantable by migration role ${migrationRole} (owner ${row.owner_name})`,
            );
          }
        }
      }
    }

    const runtimeOperatorTargets = requiredExtensions.flatMap((extension) =>
      (REQUIRED_EXTENSION_RUNTIME_OPERATORS[extension] ?? [])
        .map((operator) => ({ extension, ...operator })),
    );
    if (runtimeOperatorTargets.length > 0) {
      const runtimeOperatorResult = await client.query(
        `SELECT
            target.extension_name,
            format('%I.%s(%s, %s)', target.operator_schema, target.operator_name, target.left_type, target.right_type)
              AS operator_signature,
            o.oid IS NOT NULL AS exists_priv,
            CASE
              WHEN o.oid IS NULL THEN false
              ELSE has_function_privilege($1, o.oprcode, 'EXECUTE')
            END AS execute_priv,
            CASE
              WHEN o.oid IS NULL THEN NULL
              ELSE format('%I.%I(%s)', pn.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
            END AS function_signature,
            CASE
              WHEN o.oid IS NULL THEN true
              ELSE has_function_privilege($7, o.oprcode, 'EXECUTE WITH GRANT OPTION')
            END AS migration_grant_option_priv,
            pg_get_userbyid(p.proowner) AS function_owner_name
           FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
             AS target(extension_name, operator_schema, operator_name, left_type, right_type)
           LEFT JOIN pg_namespace n ON n.nspname = target.operator_schema
           LEFT JOIN pg_type lt ON lt.oid = to_regtype(target.left_type)
           LEFT JOIN pg_type rt ON rt.oid = to_regtype(target.right_type)
           LEFT JOIN pg_operator o ON o.oprnamespace = n.oid
                                  AND o.oprname = target.operator_name
                                  AND o.oprleft = lt.oid
                                  AND o.oprright = rt.oid
           LEFT JOIN pg_proc p ON p.oid = o.oprcode
           LEFT JOIN pg_namespace pn ON pn.oid = p.pronamespace
          ORDER BY target.extension_name, operator_signature`,
        [
          runtimeRole,
          runtimeOperatorTargets.map((target) => target.extension),
          runtimeOperatorTargets.map((target) => target.schema),
          runtimeOperatorTargets.map((target) => target.name),
          runtimeOperatorTargets.map((target) => target.leftType),
          runtimeOperatorTargets.map((target) => target.rightType),
          migrationRole,
        ],
      );
      for (const row of runtimeOperatorResult.rows) {
        if (!row.exists_priv) {
          issues.push(`missing required extension ${row.extension_name} runtime operator ${row.operator_signature}`);
        } else if (!row.execute_priv) {
          if (row.migration_grant_option_priv) {
            issues.push(
              `extension ${row.extension_name} runtime operator ${row.operator_signature} backing function ` +
                `${row.function_signature ?? "unknown"} lacks EXECUTE`,
            );
          } else {
            issues.push(
              `extension ${row.extension_name} runtime operator ${row.operator_signature} backing function ` +
                `${row.function_signature ?? "unknown"} lacks EXECUTE and is not grantable by migration role ` +
                `${migrationRole} (owner ${row.function_owner_name ?? "unknown"})`,
            );
          }
        }
      }
    }
  }

  const enumResult = await client.query(
    `SELECT
        t.typname AS type_name,
        pg_get_userbyid(t.typowner) AS owner_name,
        has_type_privilege($1, t.oid, 'USAGE') AS usage_priv
       FROM pg_type t
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
        AND t.typtype = 'e'
      ORDER BY t.typname`,
    [runtimeRole],
  );
  const enumNames = enumResult.rows.map((row) => row.type_name);
  issues.push(...missingItems(inventory.enums, enumNames).map((type) => `missing expected enum type ${type}`));
  issues.push(...enumNames.filter((type) => !inventory.enums.includes(type)).map((type) => `live DB has untracked enum type ${type}`));
  for (const row of enumResult.rows) {
    if (!row.usage_priv) issues.push(`${row.type_name} lacks USAGE`);
    if (row.owner_name === runtimeRole) issues.push(`runtime role owns enum type ${row.type_name}`);
    if (row.owner_name !== migrationRole) {
      issues.push(`enum type ${row.type_name} owned by ${row.owner_name}, expected ${migrationRole}`);
    }
  }

  const defaultRoleResult = await client.query(
    `SELECT oid, rolname
       FROM pg_roles
      WHERE rolname IN ($1, $2)`,
    [migrationRole, runtimeRole],
  );
  const expectedDefaultRoleRows = runtimeRole === migrationRole ? 1 : 2;
  if (defaultRoleResult.rows.length < expectedDefaultRoleRows) {
    issues.push(`migration role ${migrationRole} and runtime role ${runtimeRole} must both exist for default-privilege audit`);
    return issues;
  }

  const defaultPrivilegeResult = await client.query(
    `SELECT
        d.defaclobjtype,
        d.defaclnamespace,
        n.nspname AS schema_name,
        privilege.privilege_type,
        privilege.is_grantable,
        CASE
          WHEN privilege.grantee = 0 THEN 'PUBLIC'
          ELSE pg_get_userbyid(privilege.grantee)::text
        END AS grantee_name
       FROM pg_default_acl d
       LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
       CROSS JOIN LATERAL aclexplode(d.defaclacl) AS privilege
      WHERE d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = $1)
        AND privilege.grantee IN (
          0,
          (SELECT oid FROM pg_roles WHERE rolname = $2)
        )
        AND (d.defaclnamespace = 0 OR n.nspname = 'public')`,
    [migrationRole, runtimeRole],
  );
  const runtimeDefaultRows = defaultPrivilegeResult.rows
    .filter((row) => row.grantee_name === runtimeRole);
  const runtimePublicDefaultRows = runtimeDefaultRows
    .filter((row) => row.defaclnamespace !== 0 && row.schema_name === "public");
  const defaultGrants = new Set(
    runtimePublicDefaultRows.map((row) => `${row.defaclobjtype}:${row.privilege_type}`),
  );
  for (const [objectType, privileges] of defaultPrivilegeRequirements(inventory)) {
    for (const privilege of privileges) {
      if (!defaultGrants.has(`${objectType}:${privilege}`)) {
        issues.push(`default privileges for migration role ${migrationRole} do not grant ${privilege} on ${objectType} objects to ${runtimeRole}`);
      }
    }
  }
  const runtimeDefaultTableRows = runtimePublicDefaultRows
    .filter((row) => row.defaclobjtype === OBJECT_TYPE_TABLE);
  issues.push(
    ...collectTablePrivilegeAllowlistIssues(
      {
        runtime_privileges: runtimeDefaultTableRows.map((row) => row.privilege_type),
        runtime_grant_option_privileges: runtimeDefaultTableRows
          .filter((row) => row.is_grantable)
          .map((row) => row.privilege_type),
        public_privileges: defaultPrivilegeResult.rows
          .filter((row) => row.defaclobjtype === OBJECT_TYPE_TABLE && row.grantee_name === "PUBLIC")
          .map((row) => row.privilege_type),
        public_grant_option_privileges: defaultPrivilegeResult.rows
          .filter((row) => (
            row.defaclobjtype === OBJECT_TYPE_TABLE
            && row.grantee_name === "PUBLIC"
            && row.is_grantable
          ))
          .map((row) => row.privilege_type),
      },
      `default table privileges for migration role ${migrationRole} to ${runtimeRole}`,
      { checkColumnPrivileges: false },
    ),
  );
  for (const row of defaultPrivilegeResult.rows) {
    if (
      row.defaclobjtype === OBJECT_TYPE_TABLE
      && row.grantee_name === runtimeRole
      && row.defaclnamespace === 0
    ) {
      issues.push(
        `default table privileges for migration role ${migrationRole} to ${runtimeRole} must be scoped to schema public`,
      );
    }
    if (row.defaclobjtype === OBJECT_TYPE_TABLE && row.grantee_name === "PUBLIC") {
      issues.push(
        `default table privileges for migration role ${migrationRole} grant ${row.privilege_type} to PUBLIC`,
      );
    }
  }

  return issues;
}

async function main() {
  const runtimeRole = process.env.RUNTIME_DB_ROLE;
  const migrationRole = process.env.MIGRATION_DB_ROLE;
  let connectionString;
  try {
    connectionString = resolveGrantAuditConnection(process.env, process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }

  if (!runtimeRole || !migrationRole) {
    console.error(
      "Usage: GRANT_AUDIT_DATABASE_URL=\"$DIRECT_URL\" RUNTIME_DB_ROLE=grainline_app_runtime MIGRATION_DB_ROLE=grainline_migration_owner node scripts/audit-runtime-db-grants.mjs",
    );
    console.error("GRANT_AUDIT_DATABASE_URL may be omitted when DIRECT_URL is already exported.");
    process.exitCode = 2;
    return;
  }

  const inventory = deriveGrantInventory();
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: AUDIT_CONNECTION_TIMEOUT_MS,
    statement_timeout: AUDIT_STATEMENT_TIMEOUT_MS,
    query_timeout: AUDIT_QUERY_TIMEOUT_MS,
  });
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const issues = await auditLiveDatabase({ client, runtimeRole, migrationRole, inventory });
    if (issues.length > 0) {
      await client.query("ROLLBACK");
      console.error(`Runtime DB grant audit failed for ${runtimeRole}.`);
      for (const issue of issues) console.error(`- ${issue}`);
      process.exitCode = 1;
      return;
    }
    const savedSearchCatalogState = await readSavedSearchCatalogState(client);
    await client.query("COMMIT");
    console.log(formatSavedSearchCatalogEvidence(savedSearchCatalogState));
    console.log(`Runtime DB grant audit passed for ${runtimeRole}: ${formatInventorySummary(inventory)}.`);
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original audit error; the connection will be closed below.
    }
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
