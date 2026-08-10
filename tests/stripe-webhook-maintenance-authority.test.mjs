import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  legacyStockRestoreClaimFromRows,
  stripeWebhookHealthSummaryFromRows,
  stripeWebhookPruneCountFromRows,
} from "../src/lib/stripeWebhookMaintenanceState.ts";
import {
  parseStripeWebhookMaintenanceProofConfig,
} from "../scripts/stripe-webhook-maintenance-authority-postgres-proof.mjs";
import {
  STRIPE_WEBHOOK_MAINTENANCE_AUTHORITY_MIGRATION_SHA256,
  STRIPE_WEBHOOK_MAINTENANCE_AUTHORITY_PHASE,
  verifyStripeWebhookMaintenanceAuthority,
  verifyStripeWebhookMaintenanceAuthorityMigration,
} from "../scripts/verify-stripe-webhook-maintenance-authority.mjs";

const migration = fs.readFileSync(
  "prisma/migrations/20260805040000_prepare_stripe_webhook_maintenance_authority/migration.sql",
  "utf8",
);
const app = fs.readFileSync("src/lib/stripeWebhookMaintenance.ts", "utf8");
const proof = fs.readFileSync(
  "scripts/stripe-webhook-maintenance-authority-postgres-proof.mjs",
  "utf8",
);
const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
const production = fs.readFileSync(
  ".github/workflows/production-migrations.yml",
  "utf8",
);
const release = fs.readFileSync(
  "docs/stripe-webhook-maintenance-authority-release.md",
  "utf8",
);
const normalizedRelease = release.replace(/\s+/g, " ");

function sourceFiles(root = "src") {
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(?:mjs|ts|tsx)$/.test(entry.name)) files.push(file);
    }
  }
  walk(root);
  return files;
}

test("maintenance release pins an additive three-function migration", () => {
  const migrationResult = verifyStripeWebhookMaintenanceAuthorityMigration();
  const result = verifyStripeWebhookMaintenanceAuthority();
  assert.equal(
    migrationResult.migrationSha256,
    STRIPE_WEBHOOK_MAINTENANCE_AUTHORITY_MIGRATION_SHA256,
  );
  assert.equal(migrationResult.runtimeServiceFunctions, 3);
  assert.equal(result.phase, STRIPE_WEBHOOK_MAINTENANCE_AUTHORITY_PHASE);
  assert.equal(result.migrationSha256, STRIPE_WEBHOOK_MAINTENANCE_AUTHORITY_MIGRATION_SHA256);
  assert.equal(result.runtimeServiceFunctions, 3);
  assert.equal(result.rlsChanged, false);
  assert.equal(result.predecessorTableGrantsChanged, false);
  assert.equal(result.rowDataChanged, false);
  assert.equal((migration.match(/SECURITY DEFINER/g) ?? []).length, 3);
  assert.equal((migration.match(/SET search_path = pg_catalog/g) ?? []).length, 3);
  assert.doesNotMatch(migration, /pg_catalog\.(?:coalesce|nullif|greatest|least)/i);
  assert.doesNotMatch(migration, /(?:ENABLE|FORCE) ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /(?:GRANT|REVOKE)[\s\S]{0,80}ON TABLE/i);
});

test("maintenance functions derive fixed authority rather than caller targets", () => {
  assert.match(migration, /LEAST\(p_limit, 1000\)/);
  assert.match(migration, /interval '90 days'/);
  assert.match(migration, /event\.type <> 'checkout\.session\.stock_restored'/);
  assert.match(migration, /ORDER BY event\."processedAt" ASC, event\.id ASC/);
  assert.match(migration, /FOR UPDATE SKIP LOCKED/);
  assert.doesNotMatch(migration, /p_cutoff|p_event_id|p_event_type/);
  assert.match(migration, /interval '2 minutes'/);
  assert.match(migration, /canonical_event_id := 'checkout-stock-restore:' \|\| p_session_id/);
  assert.match(migration, /'checkout\.session\.stock_restored'/);
  assert.match(migration, /pg_advisory_xact_lock\(913337, pg_catalog\.hashtext\(p_session_id\)\)/);
  assert.match(migration, /\^cs_\(test_\|live_\)\?\[A-Za-z0-9\]\+\$/);
  assert.match(migration, /conflicts with an invalid event/);
});

test("application wrappers parse fail closed", () => {
  assert.equal(stripeWebhookPruneCountFromRows([{ deleted_count: "12" }]), 12);
  assert.throws(() => stripeWebhookPruneCountFromRows([]), /invalid row count/);
  assert.throws(() => stripeWebhookPruneCountFromRows([{ deleted_count: "1001" }]), /out-of-range/);
  assert.deepEqual(
    stripeWebhookHealthSummaryFromRows([{
      failed_count: "1",
      released_count: "2",
      stale_count: "1",
      issue_count: "3",
    }]),
    { failedCount: 1, releasedCount: 2, staleCount: 1, issueCount: 3 },
  );
  assert.throws(
    () => stripeWebhookHealthSummaryFromRows([{
      failed_count: "2",
      released_count: "0",
      stale_count: "0",
      issue_count: "1",
    }]),
    /inconsistent counts/,
  );
  assert.throws(
    () => stripeWebhookHealthSummaryFromRows([{
      failed_count: "1",
      released_count: "2",
      stale_count: "1",
      issue_count: "2",
    }]),
    /inconsistent counts/,
  );
  assert.throws(
    () => stripeWebhookHealthSummaryFromRows([{
      failed_count: "1",
      released_count: "2",
      stale_count: "1",
      issue_count: "5",
    }]),
    /inconsistent counts/,
  );
  assert.equal(legacyStockRestoreClaimFromRows([{ claimed: true }]), true);
  assert.throws(() => legacyStockRestoreClaimFromRows([{ claimed: "true" }]), /invalid result/);
  assert.match(app, /grainline_stripe_webhook_prune_batch/);
  assert.match(app, /grainline_stripe_webhook_health_summary/);
  assert.match(app, /grainline_legacy_stock_restore_claim/);
});

test("ordinary application source has zero direct StripeWebhookEvent table accesses", () => {
  const directAccess = /\b(?:prisma|tx|client)\.stripeWebhookEvent\b|(?:FROM|JOIN|UPDATE|INTO|TABLE|DELETE\s+FROM)\s+(?:public\.)?["`]StripeWebhookEvent["`]/i;
  const offenders = sourceFiles().filter((file) => (
    directAccess.test(fs.readFileSync(file, "utf8"))
  ));
  assert.deepEqual(offenders, []);
});

test("engine proof is loopback-only, rollback-only and covers lock races", () => {
  assert.throws(() => parseStripeWebhookMaintenanceProofConfig({}), /is required/);
  assert.throws(
    () => parseStripeWebhookMaintenanceProofConfig({
      STRIPE_WEBHOOK_MAINTENANCE_PROOF_DATABASE_URL:
        "postgresql://runtime:secret@production.example/grainline",
    }),
    /refuses a non-loopback database/,
  );
  assert.match(proof, /SET LOCAL TIME ZONE 'America\/Chicago'/);
  assert.match(proof, /oidvectortypes\(procedure\.proargtypes\)/);
  assert.match(proof, /competing claim did not wait for the advisory lock/);
  assert.match(proof, /5000/);
  assert.match(proof, /retainedLegacy/);
  assert.match(proof, /residue_count: 0/);
  assert.match(proof, /rolledBack: true/);
  assert.match(proof, /productionTouched: false/);
  assert.match(proof, /verifyStripeWebhookMaintenanceAuthorityMigration/);
  assert.doesNotMatch(proof, /verifyStripeWebhookMaintenanceAuthority\(\)/);
});

test("historical maintenance proof remains while workflows advance to activation", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(
    pkg.scripts["audit:rls-stripe-webhook-maintenance-authority"],
    "node scripts/verify-stripe-webhook-maintenance-authority.mjs",
  );
  assert.equal(
    pkg.scripts["audit:rls-stripe-webhook-maintenance-postgres"],
    "node --test tests/postgres-special-form-qualification.test.mjs && node scripts/stripe-webhook-maintenance-authority-postgres-proof.mjs",
  );
  assert.match(ci, /stripe-webhook-event-activation-reviewed/);
  assert.match(ci, /audit:rls-stripe-webhook-event-activation-release/);
  assert.match(ci, /audit:rls-stripe-webhook-maintenance-postgres/);
  assert.match(ci, /STRIPE_WEBHOOK_MAINTENANCE_PROOF_DATABASE_URL/);
  assert.match(production, /stripe-webhook-event-activation-reviewed/);
  assert.match(production, /audit:rls-stripe-webhook-event-activation-release/);
});

test("release applies additive authority before deploying its call sites", () => {
  const mergeIndex = normalizedRelease.indexOf(
    "merge PR #161, then merge this PR #162",
  );
  const migrationIndex = normalizedRelease.indexOf(
    "run the guarded Production Migrations workflow",
  );
  const deployIndex = normalizedRelease.indexOf(
    "deploy the exact compatible application",
  );
  assert.ok(mergeIndex >= 0, "reviewed merge boundary is absent");
  assert.ok(migrationIndex > mergeIndex, "migration does not follow merge");
  assert.ok(deployIndex > migrationIndex, "deployment precedes migration");
  assert.match(
    normalizedRelease,
    /apply only `20260805040000_prepare_stripe_webhook_maintenance_authority`/,
  );
});

test("release record preserves the synchronized Extra-High proof boundary", () => {
  assert.match(release, /78fb92546362d3744db924b312c27a7e915b279c/);
  assert.match(release, /31279844745/);
  assert.match(release, /4c2dc09a9f832d930b9ab6160e65a545258cfcf3/);
  assert.match(release, /31279623247/);
  assert.match(release, /2,805 passed and 7 skipped/);
  assert.match(release, /impossible aggregate health-count combinations/);
  assert.match(release, /nothing deployed/);
});

test("release record pins production preparation without claiming activation", () => {
  assert.match(release, /8abaa36fafd989604a06aa2fee9f1a215e5763b1/);
  assert.match(release, /423d3c1f670a2a4e84dc275eb2c6a4c20234a1f1/);
  assert.match(release, /31284293394/);
  assert.match(release, /31290691183/);
  assert.match(
    release,
    /applied only\s+`20260805040000_prepare_stripe_webhook_maintenance_authority`/,
  );
  assert.match(normalizedRelease, /StripeWebhookEvent RLS and table-grant revocation remain off/);
  assert.match(release, /dpl_67W8RkxzdQwbNTy3rmsEL6WK42D3/);
  assert.match(release, /fresh correctly signed classic snapshot event completed/);
  assert.match(release, /cron_run_already_claimed/);
  assert.match(release, /stripe-webhook-provider-topology-audit\.md/);
  assert.match(release, /classic Connect payout destination/);
  assert.match(release, /Signed delivery for every surface/);
  assert.match(release, /No invalid-signature request was generated/);
  assert.match(release, /stripe-webhook-subscriptions-compatible-production-20260808\.json/);
  assert.match(release, /missing 11 handled event types/);
  assert.match(release, /three\s+unused `v2\.core\.account_person\.\*` event types/);
  assert.match(release, /stripe-webhook-ops-health-compatible-production-20260809\.json/);
  assert.match(release, /all four Stripe aggregate counts/);
});
