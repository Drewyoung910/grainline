import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/user-cross-domain-convergence-production.yml",
  "utf8",
);
const migrationPath =
  "prisma/migrations/20261007160000_converge_user_cross_domain_authorities/migration.sql";
const migrationSha256 = createHash("sha256")
  .update(readFileSync(migrationPath))
  .digest("hex");
const enableMigrationPath =
  "prisma/migrations/20261008010000_enable_user_rls/migration.sql";
const enableMigrationSha256 = createHash("sha256")
  .update(readFileSync(enableMigrationPath))
  .digest("hex");

test("cross-domain convergence is exact-main, CI and predecessor bound", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(
    workflow,
    /inputs\.confirmation == 'apply-reviewed-user-cross-domain-convergence'/,
  );
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.run_attempt == 1/);
  assert.match(workflow, /group: production-database-migrations/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /environment: Production/);
  assert.match(workflow, /main\.commit\.sha !== sha/);
  assert.match(workflow, /ci\.name !== 'CI'/);
  assert.match(workflow, /ci\.event !== 'push'/);
  assert.match(workflow, /ci\.head_sha !== sha/);
  assert.match(workflow, /ci\.run_attempt !== 1/);
  assert.match(workflow, /ci\.conclusion !== 'success'/);
  assert.match(
    workflow,
    /predecessor\.name !== 'User Authority Successors Production'/,
  );
  assert.match(
    workflow,
    /predecessor\.head_sha !== '5e7994028128a24127b9abec22cfe3cb1f5ff320'/,
  );
  assert.match(workflow, /predecessorRunId !== 37690929680/);
  assert.match(workflow, /predecessor\.run_attempt !== 1/);
  assert.match(workflow, /predecessor\.conclusion !== 'success'/);
});

test("cross-domain convergence applies only its checksum-pinned migration", () => {
  assert.equal(
    migrationSha256,
    "fad2c67b0ed3ed4d762a7a5d7d491ba8cca1ab33dc6f0253d8dff845933c4302",
  );
  assert.ok(workflow.includes(`${migrationSha256}  ${migrationPath}`));
  assert.ok(workflow.includes(`checksum: '${migrationSha256}'`));
  assert.ok(workflow.includes(`const checksum = '${migrationSha256}';`));
  assert.equal(
    enableMigrationSha256,
    "19b274a225e60da129ed3868a0a5e59e13a4dcd1243f58ecf5cc81abbfafaaff",
  );
  assert.ok(
    workflow.includes(`${enableMigrationSha256}  ${enableMigrationPath}`),
  );
  assert.match(
    workflow,
    /7657e99e0e809471936e96d4ec0c5f84ad6afefabe5296ae3ffe7a021bfbe5d7[\s\S]*20261007160000_converge_user_cross_domain_authorities/,
  );
  assert.match(workflow, /guard-production-migration-runner\.mjs/);
  assert.match(workflow, /candidateRows\.length === 0/);
  assert.match(
    workflow,
    /state=\$\{candidateRows\.length === 1 \? 'applied' : 'pending'\}/,
  );
  assert.match(
    workflow,
    /name: Require every predecessor applied and no unrelated migration pending/,
  );
  assert.match(workflow, /mv "prisma\/migrations\/\$migration" "\$holding"/);
  assert.match(workflow, /name: Hold reviewed later User ENABLE migration/);
  assert.match(workflow, /name: Restore held User ENABLE source/);
  assert.match(workflow, /test "\$\{#successors\[@\]\}" -eq 1/);
  assert.match(workflow, /test "\$\{successors\[0\]\}" = "\$enable"/);
  assert.ok(
    workflow.indexOf("name: Verify owner connection boundary") <
      workflow.indexOf("name: Hold reviewed later User ENABLE migration"),
  );
  assert.ok(
    workflow.indexOf("name: Hold reviewed later User ENABLE migration") <
      workflow.indexOf("run: npx prisma migrate deploy"),
  );
  assert.ok(
    workflow.indexOf("name: Restore held User ENABLE source") >
      workflow.indexOf("name: Verify final Prisma migration status"),
  );
  assert.match(workflow, /steps\.ledger\.outputs\.state == 'pending'/);
  assert.equal((workflow.match(/run: npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.doesNotMatch(workflow, /(?:^|\n)\s+DATABASE_URL:/);
});

test("cross-domain convergence preserves exact preflight and postflight evidence", () => {
  assert.match(
    workflow,
    /EXPECTED_USER_CROSS_DOMAIN_STATE: \$\{\{ steps\.ledger\.outputs\.state \}\}/,
  );
  assert.match(workflow, /EXPECTED_USER_CROSS_DOMAIN_STATE: applied/);
  assert.ok(
    (workflow.match(/user-cross-domain-convergence-production-inspect\.mjs/gu) ?? [])
      .length >= 2,
  );
  assert.match(workflow, /assert\.deepEqual\(post\.catalog\.tables, pre\.catalog\.tables\)/);
  assert.match(workflow, /assert\.deepEqual\(post\.catalog\.policies, pre\.catalog\.policies\)/);
  assert.match(workflow, /assert\.deepEqual\(participant\(post\), participant\(pre\)\)/);
  assert.match(workflow, /post\.result\.functionCount, 3/);
  assert.match(workflow, /post\.result\.tableCount, 4/);
  assert.match(workflow, /post\.result\.triggerCount, 1/);
  assert.match(workflow, /post\.result\.productionChanged, false/);
  assert.match(workflow, /post\.result\.rowDataRead, false/);
  assert.match(workflow, /npm run audit:db-grants/);
  assert.match(
    workflow,
    /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/,
  );
  assert.match(workflow, /retention-days: 30/);
});
