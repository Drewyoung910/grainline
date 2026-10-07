import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/user-installed-catalog-production-inspection.yml",
  "utf8",
);
const successorWorkflow = readFileSync(
  ".github/workflows/user-authority-successors-production.yml",
  "utf8",
);
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");

test("installed-catalog inspection is exact-main, exact-CI, manual, and read-only", () => {
  assert.match(workflow, /name: User Installed Catalog Production Inspection/u);
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /inputs\.confirmation == 'inspect-reviewed-user-installed-catalog'/u);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /github\.run_attempt == 1/u);
  assert.match(workflow, /main\.commit\.sha !== sha/u);
  assert.match(workflow, /run\.name !== 'CI'/u);
  assert.match(workflow, /run\.event !== 'push'/u);
  assert.match(workflow, /run\.head_sha !== sha/u);
  assert.match(workflow, /run\.conclusion !== 'success'/u);
  assert.match(workflow, /group: production-database-inspections/u);
  assert.match(workflow, /environment: Production/u);
  assert.match(workflow, /guard-production-migration-runner\.mjs/u);
  assert.match(workflow, /user-installed-catalog-production-inspect\.mjs/u);
  assert.match(workflow, /PRODUCTION_MIGRATION_DIRECT_URL/u);
  assert.match(workflow, /retention-days: 30/u);
  assert.doesNotMatch(workflow, /prisma migrate deploy|psql |vercel|gh workflow run|git push/iu);
});

test("inspection proves its source before touching the owner connection", () => {
  const source = workflow.indexOf("Verify read-only installed-catalog source");
  const boundary = workflow.indexOf("Verify owner connection boundary");
  const inspect = workflow.indexOf("Inspect ledger, functions, grants, and User posture read-only");
  assert.ok(source >= 0);
  assert.ok(boundary > source);
  assert.ok(inspect > boundary);
  for (const file of [
    "tests/user-authority-catalog.test.mjs",
    "tests/user-installed-catalog-production-inspect.test.mjs",
    "tests/user-installed-catalog-production-workflow.test.mjs",
  ]) assert.match(workflow, new RegExp(file.replaceAll(".", "\\."), "u"));
});

test("complete catalog proofs stay isolated until the staff successor returns", () => {
  for (const file of [
    "tests/user-installed-catalog-production-inspect.test.mjs",
    "tests/user-installed-catalog-production-workflow.test.mjs",
  ]) {
    assert.equal(ciWorkflow.split(file).length - 1, 3, file);
  }
  const isolate = ciWorkflow.indexOf("Isolate User staff admin labels until follower passes");
  const restore = ciWorkflow.indexOf("Restore User staff admin-label source package");
  const broad = ciWorkflow.indexOf("      - name: Tests\n");
  assert.ok(isolate >= 0 && isolate < broad);
  assert.ok(restore > broad);
  const staffReplay = ciWorkflow.slice(
    ciWorkflow.indexOf("Re-verify User staff admin-label source package"),
    ciWorkflow.indexOf("Apply User staff admin-label authority in disposable PostgreSQL"),
  );
  assert.match(staffReplay, /user-authority-catalog\.test\.mjs/u);
  assert.match(staffReplay, /user-installed-catalog-production-inspect\.test\.mjs/u);
  assert.match(staffReplay, /user-installed-catalog-production-workflow\.test\.mjs/u);
});

test("successor release is exact-main, inspection-bound, scope-closed, and restart-safe", () => {
  assert.match(successorWorkflow, /name: User Authority Successors Production/u);
  assert.match(successorWorkflow, /inputs\.confirmation == 'apply-reviewed-user-authority-successors'/u);
  assert.match(successorWorkflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(successorWorkflow, /github\.run_attempt == 1/u);
  assert.match(successorWorkflow, /main\.commit\.sha !== sha/u);
  assert.match(successorWorkflow, /ci\.head_sha !== sha/u);
  assert.match(successorWorkflow, /inspection\.name !== 'User Installed Catalog Production Inspection'/u);
  assert.match(successorWorkflow, /inspection\.head_sha !== sha/u);
  assert.match(successorWorkflow, /inspection\.run_attempt !== 1/u);
  assert.match(successorWorkflow, /inspection\.conclusion !== 'success'/u);
  assert.match(successorWorkflow, /group: production-database-migrations/u);
  assert.match(successorWorkflow, /environment: Production/u);
  assert.match(successorWorkflow, /guard-production-migration-runner\.mjs/u);
  assert.match(successorWorkflow, /USER_INSTALLED_CATALOG_EXPECTED_PREFIX: successor-progress/u);
  assert.match(successorWorkflow, /USER_INSTALLED_CATALOG_EXPECTED_PREFIX: complete/u);
  assert.match(successorWorkflow, /steps\.preflight\.outputs\.applied_count != '16'/u);
  assert.equal((successorWorkflow.match(/npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.match(successorWorkflow, /USER_AUTHORITY_APPLIED_COUNT: \$\{\{ steps\.preflight\.outputs\.applied_count \}\}/u);
  assert.match(successorWorkflow, /pending_start=\$\(\(applied - 8\)\)/u);
  assert.match(successorWorkflow, /for \(\(index=pending_start; index<\$\{#migrations\[@\]\}; index\+\+\)\)/u);
  assert.equal((successorWorkflow.match(/npx prisma migrate status/gu) ?? []).length, 2);
  assert.doesNotMatch(successorWorkflow, /USER_AUTHORITY_SUCCESSORS_PRISMA_SCHEMA|migrate (?:deploy|status) --schema/u);
  assert.match(successorWorkflow, /npm run audit:db-grants -- --require-direct-url/u);
  assert.match(successorWorkflow, /name: Preserve sanitized successor evidence\n\s+if: always\(\)/u);
  assert.doesNotMatch(successorWorkflow, /ALTER TABLE[\s\S]*ROW LEVEL SECURITY|vercel|git push/iu);

  const migrations = [
    "20261006010000_prepare_user_staff_ban_authorities",
    "20261006020000_prepare_user_account_deletion_authorities",
    "20261006030000_prepare_user_relationship_authorities",
    "20261007010000_prepare_user_public_blog_state",
    "20261007020000_prepare_user_public_review_commission_state",
    "20261007030000_prepare_user_block_email_authorities",
    "20261007040000_prepare_user_follower_authorities",
    "20261007150000_prepare_user_staff_admin_labels",
  ];
  for (const migration of migrations) {
    const path = `prisma/migrations/${migration}/migration.sql`;
    const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
    assert.match(successorWorkflow, new RegExp(`${digest}  ${path.replaceAll(".", "\\.")}`, "u"));
  }
  const migrationList = successorWorkflow.match(/migrations=\(\n([\s\S]*?)\n\s+\)/u);
  assert.ok(migrationList);
  assert.deepEqual(
    migrationList[1].split("\n").map((line) => line.trim()).filter(Boolean),
    migrations,
  );

  const source = successorWorkflow.indexOf("Verify complete User authority source and release contract");
  const bytes = successorWorkflow.indexOf("Verify exact successor migration bytes");
  const boundary = successorWorkflow.indexOf("Verify owner connection boundary");
  const preflight = successorWorkflow.indexOf("Inspect restart-safe successor prefix before apply");
  const status = successorWorkflow.indexOf("Require every non-successor migration applied");
  const apply = successorWorkflow.indexOf("Apply only reviewed User authority successors through Prisma");
  const audit = successorWorkflow.indexOf("Audit global grants after successor release");
  const postflight = successorWorkflow.indexOf("Inspect complete User authority catalog after apply");
  assert.ok(source >= 0 && source < bytes && bytes < boundary && boundary < preflight);
  assert.ok(preflight < status && status < apply && apply < audit && audit < postflight);
});
