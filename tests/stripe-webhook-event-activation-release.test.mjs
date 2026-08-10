import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  LEGACY_CLAIM_SESSION_ID,
  parseStripeWebhookEventActivationProofConfig,
} from "../scripts/stripe-webhook-event-activation-postgres-proof.mjs";
import {
  parseStripeWebhookEventRollbackProofConfig,
} from "../scripts/stripe-webhook-event-activation-rollback-proof.mjs";
import {
  buildStripeWebhookEventActivationCandidate,
  STRIPE_WEBHOOK_EVENT_ACTIVATION_DRAFT_SHA256,
} from "../scripts/stage-stripe-webhook-event-activation-migration.mjs";
import {
  STRIPE_WEBHOOK_EVENT_ACTIVATION_RELEASE_PHASE,
  verifyStripeWebhookEventActivationRelease,
} from "../scripts/verify-stripe-webhook-event-activation-release.mjs";

const migration = fs.readFileSync(
  "prisma/migrations/20260805060000_enable_stripe_webhook_event_rls/migration.sql",
  "utf8",
);
const maintenanceMigration = fs.readFileSync(
  "prisma/migrations/20260805040000_prepare_stripe_webhook_maintenance_authority/migration.sql",
  "utf8",
);
const rollback = fs.readFileSync(
  "docs/rls-drafts/stripe-webhook-event-activation-rollback.sql",
  "utf8",
);
const provision = fs.readFileSync("scripts/provision-runtime-db-role.sql", "utf8");
const audit = fs.readFileSync("scripts/audit-runtime-db-grants.mjs", "utf8");
const proof = fs.readFileSync(
  "scripts/stripe-webhook-event-activation-postgres-proof.mjs",
  "utf8",
);
const rollbackProof = fs.readFileSync(
  "scripts/stripe-webhook-event-activation-rollback-proof.mjs",
  "utf8",
);
const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
const production = fs.readFileSync(
  ".github/workflows/production-migrations.yml",
  "utf8",
);

test("release pins one policyless ENABLE activation with no row mutation", () => {
  const candidate = buildStripeWebhookEventActivationCandidate();
  const release = verifyStripeWebhookEventActivationRelease(undefined, {
    allowReviewedSuccessor: true,
  });
  assert.equal(release.phase, STRIPE_WEBHOOK_EVENT_ACTIVATION_RELEASE_PHASE);
  assert.equal(release.guard.sealedPrefix, true);
  assert.equal(
    release.guard.successorPhase,
    "stripe-webhook-event-force-reviewed",
  );
  assert.equal(release.draftSha256, STRIPE_WEBHOOK_EVENT_ACTIVATION_DRAFT_SHA256);
  assert.equal(release.migrationSha256, candidate.migrationSha256);
  assert.equal(release.protectedTables, 1);
  assert.equal(release.runtimeFunctions, 6);
  assert.equal(release.rlsEnabled, true);
  assert.equal(release.rlsForced, false);
  assert.equal(release.policyCount, 0);
  assert.equal(release.runtimeTablePrivileges, 0);
  assert.match(migration, /ALTER TABLE public\."StripeWebhookEvent" ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /ALTER TABLE public\."StripeWebhookEvent" NO FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\."StripeWebhookEvent"/);
  assert.doesNotMatch(migration, /\bCREATE\s+POLICY\b/i);
  assert.doesNotMatch(migration, /(?<!NO )\bFORCE\s+ROW\s+LEVEL\s+SECURITY\b/i);
  assert.doesNotMatch(migration, /^\s*(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE)\b/im);
  assert.doesNotMatch(migration, /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i);
});

test("activation preflight pins owner, role graph, table invariants and six functions", () => {
  assert.match(migration, /requires the table owner session/);
  assert.match(migration, /rolsuper OR migration_role\.rolbypassrls/);
  assert.match(migration, /runtime_role\.rolinherit/);
  assert.match(migration, /member\.rolname = 'neondb_owner'/);
  assert.match(migration, /grantor\.rolname = 'cloud_admin'/);
  assert.match(migration, /NOT membership\.inherit_option/);
  assert.match(migration, /NOT membership\.set_option/);
  assert.match(migration, /WITH RECURSIVE restricted_members/);
  assert.match(migration, /claim-generation invariant drifted/);
  assert.match(migration, /required index catalog drifted/);
  assert.match(migration, /activation found invalid rows/);
  assert.match(migration, /oidvectortypes\(procedure\.proargtypes\)/);
  assert.match(
    migration,
    /pg_catalog\.md5\(procedure\.prosrc\) = expected\.source_md5/,
  );
  assert.match(migration, /OR acl\.is_grantable/);
  assert.match(migration, /IF function_count <> 6/);
  assert.match(migration, /IF named_runtime_function_count <> 6/);
  assert.match(migration, /IF table_function_count <> 6/);
  assert.doesNotMatch(migration, /pg_catalog\.(?:coalesce|nullif|greatest|least)\b/i);
});

test("rollback is database-first, narrow, and restores compatible CRUD", () => {
  const disable = rollback.indexOf(
    `ALTER TABLE public."StripeWebhookEvent" DISABLE ROW LEVEL SECURITY`,
  );
  const grant = rollback.indexOf(
    `GRANT SELECT, INSERT, UPDATE, DELETE`,
  );
  assert.ok(disable >= 0);
  assert.ok(grant > disable);
  assert.match(rollback, /NO FORCE ROW LEVEL SECURITY/);
  assert.match(rollback, /predecessor drifted/);
  assert.match(rollback, /did not restore predecessor/);
  assert.match(rollback, /acl\.grantee = 0/);
  assert.match(rollback, /pg_catalog\.pg_attribute AS attribute/);
  assert.match(rollbackProof, /publicAuthorityDriftRejected: true/);
  assert.match(rollbackProof, /GRANT SELECT ON TABLE/);
  assert.match(rollbackProof, /GRANT SELECT \(id\) ON TABLE/);
  assert.doesNotMatch(rollback, /\bDROP\s+(?:TABLE|FUNCTION|COLUMN)\b/i);
  assert.doesNotMatch(rollback, /^\s*(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE)\b/im);
});

test("provisioning and global grant audit converge both exact states", () => {
  assert.match(provision, /StripeWebhookEvent RLS is partially or unexpectedly configured/);
  assert.match(provision, /clean_predecessor/);
  assert.match(provision, /stripe_webhook_event_rls_active/);
  assert.match(
    provision,
    /\\if :stripe_webhook_event_rls_active[\s\S]*REVOKE ALL ON TABLE public\."StripeWebhookEvent"/,
  );
  assert.match(audit, /stripeWebhookEventRlsActivationExpected/);
  assert.match(audit, /stripeWebhookEventRlsForceExpected/);
  assert.match(audit, /STRIPE_WEBHOOK_EVENT_TABLE/);
  assert.match(audit, /collectRuntimeFunctionGrantOptionIssues/);
});

test("engine proofs are loopback-only, rollback-safe, and cover the changed boundary", () => {
  assert.throws(() => parseStripeWebhookEventActivationProofConfig({}), /is required/);
  assert.throws(
    () => parseStripeWebhookEventActivationProofConfig({
      STRIPE_WEBHOOK_EVENT_ACTIVATION_PROOF_DATABASE_URL:
        "postgresql://runtime:secret@production.example/grainline",
    }),
    /refuses a non-loopback database/,
  );
  assert.throws(() => parseStripeWebhookEventRollbackProofConfig({}), /is required/);
  assert.match(
    LEGACY_CLAIM_SESSION_ID,
    /^cs_(?:test_|live_)?[A-Za-z0-9]+$/,
    "activation proof claim fixture must satisfy the fixed-function validator",
  );
  assert.match(
    maintenanceMigration,
    /p_session_id !~ '\^cs_\(test_\|live_\)\?\[A-Za-z0-9\]\+\$'/,
    "release must retain the canonical checkout-session validator proved above",
  );
  assert.doesNotMatch(proof, /cs_test_grainline_activation_proof/);
  assert.match(proof, /"42501"/);
  assert.match(proof, /direct_select/);
  assert.match(proof, /direct_insert/);
  assert.match(proof, /direct_update/);
  assert.match(proof, /direct_delete/);
  assert.match(proof, /acl\.is_grantable/);
  for (const functionName of [
    "grainline_stripe_webhook_begin",
    "grainline_stripe_webhook_complete",
    "grainline_stripe_webhook_fail",
    "grainline_stripe_webhook_prune_batch",
    "grainline_stripe_webhook_health_summary",
    "grainline_legacy_stock_restore_claim",
  ]) {
    assert.match(proof, new RegExp(functionName));
  }
  assert.match(proof, /rolledBack: true/);
  assert.match(proof, /productionTouched: false/);
  assert.match(rollbackProof, /finally \{/);
  assert.match(rollbackProof, /restoreActivation\(owner\)/);
  assert.match(rollbackProof, /predecessorCrudProven: true/);
  assert.match(rollbackProof, /activationRestored: true/);
});

test("CI stages compatibility first and proves activation before production can apply it", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(
    pkg.scripts["audit:rls-stripe-webhook-event-activation-release"],
    "node scripts/verify-stripe-webhook-event-activation-release.mjs",
  );
  assert.equal(
    pkg.scripts["audit:rls-stripe-webhook-event-activation-postgres"],
    "node --test tests/postgres-special-form-qualification.test.mjs && node scripts/stripe-webhook-event-activation-postgres-proof.mjs",
  );
  assert.equal(
    pkg.scripts["audit:rls-stripe-webhook-event-activation-rollback"],
    "node scripts/stripe-webhook-event-activation-rollback-proof.mjs",
  );
  assert.equal(
    pkg.scripts[
      "audit:rls-stripe-webhook-event-activation-postflight-postgres"
    ],
    "node scripts/stripe-webhook-event-activation-postflight-postgres-proof.mjs",
  );
  assert.equal(
    pkg.scripts["ops:stripe-webhook-event-activation-postflight"],
    "node scripts/stripe-webhook-event-activation-production-postflight.mjs",
  );
  const isolate = ci.indexOf("Isolate the exact StripeWebhookEvent activation");
  const compatibility = ci.indexOf("Apply compatible migrations to CI Postgres");
  const restore = ci.indexOf("Restore the exact StripeWebhookEvent activation");
  const activationProof = ci.indexOf("Prove policyless StripeWebhookEvent activation");
  const rollbackProofIndex = ci.indexOf("Prove StripeWebhookEvent database-first rollback");
  assert.ok(isolate >= 0 && isolate < compatibility);
  assert.ok(restore > compatibility && activationProof > restore);
  assert.ok(rollbackProofIndex > activationProof);
  assert.match(ci, /Enable disposable direct runtime login/);
  assert.match(ci, /activation postflight through the actual runtime login/);
  assert.match(
    ci,
    /STRIPE_WEBHOOK_EVENT_ACTIVATION_POSTFLIGHT_PROOF_DATABASE_URL: postgresql:\/\/grainline_app_runtime:/,
  );
  assert.match(ci, /stripe-webhook-event-force-reviewed/);
  assert.match(production, /stripe-webhook-event-force-reviewed/);
  assert.ok(
    production.indexOf("audit:rls-stripe-webhook-event-force-release")
      < production.indexOf("npx prisma migrate deploy"),
  );
});
