import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  ORDER_QUOTE_ENABLE_RELEASE,
  buildOrderQuoteRlsCandidate,
} from "../scripts/build-order-quote-rls-candidate.mjs";

test("quote ENABLE is one pinned policyless table release", () => {
  const release = buildOrderQuoteRlsCandidate();
  assert.equal(
    release.migrationName,
    "20261001050000_enable_order_shipping_rate_quote_rls",
  );
  assert.equal(
    release.migrationSha256,
    ORDER_QUOTE_ENABLE_RELEASE.migrationSha256,
  );
  assert.match(release.migration, /OrderShippingRateQuote ENABLE/);
  assert.match(release.migration, /accepted OrderItem FORCE/);
  assert.match(release.migration, /accepted_functions <> 4/);
  assert.match(release.migration, /exact function catalog drifted/);
  assert.match(
    release.migration,
    /expected\(function_identity, source_md5, language_name, volatility, parallel_safety\)/,
  );
  assert.equal((release.migration.match(/, 'plpgsql', 'v', 'u'\)/gu) ?? []).length, 4);
  assert.doesNotMatch(release.migration, /actual\.lanname = 'plpgsql'/u);
  assert.match(release.migration, /trigger catalog drifted/);
  assert.doesNotMatch(release.migration, /CREATE POLICY|DROP POLICY/);
  assert.equal(
    release.migration,
    fs.readFileSync(path.resolve(ORDER_QUOTE_ENABLE_RELEASE.migrationPath), "utf8"),
  );
});

test("quote ENABLE rollback restores RLS-off without grants", () => {
  const { rollback } = buildOrderQuoteRlsCandidate();
  assert.match(rollback, /DISABLE ROW LEVEL SECURITY/);
  assert.match(rollback, /retains accepted OrderItem FORCE/);
  assert.doesNotMatch(rollback, /\bGRANT\b/);
});

test("global grant audit recognizes quote policyless ENABLE", () => {
  const audit = fs.readFileSync("scripts/audit-runtime-db-grants.mjs", "utf8");
  assert.match(audit, /export const ORDER_QUOTE_TABLE = "OrderShippingRateQuote"/u);
  assert.match(audit, /export function orderQuoteRlsActivationExpected/u);
  assert.match(audit, /export function orderQuoteRlsForceExpected/u);
  assert.match(
    audit,
    /row\.table_name === ORDER_QUOTE_TABLE[\s\S]{0,120}orderQuoteRlsActivationExpected\(inventory\)/u,
  );
});

test("CI isolates quote ENABLE and applies it after accepted OrderItem FORCE", () => {
  const workflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
  const verify = workflow.indexOf("Verify staged quote ENABLE source package");
  const isolate = workflow.indexOf("Isolate quote ENABLE until OrderItem FORCE passes");
  const restoreItemForce = workflow.indexOf("Restore OrderItem FORCE release");
  const applyItemForce = workflow.indexOf("Apply only OrderItem FORCE in disposable PostgreSQL");
  const holdTest = workflow.indexOf(
    "tests/order-quote-enable-release.test.mjs",
    isolate + "Isolate quote ENABLE until OrderItem FORCE passes".length,
  );
  const tests = workflow.indexOf("- name: Tests");
  const restore = workflow.indexOf("Restore quote ENABLE release");
  const apply = workflow.indexOf("Apply only quote ENABLE in disposable PostgreSQL");
  assert.ok(verify >= 0 && verify < isolate);
  assert.ok(isolate < restoreItemForce && restoreItemForce < applyItemForce);
  assert.ok(isolate < holdTest && holdTest < tests);
  assert.ok(applyItemForce < restore && restore < apply);
  assert.doesNotMatch(workflow, /ORDER_QUOTE_ENABLE_MIGRATION_PATH/u);
  assert.equal(
    (workflow.match(/20261001050000_enable_order_shipping_rate_quote_rls/gu) ?? []).length,
    3,
  );
});

test("Production quote ENABLE is manually dispatched and exact-bound", () => {
  const workflow = fs.readFileSync(
    ".github/workflows/order-shipping-rate-quote-enable-production.yml",
    "utf8",
  );
  assert.match(workflow, /^name: OrderShippingRateQuote ENABLE Production$/m);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /inputs\.confirmation == 'enable-reviewed-order-shipping-rate-quote-rls'/u);
  assert.match(workflow, /forceRun\.name !== 'OrderItem FORCE Production'/u);
  assert.match(workflow, /job\.name === 'Force policyless OrderItem RLS'/u);
  assert.match(workflow, /forceValue !== '36848393564'/u);
  assert.match(workflow, /inspection\.name !== 'Order Child Authority Inspection'/u);
  assert.match(workflow, /Read OrderItem and quote authority catalog/u);
  assert.match(workflow, /node scripts\/guard-production-migration-runner\.mjs/u);
  assert.match(workflow, /if: steps\.preflight\.outputs\.state == 'pending'/u);
  assert.match(workflow, /run: npx prisma migrate deploy/u);
  assert.match(workflow, /quoteRlsEnabled: true,[\s\S]{0,80}quoteRlsForced: false/u);
  assert.match(workflow, /retention-days: 7/u);
});
