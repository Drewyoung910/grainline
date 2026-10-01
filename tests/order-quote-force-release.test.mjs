import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  ORDER_QUOTE_FORCE_RELEASE,
  buildOrderQuoteForceCandidate,
} from "../scripts/build-order-quote-force-candidate.mjs";

test("quote FORCE is one pinned policyless posture release", () => {
  const release = buildOrderQuoteForceCandidate();
  assert.equal(
    release.migrationName,
    "20261001060000_force_order_shipping_rate_quote_rls",
  );
  assert.equal(
    release.migrationSha256,
    ORDER_QUOTE_FORCE_RELEASE.migrationSha256,
  );
  assert.match(release.migration, /OrderShippingRateQuote FORCE/);
  assert.match(release.migration, /accepted quote ENABLE/);
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
  assert.doesNotMatch(
    release.migration,
    /OrderShippingRateQuote" (?:ENABLE|NO FORCE) ROW LEVEL SECURITY/,
  );
  assert.equal(
    release.migration,
    fs.readFileSync(path.resolve(ORDER_QUOTE_FORCE_RELEASE.migrationPath), "utf8"),
  );
});

test("quote FORCE rollback restores policyless ENABLE without grants", () => {
  const { rollback } = buildOrderQuoteForceCandidate();
  assert.match(rollback, /NO FORCE ROW LEVEL SECURITY/);
  assert.match(rollback, /Restores policyless quote ENABLE/);
  assert.doesNotMatch(rollback, /DISABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(rollback, /\bGRANT\b/);
});

test("CI isolates quote FORCE until quote ENABLE succeeds", () => {
  const workflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
  const verifyForce = workflow.indexOf("Verify staged quote FORCE source package");
  const isolateForce = workflow.indexOf("Isolate quote FORCE until quote ENABLE passes");
  const verifyEnable = workflow.indexOf("Verify staged quote ENABLE source package");
  const isolateEnable = workflow.indexOf("Isolate quote ENABLE until OrderItem FORCE passes");
  const tests = workflow.indexOf("- name: Tests");
  const restoreEnable = workflow.indexOf("Restore quote ENABLE release");
  const applyEnable = workflow.indexOf("Apply only quote ENABLE in disposable PostgreSQL");
  const restoreForce = workflow.indexOf("Restore quote FORCE release");
  const applyForce = workflow.indexOf("Apply only quote FORCE in disposable PostgreSQL");
  assert.ok(verifyForce >= 0 && verifyForce < isolateForce);
  assert.ok(isolateForce < verifyEnable && verifyEnable < isolateEnable);
  assert.ok(isolateEnable < tests && tests < restoreEnable);
  assert.ok(restoreEnable < applyEnable && applyEnable < restoreForce);
  assert.ok(restoreForce < applyForce);
  assert.doesNotMatch(workflow, /ORDER_QUOTE_FORCE_MIGRATION_PATH/u);
});

test("Production quote FORCE is manual, exact-bound and restart-safe", () => {
  const workflow = fs.readFileSync(
    ".github/workflows/order-shipping-rate-quote-force-production.yml",
    "utf8",
  );
  assert.match(workflow, /^name: OrderShippingRateQuote FORCE Production$/m);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /github\.run_attempt == 1/u);
  assert.match(workflow, /inputs\.confirmation == 'force-reviewed-order-shipping-rate-quote-rls'/u);
  assert.match(workflow, /enableRun\.name !== 'OrderShippingRateQuote ENABLE Production'/u);
  assert.match(workflow, /job\.name === 'Enable policyless OrderShippingRateQuote RLS'/u);
  assert.match(workflow, /enableComparison/u);
  assert.match(workflow, /node scripts\/guard-production-migration-runner\.mjs/u);
  assert.match(workflow, /if: steps\.preflight\.outputs\.state == 'pending'/u);
  assert.match(workflow, /run: npx prisma migrate deploy/u);
  assert.match(workflow, /quoteRlsEnabled: true,[\s\S]{0,80}quoteRlsForced: true/u);
  assert.match(workflow, /retention-days: 7/u);
});
