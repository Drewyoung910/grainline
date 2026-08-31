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
  ORDER_PAYMENT_EVENT_ACTIVATION_POSTFLIGHT_CONFIRMATION,
  assertOrderPaymentEventActivationPostflightGitState,
  assertOrderPaymentEventActivationRuntimeCatalog,
  parseOrderPaymentEventActivationPostflightConfig,
  writeOrderPaymentEventActivationPostflightEvidence,
} from "../scripts/order-payment-event-activation-production-postflight.mjs";
import {
  parseOrderPaymentEventActivationPostflightProofConfig,
} from "../scripts/order-payment-event-activation-postflight-postgres-proof.mjs";

const RELEASE_COMMIT = "a".repeat(40);
const SYNTHETIC_RUNTIME_TARGET = "synthetic-runtime-target";

function environment(directory) {
  return {
    DATABASE_URL: SYNTHETIC_RUNTIME_TARGET,
    ORDER_PAYMENT_EVENT_ACTIVATION_POSTFLIGHT_CONFIRM:
      ORDER_PAYMENT_EVENT_ACTIVATION_POSTFLIGHT_CONFIRMATION,
    ORDER_PAYMENT_EVENT_ACTIVATION_POSTFLIGHT_EVIDENCE_PATH: path.join(
      directory,
      `order-payment-event-activation-production-postflight-${RELEASE_COMMIT}.json`,
    ),
    ORDER_PAYMENT_EVENT_ACTIVATION_POSTFLIGHT_MAIN_CI_RUN_ID: "33357911021",
    ORDER_PAYMENT_EVENT_ACTIVATION_POSTFLIGHT_MIGRATION_RUN_ID: "33358695448",
    ORDER_PAYMENT_EVENT_ACTIVATION_POSTFLIGHT_RELEASE_COMMIT: RELEASE_COMMIT,
  };
}

function parseWithReviewedIdentity(env) {
  return parseOrderPaymentEventActivationPostflightConfig(env, {
    assertRuntimeDatabaseIsolation: (input) => {
      assert.equal(input.DATABASE_URL, SYNTHETIC_RUNTIME_TARGET);
      assert.equal(input.VERCEL, "1");
      assert.equal(input.VERCEL_ENV, "production");
      return REVIEWED_PRODUCTION_RUNTIME_IDENTITY;
    },
  });
}

function catalogSnapshot() {
  const expected = orderPaymentEventActivationFunctionCatalog();
  return {
    table: {
      owner_name: "neondb_owner",
      rls_enabled: true,
      rls_forced: false,
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

test("activation postflight accepts only the reviewed pooled runtime contract", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "order-payment-activation-postflight-"),
  );
  const parsed = parseWithReviewedIdentity(environment(directory));
  assert.equal(parsed.releaseCommit, RELEASE_COMMIT);
  assert.equal(parsed.mainCiRunId, 33357911021);
  assert.equal(parsed.migrationRunId, 33358695448);
  assert.equal(parsed.runtimeIdentity, REVIEWED_PRODUCTION_RUNTIME_IDENTITY);

  assert.throws(
    () => parseWithReviewedIdentity({
      ...environment(directory),
      DIRECT_URL: "synthetic-owner-target",
    }),
    /privileged database keys/u,
  );
  assert.throws(
    () => parseWithReviewedIdentity({
      ...environment(directory),
      SHADOW_DATABASE_URL: "postgresql://synthetic.invalid/database",
    }),
    /aliased PostgreSQL URLs/u,
  );
  assert.throws(
    () => parseWithReviewedIdentity({
      ...environment(directory),
      ORDER_PAYMENT_EVENT_ACTIVATION_POSTFLIGHT_CONFIRM: "wrong",
    }),
    /confirmation is invalid/u,
  );
  assert.throws(
    () => parseOrderPaymentEventActivationPostflightConfig(
      environment(directory),
      {
        assertRuntimeDatabaseIsolation: () => {
          throw new Error("runtime target is not pooled");
        },
      },
    ),
    /not pooled/u,
  );
});

test("activation postflight binds exact clean source and sanitized fresh evidence", () => {
  assert.deepEqual(
    assertOrderPaymentEventActivationPostflightGitState(
      { head: RELEASE_COMMIT, status: "" },
      RELEASE_COMMIT,
    ),
    { clean: true, head: RELEASE_COMMIT },
  );
  assert.throws(
    () => assertOrderPaymentEventActivationPostflightGitState(
      { head: RELEASE_COMMIT, status: "?? residue" },
      RELEASE_COMMIT,
    ),
    /exact clean release commit/u,
  );

  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "order-payment-activation-evidence-"),
  );
  const pathname = path.join(directory, "evidence.json");
  writeOrderPaymentEventActivationPostflightEvidence(pathname, {
    status: "passed",
    productionChangedByPostflight: false,
  });
  assert.equal(fs.statSync(pathname).mode & 0o777, 0o600);
  assert.throws(
    () => writeOrderPaymentEventActivationPostflightEvidence(pathname, {}),
    /EEXIST/u,
  );
  assert.throws(
    () => writeOrderPaymentEventActivationPostflightEvidence(
      path.join(directory, "unsafe.json"),
      { database: "postgresql://user:secret@example.invalid/db" },
    ),
    /forbidden data/u,
  );
});

test("activation postflight catalog is exact and fails closed on drift", () => {
  assert.deepEqual(
    assertOrderPaymentEventActivationRuntimeCatalog(catalogSnapshot()),
    {
      functionCount: 29,
      privateFunctionCount: 13,
      runtimeFunctionCount: 16,
      policyCount: 0,
      rlsEnabled: true,
      rlsForced: false,
    },
  );

  const forceDrift = catalogSnapshot();
  forceDrift.table.rls_forced = true;
  assert.throws(
    () => assertOrderPaymentEventActivationRuntimeCatalog(forceDrift),
    /table posture drifted/u,
  );
  const grantDrift = catalogSnapshot();
  grantDrift.functions[0].runtime_can_execute =
    !grantDrift.functions[0].runtime_can_execute;
  assert.throws(
    () => assertOrderPaymentEventActivationRuntimeCatalog(grantDrift),
    /runtime function drifted/u,
  );
  const surfaceDrift = catalogSnapshot();
  surfaceDrift.directFunctionCount += 1;
  assert.throws(
    () => assertOrderPaymentEventActivationRuntimeCatalog(surfaceDrift),
    /function surface is not exact/u,
  );
});

test("activation postflight is engine-read-only and does not require owner ledger access", () => {
  const source = fs.readFileSync(
    "scripts/order-payment-event-activation-production-postflight.mjs",
    "utf8",
  );
  assert.match(source, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
  assert.match(source, /CURRENT_USER AS current_user_name/u);
  assert.match(source, /SESSION_USER AS session_user_name/u);
  assert.doesNotMatch(source, /SET\s+(?:LOCAL\s+)?ROLE/iu);
  assert.doesNotMatch(source, /_prisma_migrations/u);
  assert.match(source, /direct select/u);
  assert.match(source, /direct insert/u);
  assert.match(source, /direct update/u);
  assert.match(source, /direct delete/u);
  assert.match(
    source,
    /\["direct select",[^\n]+"42501"\]/u,
  );
  for (const operation of ["insert", "update", "delete"]) {
    assert.match(
      source,
      new RegExp(`\\["direct ${operation}",[^\\n]+"25006"\\]`, "u"),
    );
  }
  assert.match(source, /grainline_seller_refund_claim/u);
  assert.match(source, /fixed writer read-only fence/u);
  assert.match(source, /"25006"/u);
  assert.match(source, /databaseUrlSha256/u);
  assert.doesNotMatch(
    source,
    /target:\s*Object\.freeze\(\{[\s\S]*databaseUrl,/u,
  );
  assert.match(source, /productionChangedByPostflight: false/u);
});

test("activation postflight disposable proof accepts only direct loopback runtime", () => {
  const runtime =
    "postgresql://grainline_app_runtime:secret@localhost:5432/grainline_ci?sslmode=disable";
  assert.deepEqual(parseOrderPaymentEventActivationPostflightProofConfig({
    ORDER_PAYMENT_EVENT_ACTIVATION_POSTFLIGHT_PROOF_DATABASE_URL: runtime,
  }), { databaseUrl: runtime });
  for (const invalid of [
    undefined,
    runtime.replace("localhost", "production.invalid"),
    runtime.replace("grainline_app_runtime", "ci"),
    runtime.replace("grainline_ci", "grainline"),
    runtime.replace("sslmode=disable", "sslmode=require"),
  ]) {
    assert.throws(
      () => parseOrderPaymentEventActivationPostflightProofConfig({
        ORDER_PAYMENT_EVENT_ACTIVATION_POSTFLIGHT_PROOF_DATABASE_URL: invalid,
      }),
    );
  }
});

test("CI runs the actual postflight helper after activation and before rollback", () => {
  const workflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
  const activation = workflow.indexOf(
    "Prove OrderPaymentEvent activation through separate logins",
  );
  const postflight = workflow.indexOf(
    "Prove OrderPaymentEvent activation postflight through the runtime login",
  );
  const rollback = workflow.indexOf(
    "Prove OrderPaymentEvent activation rollback and restoration",
  );
  assert.ok(activation >= 0 && postflight > activation && rollback > postflight);
  assert.match(
    workflow.slice(postflight, rollback),
    /ORDER_PAYMENT_EVENT_ACTIVATION_POSTFLIGHT_PROOF_DATABASE_URL/u,
  );
});
