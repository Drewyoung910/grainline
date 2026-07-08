#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const REQUIRED_TABLE_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE"];
export const REQUIRED_SEQUENCE_PRIVILEGES = ["USAGE", "SELECT"];
export const REQUIRED_FUNCTION_PRIVILEGES = ["EXECUTE"];
export const REQUIRED_TYPE_PRIVILEGES = ["USAGE"];
const AUDIT_CONNECTION_TIMEOUT_MS = 10_000;
const AUDIT_STATEMENT_TIMEOUT_MS = 30_000;
const AUDIT_QUERY_TIMEOUT_MS = 35_000;

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
    [...migrationSql.matchAll(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s*\(/gi)]
      .map((match) => match[1])
      .filter((name) => name.startsWith("grainline_")),
  );
  const publicRevokes = sortedUnique(
    sqlStatements(migrationSql)
      .filter((statement) => /\bREVOKE\b/i.test(statement) && /\bPUBLIC\b/i.test(statement))
      .map((statement) => statement.replace(/\s+/g, " ").trim()),
  );
  const publicDefaultPrivilegeRevokes = publicRevokes.filter((statement) =>
    /\bALTER\s+DEFAULT\s+PRIVILEGES\b/i.test(statement),
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
  };
}

export function formatInventorySummary(inventory) {
  return [
    `${inventory.tables.length} tables`,
    `${inventory.enums.length} enums`,
    `${inventory.functions.length} grainline_* functions`,
    `${(inventory.extensions ?? []).length} extensions`,
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

export async function auditLiveDatabase({ client, runtimeRole, migrationRole, inventory }) {
  const issues = [];

  const roleResult = await client.query(
    `SELECT rolname, rolbypassrls, rolsuper, rolcreatedb, rolcreaterole, rolreplication
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
        has_table_privilege($1, c.oid, 'DELETE') AS delete_priv
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
  issues.push(...collectMissingPrivileges(tableResult.rows, "table_name", REQUIRED_TABLE_PRIVILEGES));
  for (const row of tableResult.rows) {
    if (row.owner_name === runtimeRole) issues.push(`runtime role owns table ${row.table_name}`);
    if (row.owner_name !== migrationRole) {
      issues.push(`table ${row.table_name} owned by ${row.owner_name}, expected ${migrationRole}`);
    }
  }

  const untrackedTableResult = await client.query(
    `SELECT
        c.relname AS table_name,
        pg_get_userbyid(c.relowner) AS owner_name,
        has_table_privilege($1, c.oid, 'SELECT') AS select_priv,
        has_table_privilege($1, c.oid, 'INSERT') AS insert_priv,
        has_table_privilege($1, c.oid, 'UPDATE') AS update_priv,
        has_table_privilege($1, c.oid, 'DELETE') AS delete_priv
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND NOT (c.relname = ANY($2::text[]))
      ORDER BY c.relname`,
    [runtimeRole, inventory.tables],
  );
  for (const row of untrackedTableResult.rows) {
    const granted = REQUIRED_TABLE_PRIVILEGES.filter((privilege) => row[`${privilege.toLowerCase()}_priv`]);
    if (granted.length > 0) {
      issues.push(`runtime role has ${granted.join("/")} on untracked public table ${row.table_name}`);
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

  const requiredExtensions = inventory.extensions ?? [];
  if (requiredExtensions.length > 0) {
    const extensionResult = await client.query(
      `SELECT extname AS extension_name
         FROM pg_extension
        WHERE extname = ANY($1::text[])
        ORDER BY extname`,
      [requiredExtensions],
    );
    const liveExtensions = sortedUnique(extensionResult.rows.map((row) => row.extension_name));
    issues.push(
      ...missingItems(requiredExtensions, liveExtensions).map((extension) => `missing expected extension ${extension}`),
    );

    const extensionFunctionResult = await client.query(
      `SELECT
          e.extname AS extension_name,
          format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS function_signature,
          has_function_privilege($1, p.oid, 'EXECUTE') AS execute_priv
         FROM pg_extension e
         JOIN pg_depend d ON d.refclassid = 'pg_extension'::regclass
                           AND d.refobjid = e.oid
                           AND d.classid = 'pg_proc'::regclass
                           AND d.deptype = 'e'
         JOIN pg_proc p ON p.oid = d.objid
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE e.extname = ANY($2::text[])
        ORDER BY e.extname, function_signature`,
      [runtimeRole, requiredExtensions],
    );
    for (const row of extensionFunctionResult.rows) {
      if (!row.execute_priv) {
        issues.push(`extension ${row.extension_name} function ${row.function_signature} lacks EXECUTE`);
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
            END AS execute_priv
           FROM (
             SELECT extension_name, signature, to_regprocedure(signature) AS function_oid
               FROM unnest($2::text[], $3::text[]) AS target(extension_name, signature)
           ) target
          ORDER BY target.extension_name, target.signature`,
        [
          runtimeRole,
          runtimeFunctionTargets.map((target) => target.extension),
          runtimeFunctionTargets.map((target) => target.signature),
        ],
      );
      for (const row of runtimeFunctionResult.rows) {
        if (!row.exists_priv) {
          issues.push(`missing required extension ${row.extension_name} runtime function ${row.function_signature}`);
        } else if (!row.execute_priv) {
          issues.push(`extension ${row.extension_name} runtime function ${row.function_signature} lacks EXECUTE`);
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
            END AS function_signature
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
        ],
      );
      for (const row of runtimeOperatorResult.rows) {
        if (!row.exists_priv) {
          issues.push(`missing required extension ${row.extension_name} runtime operator ${row.operator_signature}`);
        } else if (!row.execute_priv) {
          issues.push(
            `extension ${row.extension_name} runtime operator ${row.operator_signature} backing function ` +
              `${row.function_signature ?? "unknown"} lacks EXECUTE`,
          );
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
        privilege.privilege_type
       FROM pg_default_acl d
       LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
       CROSS JOIN LATERAL aclexplode(d.defaclacl) AS privilege
      WHERE d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = $1)
        AND privilege.grantee = (SELECT oid FROM pg_roles WHERE rolname = $2)
        AND (d.defaclnamespace = 0 OR n.nspname = 'public')`,
    [migrationRole, runtimeRole],
  );
  const defaultGrants = new Set(
    defaultPrivilegeResult.rows.map((row) => `${row.defaclobjtype}:${row.privilege_type}`),
  );
  for (const [objectType, privileges] of defaultPrivilegeRequirements(inventory)) {
    for (const privilege of privileges) {
      if (!defaultGrants.has(`${objectType}:${privilege}`)) {
        issues.push(`default privileges for migration role ${migrationRole} do not grant ${privilege} on ${objectType} objects to ${runtimeRole}`);
      }
    }
  }

  return issues;
}

async function main() {
  const runtimeRole = process.env.RUNTIME_DB_ROLE;
  const migrationRole = process.env.MIGRATION_DB_ROLE;
  const connectionString = process.env.GRANT_AUDIT_DATABASE_URL ?? process.env.DIRECT_URL;

  if (!runtimeRole || !migrationRole || !connectionString) {
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
    const issues = await auditLiveDatabase({ client, runtimeRole, migrationRole, inventory });
    if (issues.length > 0) {
      console.error(`Runtime DB grant audit failed for ${runtimeRole}.`);
      for (const issue of issues) console.error(`- ${issue}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Runtime DB grant audit passed for ${runtimeRole}: ${formatInventorySummary(inventory)}.`);
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
