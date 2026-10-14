import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sellerProfilePrivateMigrationPath } from "./helpers/seller-profile-private-migration-path.mjs";

const migration = readFileSync(
  sellerProfilePrivateMigrationPath("20261015010000_retire_seller_profile_private_predecessor"),
  "utf8",
);
const schema = readFileSync("prisma/schema.prisma", "utf8");
const grantAudit = readFileSync("scripts/audit-runtime-db-grants.mjs", "utf8");
const provisioning = readFileSync("scripts/provision-runtime-db-role.sql", "utf8");

const privateFields = Object.freeze([
  "stripeAccountId",
  "stripeAccountVersion",
  "stripeControllerType",
  "manualStripeReconciliationNeeded",
  "manualStripeReconciliationNote",
  "shipFromName",
  "shipFromLine1",
  "shipFromLine2",
  "shipFromCity",
  "shipFromState",
  "shipFromPostal",
  "shipFromCountry",
  "shipFromPhone",
  "defaultPkgWeightGrams",
  "defaultPkgLengthCm",
  "defaultPkgWidthCm",
  "defaultPkgHeightCm",
  "useCalculatedShipping",
  "preferredCarriers",
  "onboardingStep",
  "onboardingComplete",
  "guildMemberApprovedAt",
  "guildMasterApprovedAt",
  "guildMasterAppliedAt",
  "guildMasterReviewNotes",
  "consecutiveMetricFailures",
  "lastMetricCheckAt",
  "metricWarningSentAt",
  "listingsBelowThresholdSince",
  "profileViews",
]);

const rewrittenFunctions = Object.freeze([
  "grainline_seller_profile_deauthorize_compat",
  "grainline_seller_profile_reconciliation_required_compat",
  "grainline_seller_stripe_account_bind",
  "grainline_seller_stripe_charges_update",
  "grainline_seller_owner_onboarding_step_update",
  "grainline_seller_owner_onboarding_complete",
  "grainline_seller_owner_shop_settings_update",
  "grainline_seller_account_deletion_anonymize",
  "grainline_seller_guild_listing_threshold_sync",
  "grainline_seller_guild_member_revoke",
  "grainline_seller_guild_metrics_apply",
  "grainline_seller_guild_staff_transition",
  "grainline_seller_profile_view_record",
  "grainline_seller_account_deletion_reconciliation_clear",
  "grainline_seller_owner_guild_master_application_record",
]);

function model(name) {
  return schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`, "u"))?.[0] ?? "";
}

test("private fields exist only on SellerProfilePrivate", () => {
  const publicModel = model("SellerProfile");
  const privateModel = model("SellerProfilePrivate");
  assert.ok(publicModel);
  assert.ok(privateModel);
  for (const field of privateFields) {
    assert.doesNotMatch(publicModel, new RegExp(`\\b${field}\\b`, "u"));
    assert.match(privateModel, new RegExp(`\\b${field}\\b`, "u"));
    assert.match(migration, new RegExp(`DROP COLUMN "${field}"`, "u"));
  }
  assert.match(publicModel, /stripeAccountSupported\s+Boolean/u);
  assert.match(publicModel, /chargesEnabled\s+Boolean/u);
});

test("retirement is atomic, convergence-gated, and leaves RLS unchanged", () => {
  assert.match(migration, /^BEGIN;/mu);
  assert.match(migration, /LOCK TABLE public\."SellerProfile", public\."SellerProfilePrivate"[\s\S]*ACCESS EXCLUSIVE/u);
  assert.match(migration, /missing_private_count/u);
  assert.match(migration, /mismatch_count/u);
  assert.match(migration, /SellerProfile_stripeAccountSupported_check/u);
  assert.match(migration, /COMMIT;\s*$/u);
  assert.doesNotMatch(migration, /(?:ENABLE|FORCE) ROW LEVEL SECURITY/iu);
  assert.doesNotMatch(migration, /DISABLE ROW LEVEL SECURITY/iu);
});

test("all effective dual writers are replaced before predecessor columns drop", () => {
  const dropOffset = migration.indexOf('ALTER TABLE public."SellerProfile"');
  assert.ok(dropOffset > 0);
  for (const functionName of rewrittenFunctions) {
    const offset = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${functionName}(`);
    assert.ok(offset > 0, `${functionName} must be replaced`);
    assert.ok(offset < dropOffset, `${functionName} must be replaced before column removal`);
  }

  const replacementSection = migration.slice(
    migration.indexOf("CREATE OR REPLACE FUNCTION public.grainline_seller_profile_deauthorize_compat("),
    dropOffset,
  );
  for (const field of privateFields) {
    assert.doesNotMatch(
      replacementSection,
      new RegExp(`(?:seller|source_seller)\\."${field}"`, "u"),
    );
  }
});

test("new seller rows receive an isolated private companion", () => {
  assert.match(migration, /DROP TRIGGER "SellerProfile_private_mirror"/u);
  assert.match(migration, /DROP TRIGGER "SellerProfile_supported_snapshot"/u);
  assert.match(migration, /CREATE FUNCTION public\.grainline_seller_profile_private_initialize\(\)/u);
  assert.match(migration, /AFTER INSERT ON public\."SellerProfile"/u);
  assert.match(migration, /INSERT INTO public\."SellerProfilePrivate"[\s\S]*NEW\.id/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.grainline_seller_profile_private_initialize\(\)[\s\S]*FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime/u);
  assert.match(grantAudit, /"grainline_seller_profile_private_initialize"/u);
  assert.doesNotMatch(grantAudit, /"grainline_seller_profile_private_mirror"/u);
  assert.doesNotMatch(grantAudit, /"grainline_seller_profile_supported_snapshot"/u);
  assert.match(provisioning, /grainline_seller_profile_private_initialize/u);
});

test("retirement preserves the live app-authority corrections", () => {
  assert.match(migration, /OR p_operation IS NULL/u);
  assert.equal((migration.match(/audit_reason := pg_catalog\.left\(p_review_notes, 500\);/gu) ?? []).length, 2);
  assert.doesNotMatch(
    migration,
    /WHERE seller\."userId" = p_user_id\s+AND seller_private\."stripeAccountId" = p_stripe_account_id/u,
  );
  assert.match(
    migration,
    /Account deletion could not reject Stripe Connect account ' \|\| p_stripe_account_id/u,
  );
});
