import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  REVIEWED_PRODUCTION_RUNTIME_IDENTITY,
} from "../scripts/guard-runtime-db-env.mjs";
import {
  ORDER_PAYMENT_EVENT_COMPATIBLE_POSTFLIGHT_CONFIRMATION,
  assertOrderPaymentEventCompatiblePostflightGitState,
  parseOrderPaymentEventCompatiblePostflightConfig,
  writeOrderPaymentEventCompatiblePostflightEvidence,
} from "../scripts/order-payment-event-compatible-production-postflight.mjs";
import {
  parseOrderPaymentEventCompatiblePostflightProofConfig,
} from "../scripts/order-payment-event-compatible-postflight-postgres-proof.mjs";

const RELEASE_COMMIT = "a".repeat(40);
const SYNTHETIC_RUNTIME_TARGET = "synthetic-runtime-target";

function environment(directory) {
  return {
    DATABASE_URL: SYNTHETIC_RUNTIME_TARGET,
    ORDER_PAYMENT_EVENT_COMPATIBLE_POSTFLIGHT_CONFIRM:
      ORDER_PAYMENT_EVENT_COMPATIBLE_POSTFLIGHT_CONFIRMATION,
    ORDER_PAYMENT_EVENT_COMPATIBLE_POSTFLIGHT_EVIDENCE_PATH: path.join(
      directory,
      `order-payment-event-compatible-production-postflight-${RELEASE_COMMIT}.json`,
    ),
    ORDER_PAYMENT_EVENT_COMPATIBLE_POSTFLIGHT_MAIN_CI_RUN_ID: "32792800761",
    ORDER_PAYMENT_EVENT_COMPATIBLE_POSTFLIGHT_MIGRATION_RUN_ID: "32793394895",
    ORDER_PAYMENT_EVENT_COMPATIBLE_POSTFLIGHT_RELEASE_COMMIT: RELEASE_COMMIT,
  };
}

function parseWithReviewedIdentity(env) {
  return parseOrderPaymentEventCompatiblePostflightConfig(env, {
    assertRuntimeDatabaseIsolation: (input) => {
      assert.equal(input.DATABASE_URL, SYNTHETIC_RUNTIME_TARGET);
      assert.equal(input.VERCEL, "1");
      assert.equal(input.VERCEL_ENV, "production");
      return REVIEWED_PRODUCTION_RUNTIME_IDENTITY;
    },
  });
}

test("payment compatible postflight accepts only the reviewed runtime contract", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "order-payment-compatible-postflight-"),
  );
  const parsed = parseWithReviewedIdentity(environment(directory));
  assert.equal(parsed.releaseCommit, RELEASE_COMMIT);
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
      OTHER_DATABASE_URL: "postgresql://synthetic.invalid/database",
    }),
    /aliased PostgreSQL URLs/u,
  );
  assert.throws(
    () => parseOrderPaymentEventCompatiblePostflightConfig(
      environment(directory),
      {
        assertRuntimeDatabaseIsolation: () => {
          throw new Error("runtime target is not the pooled reviewed identity");
        },
      },
    ),
    /not the pooled reviewed identity/u,
  );
});

test("payment compatible postflight binds exact clean source and evidence", () => {
  assert.deepEqual(
    assertOrderPaymentEventCompatiblePostflightGitState(
      { head: RELEASE_COMMIT, status: "" },
      RELEASE_COMMIT,
    ),
    { clean: true, head: RELEASE_COMMIT },
  );
  assert.throws(
    () => assertOrderPaymentEventCompatiblePostflightGitState(
      { head: RELEASE_COMMIT, status: "?? residue" },
      RELEASE_COMMIT,
    ),
    /exact clean release commit/u,
  );

  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "order-payment-compatible-evidence-"),
  );
  const pathname = path.join(directory, "evidence.json");
  writeOrderPaymentEventCompatiblePostflightEvidence(pathname, {
    status: "passed",
    productionChangedByPostflight: false,
  });
  assert.equal(fs.statSync(pathname).mode & 0o777, 0o600);
  assert.throws(
    () => writeOrderPaymentEventCompatiblePostflightEvidence(pathname, {}),
    /EEXIST/u,
  );
});

test("payment compatible postflight is actual-runtime and engine-read-only", () => {
  const source = fs.readFileSync(
    "scripts/order-payment-event-compatible-production-postflight.mjs",
    "utf8",
  );
  assert.match(source, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
  assert.match(source, /CURRENT_USER AS current_user_name/u);
  assert.match(source, /SESSION_USER AS session_user_name/u);
  assert.doesNotMatch(source, /SET\s+(?:LOCAL\s+)?ROLE/iu);
  assert.match(source, /orderPaymentEventPredecessorCrudRetained: true/u);
  assert.match(source, /orderRefundReconciliationRlsForced: true/u);
  assert.match(source, /private reconciliation table read/u);
  assert.match(source, /private refund-record core execute/u);
  assert.match(source, /fixed seller refund claim read-only lock fence/u);
  assert.match(source, /"25006"/u);
  assert.match(source, /databaseUrlSha256/u);
  assert.doesNotMatch(
    source,
    /target:\s*Object\.freeze\(\{[\s\S]*databaseUrl,/u,
  );
  assert.match(source, /productionChangedByPostflight: false/u);

  assert.throws(
    () => parseOrderPaymentEventCompatiblePostflightProofConfig({}),
    /is required/u,
  );
  assert.throws(
    () => parseOrderPaymentEventCompatiblePostflightProofConfig({
      ORDER_PAYMENT_EVENT_COMPATIBLE_POSTFLIGHT_PROOF_DATABASE_URL:
        "postgresql://runtime@production.invalid/grainline_ci",
    }),
    /refuses a non-loopback database/u,
  );
});
