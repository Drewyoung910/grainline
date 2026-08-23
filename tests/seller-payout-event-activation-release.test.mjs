import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  parseSellerPayoutEventActivationProofConfig,
} from "../scripts/seller-payout-event-activation-postgres-proof.mjs";
import {
  parseSellerPayoutEventActivationRollbackProofConfig,
} from "../scripts/seller-payout-event-activation-rollback-proof.mjs";
import {
  SELLER_PAYOUT_EVENT_ACTIVATION_DRAFT_SHA256,
  buildSellerPayoutEventActivationCandidate,
} from "../scripts/stage-seller-payout-event-activation-migration.mjs";
import {
  SELLER_PAYOUT_EVENT_ACTIVATION_RELEASE_PHASE,
  verifySellerPayoutEventActivationRelease,
} from "../scripts/verify-seller-payout-event-activation-release.mjs";
import {
  verifySellerPayoutEventAuthorityRelease,
} from "../scripts/verify-seller-payout-event-authority-release.mjs";

const migration = fs.readFileSync(
  "prisma/migrations/20260822180000_enable_seller_payout_event_rls/migration.sql",
  "utf8",
);
const rollback = fs.readFileSync(
  "docs/rls-drafts/seller-payout-event-activation-rollback.sql",
  "utf8",
);
const provision = fs.readFileSync(
  "scripts/provision-runtime-db-role.sql",
  "utf8",
);
const audit = fs.readFileSync("scripts/audit-runtime-db-grants.mjs", "utf8");
const proof = fs.readFileSync(
  "scripts/seller-payout-event-activation-postgres-proof.mjs",
  "utf8",
);
const productionPostflight = fs.readFileSync(
  "scripts/seller-payout-event-activation-production-postflight.mjs",
  "utf8",
);
const rollbackProof = fs.readFileSync(
  "scripts/seller-payout-event-activation-rollback-proof.mjs",
  "utf8",
);
const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
const production = fs.readFileSync(
  ".github/workflows/production-migrations.yml",
  "utf8",
);
const releaseDocument = fs.readFileSync(
  "docs/seller-payout-event-activation-release.md",
  "utf8",
);
const productionWiringDocument = fs.readFileSync(
  "docs/seller-payout-event-activation-production-wiring.md",
  "utf8",
);

test("release pins one policyless SellerPayoutEvent activation", () => {
  const candidate = buildSellerPayoutEventActivationCandidate();
  const release = verifySellerPayoutEventActivationRelease();
  assert.equal(release.phase, SELLER_PAYOUT_EVENT_ACTIVATION_RELEASE_PHASE);
  assert.equal(release.draftSha256, SELLER_PAYOUT_EVENT_ACTIVATION_DRAFT_SHA256);
  assert.equal(release.migrationSha256, candidate.migrationSha256);
  assert.equal(release.protectedTables, 1);
  assert.equal(release.runtimeFunctions, 3);
  assert.equal(release.rlsEnabled, true);
  assert.equal(release.rlsForced, false);
  assert.equal(release.policyCount, 0);
  assert.equal(release.runtimeTablePrivileges, 0);
  assert.equal(release.providerEventTimeNotNull, true);
  assert.equal(release.rowDataChanged, false);
  assert.equal(
    release.guard.phase,
    "seller-payout-event-activation-reviewed",
  );
  assert.match(
    migration,
    /ALTER TABLE public\."SellerPayoutEvent" ENABLE ROW LEVEL SECURITY/u,
  );
  assert.match(
    migration,
    /ALTER TABLE public\."SellerPayoutEvent" NO FORCE ROW LEVEL SECURITY/u,
  );
  assert.match(
    migration,
    /ALTER COLUMN "stripeEventCreatedSeconds" SET NOT NULL/u,
  );
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\."SellerPayoutEvent"/u,
  );
  assert.doesNotMatch(migration, /\bCREATE\s+POLICY\b/iu);
  assert.doesNotMatch(
    migration,
    /(?<!NO )\bFORCE\s+ROW\s+LEVEL\s+SECURITY\b/iu,
  );
  assert.doesNotMatch(
    migration,
    /^\s*(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE)\b/imu,
  );
  assert.doesNotMatch(
    migration,
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/iu,
  );
  assert.match(schema, /stripeEventCreatedSeconds\s+BigInt\s*$/mu);
  assert.doesNotMatch(schema, /stripeEventCreatedSeconds\s+BigInt\?/u);
});

test("activation preflight pins owner, role graph, invariants and functions", () => {
  assert.match(migration, /requires the table owner session/u);
  assert.match(migration, /rolsuper OR migration_role\.rolbypassrls/u);
  assert.match(migration, /runtime_role\.rolinherit/u);
  assert.match(migration, /member\.rolname = 'neondb_owner'/u);
  assert.match(migration, /grantor\.rolname = 'cloud_admin'/u);
  assert.match(migration, /NOT membership\.inherit_option/u);
  assert.match(migration, /NOT membership\.set_option/u);
  assert.match(migration, /WITH RECURSIVE restricted_members/u);
  assert.match(migration, /validated constraint catalog drifted/u);
  assert.match(migration, /required index catalog drifted/u);
  assert.match(migration, /activation found invalid rows/u);
  assert.match(migration, /oidvectortypes\(procedure\.proargtypes\)/u);
  assert.match(
    migration,
    /pg_catalog\.md5\(procedure\.prosrc\) = expected\.source_md5/u,
  );
  assert.match(migration, /invalid_table_acl_count/u);
  assert.match(migration, /acl\.grantee NOT IN \(/u);
  assert.match(migration, /OR acl\.is_grantable/u);
  assert.match(migration, /index_row\.indisunique AS is_unique/u);
  assert.match(migration, /index_row\.indisprimary AS is_primary/u);
  assert.match(migration, /index_row\.indisvalid AS is_valid/u);
  assert.match(migration, /actual\.key_columns = expected\.key_columns/u);
  assert.match(migration, /actual\.descending = expected\.descending/u);
  assert.match(migration, /IF function_count <> 3/u);
  assert.match(migration, /IF named_runtime_function_count <> 3/u);
  assert.match(migration, /IF table_function_count <> 3/u);
  assert.doesNotMatch(
    migration,
    /pg_catalog\.(?:coalesce|nullif|greatest|least)\b/iu,
  );
});

test("database-first rollback restores exact compatible posture", () => {
  const disable = rollback.indexOf(
    'ALTER TABLE public."SellerPayoutEvent" DISABLE ROW LEVEL SECURITY',
  );
  const nullable = rollback.indexOf(
    'ALTER COLUMN "stripeEventCreatedSeconds" DROP NOT NULL',
  );
  const grant = rollback.indexOf("GRANT SELECT, INSERT, UPDATE, DELETE");
  assert.ok(disable >= 0);
  assert.ok(nullable > disable);
  assert.ok(grant > nullable);
  assert.match(rollback, /NO FORCE ROW LEVEL SECURITY/u);
  assert.match(rollback, /rollback predecessor drifted/u);
  assert.match(rollback, /did not restore predecessor/u);
  assert.match(rollback, /acl\.grantee <> class\.relowner/u);
  assert.match(rollback, /acl\.grantee NOT IN \(/u);
  assert.match(rollback, /pg_catalog\.pg_attribute AS attribute/u);
  assert.doesNotMatch(rollback, /\bDROP\s+(?:TABLE|FUNCTION|COLUMN)\b/iu);
  assert.doesNotMatch(
    rollback,
    /^\s*(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE)\b/imu,
  );
  assert.match(rollbackProof, /publicAuthorityDriftRejected: true/u);
  assert.match(rollbackProof, /nullableCompatibilityRestored: true/u);
  assert.match(rollbackProof, /activationRestored: true/u);
});

test("provisioning and global audit converge the new policyless ledger", () => {
  assert.match(
    provision,
    /SellerPayoutEvent RLS is partially or unexpectedly configured/u,
  );
  assert.match(provision, /seller_payout_event_rls_active/u);
  assert.match(
    provision,
    /\\if :seller_payout_event_rls_active[\s\S]*REVOKE ALL ON TABLE public\."SellerPayoutEvent"/u,
  );
  assert.match(audit, /sellerPayoutEventRlsActivationExpected/u);
  assert.match(audit, /sellerPayoutEventRlsForceExpected/u);
  assert.match(audit, /SELLER_PAYOUT_EVENT_TABLE/u);
});

test("engine proofs require separate loopback owner and runtime logins", () => {
  assert.throws(
    () => parseSellerPayoutEventActivationProofConfig({}),
    /is required/u,
  );
  assert.throws(
    () => parseSellerPayoutEventActivationProofConfig({
      SELLER_PAYOUT_EVENT_ACTIVATION_PROOF_DATABASE_URL:
        "postgresql://ci:secret@production.example/grainline_ci",
    }),
    /refuses a non-loopback database/u,
  );
  assert.throws(
    () => parseSellerPayoutEventActivationRollbackProofConfig({}),
    /is required/u,
  );
  assert.match(proof, /SESSION_USER AS session_user/u);
  assert.match(proof, /owner_name, expectedOwner/u);
  assert.match(proof, /directTableOperationsDenied: 4/u);
  assert.match(proof, /unexpected_table_authority/u);
  assert.match(proof, /direct_column_acl/u);
  assert.match(proof, /"42501"/u);
  assert.match(proof, /"25006"/u);
  for (const functionName of [
    "grainline_seller_payout_event_apply",
    "grainline_seller_payout_latest_failure",
    "grainline_seller_payout_export_page",
  ]) {
    assert.match(proof, new RegExp(functionName, "u"));
  }
  assert.match(proof, /productionTouched: false/u);
  assert.match(rollbackProof, /directRuntimeLogin: true/u);
  assert.match(rollbackProof, /productionTouched: false/u);
});

test("compatible authority verifier accepts only the exact reviewed successor", () => {
  const result = verifySellerPayoutEventAuthorityRelease(process.cwd(), {
    allowReviewedActivationSuccessor: true,
  });
  assert.equal(result.runtimeFunctions, 3);
  assert.throws(
    () => verifySellerPayoutEventAuthorityRelease(),
    /unreviewed successor/u,
  );
});

test("CI proves the exact activation after its compatible authority", () => {
  const verifyActivation = ci.indexOf(
    "Verify SellerPayoutEvent activation migration tree",
  );
  const isolateActivation = ci.indexOf(
    "Isolate SellerPayoutEvent activation until authority proofs pass",
  );
  const applyAuthority = ci.indexOf(
    "Apply SellerPayoutEvent compatible authority",
  );
  const zeroDirectAccess = ci.indexOf(
    "Prove zero direct SellerPayoutEvent application access",
  );
  const restoreActivation = ci.indexOf(
    "Restore SellerPayoutEvent activation release",
  );
  const applyActivation = ci.indexOf(
    "Apply SellerPayoutEvent policyless activation",
  );
  const runtimeProof = ci.indexOf(
    "Prove SellerPayoutEvent policyless activation through separate logins",
  );
  const postflightProof = ci.indexOf(
    "Prove SellerPayoutEvent activation postflight through the actual runtime login",
  );
  const rollbackProof = ci.indexOf(
    "Prove SellerPayoutEvent database-first rollback and restoration",
  );
  assert.ok(verifyActivation >= 0);
  assert.ok(isolateActivation > verifyActivation);
  assert.ok(applyAuthority > isolateActivation);
  assert.ok(zeroDirectAccess > applyAuthority);
  assert.ok(restoreActivation > zeroDirectAccess);
  assert.ok(applyActivation > restoreActivation);
  assert.ok(runtimeProof > applyActivation);
  assert.ok(postflightProof > runtimeProof);
  assert.ok(rollbackProof > postflightProof);
  assert.match(
    ci,
    /SAVED_SEARCH_RLS_DEPLOY_PHASE: seller-payout-event-activation-reviewed/u,
  );
  assert.match(
    ci,
    /SELLER_PAYOUT_EVENT_ACTIVATION_PROOF_RUNTIME_DATABASE_URL:[\s\S]*grainline_app_runtime/u,
  );
  assert.match(
    ci,
    /SELLER_PAYOUT_EVENT_ACTIVATION_ROLLBACK_PROOF_RUNTIME_DATABASE_URL:[\s\S]*grainline_app_runtime/u,
  );
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(
    pkg.scripts[
      "audit:rls-seller-payout-event-activation-postflight-postgres"
    ],
    "node scripts/seller-payout-event-activation-postflight-postgres-proof.mjs",
  );
  assert.equal(
    pkg.scripts["ops:seller-payout-event-activation-postflight"],
    "node scripts/seller-payout-event-activation-production-postflight.mjs",
  );
});

test("guarded production wiring isolates predecessors and proves restart scope", () => {
  const verifyActivation = production.indexOf(
    "Verify exact SellerPayoutEvent activation migration tree",
  );
  const verifyRelease = production.indexOf(
    "Verify exact SellerPayoutEvent activation release",
  );
  const isolateActivation = production.indexOf(
    "Isolate the reviewed SellerPayoutEvent activation release",
  );
  const verifyAuthority = production.indexOf(
    "Verify sealed SellerPayoutEvent authority predecessor",
  );
  const isolateAuthority = production.indexOf(
    "Isolate the reviewed SellerPayoutEvent authority predecessor",
  );
  const verifyReservationForce = production.indexOf(
    "Verify exact CheckoutStockReservation FORCE migration tree",
  );
  const isolateReservationForce = production.indexOf(
    "Isolate the reviewed CheckoutStockReservation FORCE release",
  );
  const restoreReservationForce = production.indexOf(
    "Restore the reviewed CheckoutStockReservation FORCE release",
  );
  const restoreAuthority = production.indexOf(
    "Restore the reviewed SellerPayoutEvent authority predecessor",
  );
  const restoreActivation = production.indexOf(
    "Restore the reviewed SellerPayoutEvent activation release",
  );
  const restartScope = production.indexOf(
    "Inspect exact SellerPayoutEvent activation restart scope read-only",
  );
  const apply = production.indexOf("Apply production migrations");
  const converge = production.indexOf(
    "Converge exact activated SellerPayoutEvent runtime grants",
  );
  const audit = production.indexOf(
    "Audit final runtime grants and RLS catalog",
  );
  const afterScope = production.indexOf(
    "Prove exact SellerPayoutEvent activation production scope",
  );

  assert.ok(verifyActivation >= 0 && verifyActivation < verifyRelease);
  assert.ok(verifyRelease < isolateActivation);
  assert.ok(isolateActivation < verifyAuthority);
  assert.ok(verifyAuthority < isolateAuthority);
  assert.ok(isolateAuthority < verifyReservationForce);
  assert.ok(verifyReservationForce < isolateReservationForce);
  assert.ok(isolateReservationForce < restoreReservationForce);
  assert.ok(restoreReservationForce < restoreAuthority);
  assert.ok(restoreAuthority < restoreActivation);
  assert.ok(restoreActivation < restartScope);
  assert.ok(restartScope < apply && apply < converge);
  assert.ok(converge < audit && audit < afterScope);
  assert.match(
    production,
    /SAVED_SEARCH_RLS_DEPLOY_PHASE: seller-payout-event-activation-reviewed/u,
  );
  assert.match(
    production,
    /20260822180000_enable_seller_payout_event_rls/u,
  );
  assert.match(
    production,
    /SELLER_PAYOUT_EVENT_ACTIVATION_SCOPE_STAGE: restart/u,
  );
  assert.match(
    production,
    /SELLER_PAYOUT_EVENT_ACTIVATION_SCOPE_STAGE: after/u,
  );
});

test("release record preserves the accepted policyless Phase-A boundary", () => {
  const normalized = releaseDocument.replace(/\s+/gu, " ");
  assert.match(normalized, /accepted production policyless Phase A/u);
  assert.match(normalized, /32667518275/u);
  assert.match(
    normalized,
    /01235ef9a0922d1d1b8feb17e53bf9bbf47589ef23c927a9e5e65312cebb27de/u,
  );
  assert.match(normalized, /exactly zero policies/u);
  assert.match(
    normalized,
    /zero direct runtime\/PUBLIC table or column authority/u,
  );
  assert.match(normalized, /FORCE is deliberately absent/u);
  assert.match(
    normalized,
    /corrected production order merged at exact main/u,
  );
  assert.match(normalized, /32659750056/u);
  assert.match(normalized, /OrderPaymentEvent/u);
  assert.match(normalized, /OrderShippingRateQuote/u);
  assert.match(normalized, /OrderItem/u);
  assert.match(normalized, /actual runtime login without `SET ROLE`/u);
  assert.match(normalized, /SQLSTATE `25006`/u);
  assert.match(normalized, /productionChangedByPostflight=false/u);
  assert.match(
    productionPostflight,
    /proveSellerPayoutEventActivatedCatalog\(client, MIGRATION_ROLE\)/u,
  );
  assert.match(
    productionPostflight,
    /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u,
  );
  const normalizedWiring = productionWiringDocument.replace(/\s+/gu, " ");
  assert.match(
    normalizedWiring,
    /accepted production Phase A/u,
  );
  assert.match(
    normalizedWiring,
    /`restart` stage accepts exactly two complete states/u,
  );
  assert.match(normalizedWiring, /SellerPayoutEvent activation restored last/u);
  assert.match(normalizedWiring, /32659750056/u);
  assert.match(normalizedWiring, /No workflow input selects a migration/u);
  assert.match(normalizedWiring, /FORCE remains a later, posture-only migration/u);
});
