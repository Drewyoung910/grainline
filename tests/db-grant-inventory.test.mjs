import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

const {
  REQUIRED_FUNCTION_PRIVILEGES,
  REQUIRED_SEQUENCE_PRIVILEGES,
  REQUIRED_TABLE_PRIVILEGES,
  REQUIRED_TYPE_PRIVILEGES,
  defaultPrivilegeRequirements,
  deriveGrantInventory,
} = await import("../scripts/audit-runtime-db-grants.mjs");

function source(path) {
  return readFileSync(path, "utf8");
}

describe("database grant inventory guardrails", () => {
  it("derives the current runtime grant surface from schema and migrations", () => {
    const inventory = deriveGrantInventory();

    assert.equal(inventory.tables.length, 56);
    assert.equal(inventory.enums.length, 20);
    assert.deepEqual(inventory.functions, ["grainline_notification_preferences_valid"]);
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
    assert.match(script, /rolbypassrls/);
    assert.match(script, /pg_auth_members/);
    assert.match(script, /member of role/);
    assert.match(script, /must differ from migration role/);
    assert.match(script, /has_database_privilege\(\$1, current_database\(\), 'CREATE'\)/);
    assert.match(script, /has CREATE on non-public schema/);
    assert.match(script, /owned by \$\{row\.owner_name\}, expected \$\{migrationRole\}/);
    assert.match(script, /has_table_privilege/);
    assert.match(script, /has_sequence_privilege/);
    assert.match(script, /has_function_privilege/);
    assert.match(script, /has_type_privilege/);
    assert.match(script, /pg_default_acl/);
    assert.match(script, /untracked public table/);
    assert.match(script, /lightweight REVOKE detector/);
    assert.match(script, /connectionTimeoutMillis: AUDIT_CONNECTION_TIMEOUT_MS/);
    assert.match(script, /statement_timeout: AUDIT_STATEMENT_TIMEOUT_MS/);
    assert.match(script, /query_timeout: AUDIT_QUERY_TIMEOUT_MS/);
    assert.doesNotMatch(script, /console\.log\(.*connectionString/s);
    assert.doesNotMatch(script, /process\.env\.DATABASE_URL/);
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
    const pkg = source("package.json");

    assert.match(plan, /Source-derived grant inventory/);
    assert.match(plan, /56 Prisma model tables/);
    assert.match(plan, /20 Prisma enum types/);
    assert.match(plan, /0 source-derived sequences/);
    assert.match(plan, /grainline_notification_preferences_valid/);
    assert.match(plan, /PUBLIC.*dependency/);
    assert.match(plan, /role memberships/);
    assert.match(plan, /tracked app objects owned by the migration role/);
    assert.match(plan, /database-level `CREATE`/);
    assert.match(plan, /non-public schemas/);
    assert.match(plan, /audit:db-grants/);
    assert.match(rls, /public-default dependency/);
    assert.match(pkg, /"audit:db-grants": "node scripts\/audit-runtime-db-grants\.mjs"/);
  });
});
