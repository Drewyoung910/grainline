import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  REVIEWED_PRODUCTION_RUNTIME_IDENTITY,
} from "../scripts/guard-runtime-db-env.mjs";
import {
  ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_POSTFLIGHT_CONFIRMATION,
  assertOrderPaymentSignedRefundIdentityPostflightGitState,
  parseOrderPaymentSignedRefundIdentityPostflightConfig,
  writeOrderPaymentSignedRefundIdentityPostflightEvidence,
} from "../scripts/order-payment-signed-refund-identity-production-postflight.mjs";

const RELEASE_COMMIT = "f".repeat(40);
const SYNTHETIC_RUNTIME_TARGET = "synthetic-runtime-target";

function tempDirectory() {
  return fs.mkdtempSync(
    path.join(os.tmpdir(), "signed-refund-identity-postflight-"),
  );
}

function environment(directory, overrides = {}) {
  return {
    DATABASE_URL: SYNTHETIC_RUNTIME_TARGET,
    ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_POSTFLIGHT_CONFIRM:
      ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_POSTFLIGHT_CONFIRMATION,
    ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_POSTFLIGHT_EVIDENCE_PATH: path.join(
      directory,
      `order-payment-signed-refund-identity-production-postflight-${RELEASE_COMMIT}.json`,
    ),
    ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_POSTFLIGHT_MAIN_CI_RUN_ID:
      "33150000001",
    ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_POSTFLIGHT_MIGRATION_RUN_ID:
      "33150000002",
    ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_POSTFLIGHT_RELEASE_COMMIT:
      RELEASE_COMMIT,
    ...overrides,
  };
}

function parseWithReviewedIdentity(env) {
  return parseOrderPaymentSignedRefundIdentityPostflightConfig(env, {
    assertRuntimeDatabaseIsolation: (input) => {
      assert.equal(input.DATABASE_URL, SYNTHETIC_RUNTIME_TARGET);
      assert.equal(input.VERCEL, "1");
      assert.equal(input.VERCEL_ENV, "production");
      return REVIEWED_PRODUCTION_RUNTIME_IDENTITY;
    },
  });
}

test("signed-refund postflight accepts only exact pooled-runtime bindings", () => {
  const directory = tempDirectory();
  try {
    const parsed = parseWithReviewedIdentity(environment(directory));
    assert.equal(parsed.releaseCommit, RELEASE_COMMIT);
    assert.equal(parsed.runtimeIdentity, REVIEWED_PRODUCTION_RUNTIME_IDENTITY);
    assert.equal(parsed.mainCiRunId, 33150000001);
    assert.equal(parsed.migrationRunId, 33150000002);

    for (const drift of [
      { ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_POSTFLIGHT_CONFIRM: "yes" },
      { ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_POSTFLIGHT_RELEASE_COMMIT: "short" },
      { ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_POSTFLIGHT_MAIN_CI_RUN_ID: "0" },
      { ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_POSTFLIGHT_MIGRATION_RUN_ID: "bad" },
      { DIRECT_URL: "synthetic-owner-target" },
      { OTHER_DATABASE_URL: "postgresql://synthetic.invalid/database" },
      { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
      { PGOPTIONS: "-c row_security=off" },
      { ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_POSTFLIGHT_EVIDENCE_PATH: "/tmp/wrong.json" },
    ]) {
      assert.throws(() => parseWithReviewedIdentity({
        ...environment(directory),
        ...drift,
      }));
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("signed-refund postflight binds exact clean source and fresh 0600 evidence", () => {
  assert.deepEqual(
    assertOrderPaymentSignedRefundIdentityPostflightGitState(
      { head: RELEASE_COMMIT, status: "" },
      RELEASE_COMMIT,
    ),
    { clean: true, head: RELEASE_COMMIT },
  );
  assert.throws(() =>
    assertOrderPaymentSignedRefundIdentityPostflightGitState(
      { head: RELEASE_COMMIT, status: "?? residue" },
      RELEASE_COMMIT,
    )
  );

  const directory = tempDirectory();
  try {
    const pathname = path.join(directory, "evidence.json");
    writeOrderPaymentSignedRefundIdentityPostflightEvidence(pathname, {
      status: "passed",
      productionChangedByPostflight: false,
    });
    assert.equal(fs.statSync(pathname).mode & 0o777, 0o600);
    assert.throws(() =>
      writeOrderPaymentSignedRefundIdentityPostflightEvidence(pathname, {})
    , { code: "EEXIST" });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("signed-refund postflight is actual-runtime, exact-catalog, and read-only", () => {
  const source = fs.readFileSync(
    "scripts/order-payment-signed-refund-identity-production-postflight.mjs",
    "utf8",
  );
  assert.match(source, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
  assert.match(source, /transaction_read_only/u);
  assert.match(source, /CURRENT_USER AS current_user_name/u);
  assert.match(source, /SESSION_USER AS session_user_name/u);
  assert.doesNotMatch(source, /SET\s+(?:LOCAL\s+)?ROLE/iu);
  assert.match(source, /oidvectortypes\(procedure\.proargtypes\)/u);
  assert.match(source, /orderPaymentSignedRefundIdentityFunctionSource/u);
  assert.match(
    source,
    /runtime_privileges: \["DELETE", "INSERT", "SELECT", "UPDATE"\]/u,
  );
  assert.match(source, /signed-refund fixed function read-only lock fence/u);
  assert.match(source, /"25006"/u);
  assert.match(source, /databaseUrlSha256/u);
  assert.doesNotMatch(
    source,
    /target:\s*Object\.freeze\(\{[\s\S]*databaseUrl,/u,
  );
  assert.match(source, /productionChangedByPostflight: false/u);

  const postgresProof = fs.readFileSync(
    "scripts/order-payment-signed-refund-identity-postgres-proof.mjs",
    "utf8",
  );
  assert.match(postgresProof, /proveProductionPostflightContract\(runtime\)/u);
  assert.match(postgresProof, /productionPostflightReadOnly: true/u);

  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(
    packageJson.scripts?.[
      "ops:order-payment-signed-refund-identity-postflight"
    ],
    "node scripts/order-payment-signed-refund-identity-production-postflight.mjs",
  );
});
