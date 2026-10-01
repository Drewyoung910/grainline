import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  ORDER_ITEM_FORCE_RELEASE,
  buildOrderItemForceCandidate,
} from "../scripts/build-order-item-force-candidate.mjs";

test("OrderItem FORCE is one pinned policyless posture release", () => {
  const release = buildOrderItemForceCandidate();
  assert.equal(release.migrationName, "20261001040000_force_order_item_rls");
  assert.equal(release.migrationSha256, ORDER_ITEM_FORCE_RELEASE.migrationSha256);
  assert.match(release.migration, /OrderItem FORCE/);
  assert.match(release.migration, /OrderItem" FORCE ROW LEVEL SECURITY/);
  assert.match(release.migration, /accepted_functions <> 34/);
  assert.match(release.migration, /accepted_triggers <> 2/);
  assert.match(
    release.migration,
    /expected\(function_identity, source_md5, language_name, volatility, parallel_safety\)/,
  );
  assert.equal((release.migration.match(/, 'sql', 's', 's'\)/gu) ?? []).length, 4);
  assert.equal((release.migration.match(/, 'plpgsql', '[sv]', '[su]'\)/gu) ?? []).length, 30);
  assert.doesNotMatch(release.migration, /actual\.lanname = 'plpgsql'/u);
  assert.match(release.migration, /pg_catalog\.pg_auth_members/);
  assert.match(release.migration, /OrderItem owner-session drain is incomplete/);
  assert.match(release.migration, /OrderShippingRateQuote stays/);
  assert.doesNotMatch(release.migration, /CREATE POLICY|DROP POLICY/);
  assert.doesNotMatch(
    release.migration,
    /OrderItem" (?:ENABLE|NO FORCE) ROW LEVEL SECURITY/,
  );
  assert.equal(
    release.migration,
    fs.readFileSync(path.resolve(ORDER_ITEM_FORCE_RELEASE.migrationPath), "utf8"),
  );
});

test("OrderItem rollback restores policyless zero-direct ENABLE", () => {
  const { rollback } = buildOrderItemForceCandidate();
  assert.match(rollback, /NO FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(rollback, /DISABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(rollback, /\bGRANT\b/);
  assert.match(rollback, /remains policyless ENABLE/);
  assert.match(rollback, /pg_catalog\.pg_auth_members/);
  assert.match(rollback, /OrderItem rollback owner-session drain is incomplete/);
});

test("CI isolates FORCE until policyless ENABLE succeeds", () => {
  const workflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
  const verifyForce = workflow.indexOf("Verify staged OrderItem FORCE source package");
  const isolateForce = workflow.indexOf("Isolate OrderItem FORCE until policyless ENABLE passes");
  const verifyEnable = workflow.indexOf("Verify staged OrderItem ENABLE source package");
  const isolateEnable = workflow.indexOf("Isolate OrderItem ENABLE until every accepted predecessor passes");
  const tests = workflow.indexOf("- name: Tests");
  const restoreEnable = workflow.indexOf("Restore OrderItem ENABLE release");
  const applyEnable = workflow.indexOf("Apply only OrderItem ENABLE in disposable PostgreSQL");
  const restoreForce = workflow.indexOf("Restore OrderItem FORCE release");
  const applyForce = workflow.indexOf("Apply only OrderItem FORCE in disposable PostgreSQL");
  assert.ok(verifyForce >= 0 && verifyForce < isolateForce);
  assert.ok(isolateForce < verifyEnable && verifyEnable < isolateEnable);
  assert.ok(isolateEnable < tests && tests < restoreEnable);
  assert.ok(restoreEnable < applyEnable && applyEnable < restoreForce);
  assert.ok(restoreForce < applyForce);
  assert.match(
    workflow,
    /name: Tests[\s\S]*ORDER_ITEM_FORCE_MIGRATION_PATH: \$\{\{ runner\.temp \}\}\/order-item-force-release\/migration\.sql[\s\S]*npm test/u,
  );
});

test("Production FORCE is manual, exact-bound and restart-safe", () => {
  const workflow = fs.readFileSync(
    ".github/workflows/order-item-force-production.yml",
    "utf8",
  );
  assert.match(workflow, /^name: OrderItem FORCE Production$/m);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.run_attempt == 1/);
  assert.match(workflow, /inputs\.confirmation == 'force-reviewed-order-item-rls'/);
  assert.match(workflow, /REVIEWED_ENABLE_RUN_ID: \$\{\{ inputs\.enable_run_id \}\}/);
  assert.match(workflow, /enableRun\.name !== 'OrderItem ENABLE Production'/);
  assert.match(workflow, /enableRun\.path !== '\.github\/workflows\/order-item-enable-production\.yml'/);
  assert.match(workflow, /job\.name === 'Enable policyless OrderItem RLS'/);
  assert.match(workflow, /enableComparison/);
  assert.match(workflow, /node scripts\/guard-production-migration-runner\.mjs/);
  assert.match(workflow, /if: steps\.preflight\.outputs\.state == 'pending'/);
  assert.match(workflow, /run: npx prisma migrate deploy/);
  assert.match(workflow, /orderItemRlsEnabled: true, orderItemRlsForced: true/);
  assert.match(workflow, /retention-days: 7/);
});
