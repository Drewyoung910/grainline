import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  REVIEWED_PRODUCTION_RUNTIME_IDENTITY,
} from "../scripts/guard-runtime-db-env.mjs";
import {
  SELLER_PAYOUT_EVENT_FORCE_POSTFLIGHT_CONFIRMATION,
  parseSellerPayoutEventActivationPostflightConfig,
  parseSellerPayoutEventPostflightMode,
  writeSellerPayoutEventActivationPostflightEvidence,
} from "../scripts/seller-payout-event-activation-production-postflight.mjs";

const RELEASE_COMMIT = "b".repeat(40);
const SYNTHETIC_RUNTIME_TARGET = "synthetic-force-runtime-target";

function environment(directory) {
  return {
    DATABASE_URL: SYNTHETIC_RUNTIME_TARGET,
    SELLER_PAYOUT_EVENT_FORCE_POSTFLIGHT_CONFIRM:
      SELLER_PAYOUT_EVENT_FORCE_POSTFLIGHT_CONFIRMATION,
    SELLER_PAYOUT_EVENT_FORCE_POSTFLIGHT_EVIDENCE_PATH: path.join(
      directory,
      `seller-payout-event-force-production-postflight-${RELEASE_COMMIT}.json`,
    ),
    SELLER_PAYOUT_EVENT_FORCE_POSTFLIGHT_MAIN_CI_RUN_ID: "32672008187",
    SELLER_PAYOUT_EVENT_FORCE_POSTFLIGHT_MIGRATION_RUN_ID: "32672434812",
    SELLER_PAYOUT_EVENT_FORCE_POSTFLIGHT_RELEASE_COMMIT: RELEASE_COMMIT,
  };
}

function parseForce(env) {
  return parseSellerPayoutEventActivationPostflightConfig(env, {
    assertRuntimeDatabaseIsolation: (input) => {
      assert.equal(input.DATABASE_URL, SYNTHETIC_RUNTIME_TARGET);
      assert.equal(input.VERCEL, "1");
      assert.equal(input.VERCEL_ENV, "production");
      return REVIEWED_PRODUCTION_RUNTIME_IDENTITY;
    },
    postForce: true,
  });
}

test("SellerPayoutEvent FORCE postflight has a distinct exact contract", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "seller-payout-force-postflight-"),
  );
  const parsed = parseForce(environment(directory));
  assert.equal(parsed.operation, "seller-payout-event-force-production-postflight");
  assert.equal(parsed.releaseCommit, RELEASE_COMMIT);
  assert.equal(parsed.rlsForced, true);
  assert.equal(parsed.mainCiRunId, 32672008187);
  assert.equal(parsed.migrationRunId, 32672434812);
  assert.equal(parsed.runtimeIdentity, REVIEWED_PRODUCTION_RUNTIME_IDENTITY);

  assert.throws(
    () => parseForce({
      ...environment(directory),
      SELLER_PAYOUT_EVENT_FORCE_POSTFLIGHT_CONFIRM:
        "verify-production-seller-payout-event-activation-runtime-read-only",
    }),
    /FORCE postflight confirmation is invalid/u,
  );
  assert.throws(
    () => parseForce({
      ...environment(directory),
      SELLER_PAYOUT_EVENT_FORCE_POSTFLIGHT_EVIDENCE_PATH: path.join(
        directory,
        `seller-payout-event-activation-production-postflight-${RELEASE_COMMIT}.json`,
      ),
    }),
    /FORCE evidence path is not fresh and exact/u,
  );
});

test("SellerPayoutEvent postflight modes are fail closed", () => {
  assert.equal(parseSellerPayoutEventPostflightMode([]), false);
  assert.equal(parseSellerPayoutEventPostflightMode(["--post-force"]), true);
  assert.throws(
    () => parseSellerPayoutEventPostflightMode(["--post-force", "extra"]),
    /Usage:/u,
  );
  assert.throws(
    () => parseSellerPayoutEventPostflightMode(["--unknown"]),
    /Usage:/u,
  );
});

test("SellerPayoutEvent FORCE evidence remains fresh, local and mode 0600", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "seller-payout-force-evidence-"),
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

test("SellerPayoutEvent FORCE postflight is engine-read-only and FORCE-exact", () => {
  const source = fs.readFileSync(
    "scripts/seller-payout-event-activation-production-postflight.mjs",
    "utf8",
  );
  assert.match(source, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
  assert.match(
    source,
    /proveSellerPayoutEventActivatedCatalog\([\s\S]*config\.rlsForced/u,
  );
  assert.match(source, /policyless_enable_force_table_posture/u);
  assert.match(source, /direct table read/u);
  assert.match(source, /fixed write read-only fence/u);
  assert.match(source, /"25006"/u);
  assert.doesNotMatch(source, /SET\s+(?:LOCAL\s+)?ROLE/iu);
  assert.match(source, /productionChangedByPostflight: false/u);

  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(
    pkg.scripts["ops:seller-payout-event-force-postflight"],
    "node scripts/seller-payout-event-activation-production-postflight.mjs --post-force",
  );
  assert.equal(
    pkg.scripts["audit:rls-seller-payout-event-force-postflight-postgres"],
    "node scripts/seller-payout-event-activation-postflight-postgres-proof.mjs --post-force",
  );
  const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(ci, /Apply SellerPayoutEvent FORCE hardening/u);
  assert.match(ci, /Prove FORCE-hardened SellerPayoutEvent authority/u);
  assert.match(
    ci,
    /Prove SellerPayoutEvent FORCE postflight through the actual runtime login/u,
  );
});

test("SellerPayoutEvent FORCE production records preserve the pending boundary", () => {
  const release = fs.readFileSync(
    "docs/seller-payout-event-force-release.md",
    "utf8",
  );
  const runbook = fs.readFileSync("docs/runbook.md", "utf8");
  const checklist = fs.readFileSync("docs/launch-checklist.md", "utf8");
  const architecture = fs.readFileSync("docs/architecture.md", "utf8");
  const matrix = fs.readFileSync("docs/rls-coverage-matrix.md", "utf8");
  const strategy = fs.readFileSync("STRATEGY.md", "utf8");
  const audit = fs.readFileSync("docs/security-audit-log.md", "utf8");

  for (const document of [release, runbook, architecture, matrix, strategy, audit]) {
    assert.match(document, /0eb360b9878698f45288ac3c1649871de9a8a33c/u);
    assert.match(document, /32672008187/u);
    assert.match(document, /32672434812/u);
  }
  for (const document of [release, runbook, checklist]) {
    assert.match(
      document,
      /SELLER_PAYOUT_EVENT_FORCE_POSTFLIGHT_CONFIRM=verify-production-seller-payout-event-force-runtime-read-only/u,
    );
    assert.match(document, /ops:seller-payout-event-force-postflight/u);
    assert.match(
      document,
      /seller-payout-event-force-production-postflight-/u,
    );
  }
  assert.match(matrix, /RLS_LIVE_FORCE_PENDING_POSTFLIGHT/u);
  assert.doesNotMatch(
    matrix,
    /`SellerPayoutEvent` \| `RLS_LIVE_FORCE`/u,
  );
  assert.match(release, /Phase-A postflight[\s\S]*not reusable/u);
  assert.match(audit, /final FORCE acceptance is withheld/u);
});
