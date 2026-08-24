import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";
import { repositoryBeforeRefundReconciliation } from "./helpers/release-verifier-root.mjs";

import {
  parseSellerPayoutEventForceProofConfig,
} from "../scripts/seller-payout-event-force-postgres-proof.mjs";
import {
  parseSellerPayoutEventForceRollbackProofConfig,
} from "../scripts/seller-payout-event-force-rollback-proof.mjs";
import {
  SELLER_PAYOUT_EVENT_FORCE_DRAFT_SHA256,
  SELLER_PAYOUT_EVENT_FORCE_MIGRATION,
  SELLER_PAYOUT_EVENT_FORCE_MIGRATION_SHA256,
  SELLER_PAYOUT_EVENT_FORCE_ROLLBACK_SHA256,
  buildSellerPayoutEventForceCandidate,
} from "../scripts/stage-seller-payout-event-force-migration.mjs";
import {
  SELLER_PAYOUT_EVENT_FORCE_PHASE,
  verifySellerPayoutEventForceRelease,
} from "../scripts/verify-seller-payout-event-force-release.mjs";
const migration = fs.readFileSync(
  `prisma/migrations/${SELLER_PAYOUT_EVENT_FORCE_MIGRATION}/migration.sql`,
  "utf8",
);
const rollback = fs.readFileSync(
  "docs/rls-drafts/seller-payout-event-force-rollback.sql",
  "utf8",
);
const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
const production = fs.readFileSync(
  ".github/workflows/production-migrations.yml",
  "utf8",
);
const releaseDocument = fs.readFileSync(
  "docs/seller-payout-event-force-release.md",
  "utf8",
);

test("FORCE release is one exact posture-only catalog change", () => {
  const candidate = buildSellerPayoutEventForceCandidate();
  const release = verifySellerPayoutEventForceRelease(
    repositoryBeforeRefundReconciliation(), {
    allowReviewedRefundClaimSuccessor: true,
    allowReviewedRefundRecordSuccessor: true,
    allowReviewedSignedAuthoritySuccessor: true,
  });
  assert.equal(release.phase, SELLER_PAYOUT_EVENT_FORCE_PHASE);
  assert.equal(release.migration, SELLER_PAYOUT_EVENT_FORCE_MIGRATION);
  assert.equal(candidate.migrationSha256, SELLER_PAYOUT_EVENT_FORCE_MIGRATION_SHA256);
  assert.equal(release.draftSha256, SELLER_PAYOUT_EVENT_FORCE_DRAFT_SHA256);
  assert.equal(release.rollbackSha256, SELLER_PAYOUT_EVENT_FORCE_ROLLBACK_SHA256);
  assert.equal(release.runtimeFunctions, 3);
  assert.equal(release.rlsEnabled, true);
  assert.equal(release.rlsForced, true);
  assert.equal(release.policyCount, 0);
  assert.equal(release.runtimeTablePrivileges, 0);
  assert.equal(release.rowDataChanged, false);
  assert.equal(release.guard.phase, SELLER_PAYOUT_EVENT_FORCE_PHASE);
  assert.throws(
    () => verifySellerPayoutEventForceRelease(undefined, {
      allowReviewedRefundRecordSuccessor: true,
    }),
    /refund record successor requires the reviewed refund claim successor/i,
  );
  assert.equal(
    (migration.match(
      /^ALTER TABLE public\."SellerPayoutEvent" FORCE ROW LEVEL SECURITY;$/gmu,
    ) ?? []).length,
    1,
  );
  assert.doesNotMatch(migration, /\bNO\s+FORCE\b/iu);
  assert.doesNotMatch(migration, /\bCREATE\s+POLICY\b/iu);
  assert.doesNotMatch(migration, /^\s*(?:GRANT|REVOKE)\b/imu);
  assert.doesNotMatch(
    migration,
    /^\s*(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE)\b/imu,
  );
  assert.doesNotMatch(
    migration,
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/iu,
  );
});

test("activation verifier exposes only the exact FORCE successor mode", () => {
  const script = "scripts/verify-seller-payout-event-activation-release.mjs";
  const strict = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(strict.status, 1);
  assert.match(strict.stderr, /unreviewed successor/u);

  const forceOnly = spawnSync(
    process.execPath,
    [script, "--allow-reviewed-force-successor"],
    { encoding: "utf8" },
  );
  assert.equal(forceOnly.status, 1);
  assert.match(forceOnly.stderr, /unreviewed successor/u);

  const claimOnly = spawnSync(
    process.execPath,
    [script, "--allow-reviewed-refund-claim-successor"],
    { encoding: "utf8" },
  );
  assert.equal(claimOnly.status, 1);
  assert.match(claimOnly.stderr, /unreviewed successor/u);

  const sealed = spawnSync(
    process.execPath,
    [script, "--allow-reviewed-signed-authority-successor"],
    { encoding: "utf8" },
  );
  assert.equal(sealed.status, 1);
  assert.match(sealed.stderr, /unreviewed successor/u);

  const unknown = spawnSync(process.execPath, [script, "--allow-any-successor"], {
    encoding: "utf8",
  });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /usage:/u);
});

test("FORCE preflight pins Phase A, role graph and exact function authority", () => {
  assert.match(migration, /owner-session drain is incomplete/u);
  assert.match(migration, /runtime role retains unreviewed role membership/u);
  assert.match(migration, /member\.rolname = 'neondb_owner'/u);
  assert.match(migration, /grantor\.rolname = 'cloud_admin'/u);
  assert.match(migration, /NOT membership\.inherit_option/u);
  assert.match(migration, /NOT membership\.set_option/u);
  assert.match(migration, /WITH RECURSIVE restricted_members/u);
  assert.match(migration, /class\.relrowsecurity/u);
  assert.match(migration, /NOT class\.relforcerowsecurity/u);
  assert.match(migration, /accepted_function_count <> 3/u);
  assert.match(migration, /named_runtime_function_count <> 3/u);
  assert.match(migration, /table_function_count <> 3/u);
  assert.match(migration, /oidvectortypes\(procedure\.proargtypes\)/u);
  assert.match(migration, /pg_catalog\.md5\(procedure\.prosrc\)/u);
  assert.doesNotMatch(
    migration,
    /pg_catalog\.(?:coalesce|nullif|greatest|least)\b/iu,
  );
});

test("FORCE rollback restores only accepted Phase A and proof restores FORCE", () => {
  assert.match(
    rollback,
    /ALTER TABLE public\."SellerPayoutEvent" NO FORCE ROW LEVEL SECURITY/u,
  );
  assert.match(rollback, /rollback predecessor drifted/u);
  assert.match(rollback, /did not restore Phase A/u);
  assert.doesNotMatch(rollback, /\b(?:GRANT|REVOKE)\b/iu);
  assert.doesNotMatch(
    rollback,
    /\b(?:ENABLE|DISABLE)\s+ROW\s+LEVEL\s+SECURITY\b/iu,
  );
  const proof = fs.readFileSync(
    "scripts/seller-payout-event-force-rollback-proof.mjs",
    "utf8",
  );
  assert.match(proof, /finally \{/u);
  assert.match(proof, /FORCE ROW LEVEL SECURITY/u);
  assert.match(proof, /forceRestored: true/u);
});

test("disposable FORCE proofs reject remote or wrong-role URLs", () => {
  assert.throws(() => parseSellerPayoutEventForceProofConfig({}), /required/u);
  assert.throws(
    () => parseSellerPayoutEventForceProofConfig({
      SELLER_PAYOUT_EVENT_FORCE_PROOF_DATABASE_URL:
        "postgresql://grainline_app_runtime:secret@production.example/neondb",
    }),
    /non-loopback/u,
  );
  assert.throws(
    () => parseSellerPayoutEventForceProofConfig({
      SELLER_PAYOUT_EVENT_FORCE_PROOF_DATABASE_URL:
        "postgresql://ci:secret@localhost/grainline_ci",
    }),
    /grainline_app_runtime/u,
  );
  assert.throws(
    () => parseSellerPayoutEventForceRollbackProofConfig({
      SELLER_PAYOUT_EVENT_FORCE_ROLLBACK_PROOF_DATABASE_URL:
        "postgresql://ci:secret@production.example/grainline_ci",
    }),
    /non-loopback/u,
  );
  assert.throws(
    () => parseSellerPayoutEventForceRollbackProofConfig({
      SELLER_PAYOUT_EVENT_FORCE_ROLLBACK_PROOF_DATABASE_URL:
        "postgresql://grainline_app_runtime:secret@localhost/grainline_ci",
    }),
    /ci/u,
  );
});

test("CI proves FORCE after Phase A and production wiring preserves the order", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(
    pkg.scripts["audit:rls-seller-payout-event-force-release"],
    "node scripts/verify-seller-payout-event-force-release.mjs",
  );
  assert.equal(
    pkg.scripts["audit:rls-seller-payout-event-force-production-scope"],
    "node scripts/verify-seller-payout-event-force-production-scope.mjs",
  );
  const verifyForce = ci.indexOf("Verify SellerPayoutEvent FORCE migration tree");
  const isolateForce = ci.indexOf("Isolate SellerPayoutEvent FORCE until Phase A passes");
  const applyPhaseA = ci.indexOf("Apply SellerPayoutEvent policyless activation");
  const restoreForce = ci.indexOf("Restore SellerPayoutEvent FORCE release");
  const applyForce = ci.indexOf("Apply SellerPayoutEvent FORCE hardening");
  const forceProof = ci.indexOf("Prove FORCE-hardened SellerPayoutEvent authority");
  const rollbackProof = ci.indexOf("Prove SellerPayoutEvent FORCE rollback and restoration");
  assert.ok(verifyForce >= 0 && verifyForce < isolateForce);
  assert.ok(isolateForce < applyPhaseA);
  assert.ok(applyPhaseA < restoreForce && restoreForce < applyForce);
  assert.ok(applyForce < forceProof && forceProof < rollbackProof);
  assert.match(ci, /SAVED_SEARCH_RLS_DEPLOY_PHASE: seller-payout-event-force-reviewed/u);

  const productionVerify = production.indexOf(
    "Verify exact SellerPayoutEvent FORCE migration tree",
  );
  const productionIsolate = production.indexOf(
    "Isolate the reviewed SellerPayoutEvent FORCE release",
  );
  const productionRestore = production.indexOf(
    "Restore the reviewed SellerPayoutEvent FORCE release",
  );
  const productionRestart = production.indexOf(
    "Inspect exact SellerPayoutEvent FORCE restart scope read-only",
  );
  const productionApply = production.indexOf("Apply production migrations");
  const productionAfter = production.indexOf(
    "Prove exact SellerPayoutEvent FORCE production scope",
  );
  assert.ok(productionVerify >= 0 && productionVerify < productionIsolate);
  assert.ok(productionIsolate < productionRestore);
  assert.ok(productionRestore < productionRestart);
  assert.ok(productionRestart < productionApply && productionApply < productionAfter);
  assert.match(production, /SELLER_PAYOUT_EVENT_FORCE_SCOPE_STAGE: restart/u);
  assert.match(production, /SELLER_PAYOUT_EVENT_FORCE_SCOPE_STAGE: after/u);
  assert.match(
    releaseDocument,
    /Status: accepted production FORCE RLS/u,
  );
  assert.match(releaseDocument, /32672434812/u);
  assert.match(releaseDocument, /32675227286/u);
  assert.match(releaseDocument, /f2be83824cf4f8a9354ae72a5d9a12498ba1b7c24bf10f9b1c92636a3490228e/u);
  assert.match(releaseDocument, /Phase-A postflight[\s\S]*not reusable/u);
});
