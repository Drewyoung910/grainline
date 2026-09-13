import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  REVIEWED_PRODUCTION_RUNTIME_IDENTITY,
} from "../scripts/guard-runtime-db-env.mjs";
import {
  SELLER_PAYOUT_EVENT_ACTIVATION_POSTFLIGHT_CONFIRMATION,
  assertSellerPayoutEventActivationPostflightGitState,
  parseSellerPayoutEventActivationPostflightConfig,
  writeSellerPayoutEventActivationPostflightEvidence,
} from "../scripts/seller-payout-event-activation-production-postflight.mjs";
import {
  parseSellerPayoutEventActivationPostflightProofConfig,
} from "../scripts/seller-payout-event-activation-postflight-postgres-proof.mjs";

const RELEASE_COMMIT = "a".repeat(40);
const SYNTHETIC_RUNTIME_TARGET = "synthetic-runtime-target";

function environment(directory) {
  return {
    DATABASE_URL: SYNTHETIC_RUNTIME_TARGET,
    SELLER_PAYOUT_EVENT_ACTIVATION_POSTFLIGHT_CONFIRM:
      SELLER_PAYOUT_EVENT_ACTIVATION_POSTFLIGHT_CONFIRMATION,
    SELLER_PAYOUT_EVENT_ACTIVATION_POSTFLIGHT_EVIDENCE_PATH: path.join(
      directory,
      `seller-payout-event-activation-production-postflight-${RELEASE_COMMIT}.json`,
    ),
    SELLER_PAYOUT_EVENT_ACTIVATION_POSTFLIGHT_MAIN_CI_RUN_ID:
      "32590297568",
    SELLER_PAYOUT_EVENT_ACTIVATION_POSTFLIGHT_MIGRATION_RUN_ID:
      "32590297569",
    SELLER_PAYOUT_EVENT_ACTIVATION_POSTFLIGHT_RELEASE_COMMIT:
      RELEASE_COMMIT,
  };
}

function parseWithReviewedIdentity(env) {
  return parseSellerPayoutEventActivationPostflightConfig(env, {
    assertRuntimeDatabaseIsolation: (input) => {
      assert.equal(input.DATABASE_URL, SYNTHETIC_RUNTIME_TARGET);
      assert.equal(input.VERCEL, "1");
      assert.equal(input.VERCEL_ENV, "production");
      return REVIEWED_PRODUCTION_RUNTIME_IDENTITY;
    },
  });
}

test("payout activation postflight accepts only the reviewed runtime contract", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "seller-payout-activation-postflight-"),
  );
  const parsed = parseWithReviewedIdentity(environment(directory));
  assert.equal(parsed.releaseCommit, RELEASE_COMMIT);
  assert.equal(parsed.operation, "seller-payout-event-activation-production-postflight");
  assert.equal(parsed.rlsForced, false);
  assert.equal(parsed.runtimeIdentity, REVIEWED_PRODUCTION_RUNTIME_IDENTITY);

  assert.throws(
    () => parseWithReviewedIdentity({
      ...environment(directory),
      DIRECT_URL: "synthetic-privileged-target",
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
    () => parseSellerPayoutEventActivationPostflightConfig(
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

test("payout activation postflight binds exact clean source and fresh evidence", () => {
  assert.deepEqual(
    assertSellerPayoutEventActivationPostflightGitState(
      { head: RELEASE_COMMIT, status: "" },
      RELEASE_COMMIT,
    ),
    { clean: true, head: RELEASE_COMMIT },
  );
  assert.throws(
    () => assertSellerPayoutEventActivationPostflightGitState(
      { head: RELEASE_COMMIT, status: "?? residue" },
      RELEASE_COMMIT,
    ),
    /exact clean release commit/u,
  );

  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "seller-payout-activation-evidence-"),
  );
  const pathname = path.join(directory, "evidence.json");
  writeSellerPayoutEventActivationPostflightEvidence(pathname, {
    status: "passed",
    productionChangedByPostflight: false,
  });
  assert.equal(fs.statSync(pathname).mode & 0o777, 0o600);
  assert.throws(
    () => writeSellerPayoutEventActivationPostflightEvidence(pathname, {}),
    /EEXIST/u,
  );
});

test("payout activation postflight is engine-read-only and exact-catalog", () => {
  const source = fs.readFileSync(
    "scripts/seller-payout-event-activation-production-postflight.mjs",
    "utf8",
  );
  assert.match(source, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
  assert.match(source, /CURRENT_USER AS current_user_name/u);
  assert.match(source, /SESSION_USER AS session_user_name/u);
  assert.doesNotMatch(source, /SET\s+(?:LOCAL\s+)?ROLE/iu);
  assert.match(source, /proveSellerPayoutEventActivatedCatalog/u);
  assert.match(source, /direct table read/u);
  assert.match(source, /grainline_seller_payout_latest_failure/u);
  assert.match(source, /grainline_seller_payout_export_page/u);
  assert.match(source, /grainline_seller_payout_event_apply/u);
  assert.match(source, /fixed write read-only fence/u);
  assert.match(source, /"25006"/u);
  assert.match(source, /databaseUrlSha256/u);
  assert.doesNotMatch(
    source,
    /target:\s*Object\.freeze\(\{[\s\S]*databaseUrl,/u,
  );
  assert.match(source, /productionChangedByPostflight: false/u);

  assert.throws(
    () => parseSellerPayoutEventActivationPostflightProofConfig({}),
    /is required/u,
  );
  assert.throws(
    () => parseSellerPayoutEventActivationPostflightProofConfig({
      SELLER_PAYOUT_EVENT_ACTIVATION_POSTFLIGHT_PROOF_DATABASE_URL:
        "postgresql://runtime@production.invalid/grainline_ci",
    }),
    /refuses a non-loopback database/u,
  );
});
