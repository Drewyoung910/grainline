import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/order-blocked-pair-checkout-production.yml",
  "utf8",
);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const migrationPath = [
  process.env.ORDER_BLOCKED_PAIR_CHECKOUT_MIGRATION_PATH,
  "prisma/migrations/20260930032000_block_checkout_user_pairs/migration.sql",
  process.env.RUNNER_TEMP
    ? `${process.env.RUNNER_TEMP}/order-blocked-pair-checkout/migration.sql`
    : null,
].find((candidate) => candidate && existsSync(candidate));
assert.ok(migrationPath, "blocked-pair checkout migration source must be available");
const migration = readFileSync(migrationPath, "utf8");

test("blocked-pair checkout workflow is manual, exact-main and Production-bound", () => {
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /inputs\.confirmation == 'apply-reviewed-order-blocked-pair-checkout'/u);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /github\.run_attempt == 1/u);
  assert.match(workflow, /environment: Production/u);
  assert.match(workflow, /group: production-database-migrations/u);
  assert.match(
    workflow,
    /main\.commit\.sha !== sha[\s\S]*run\.event !== 'push'[\s\S]*run\.head_branch !== 'main'[\s\S]*run\.head_sha !== sha[\s\S]*run\.conclusion !== 'success'/u,
  );
});

test("workflow admits only the exact latest blocked-pair migration after its predecessors", () => {
  assert.match(
    workflow,
    /dc1cdbf14a5b126635af44fbbc4ca820ac16e46823a68071400fd5786110209d\s+prisma\/migrations\/20260930032000_block_checkout_user_pairs\/migration\.sql/u,
  );
  assert.match(workflow, /tail -n 1[\s\S]*20260930032000_block_checkout_user_pairs/u);
  assert.match(workflow, /20260930030000_bound_listing_fulfillment_days/u);
  assert.match(workflow, /20260930031000_mark_paid_private_listing_sold/u);
  assert.match(
    workflow,
    /Require every predecessor applied and no other pending migration[\s\S]*npx prisma migrate status[\s\S]*Apply only the reviewed Order blocked-pair checkout migration/u,
  );
});

test("postflight proves all three exact function sources and unchanged table posture", () => {
  for (const name of [
    "grainline_checkout_reservation_create_cart_snapshot",
    "grainline_checkout_reservation_create_single_snapshot",
    "grainline_stripe_checkout_order_create",
  ]) {
    assert.match(workflow, new RegExp(name, "u"));
  }
  assert.match(workflow, /assert\.equal\(row\.prosrc, expectedBody\(name\)\)/u);
  assert.match(workflow, /assert\.equal\(row\.runtime_execute, true\)/u);
  assert.match(workflow, /assert\.equal\(row\.public_execute, false\)/u);
  assert.match(workflow, /assert\.deepEqual\(\(await client\.query\(postureSql\)\)\.rows, before\)/u);
  assert.doesNotMatch(workflow, /provision-runtime-db-role\.sql/u);
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/iu);
  assert.doesNotMatch(migration, /ALTER TABLE[\s\S]*(?:ENABLE|FORCE) ROW LEVEL SECURITY/iu);
});

test("CI keeps the successor isolated until the two accepted post-FORCE predecessors pass", () => {
  const isolate = ci.indexOf(
    "Isolate Order blocked-pair checkout until post-FORCE predecessors pass",
  );
  const postForceApply = ci.indexOf(
    "Apply only Order post-FORCE application corrections through Prisma",
  );
  const restore = ci.indexOf("Restore Order blocked-pair checkout");
  const apply = ci.indexOf("Apply only Order blocked-pair checkout through Prisma");
  assert.ok(isolate > 0 && isolate < postForceApply);
  assert.ok(postForceApply < restore && restore < apply);
  assert.match(ci, /ORDER_BLOCKED_PAIR_CHECKOUT_MIGRATION_PATH=\$correction\/migration\.sql/u);
  assert.match(ci, /ORDER_BLOCKED_PAIR_CHECKOUT_PRISMA_SCHEMA/u);
});
