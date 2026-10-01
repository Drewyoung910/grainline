import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  ORDER_ITEM_ENABLE_RELEASE,
  buildOrderItemRlsCandidate,
} from "../scripts/build-order-item-rls-candidate.mjs";

test("OrderItem ENABLE is one pinned policyless table release", () => {
  const release = buildOrderItemRlsCandidate();
  assert.equal(release.migrationName, "20261001030000_enable_order_item_rls");
  assert.equal(release.migrationSha256, ORDER_ITEM_ENABLE_RELEASE.migrationSha256);
  assert.match(release.migration, /OrderItem ENABLE/);
  assert.match(release.migration, /accepted_functions <> 34/);
  assert.match(release.migration, /accepted_triggers <> 2/);
  assert.match(
    release.migration,
    /expected\(function_identity, source_md5, language_name, volatility, parallel_safety\)/,
  );
  assert.equal((release.migration.match(/, 'sql', 's', 's'\)/gu) ?? []).length, 4);
  assert.equal((release.migration.match(/, 'plpgsql', '[sv]', '[su]'\)/gu) ?? []).length, 30);
  assert.doesNotMatch(release.migration, /actual\.lanname = 'plpgsql'/u);
  assert.match(release.migration, /OrderShippingRateQuote stays/);
  assert.doesNotMatch(release.migration, /CREATE POLICY|DROP POLICY/);
  assert.equal(
    release.migration,
    fs.readFileSync(path.resolve(ORDER_ITEM_ENABLE_RELEASE.migrationPath), "utf8"),
  );
});

test("OrderItem rollback restores the zero-direct RLS-off predecessor", () => {
  const { rollback } = buildOrderItemRlsCandidate();
  assert.match(rollback, /DISABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(rollback, /\bGRANT\b/);
  assert.match(rollback, /zero ordinary-runtime, staff-runtime and PUBLIC table authority/);
});

test("CI isolates the staged OrderItem migration and applies it only after predecessors", () => {
  const workflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
  const verify = workflow.indexOf("Verify staged OrderItem ENABLE source package");
  const isolate = workflow.indexOf("Isolate OrderItem ENABLE until every accepted predecessor passes");
  const holdTest = workflow.indexOf("tests/order-item-enable-release.test.mjs", isolate);
  const broadTests = workflow.indexOf("- name: Tests", isolate);
  const dispute = workflow.indexOf("Apply only Order dispute recovery through Prisma");
  const restoredSuccessors = workflow.indexOf("Restore and prove the reviewed successors");
  const appliedSuccessors = workflow.indexOf(
    "Apply remaining reviewed Order successors in disposable PostgreSQL",
  );
  const caseLabelCorrection = workflow.indexOf(
    "Apply only Case refund label-claim correction in disposable PostgreSQL",
  );
  const restore = workflow.indexOf("Restore OrderItem ENABLE release");
  const apply = workflow.indexOf("Apply only OrderItem ENABLE in disposable PostgreSQL");
  assert.ok(verify >= 0 && verify < isolate);
  assert.ok(isolate < dispute && dispute < restore && restore < apply);
  assert.ok(
    broadTests < restoredSuccessors
      && restoredSuccessors < appliedSuccessors
      && appliedSuccessors < caseLabelCorrection
      && caseLabelCorrection < dispute,
  );
  for (const migration of [
    "20260926011000_correct_order_paid_checkout_bound_reservation",
    "20260926012000_correct_order_seller_deauthorization_fulfillment",
    "20260926012100_correct_order_seller_deauthorization_label",
    "20260926012200_correct_order_seller_deauthorization_projection",
    "20260926012300_retire_legacy_checkout_reservation_creators",
  ]) {
    const migrationIndex = workflow.indexOf(migration, appliedSuccessors);
    assert.ok(
      migrationIndex > appliedSuccessors && migrationIndex < caseLabelCorrection,
      `${migration} is not applied in the reviewed successor step`,
    );
  }
  assert.ok(isolate < holdTest && holdTest < broadTests);
  assert.doesNotMatch(workflow, /ORDER_ITEM_ENABLE_MIGRATION_PATH/u);
  assert.equal(
    (workflow.match(/20261001030000_enable_order_item_rls/gu) ?? []).length,
    3,
  );
});

test("Production ENABLE is manually dispatched, exact-bound and restart-safe", () => {
  const workflow = fs.readFileSync(
    ".github/workflows/order-item-enable-production.yml",
    "utf8",
  );
  assert.match(workflow, /^name: OrderItem ENABLE Production$/m);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.run_attempt == 1/);
  assert.match(workflow, /inputs\.confirmation == 'enable-reviewed-order-item-rls'/);
  assert.match(workflow, /inspection\.name !== 'Order Child Authority Inspection'/);
  assert.match(workflow, /inspection\.path !== '\.github\/workflows\/order-child-authority-inspection\.yml'/);
  assert.match(workflow, /Number\(inspection\.run_attempt\) !== 1/);
  assert.match(workflow, /listJobsForWorkflowRun/);
  assert.match(workflow, /Read OrderItem and quote authority catalog/);
  assert.match(workflow, /\['ahead', 'identical'\]\.includes\(comparison\.status\)/);
  assert.match(workflow, /node scripts\/guard-production-migration-runner\.mjs/);
  assert.match(workflow, /npx prisma migrate status/);
  assert.match(workflow, /if: steps\.preflight\.outputs\.state == 'pending'/);
  assert.match(workflow, /run: npx prisma migrate deploy/);
  assert.match(workflow, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(workflow, /orderItemRlsEnabled: true, orderItemRlsForced: false/);
  assert.match(workflow, /retention-days: 7/);
});
