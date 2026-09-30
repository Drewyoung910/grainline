import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/order-ops-health-production.yml",
  "utf8",
);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const migrationPath = [
  process.env.ORDER_OPS_HEALTH_MIGRATION_PATH,
  "prisma/migrations/20260930033000_order_ops_health_summary/migration.sql",
  process.env.RUNNER_TEMP
    ? `${process.env.RUNNER_TEMP}/order-ops-health/migration.sql`
    : null,
].find((candidate) => candidate && existsSync(candidate));
assert.ok(migrationPath, "Order ops-health migration source must be available");
const migration = readFileSync(migrationPath, "utf8");

test("Order ops-health workflow is manual, exact-main and Production-bound", () => {
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /inputs\.confirmation == 'apply-reviewed-order-ops-health'/u);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /github\.run_attempt == 1/u);
  assert.match(workflow, /environment: Production/u);
  assert.match(workflow, /group: production-database-migrations/u);
  assert.match(
    workflow,
    /main\.commit\.sha !== sha[\s\S]*run\.event !== 'push'[\s\S]*run\.head_branch !== 'main'[\s\S]*run\.head_sha !== sha[\s\S]*run\.conclusion !== 'success'/u,
  );
});

test("workflow admits only the exact latest migration after its predecessor", () => {
  assert.match(
    workflow,
    /7fa34097c631dcfeb88d531a597b3a39b38b9afdf248c7717e450ab8cffb48b7\s+prisma\/migrations\/20260930033000_order_ops_health_summary\/migration\.sql/u,
  );
  assert.match(workflow, /tail -n 1[\s\S]*20260930033000_order_ops_health_summary/u);
  assert.match(workflow, /20260930032000_block_checkout_user_pairs/u);
  assert.match(
    workflow,
    /Require every predecessor applied and no other pending migration[\s\S]*npx prisma migrate status[\s\S]*Apply only the reviewed Order ops-health migration/u,
  );
});

test("postflight proves exact count-only authority and unchanged FORCE tables", () => {
  assert.match(workflow, /assert\.equal\(functionRow\.prosrc, expectedSource\)/u);
  assert.match(workflow, /assert\.equal\(functionRow\.owner, 'neondb_owner'\)/u);
  assert.match(workflow, /assert\.equal\(functionRow\.provolatile, 's'\)/u);
  assert.match(workflow, /assert\.equal\(functionRow\.proparallel, 's'\)/u);
  assert.match(workflow, /assert\.equal\(functionRow\.runtime_execute, true\)/u);
  assert.match(workflow, /assert\.equal\(functionRow\.public_execute, false\)/u);
  assert.match(workflow, /assert\.deepEqual\(\(await client\.query\(postureSql\)\)\.rows, before\)/u);
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/iu);
  assert.doesNotMatch(migration, /ALTER TABLE[\s\S]*(?:ENABLE|FORCE) ROW LEVEL SECURITY/iu);
});

test("CI isolates the new migration until the accepted blocked-pair successor", () => {
  const isolate = ci.indexOf("Isolate Order ops-health until blocked-pair checkout passes");
  const blockedPairApply = ci.indexOf("Apply only Order blocked-pair checkout through Prisma");
  const restore = ci.indexOf("Restore Order ops-health");
  const apply = ci.indexOf("Apply only Order ops-health through Prisma");
  assert.ok(isolate > 0 && isolate < blockedPairApply);
  assert.ok(blockedPairApply < restore && restore < apply);
  assert.match(
    ci,
    /ORDER_OPS_HEALTH_MIGRATION_PATH=\$correction\/migration\.sql/u,
  );
});
