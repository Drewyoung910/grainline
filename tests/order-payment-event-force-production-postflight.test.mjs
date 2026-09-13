import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  REVIEWED_PRODUCTION_RUNTIME_IDENTITY,
} from "../scripts/guard-runtime-db-env.mjs";
import {
  ORDER_PAYMENT_EVENT_DIRECT_FUNCTION_IDENTITIES,
  orderPaymentEventActivationFunctionCatalog,
} from "../scripts/order-payment-event-activation-catalog.mjs";
import {
  ORDER_PAYMENT_EVENT_FORCE_POSTFLIGHT_CONFIRMATION,
  assertOrderPaymentEventActivationRuntimeCatalog,
  parseOrderPaymentEventActivationPostflightConfig,
  parseOrderPaymentEventPostflightMode,
} from "../scripts/order-payment-event-activation-production-postflight.mjs";

const RELEASE_COMMIT = "f".repeat(40);
const SYNTHETIC_RUNTIME_TARGET = "synthetic-force-runtime-target";

function environment(directory) {
  return {
    DATABASE_URL: SYNTHETIC_RUNTIME_TARGET,
    ORDER_PAYMENT_EVENT_FORCE_POSTFLIGHT_CONFIRM:
      ORDER_PAYMENT_EVENT_FORCE_POSTFLIGHT_CONFIRMATION,
    ORDER_PAYMENT_EVENT_FORCE_POSTFLIGHT_EVIDENCE_PATH: path.join(
      directory,
      `order-payment-event-force-production-postflight-${RELEASE_COMMIT}.json`,
    ),
    ORDER_PAYMENT_EVENT_FORCE_POSTFLIGHT_MAIN_CI_RUN_ID: "33360000001",
    ORDER_PAYMENT_EVENT_FORCE_POSTFLIGHT_MIGRATION_RUN_ID: "33360000002",
    ORDER_PAYMENT_EVENT_FORCE_POSTFLIGHT_RELEASE_COMMIT: RELEASE_COMMIT,
  };
}

function parseForce(env) {
  return parseOrderPaymentEventActivationPostflightConfig(env, {
    assertRuntimeDatabaseIsolation: (input) => {
      assert.equal(input.DATABASE_URL, SYNTHETIC_RUNTIME_TARGET);
      assert.equal(input.VERCEL, "1");
      assert.equal(input.VERCEL_ENV, "production");
      return REVIEWED_PRODUCTION_RUNTIME_IDENTITY;
    },
    postForce: true,
  });
}

function forceCatalogSnapshot() {
  const expected = orderPaymentEventActivationFunctionCatalog();
  return {
    table: {
      owner_name: "neondb_owner",
      rls_enabled: true,
      rls_forced: true,
      policy_count: 0,
      runtime_can_select: false,
      runtime_can_insert: false,
      runtime_can_update: false,
      runtime_can_delete: false,
      public_has_crud: false,
      invalid_table_acl_count: 0,
      column_acl_count: 0,
      validated_constraint_count: 6,
      required_index_count: 7,
      required_trigger_count: 7,
      order_payment_event_trigger_count: 4,
    },
    functions: expected.map((entry) => ({
      identity: entry.identity,
      owner_name: "neondb_owner",
      function_kind: "f",
      language_name: entry.language,
      volatility: entry.volatility,
      parallel_safety: entry.parallelSafety,
      security_definer: entry.securityDefiner,
      leakproof: false,
      config: ["search_path=pg_catalog"],
      source_md5: entry.sourceMd5,
      runtime_can_execute: entry.runtimeAfter,
      runtime_execute_grantable: false,
      public_can_execute: false,
      invalid_acl_count: 0,
    })),
    unexpectedNamedFunctionCount: 0,
    directFunctionCount: ORDER_PAYMENT_EVENT_DIRECT_FUNCTION_IDENTITIES.length,
    reviewedDirectFunctionCount:
      ORDER_PAYMENT_EVENT_DIRECT_FUNCTION_IDENTITIES.length,
  };
}

test("OrderPaymentEvent FORCE postflight has a distinct exact contract", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "order-payment-force-postflight-"),
  );
  const parsed = parseForce(environment(directory));
  assert.equal(parsed.operation, "order-payment-event-force-production-postflight");
  assert.equal(parsed.releaseCommit, RELEASE_COMMIT);
  assert.equal(parsed.rlsForced, true);
  assert.equal(parsed.mainCiRunId, 33360000001);
  assert.equal(parsed.migrationRunId, 33360000002);
  assert.equal(parsed.runtimeIdentity, REVIEWED_PRODUCTION_RUNTIME_IDENTITY);

  assert.throws(
    () => parseForce({
      ...environment(directory),
      ORDER_PAYMENT_EVENT_FORCE_POSTFLIGHT_CONFIRM:
        "verify-production-order-payment-event-activation-runtime-read-only",
    }),
    /FORCE postflight confirmation is invalid/u,
  );
  assert.throws(
    () => parseForce({
      ...environment(directory),
      ORDER_PAYMENT_EVENT_FORCE_POSTFLIGHT_EVIDENCE_PATH: path.join(
        directory,
        `order-payment-event-activation-production-postflight-${RELEASE_COMMIT}.json`,
      ),
    }),
    /FORCE postflight evidence path is not fresh and exact/u,
  );
  assert.throws(
    () => parseForce({
      ...environment(directory),
      DIRECT_URL: "synthetic-owner-target",
    }),
    /rejects privileged database keys/u,
  );
});

test("OrderPaymentEvent postflight modes are fail closed", () => {
  assert.equal(parseOrderPaymentEventPostflightMode([]), false);
  assert.equal(parseOrderPaymentEventPostflightMode(["--post-force"]), true);
  assert.throws(
    () => parseOrderPaymentEventPostflightMode(["--unknown"]),
    /Usage:/u,
  );
  assert.throws(
    () => parseOrderPaymentEventPostflightMode(["--post-force", "extra"]),
    /Usage:/u,
  );
});

test("OrderPaymentEvent FORCE catalog requires the exact FORCE posture", () => {
  assert.deepEqual(
    assertOrderPaymentEventActivationRuntimeCatalog(
      forceCatalogSnapshot(),
      { expectedForce: true },
    ),
    {
      functionCount: 29,
      privateFunctionCount: 13,
      runtimeFunctionCount: 16,
      policyCount: 0,
      rlsEnabled: true,
      rlsForced: true,
    },
  );

  const noForce = forceCatalogSnapshot();
  noForce.table.rls_forced = false;
  assert.throws(
    () => assertOrderPaymentEventActivationRuntimeCatalog(
      noForce,
      { expectedForce: true },
    ),
    /table posture drifted/u,
  );
  assert.throws(
    () => assertOrderPaymentEventActivationRuntimeCatalog(
      forceCatalogSnapshot(),
      { expectedForce: false },
    ),
    /table posture drifted/u,
  );
});

test("OrderPaymentEvent FORCE postflight is read-only and separately callable", () => {
  const source = fs.readFileSync(
    "scripts/order-payment-event-activation-production-postflight.mjs",
    "utf8",
  );
  assert.match(source, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
  assert.match(source, /verifyOrderPaymentEventForceRelease/u);
  assert.match(source, /expectedForce: config\.rlsForced/u);
  assert.match(source, /policyless_enable_force_table_posture/u);
  assert.match(source, /productionChangedByPostflight: false/u);
  assert.doesNotMatch(source, /SET\s+(?:LOCAL\s+)?ROLE/iu);

  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(
    pkg.scripts["ops:order-payment-event-force-postflight"],
    "node scripts/order-payment-event-activation-production-postflight.mjs --post-force",
  );
  assert.equal(
    pkg.scripts["audit:order-payment-event-force-postflight-postgres"],
    "node scripts/order-payment-event-activation-postflight-postgres-proof.mjs --post-force",
  );

  const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
  const forceApply = ci.indexOf(
    "Apply OrderPaymentEvent posture-only FORCE hardening",
  );
  const forceAuthority = ci.indexOf(
    "Prove FORCE-hardened OrderPaymentEvent through separate logins",
  );
  const forcePostflight = ci.indexOf(
    "Prove OrderPaymentEvent FORCE postflight through the runtime login",
  );
  const forceRollback = ci.indexOf(
    "Prove OrderPaymentEvent FORCE rollback and restoration",
  );
  assert.ok(
    forceApply >= 0
      && forceAuthority > forceApply
      && forcePostflight > forceAuthority
      && forceRollback > forcePostflight,
  );
  assert.match(
    ci.slice(forcePostflight, forceRollback),
    /ORDER_PAYMENT_EVENT_ACTIVATION_POSTFLIGHT_PROOF_DATABASE_URL/u,
  );
});
