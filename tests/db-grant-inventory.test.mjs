import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import pg from "pg";

const {
  REQUIRED_FUNCTION_PRIVILEGES,
  REQUIRED_SEQUENCE_PRIVILEGES,
  REQUIRED_TABLE_PRIVILEGES,
  REQUIRED_TYPE_PRIVILEGES,
  auditLiveDatabase,
  defaultPrivilegeRequirements,
  deriveGrantInventory,
} = await import("../scripts/audit-runtime-db-grants.mjs");

const { Client } = pg;

function source(path) {
  return readFileSync(path, "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function provisionedObjects(provision, objectKind) {
  const match = provision.match(new RegExp(`GRANT[\\s\\S]*?ON ${objectKind}\\s+([\\s\\S]*?)\\nTO :"runtime_role";`));
  assert.ok(match, `missing ${objectKind} grant block`);
  return [...match[1].matchAll(/public\."([^"]+)"/g)]
    .map((objectMatch) => objectMatch[1])
    .sort((a, b) => a.localeCompare(b));
}

function auditIntegrationSkipReason() {
  if (process.env.GITHUB_ACTIONS !== "true") return "requires the GitHub Actions Postgres service";
  if (!process.env.DATABASE_URL) return "requires DATABASE_URL";
  return false;
}

function assertSafeIdentifier(value) {
  assert.match(value, /^[a-z_][a-z0-9_]*$/);
  return `"${value}"`;
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function databaseUrl(databaseName, role, password) {
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${databaseName}`;
  if (role) url.username = role;
  if (password) url.password = password;
  return url.toString();
}

async function withClient(connectionString, fn) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function withAuditFixture(options, fn) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const databaseName = `grainline_audit_${suffix}`;
  const migrationRole = `grainline_mig_${suffix}`;
  const runtimeRole = `grainline_run_${suffix}`;
  const parentRole = `grainline_parent_${suffix}`;
  const tableName = `grant_audit_table_${suffix}`;
  const policyName = `grant_audit_policy_${suffix}`;
  const untrackedTableName = `grant_audit_untracked_${suffix}`;
  const enumName = `grant_audit_enum_${suffix}`;
  const functionName = `grainline_audit_fn_${suffix}`;
  const nonPublicSchemaName = `grant_audit_schema_${suffix}`;
  const migrationPassword = `mig_${suffix}_pw`;
  const runtimePassword = `run_${suffix}_pw`;
  const adminUrl = process.env.DATABASE_URL;

  async function cleanup() {
    await withClient(adminUrl, async (admin) => {
      await admin.query(`REVOKE ${assertSafeIdentifier(parentRole)} FROM ${assertSafeIdentifier(runtimeRole)}`)
        .catch(() => {});
      await admin.query(`DROP DATABASE IF EXISTS ${assertSafeIdentifier(databaseName)} WITH (FORCE)`);
      for (const role of [parentRole, runtimeRole, migrationRole]) {
        await admin.query(`DROP ROLE IF EXISTS ${assertSafeIdentifier(role)}`).catch(() => {});
      }
    });
  }

  await cleanup();

  await withClient(adminUrl, async (admin) => {
    await admin.query(`CREATE ROLE ${assertSafeIdentifier(migrationRole)} LOGIN PASSWORD ${sqlLiteral(migrationPassword)}`);
    await admin.query(`CREATE ROLE ${assertSafeIdentifier(runtimeRole)} LOGIN PASSWORD ${sqlLiteral(runtimePassword)} ${options.runtimeRoleAttributes ?? ""}`);
    if (options.createParentRole) {
      await admin.query(`CREATE ROLE ${assertSafeIdentifier(parentRole)} NOLOGIN`);
      await admin.query(`GRANT ${assertSafeIdentifier(parentRole)} TO ${assertSafeIdentifier(runtimeRole)}`);
    }
    await admin.query(`CREATE DATABASE ${assertSafeIdentifier(databaseName)} OWNER ${assertSafeIdentifier(migrationRole)}`);
  });

  const migrationUrl = databaseUrl(databaseName, migrationRole, migrationPassword);
  const adminDatabaseUrl = databaseUrl(databaseName);
  const inventory = {
    tables: [tableName],
    enums: [enumName],
    functions: [functionName],
    extensions: options.createPgTrgmExtension || options.createPgTrgmExtensionAsAdmin || options.requirePgTrgmExtension
      ? ["pg_trgm"]
      : [],
    fixedIntSingletonIds: [],
    autoincrementFields: [],
    sequenceSqlReferences: [],
    publicRevokes: [],
    publicDefaultPrivilegeRevokes: [],
  };

  try {
    if (options.createPgTrgmExtensionAsAdmin) {
      await withClient(adminDatabaseUrl, async (adminDb) => {
        await adminDb.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
        if (options.revokeAdminPgTrgmPublicExecute) {
          await adminDb.query("REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC");
        }
      });
    }

    await withClient(migrationUrl, async (migrationClient) => {
      await migrationClient.query(`CREATE TYPE ${assertSafeIdentifier(enumName)} AS ENUM ('active')`);
      await migrationClient.query(
        `CREATE TABLE ${assertSafeIdentifier(tableName)} (id text PRIMARY KEY, status ${assertSafeIdentifier(enumName)} NOT NULL)`,
      );
      await migrationClient.query(
        `CREATE OR REPLACE FUNCTION ${assertSafeIdentifier(functionName)}() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$`,
      );
      if (options.createRlsPolicy) {
        await migrationClient.query(
          `CREATE POLICY ${assertSafeIdentifier(policyName)}
             ON ${assertSafeIdentifier(tableName)}
            FOR SELECT
          USING (id = current_setting('app.user_id', true))`,
        );
        if (options.enableRls) {
          await migrationClient.query(`ALTER TABLE ${assertSafeIdentifier(tableName)} ENABLE ROW LEVEL SECURITY`);
        }
        if (options.forceRls) {
          await migrationClient.query(`ALTER TABLE ${assertSafeIdentifier(tableName)} FORCE ROW LEVEL SECURITY`);
        }
      }
      await migrationClient.query(`GRANT USAGE ON SCHEMA public TO ${assertSafeIdentifier(runtimeRole)}`);
      if (options.grantTablePrivileges !== false) {
        await migrationClient.query(
          `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${assertSafeIdentifier(tableName)} TO ${assertSafeIdentifier(runtimeRole)}`,
        );
      }
      await migrationClient.query(`GRANT USAGE ON TYPE ${assertSafeIdentifier(enumName)} TO ${assertSafeIdentifier(runtimeRole)}`);
      await migrationClient.query(`GRANT EXECUTE ON FUNCTION ${assertSafeIdentifier(functionName)}() TO ${assertSafeIdentifier(runtimeRole)}`);
      if (options.createPgTrgmExtension) {
        await migrationClient.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
      }
      if (options.grantUntrackedTableSelect) {
        await migrationClient.query(`CREATE TABLE ${assertSafeIdentifier(untrackedTableName)} (id text PRIMARY KEY)`);
        await migrationClient.query(`GRANT SELECT ON TABLE ${assertSafeIdentifier(untrackedTableName)} TO ${assertSafeIdentifier(runtimeRole)}`);
      }
      if (options.defaultPrivileges !== false) {
        await migrationClient.query(
          `ALTER DEFAULT PRIVILEGES FOR ROLE ${assertSafeIdentifier(migrationRole)} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${assertSafeIdentifier(runtimeRole)}`,
        );
        await migrationClient.query(
          `ALTER DEFAULT PRIVILEGES FOR ROLE ${assertSafeIdentifier(migrationRole)} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${assertSafeIdentifier(runtimeRole)}`,
        );
      }
      if (options.grantDatabaseCreate) {
        await migrationClient.query(`GRANT CREATE ON DATABASE ${assertSafeIdentifier(databaseName)} TO ${assertSafeIdentifier(runtimeRole)}`);
      }
      if (options.grantNonPublicSchemaCreate) {
        await migrationClient.query(`CREATE SCHEMA ${assertSafeIdentifier(nonPublicSchemaName)}`);
        await migrationClient.query(`GRANT CREATE ON SCHEMA ${assertSafeIdentifier(nonPublicSchemaName)} TO ${assertSafeIdentifier(runtimeRole)}`);
      }
    });

    if (options.runtimeOwnsTable) {
      await withClient(adminDatabaseUrl, async (adminDb) => {
        await adminDb.query(`ALTER TABLE ${assertSafeIdentifier(tableName)} OWNER TO ${assertSafeIdentifier(runtimeRole)}`);
      });
    }

    await withClient(options.auditAsAdmin ? adminDatabaseUrl : migrationUrl, async (auditClient) => {
      await fn({
        auditClient,
        inventory,
        migrationRole,
        nonPublicSchemaName,
        runtimeRole,
        untrackedTableName,
      });
    });
  } finally {
    await cleanup();
  }
}

describe("database grant inventory guardrails", () => {
  it("derives the current runtime grant surface from schema and migrations", () => {
    const inventory = deriveGrantInventory();

    assert.equal(inventory.tables.length, 56);
    assert.equal(inventory.enums.length, 20);
    assert.deepEqual(inventory.functions, ["grainline_notification_preferences_valid"]);
    assert.deepEqual(inventory.extensions, ["pg_trgm"]);
    assert.deepEqual(inventory.sequenceSqlReferences, []);
    assert.deepEqual(inventory.autoincrementFields, []);
    assert.deepEqual(inventory.fixedIntSingletonIds, ["SiteConfig.id", "SiteMetricsSnapshot.id"]);
    assert.deepEqual(inventory.publicRevokes, []);
    assert.deepEqual(inventory.publicDefaultPrivilegeRevokes, []);
  });

  it("keeps the manual grant audit focused on least-privilege role evidence", () => {
    const script = source("scripts/audit-runtime-db-grants.mjs");

    assert.match(script, /RUNTIME_DB_ROLE/);
    assert.match(script, /MIGRATION_DB_ROLE/);
    assert.match(script, /GRANT_AUDIT_DATABASE_URL/);
    assert.match(script, /export async function auditLiveDatabase/);
    assert.match(script, /rolbypassrls/);
    assert.match(script, /pg_auth_members/);
    assert.match(script, /member of role/);
    assert.match(script, /must differ from migration role/);
    assert.match(script, /current_user AS current_user_name/);
    assert.match(script, /session_user AS session_user_name/);
    assert.match(script, /expected migration role/);
    assert.match(script, /has_database_privilege\(\$1, current_database\(\), 'CREATE'\)/);
    assert.match(script, /has CREATE on non-public schema/);
    assert.match(script, /owned by \$\{row\.owner_name\}, expected \$\{migrationRole\}/);
    assert.match(script, /has_table_privilege/);
    assert.match(script, /has_sequence_privilege/);
    assert.match(script, /has_function_privilege/);
    assert.match(script, /has_type_privilege/);
    assert.match(script, /pg_policy/);
    assert.match(script, /relrowsecurity/);
    assert.match(script, /relforcerowsecurity/);
    assert.match(script, /ROW LEVEL SECURITY is not enabled/);
    assert.match(script, /FORCE ROW LEVEL SECURITY is not enabled/);
    assert.match(script, /pg_extension/);
    assert.match(script, /runtime role owns extension/);
    assert.match(script, /extension .* owned by .* expected/);
    assert.match(script, /extension .* lacks EXECUTE/);
    assert.match(script, /EXECUTE WITH GRANT OPTION/);
    assert.match(script, /lacks EXECUTE and [\s\S]*not grantable by migration role/);
    assert.match(script, /REQUIRED_EXTENSION_RUNTIME_FUNCTIONS/);
    assert.match(script, /REQUIRED_EXTENSION_RUNTIME_OPERATORS/);
    assert.match(script, /runtime function .* lacks EXECUTE/);
    assert.match(script, /runtime operator .* backing function/);
    assert.match(script, /pg_default_acl/);
    assert.match(script, /untracked public table/);
    assert.match(script, /lightweight REVOKE detector/);
    assert.match(script, /connectionTimeoutMillis: AUDIT_CONNECTION_TIMEOUT_MS/);
    assert.match(script, /statement_timeout: AUDIT_STATEMENT_TIMEOUT_MS/);
    assert.match(script, /query_timeout: AUDIT_QUERY_TIMEOUT_MS/);
    assert.doesNotMatch(script, /console\.log\(.*connectionString/s);
    assert.doesNotMatch(script, /process\.env\.DATABASE_URL/);
  });

  it("executes live grant-audit catalog checks against synthetic Postgres roles", { skip: auditIntegrationSkipReason() }, async () => {
    await withAuditFixture({}, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      assert.deepEqual(
        await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory }),
        [],
      );
    });

    await withAuditFixture({ auditAsAdmin: true }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      assert.match(
        (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n"),
        /audit connection uses current_user/,
      );
    });

    await withAuditFixture({ grantTablePrivileges: false }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      assert.match(
        (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n"),
        /lacks SELECT/,
      );
    });

    await withAuditFixture({ defaultPrivileges: false }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      assert.match(
        (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n"),
        /default privileges/,
      );
    });

    await withAuditFixture({ createParentRole: true }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      assert.match(
        (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n"),
        /is member of role/,
      );
    });

    await withAuditFixture({ runtimeRoleAttributes: "BYPASSRLS" }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      assert.match(
        (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n"),
        /rolbypassrls/,
      );
    });

    await withAuditFixture({ grantDatabaseCreate: true }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      assert.match(
        (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n"),
        /has CREATE on current database/,
      );
    });

    await withAuditFixture({ grantNonPublicSchemaCreate: true }, async ({ auditClient, inventory, migrationRole, nonPublicSchemaName, runtimeRole }) => {
      assert.ok(
        (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory }))
          .includes(`runtime role ${runtimeRole} has CREATE on non-public schema ${nonPublicSchemaName}`),
      );
    });

    await withAuditFixture({ grantUntrackedTableSelect: true }, async ({ auditClient, inventory, migrationRole, runtimeRole, untrackedTableName }) => {
      assert.ok(
        (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory }))
          .includes(`runtime role has SELECT on untracked public table ${untrackedTableName}`),
      );
    });

    await withAuditFixture({ runtimeOwnsTable: true }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      const issues = (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n");
      assert.match(issues, /runtime role owns table/);
      assert.match(issues, /expected/);
    });

    await withAuditFixture({ createRlsPolicy: true }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      const issues = (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n");
      assert.match(issues, /has RLS policies .* but ROW LEVEL SECURITY is not enabled/);
      assert.match(issues, /has RLS policies .* but FORCE ROW LEVEL SECURITY is not enabled/);
    });

    await withAuditFixture({ createRlsPolicy: true, enableRls: true }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      const issues = (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n");
      assert.doesNotMatch(issues, /ROW LEVEL SECURITY is not enabled/);
      assert.match(issues, /has RLS policies .* but FORCE ROW LEVEL SECURITY is not enabled/);
    });

    await withAuditFixture({ createRlsPolicy: true, enableRls: true, forceRls: true }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      assert.deepEqual(
        await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory }),
        [],
      );
    });

    await withAuditFixture({ createPgTrgmExtension: true }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      assert.deepEqual(
        await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory }),
        [],
      );
    });

    await withAuditFixture({ requirePgTrgmExtension: true }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      assert.match(
        (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n"),
        /missing expected extension pg_trgm/,
      );
    });

    await withAuditFixture({ createPgTrgmExtensionAsAdmin: true }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      const issues = (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n");
      assert.match(issues, /extension pg_trgm owned by .* expected/);
      assert.doesNotMatch(issues, /not grantable by migration role/);
    });

    await withAuditFixture({
      createPgTrgmExtensionAsAdmin: true,
      revokeAdminPgTrgmPublicExecute: true,
    }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      const issues = (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n");
      assert.match(issues, /extension pg_trgm owned by .* expected/);
      assert.match(issues, /lacks EXECUTE and .*not grantable by migration role/);
    });
  });

  it("records the exact privilege classes required for the runtime role", () => {
    assert.deepEqual(REQUIRED_TABLE_PRIVILEGES, ["SELECT", "INSERT", "UPDATE", "DELETE"]);
    assert.deepEqual(REQUIRED_SEQUENCE_PRIVILEGES, ["USAGE", "SELECT"]);
    assert.deepEqual(REQUIRED_FUNCTION_PRIVILEGES, ["EXECUTE"]);
    assert.deepEqual(REQUIRED_TYPE_PRIVILEGES, ["USAGE"]);
  });

  it("does not require explicit future function/type defaults while PUBLIC defaults are intact", () => {
    const inventory = deriveGrantInventory();

    assert.deepEqual(
      defaultPrivilegeRequirements(inventory),
      [
        ["r", REQUIRED_TABLE_PRIVILEGES],
        ["S", REQUIRED_SEQUENCE_PRIVILEGES],
      ],
    );
    assert.deepEqual(
      defaultPrivilegeRequirements({ ...inventory, publicRevokes: ["REVOKE SELECT ON TABLES FROM PUBLIC"] }),
      [
        ["r", REQUIRED_TABLE_PRIVILEGES],
        ["S", REQUIRED_SEQUENCE_PRIVILEGES],
      ],
    );
    assert.deepEqual(
      defaultPrivilegeRequirements({ ...inventory, publicRevokes: ["REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC"] }),
      [
        ["r", REQUIRED_TABLE_PRIVILEGES],
        ["S", REQUIRED_SEQUENCE_PRIVILEGES],
      ],
    );
    assert.deepEqual(
      defaultPrivilegeRequirements({
        ...inventory,
        publicDefaultPrivilegeRevokes: ["ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC"],
      }),
      [
        ["r", REQUIRED_TABLE_PRIVILEGES],
        ["S", REQUIRED_SEQUENCE_PRIVILEGES],
        ["f", REQUIRED_FUNCTION_PRIVILEGES],
      ],
    );
    assert.deepEqual(
      defaultPrivilegeRequirements({ ...inventory, publicRevokes: ["REVOKE USAGE ON TYPES FROM PUBLIC"] }),
      [
        ["r", REQUIRED_TABLE_PRIVILEGES],
        ["S", REQUIRED_SEQUENCE_PRIVILEGES],
      ],
    );
    assert.deepEqual(
      defaultPrivilegeRequirements({
        ...inventory,
        publicDefaultPrivilegeRevokes: ["ALTER DEFAULT PRIVILEGES REVOKE USAGE ON TYPES FROM PUBLIC"],
      }),
      [
        ["r", REQUIRED_TABLE_PRIVILEGES],
        ["S", REQUIRED_SEQUENCE_PRIVILEGES],
        ["T", REQUIRED_TYPE_PRIVILEGES],
      ],
    );
  });

  it("derives mapped Prisma table and enum names instead of assuming model names", () => {
    const root = mkdtempSync(join(tmpdir(), "grainline-grant-inventory-"));
    mkdirSync(join(root, "prisma", "migrations", "0001"), { recursive: true });
    writeFileSync(
      join(root, "prisma", "schema.prisma"),
      [
        "model InternalUser {",
        "  id String @id @default(cuid())",
        '  @@map("User")',
        "}",
        "",
        "enum InternalRole {",
        "  USER",
        '  @@map("Role")',
        "}",
      ].join("\n"),
    );
    writeFileSync(
      join(root, "prisma", "migrations", "0001", "migration.sql"),
      [
        'CREATE OR REPLACE FUNCTION "grainline_test"() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;',
        "REVOKE EXECUTE ON FUNCTION grainline_test() FROM PUBLIC;",
        "ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;",
      ].join("\n"),
    );

    const inventory = deriveGrantInventory(root);

    assert.deepEqual(inventory.tables, ["User"]);
    assert.deepEqual(inventory.enums, ["Role"]);
    assert.deepEqual(inventory.functions, ["grainline_test"]);
    assert.deepEqual(inventory.publicRevokes, [
      "ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC",
      "REVOKE EXECUTE ON FUNCTION grainline_test() FROM PUBLIC",
    ]);
    assert.deepEqual(inventory.publicDefaultPrivilegeRevokes, [
      "ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC",
    ]);
  });

  it("documents source-derived inventory and the live-proof boundary", () => {
    const plan = source("docs/db-defense-in-depth-plan.md");
    const rls = source("docs/rls-feasibility-plan.md");
    const runbook = source("docs/runbook.md");
    const launch = source("docs/launch-checklist.md");
    const pkg = source("package.json");

    assert.match(plan, /Source-derived grant inventory/);
    assert.match(plan, /56 Prisma model tables/);
    assert.match(plan, /20 Prisma enum types/);
    assert.match(plan, /0 source-derived sequences/);
    assert.match(plan, /1 source-derived extension/);
    assert.match(plan, /pg_trgm/);
    assert.match(plan, /bootstrap-owned\s+trusted-extension functions/);
    assert.match(plan, /PUBLIC` default/);
    assert.match(plan, /grainline_notification_preferences_valid/);
    assert.match(plan, /PUBLIC.*dependency/);
    assert.match(plan, /role memberships/);
    assert.match(plan, /current_user` and `session_user`/);
    assert.match(plan, /RLS policies.*ROW LEVEL SECURITY.*FORCE ROW LEVEL SECURITY/s);
    assert.match(plan, /version-controlled SQL/);
    assert.match(plan, /synthetic Postgres roles\/databases/);
    assert.match(plan, /tracked app objects owned by the migration role/);
    assert.match(plan, /database-level `CREATE`/);
    assert.match(plan, /non-public schemas/);
    assert.match(plan, /non-model public tables inherit runtime table DML/);
    assert.match(plan, /add them to the audit inventory or explicitly\s+`REVOKE` runtime access/);
    assert.match(plan, /audit:db-grants/);
    assert.match(runbook, /`DIRECT_URL` must authenticate as the declared migration owner role/);
    assert.match(runbook, /version-controlled SQL or migrations/);
    assert.match(runbook, /pg_trgm/);
    assert.match(runbook, /bootstrap\/admin role/);
    assert.match(runbook, /runtime lacks\s+access that the declared migration role cannot restore/);
    assert.match(runbook, /same environment\/secret set that will run migrations/);
    assert.match(runbook, /RLS policies.*ROW LEVEL SECURITY.*FORCE ROW LEVEL SECURITY/s);
    assert.match(runbook, /Non-model public tables created by the migration role can inherit runtime DML/);
    assert.match(runbook, /grant-audit\s+inventory or explicitly `REVOKE` runtime access/);
    assert.match(launch, /GRANT_AUDIT_DATABASE_URL="\$DIRECT_URL"/);
    assert.match(launch, /RUNTIME_DB_ROLE=grainline_app_runtime/);
    assert.match(launch, /MIGRATION_DB_ROLE=grainline_migration_owner/);
    assert.match(rls, /public-default dependency/);
    assert.match(rls, /runtime `EXECUTE` is missing/);
    assert.match(pkg, /"audit:db-grants": "node scripts\/audit-runtime-db-grants\.mjs"/);
  });

  it("keeps the runtime-role provisioning SQL aligned with the grant inventory", () => {
    const inventory = deriveGrantInventory();
    const provision = source("scripts/provision-runtime-db-role.sql");
    const plan = source("docs/db-defense-in-depth-plan.md");
    const runbook = source("docs/runbook.md");
    const launch = source("docs/launch-checklist.md");

    assert.match(provision, /psql "\$DIRECT_URL"/);
    assert.match(provision, /-v runtime_role=grainline_app_runtime/);
    assert.match(provision, /-v migration_role=grainline_migration_owner/);
    assert.match(provision, /current_user/);
    assert.match(provision, /session_user/);
    assert.match(provision, /rolbypassrls/);
    assert.match(provision, /pg_auth_members/);
    assert.match(provision, /GRANT USAGE ON SCHEMA public TO :"runtime_role"/);
    assert.match(provision, /REVOKE CREATE ON SCHEMA public FROM :"runtime_role"/);
    assert.match(provision, /REVOKE CREATE ON DATABASE/);
    assert.match(provision, /_prisma_migrations/);
    assert.match(provision, /ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA public\s+GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"runtime_role"/);
    assert.match(provision, /ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA public\s+GRANT USAGE, SELECT ON SEQUENCES TO :"runtime_role"/);
    assert.match(provision, /required extension pg_trgm is not installed/);
    assert.match(provision, /lacks EXECUTE on pg_trgm function/);
    assert.match(provision, /has_function_privilege\(:'runtime_role', p\.oid, 'EXECUTE'\)/);
    assert.match(provision, /EXECUTE WITH GRANT OPTION/);
    assert.match(provision, /e\.extname = 'pg_trgm'/);
    assert.match(provision, /pg_get_function_identity_arguments\(p\.oid\)/);
    assert.match(provision, /Public search\/autocomplete SQL uses pg_trgm/);
    assert.match(provision, /PUBLIC defaults remain intact/);
    assert.match(provision, /public\."grainline_notification_preferences_valid"\(jsonb\)/);
    assert.doesNotMatch(provision, /PASSWORD\s+'(?!\[REDACTED\])/i);
    assert.doesNotMatch(provision, /GRANT\s+[^;]*ON\s+ALL\s+TABLES\s+IN\s+SCHEMA\s+public\s+TO/i);
    assert.doesNotMatch(provision, /GRANT\s+[^;]*ON\s+ALL\s+SEQUENCES\s+IN\s+SCHEMA\s+public\s+TO/i);

    assert.deepEqual(provisionedObjects(provision, "TABLE"), inventory.tables);
    assert.deepEqual(provisionedObjects(provision, "TYPE"), inventory.enums);
    for (const fn of inventory.functions) {
      assert.match(provision, new RegExp(`public\\."${escapeRegExp(fn)}"`));
    }
    for (const extension of inventory.extensions) {
      assert.match(provision, new RegExp(`e\\.extname = '${escapeRegExp(extension)}'`));
    }

    assert.match(plan, /scripts\/provision-runtime-db-role\.sql/);
    assert.match(runbook, /scripts\/provision-runtime-db-role\.sql/);
    assert.match(launch, /scripts\/provision-runtime-db-role\.sql/);
  });
});
