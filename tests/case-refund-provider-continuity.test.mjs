import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildCaseRefundProviderContinuity,
  verifyCaseRefundProviderContinuityBytes,
} from "../scripts/build-case-refund-provider-continuity.mjs";

const migration = readFileSync(
  "prisma/migrations/20261002020000_correct_case_refund_provider_recovery_continuity/migration.sql",
  "utf8",
);
const authority = readFileSync(
  "src/lib/caseStaffResolutionAuthority.ts",
  "utf8",
);
const route = readFileSync(
  "src/app/api/cases/[id]/resolve/route.ts",
  "utf8",
);

test("Case refund continuity migration is generated from the sealed predecessor", () => {
  assert.equal(verifyCaseRefundProviderContinuityBytes(), true);
  assert.equal(buildCaseRefundProviderContinuity(), migration);
  assert.match(
    migration,
    /a010dd797a770fdbb1c821f3e09c3717c5b517de315723e33d34f1c493f2bf7f/u,
  );
  assert.match(
    migration,
    /19b554741fce36f911cbba1dc771af88756ef02213ec9424e3ed4c8311a1ddca/u,
  );
  assert.match(
    migration,
    /f2ff2bb23e2e0be1d35e6f4a0e91ae0575df10e7f7bcc844d50c1572a503f09d/u,
  );
});

test("recovered ambiguous outcomes use recovery authority and release delegation", () => {
  assert.match(
    authority,
    /prepared\.action === "recovered"[\s\S]*grainline_case_staff_resolution_provider_recovery_record/u,
  );
  assert.match(
    route,
    /prepared\.action === "recovery_required"[\s\S]*loadCaseStaffResolutionProviderRecovery[\s\S]*prepared\.status === "PROVIDER_PENDING"[\s\S]*prepared\.action !== "recovery_required"[\s\S]*recordAmbiguousCaseStaffResolutionProvider/u,
  );
  assert.match(
    migration,
    /p_provider_outcome IS NULL[\s\S]*p_provider_outcome NOT IN \('RECORDED', 'AMBIGUOUS'\)/u,
  );
  assert.match(
    migration,
    /p_provider_outcome = 'AMBIGUOUS'[\s\S]*"providerRecoveryActorId" = NULL[\s\S]*'RECOVER_CASE_RESOLUTION_PROVIDER_AMBIGUOUS'/u,
  );
});

test("recovery load returns its action and only replaces an inactive ADMIN", () => {
  assert.match(
    migration,
    /claim\."providerRecoveryActorId",[\s\S]*claim\."providerRecoveryAction",[\s\S]*'providerRecoveryAction', locked_claim\."providerRecoveryAction"/u,
  );
  assert.match(
    migration,
    /prior_actor\.role = 'ADMIN'[\s\S]*NOT prior_actor\.banned[\s\S]*prior_actor\."deletedAt" IS NULL[\s\S]*RAISE EXCEPTION 'Case provider-recovery claim is already delegated'/u,
  );
  assert.match(
    migration,
    /INTO prior_actor[\s\S]*WHERE actor\.id = locked_claim\."providerRecoveryActorId"[\s\S]*FOR SHARE/u,
  );
  assert.match(
    migration,
    /'REDELEGATE_CASE_RESOLUTION_PROVIDER_RECOVERY'[\s\S]*'priorRecoveryActorId'[\s\S]*'replacementRecoveryActorId'/u,
  );
});

test("successor changes no table grants or RLS policies", () => {
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/u);
  assert.doesNotMatch(migration, /CREATE POLICY|DROP POLICY|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/u);
  assert.doesNotMatch(migration, /GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON TABLE/iu);
  assert.doesNotMatch(migration, /ALTER TABLE/u);
});
