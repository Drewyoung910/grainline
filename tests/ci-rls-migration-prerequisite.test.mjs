import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("fresh CI database RLS migration prerequisite", () => {
  it("creates only an ephemeral passwordless membership-free LOGIN policy role", () => {
    const sql = source("scripts/prepare-ci-rls-runtime-role.sql");
    const executableSql = sql.replace(/^\s*--.*$/gm, "");

    assert.match(sql, /current_database\(\) <> 'grainline_ci'/);
    assert.match(sql, /current_user <> 'ci'/);
    assert.match(sql, /CREATE ROLE grainline_app_runtime[\s\S]*?LOGIN[\s\S]*?NOSUPERUSER[\s\S]*?NOBYPASSRLS/);
    assert.match(sql, /ALTER ROLE grainline_app_runtime[\s\S]*?LOGIN[\s\S]*?NOSUPERUSER[\s\S]*?NOBYPASSRLS/);
    assert.match(sql, /FROM pg_auth_members/);
    assert.match(sql, /REVOKE %I FROM grainline_app_runtime/);
    assert.match(sql, /GRANT USAGE ON SCHEMA public TO grainline_app_runtime/);
    assert.match(sql, /ALTER DEFAULT PRIVILEGES IN SCHEMA public[\s\S]*?GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES[\s\S]*?TO grainline_app_runtime/);
    assert.doesNotMatch(executableSql, /\bPASSWORD\b/i);
    assert.doesNotMatch(executableSql, /\bNOLOGIN\b/);
  });

  it("runs the CI-only prerequisite before every ephemeral CI database migration", () => {
    const workflowFiles = readdirSync(".github/workflows")
      .filter((name) => /\.ya?ml$/.test(name));
    let migrateWorkflowCount = 0;

    for (const name of workflowFiles) {
      const workflow = source(`.github/workflows/${name}`);
      const prerequisiteCommand =
        'psql "$DIRECT_URL" -f scripts/prepare-ci-rls-runtime-role.sql';
      const provisionCommand =
        'psql "$DIRECT_URL" -v runtime_role=grainline_app_runtime -v migration_role=ci -f scripts/provision-runtime-db-role.sql';
      const migrationStatusCommand = "npx prisma migrate status";
      const auditCommand =
        'GRANT_AUDIT_DATABASE_URL="$DIRECT_URL" RUNTIME_DB_ROLE=grainline_app_runtime MIGRATION_DB_ROLE=ci npm run audit:db-grants';
      const isEphemeralCiDatabase =
        workflow.includes("POSTGRES_DB: grainline_ci")
        && workflow.includes("postgres:16");
      if (workflow.includes(prerequisiteCommand)) {
        assert.ok(
          isEphemeralCiDatabase,
          `${name} must not invoke the CI-only role prerequisite outside ephemeral CI Postgres`,
        );
      }
      if (!isEphemeralCiDatabase || !workflow.includes("npx prisma migrate deploy")) continue;
      migrateWorkflowCount += 1;
      const prerequisiteIndex = workflow.indexOf(prerequisiteCommand);
      const migrateIndex = workflow.indexOf("npx prisma migrate deploy");
      const provisionIndex = workflow.indexOf(provisionCommand);
      const migrationStatusIndex = workflow.indexOf(migrationStatusCommand);
      const auditIndex = workflow.indexOf(auditCommand);
      assert.notEqual(prerequisiteIndex, -1, `${name} is missing the CI RLS role prerequisite`);
      assert.ok(
        prerequisiteIndex < migrateIndex,
        `${name} must prepare the CI RLS role before deploying migrations`,
      );
      assert.notEqual(
        provisionIndex,
        -1,
        `${name} must run production-style grant convergence after migrations`,
      );
      assert.ok(
        migrateIndex < provisionIndex,
        `${name} must converge runtime grants against the fully migrated schema`,
      );
      assert.ok(
        provisionIndex < migrationStatusIndex,
        `${name} must verify migration status after grant convergence`,
      );
      assert.ok(
        migrationStatusIndex < auditIndex,
        `${name} must audit the final post-migration catalog after migration status`,
      );
    }

    assert.ok(migrateWorkflowCount > 0, "expected at least one fresh-migration CI workflow");
  });
});
