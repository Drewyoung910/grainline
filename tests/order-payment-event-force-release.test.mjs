import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  parseOrderPaymentEventActivationProofConfig,
} from "../scripts/order-payment-event-activation-postgres-proof.mjs";
import {
  ORDER_PAYMENT_EVENT_FORCE_DRAFT_SHA256,
  ORDER_PAYMENT_EVENT_FORCE_MIGRATION,
  ORDER_PAYMENT_EVENT_FORCE_MIGRATION_SHA256,
  ORDER_PAYMENT_EVENT_FORCE_ROLLBACK_SHA256,
  buildOrderPaymentEventForceCandidate,
} from "../scripts/stage-order-payment-event-force-migration.mjs";
import {
  ORDER_PAYMENT_EVENT_FORCE_PHASE,
  verifyOrderPaymentEventForceRelease,
} from "../scripts/verify-order-payment-event-force-release.mjs";

const migration = fs.readFileSync(
  `prisma/migrations/${ORDER_PAYMENT_EVENT_FORCE_MIGRATION}/migration.sql`,
  "utf8",
);
const rollback = fs.readFileSync(
  "docs/rls-drafts/order-payment-event-force-rollback.sql",
  "utf8",
);

test("FORCE release is one exact posture-only successor", () => {
  const candidate = buildOrderPaymentEventForceCandidate();
  assert.throws(
    () => verifyOrderPaymentEventForceRelease(),
    /latest migration|review/u,
  );
  const release = verifyOrderPaymentEventForceRelease(process.cwd(), {
    allowReviewedOrderParticipantListSuccessor: true,
  });
  assert.equal(release.phase, ORDER_PAYMENT_EVENT_FORCE_PHASE);
  assert.equal(release.migration, ORDER_PAYMENT_EVENT_FORCE_MIGRATION);
  assert.equal(candidate.migrationSha256, ORDER_PAYMENT_EVENT_FORCE_MIGRATION_SHA256);
  assert.equal(release.draftSha256, ORDER_PAYMENT_EVENT_FORCE_DRAFT_SHA256);
  assert.equal(release.rollbackSha256, ORDER_PAYMENT_EVENT_FORCE_ROLLBACK_SHA256);
  assert.equal(release.runtimeFunctions, 16);
  assert.equal(release.privateFunctions, 13);
  assert.equal(release.directReferenceFunctions, 25);
  assert.equal(release.rlsEnabled, true);
  assert.equal(release.rlsForced, true);
  assert.equal(release.policyCount, 0);
  assert.equal(release.runtimeTablePrivileges, 0);
  assert.equal(release.rowDataChanged, false);
  assert.equal(release.guard.phase, ORDER_PAYMENT_EVENT_FORCE_PHASE);
  assert.equal(
    (migration.match(
      /^ALTER TABLE public\."OrderPaymentEvent" FORCE ROW LEVEL SECURITY;$/gmu,
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

test("FORCE preflight pins the complete accepted Phase-A boundary", () => {
  assert.match(migration, /owner-session drain is incomplete/u);
  assert.match(migration, /runtime role retains unreviewed role membership/u);
  assert.match(migration, /member\.rolname = 'neondb_owner'/u);
  assert.match(migration, /grantor\.rolname = 'cloud_admin'/u);
  assert.match(migration, /NOT membership\.inherit_option/u);
  assert.match(migration, /NOT membership\.set_option/u);
  assert.match(migration, /WITH RECURSIVE restricted_members/u);
  assert.match(migration, /validated_constraint_count <> 6/u);
  assert.match(migration, /required_index_count <> 7/u);
  assert.match(migration, /required_trigger_count <> 7/u);
  assert.match(migration, /order_trigger_count <> 4/u);
  assert.match(migration, /function_count <> 29/u);
  assert.match(migration, /named_function_count <> 29/u);
  assert.match(migration, /direct_function_count <> 25/u);
  assert.match(migration, /reviewed_direct_function_count <> 25/u);
  assert.match(migration, /pg_catalog\.md5\(prosrc\)/u);
  assert.doesNotMatch(
    migration,
    /pg_catalog\.(?:coalesce|nullif|greatest|least)\b/iu,
  );
});

test("FORCE rollback changes only FORCE and refuses privilege drift", () => {
  assert.match(
    rollback,
    /ALTER TABLE public\."OrderPaymentEvent" NO FORCE ROW LEVEL SECURITY/u,
  );
  assert.match(rollback, /rollback predecessor drifted/u);
  assert.match(rollback, /did not restore Phase A/u);
  assert.match(
    rollback,
    /current_user = 'ci'[\s\S]*current_database\(\) = 'grainline_ci'/u,
  );
  assert.match(rollback, /acl\.grantee <> class\.relowner/u);
  assert.doesNotMatch(rollback, /^\s*(?:GRANT|REVOKE)\b/imu);
  assert.doesNotMatch(
    rollback,
    /\b(?:ENABLE|DISABLE)\s+ROW\s+LEVEL\s+SECURITY\b/iu,
  );
});

test("disposable FORCE proofs reject missing and remote database URLs", () => {
  assert.throws(() => parseOrderPaymentEventActivationProofConfig({}), /required/u);
  assert.throws(
    () => parseOrderPaymentEventActivationProofConfig({
      ORDER_PAYMENT_EVENT_ACTIVATION_PROOF_DATABASE_URL:
        "postgresql://ci:fixture@production.invalid/grainline_ci",
      ORDER_PAYMENT_EVENT_ACTIVATION_PROOF_RUNTIME_DATABASE_URL:
        "postgresql://grainline_app_runtime:fixture@production.invalid/grainline_ci",
    }),
    /non-loopback/u,
  );
});
