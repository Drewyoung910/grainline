import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  parseSellerProfilePrivateBoundaryProofConfig,
  qualifySellerProfilePrivateBoundaryMigration,
} from "../scripts/seller-profile-private-boundary-postgres-proof.mjs";
import { sellerProfilePrivateMigrationPath } from "./helpers/seller-profile-private-migration-path.mjs";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migrationIsolation = process.env.SELLER_PROFILE_PRIVATE_BOUNDARY_MIGRATION_ISOLATED;
assert.ok(
  migrationIsolation === undefined || migrationIsolation === "true",
  "SellerProfile private-boundary migration isolation must be absent or exactly true",
);
const migrationIsolated = migrationIsolation === "true";
const isolatedMigrationPath = process.env.SELLER_PROFILE_PRIVATE_BOUNDARY_MIGRATION_PATH;
assert.equal(
  migrationIsolated,
  typeof isolatedMigrationPath === "string" && isolatedMigrationPath.length > 0,
  "SellerProfile private-boundary isolation and held migration path must be set together",
);
const migration = readFileSync(
  migrationIsolated
    ? isolatedMigrationPath
    : "prisma/migrations/20261013120000_prepare_seller_profile_private_boundary/migration.sql",
  "utf8",
);
const supportedCallerMigration = readFileSync(
  sellerProfilePrivateMigrationPath(
    "20261013130000_move_seller_supported_snapshot_sql_callers",
  ),
  "utf8",
);
const checkoutCallerMigration = readFileSync(
  sellerProfilePrivateMigrationPath(
    "20261013140000_move_checkout_seller_private_sql_callers",
  ),
  "utf8",
);
const customOrderCallerMigration = readFileSync(
  sellerProfilePrivateMigrationPath(
    "20261013150000_move_custom_order_seller_private_sql_callers",
  ),
  "utf8",
);
const caseGuildCallerMigration = readFileSync(
  sellerProfilePrivateMigrationPath(
    "20261013160000_move_case_guild_seller_private_sql_caller",
  ),
  "utf8",
);
const orderLabelCallerMigration = readFileSync(
  sellerProfilePrivateMigrationPath(
    "20261013170000_move_order_label_seller_private_sql_caller",
  ),
  "utf8",
);
const providerIdentityCallerMigration = readFileSync(
  sellerProfilePrivateMigrationPath(
    "20261013180000_move_provider_identity_seller_private_sql_callers",
  ),
  "utf8",
);
const reconciliationCallerMigration = readFileSync(
  sellerProfilePrivateMigrationPath(
    "20261013190000_move_reconciliation_seller_private_sql_callers",
  ),
  "utf8",
);
const reconciliationTargetCorrectionMigration = readFileSync(
  sellerProfilePrivateMigrationPath(
    "20261014010000_tolerate_missing_seller_reconciliation_target",
  ),
  "utf8",
);
const finalCallerMigration = readFileSync(
  sellerProfilePrivateMigrationPath(
    "20261013200000_move_final_seller_private_sql_callers",
  ),
  "utf8",
);
const accountDeletionCallerMigration = readFileSync(
  sellerProfilePrivateMigrationPath(
    "20261013210000_move_account_deletion_seller_private_sql_callers",
  ),
  "utf8",
);
const grantAudit = readFileSync("scripts/audit-runtime-db-grants.mjs", "utf8");
const provisioning = readFileSync("scripts/provision-runtime-db-role.sql", "utf8");
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const proof = readFileSync(
  "scripts/seller-profile-private-boundary-postgres-proof.mjs",
  "utf8",
);
const zeroDirectProof = readFileSync(
  "scripts/order-zero-direct-release-scope-postgres-proof.mjs",
  "utf8",
);
const zeroDirectStructureProof = readFileSync(
  "scripts/order-zero-direct-release-structure-postgres-proof.mjs",
  "utf8",
);
const zeroDirectScope = readFileSync(
  "scripts/order-zero-direct-release-scope.mjs",
  "utf8",
);
const zeroDirectAuthority = readFileSync(
  "scripts/order-zero-direct-release-authority.mjs",
  "utf8",
);
const stripePrivateAccess = readFileSync(
  "src/lib/sellerStripePrivateAccess.ts",
  "utf8",
);
const stripeAppAuthorityMigration = readFileSync(
  sellerProfilePrivateMigrationPath("20261014120000_prepare_seller_profile_private_stripe_app_authorities"),
  "utf8",
);
const shippingPrivateAccess = readFileSync(
  "src/lib/sellerShippingPrivateAccess.ts",
  "utf8",
);
const shippingAppAuthorityMigration = readFileSync(
  sellerProfilePrivateMigrationPath("20261014130000_prepare_seller_profile_private_shipping_quote_authority"),
  "utf8",
);
const checkoutAppAuthorityMigration = readFileSync(
  sellerProfilePrivateMigrationPath("20261014140000_prepare_seller_profile_private_checkout_app_authority"),
  "utf8",
);
const ownerAppAuthorityMigration = readFileSync(
  sellerProfilePrivateMigrationPath("20261014150000_prepare_seller_profile_private_owner_app_authorities"),
  "utf8",
);
const ownerPrivateAccess = readFileSync(
  "src/lib/sellerOwnerPrivateAccess.ts",
  "utf8",
);
const staffPrivateAccess = readFileSync(
  "src/lib/sellerStaffPrivateAccess.ts",
  "utf8",
);
const remainingAppAuthorityMigration = readFileSync(
  sellerProfilePrivateMigrationPath("20261014230000_prepare_seller_profile_private_remaining_app_authorities"),
  "utf8",
);
const profileViewAccess = readFileSync(
  "src/lib/sellerProfileViewAccess.ts",
  "utf8",
);
const accountDeletionPrivateAccess = readFileSync(
  "src/lib/sellerAccountDeletionPrivateAccess.ts",
  "utf8",
);
const guildListingThreshold = readFileSync(
  "src/lib/guildListingThreshold.ts",
  "utf8",
);
const guildListingThresholdMigration = readFileSync(
  sellerProfilePrivateMigrationPath("20261014170000_prepare_seller_profile_private_guild_listing_threshold_authority"),
  "utf8",
);
const guildCronBatchMigration = readFileSync(
  sellerProfilePrivateMigrationPath("20261014180000_prepare_seller_profile_private_guild_cron_batch_authorities"),
  "utf8",
);
const guildMetricsAuthorityMigration = readFileSync(
  sellerProfilePrivateMigrationPath("20261014190000_prepare_seller_profile_private_guild_metrics_authority"),
  "utf8",
);
const guildMemberRevocationAuthorityMigration = readFileSync(
  sellerProfilePrivateMigrationPath("20261014200000_prepare_seller_profile_private_guild_member_revocation_authority"),
  "utf8",
);
const guildStaffReadAuthorityMigration = readFileSync(
  sellerProfilePrivateMigrationPath("20261014210000_prepare_seller_profile_private_guild_staff_read_authorities"),
  "utf8",
);
const guildStaffTransitionAuthorityMigration = readFileSync(
  sellerProfilePrivateMigrationPath("20261014220000_prepare_seller_profile_private_guild_staff_transition_authority"),
  "utf8",
);
const guildStaffPrivateAccess = readFileSync(
  "src/lib/sellerGuildStaffPrivateAccess.ts",
  "utf8",
);
const adminVerification = readFileSync(
  "src/app/admin/verification/page.tsx",
  "utf8",
);
const checkoutPrivateAccess = readFileSync(
  "src/lib/sellerCheckoutPrivateAccess.ts",
  "utf8",
);
const singleCheckout = readFileSync(
  "src/app/api/cart/checkout/single/route.ts",
  "utf8",
);
const singleCheckoutResume = readFileSync(
  "src/app/api/cart/checkout/single/resume/route.ts",
  "utf8",
);
const cartOwnerAccess = readFileSync(
  "src/lib/cartOwnerAccess.ts",
  "utf8",
);
const PRIVATE_FIELDS = Object.freeze([
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

function functionDefinition(source, name) {
  const start = source.search(
    new RegExp(`CREATE OR REPLACE FUNCTION\\s+public\\.${name}\\(`, "u"),
  );
  assert.notEqual(start, -1, `${name} definition is missing`);
  const endMarker = `\n$${name}$;`;
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${name} definition is incomplete`);
  return source.slice(start, end + endMarker.length);
}

describe("SellerProfile private-boundary additive preparation", () => {
  it("bounds Production lock and statement waits", () => {
    assert.match(migration, /SET LOCAL lock_timeout = '10s';/);
    assert.match(migration, /SET LOCAL statement_timeout = '120s';/);
  });

  it("centralizes checkout private seller source projections", () => {
    assert.match(singleCheckout, /sellerSingleCheckoutSource\(body\.listingId\)/);
    assert.doesNotMatch(singleCheckout, /seller:\s*\{\s*select:\s*\{/);
    assert.match(singleCheckoutResume, /sellerSingleCheckoutResumeSource\(listingId\)/);
    assert.doesNotMatch(singleCheckoutResume, /seller:\s*\{\s*select:\s*\{/);
    assert.match(cartOwnerAccess, /include: sellerCartCheckoutInclude/);
    assert.match(checkoutPrivateAccess, /export function sellerSingleCheckoutSource/);
    assert.match(checkoutPrivateAccess, /export function sellerSingleCheckoutResumeSource/);
    assert.match(checkoutPrivateAccess, /export const sellerCartCheckoutInclude/);
    assert.match(checkoutPrivateAccess, /stripeAccountSupported: true/);
    assert.match(checkoutPrivateAccess, /grainline_seller_checkout_private_state/);
    assert.doesNotMatch(checkoutPrivateAccess, /stripeAccountId: true/);
    assert.doesNotMatch(checkoutPrivateAccess, /stripeAccountVersion: true/);
    assert.doesNotMatch(checkoutPrivateAccess, /defaultPkgWeightGrams: true/);
    assert.match(checkoutAppAuthorityMigration, /CREATE OR REPLACE FUNCTION public\.grainline_seller_checkout_private_state\(/);
    assert.match(checkoutAppAuthorityMigration, /JOIN public\."SellerProfilePrivate"/);
    assert.doesNotMatch(checkoutAppAuthorityMigration, /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)[\s\S]*SellerProfilePrivate/i);
    assert.match(provisioning, /public\."grainline_seller_checkout_private_state"\(text, text, text, text\)/);
    for (const source of [singleCheckout, singleCheckoutResume]) {
      assert.match(source, /sellerCheckoutPrivateState\(\{/);
    }
  });

  it("centralizes staff Guild private state behind one compatibility boundary", () => {
    for (const operation of [
      "applySellerGuildStaffTransition",
      "sellerGuildStaffMasterPendingList",
      "sellerGuildStaffMemberList",
      "sellerGuildStaffMasterList",
      "sellerGuildStaffRevokedMemberList",
    ]) {
      assert.match(adminVerification, new RegExp(`\\b${operation}\\(`));
      assert.match(guildStaffPrivateAccess, new RegExp(`export (?:async )?function ${operation}\\(`));
    }

    assert.match(guildStaffPrivateAccess, /grainline_seller_guild_staff_roster/);
    assert.match(guildStaffPrivateAccess, /grainline_seller_guild_staff_master_pending/);
    assert.match(guildStaffReadAuthorityMigration, /JOIN public\."SellerProfilePrivate"/);
    assert.match(guildStaffReadAuthorityMigration, /SESSION_USER <> 'grainline_staff_read_runtime'/);
    assert.match(guildStaffReadAuthorityMigration, /GRANT EXECUTE[\s\S]*TO grainline_staff_read_runtime/);
    assert.doesNotMatch(guildStaffReadAuthorityMigration, /GRANT EXECUTE[\s\S]*TO grainline_app_runtime/);
    assert.match(guildStaffPrivateAccess, /grainline_seller_guild_staff_transition/);
    assert.match(guildStaffTransitionAuthorityMigration, /SESSION_USER <> 'grainline_staff_read_runtime'/);
    assert.match(guildStaffTransitionAuthorityMigration, /FOR UPDATE/);
    assert.match(guildStaffTransitionAuthorityMigration, /UPDATE public\."MakerVerification"/);
    assert.match(guildStaffTransitionAuthorityMigration, /UPDATE public\."SellerProfilePrivate"/);
    assert.match(guildStaffTransitionAuthorityMigration, /UPDATE public\."SellerProfile"/);
    assert.match(guildStaffTransitionAuthorityMigration, /INSERT INTO public\."AdminAuditLog"/);
    assert.match(guildStaffTransitionAuthorityMigration, /GRANT EXECUTE[\s\S]*TO grainline_staff_read_runtime/);
    assert.doesNotMatch(guildStaffTransitionAuthorityMigration, /GRANT EXECUTE[\s\S]*TO grainline_app_runtime/);
    assert.doesNotMatch(guildStaffPrivateAccess, /sellerProfile\.findMany/);
    assert.doesNotMatch(guildStaffPrivateAccess, /makerVerification\.findMany/);

    for (const field of [
      "guildMemberApprovedAt",
      "guildMasterApprovedAt",
      "guildMasterAppliedAt",
      "guildMasterReviewNotes",
      "consecutiveMetricFailures",
      "lastMetricCheckAt",
      "metricWarningSentAt",
      "listingsBelowThresholdSince",
    ]) {
      assert.doesNotMatch(
        adminVerification,
        new RegExp(`sellerProfile\\.(?:find|update)[\\s\\S]{0,700}${field}`),
      );
    }
  });

  it("adds the one-to-one private companion without removing predecessor fields", () => {
    assert.match(schema, /stripeAccountSupported\s+Boolean\s+@default\(true\)/);
    assert.match(schema, /privateData\s+SellerProfilePrivate\?/);
    assert.match(schema, /model SellerProfilePrivate \{[\s\S]*sellerProfileId String\s+@id/);
    assert.match(schema, /model SellerProfilePrivate \{[\s\S]*shipFromLine1\s+String\?/);
    assert.match(schema, /model SellerProfilePrivate \{[\s\S]*stripeAccountId\s+String\?\s+@unique/);
    assert.match(schema, /model SellerProfilePrivate \{[\s\S]*guildMemberApprovedAt\s+DateTime\?/);
    assert.match(schema, /model SellerProfilePrivate \{[\s\S]*guildMasterApprovedAt\s+DateTime\?/);
    assert.match(schema, /model SellerProfilePrivate \{[\s\S]*guildMasterAppliedAt\s+DateTime\?/);
    assert.match(schema, /model SellerProfilePrivate \{[\s\S]*guildMasterReviewNotes\s+String\?/);
    const publicModel = schema.match(/model SellerProfile \{[\s\S]*?\n\}/u)?.[0] ?? "";
    assert.doesNotMatch(publicModel, /\bshipFromLine1\b/u);
    assert.doesNotMatch(migration, /DROP\s+(?:COLUMN|TABLE)/i);
    assert.doesNotMatch(migration, /ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it("backfills every predecessor row and mirrors every classified private field", () => {
    assert.match(migration, /INSERT INTO public\."SellerProfilePrivate"[\s\S]*FROM public\."SellerProfile" AS source/);
    assert.match(migration, /AFTER INSERT OR UPDATE OF[\s\S]*"stripeAccountId"[\s\S]*"shipFromPhone"[\s\S]*"defaultPkgWeightGrams"[\s\S]*"onboardingComplete"[\s\S]*"guildMemberApprovedAt"[\s\S]*"guildMasterApprovedAt"[\s\S]*"guildMasterAppliedAt"[\s\S]*"guildMasterReviewNotes"[\s\S]*"profileViews"/);
    assert.match(migration, /ON CONFLICT \("sellerProfileId"\) DO UPDATE SET/);
    assert.match(migration, /ON DELETE CASCADE[\s\S]*ON UPDATE CASCADE/);
    for (const field of PRIVATE_FIELDS) {
      assert.match(
        schema,
        new RegExp(`model SellerProfilePrivate \\{[\\s\\S]*\\b${field}\\b`, "u"),
      );
      assert.ok(
        migration.split(`"${field}"`).length - 1 >= 8,
        `${field} must remain present in create, backfill, mirror, convergence, and trigger surfaces`,
      );
    }
  });

  it("derives the public-safe supported snapshot and prevents caller drift", () => {
    assert.match(migration, /NEW\."stripeAccountSupported" := \([\s\S]*NEW\."stripeAccountVersion" IS NULL[\s\S]*NEW\."stripeAccountVersion" = 'v2'/);
    assert.match(migration, /SellerProfile_stripeAccountSupported_check/);
    assert.match(migration, /BEFORE INSERT OR UPDATE OF "stripeAccountVersion", "stripeAccountSupported"/);
  });

  it("moves public SQL eligibility callers off the private provider version", () => {
    const callers = [
      "grainline_conversation_listing_core",
      "grainline_notification_claim_back_in_stock",
      "grainline_order_buyer_detail_v2",
      "grainline_order_public_listing_counts",
      "grainline_order_public_marketplace_listing_metrics",
      "grainline_order_public_seller_stats",
      "grainline_order_seller_detail_v2",
      "grainline_user_public_listing_favorite_counts",
    ];

    for (const caller of callers) {
      assert.match(
        supportedCallerMigration,
        new RegExp(`CREATE OR REPLACE FUNCTION public\\.${caller}\\(`),
      );
    }
    assert.equal(
      supportedCallerMigration.match(/CREATE OR REPLACE FUNCTION public\./g)?.length,
      callers.length,
    );
    assert.doesNotMatch(supportedCallerMigration, /"stripeAccountVersion"/);
    assert.match(supportedCallerMigration, /"stripeAccountSupported"/);
    assert.match(supportedCallerMigration, /BEGIN;[\s\S]*COMMIT;/);
    assert.doesNotMatch(supportedCallerMigration, /DROP\s+(?:COLUMN|TABLE|FUNCTION)/i);
    assert.doesNotMatch(supportedCallerMigration, /GRANT\s|REVOKE\s/i);
  });

  it("moves checkout SQL callers onto the private companion", () => {
    const callers = [
      "grainline_checkout_reservation_create_cart",
      "grainline_checkout_reservation_create_single",
      "grainline_checkout_reservation_seller_witness",
    ];

    for (const caller of callers) {
      assert.match(
        checkoutCallerMigration,
        new RegExp(`CREATE OR REPLACE FUNCTION public\\.${caller}\\(`),
      );
    }
    assert.equal(
      checkoutCallerMigration.match(/CREATE OR REPLACE FUNCTION public\./g)?.length,
      callers.length,
    );
    assert.match(checkoutCallerMigration, /public\."SellerProfilePrivate"/);
    assert.doesNotMatch(checkoutCallerMigration, /seller\."stripeAccount(?:Id|Version)"/);
    assert.doesNotMatch(
      checkoutCallerMigration,
      /seller\."defaultPkg(?:WeightGrams|LengthCm|WidthCm|HeightCm)"/,
    );
    assert.match(checkoutCallerMigration, /BEGIN;[\s\S]*COMMIT;/);
    assert.doesNotMatch(checkoutCallerMigration, /DROP\s+(?:COLUMN|TABLE|FUNCTION)/i);
    assert.doesNotMatch(checkoutCallerMigration, /GRANT\s|REVOKE\s/i);
  });

  it("moves custom-order SQL callers onto the private companion", () => {
    const callers = [
      "grainline_message_send_custom_request",
      "grainline_message_send_custom_order_ready",
      "grainline_user_custom_order_seller_state",
    ];

    for (const caller of callers) {
      assert.match(
        customOrderCallerMigration,
        new RegExp(`CREATE OR REPLACE FUNCTION public\\.${caller}\\(`),
      );
    }
    assert.equal(
      customOrderCallerMigration.match(/CREATE OR REPLACE FUNCTION public\./g)?.length,
      callers.length,
    );
    assert.match(customOrderCallerMigration, /public\."SellerProfilePrivate"/);
    assert.doesNotMatch(
      customOrderCallerMigration,
      /seller\."stripeAccount(?:Id|Version)"/,
    );
    assert.match(customOrderCallerMigration, /"stripeAccountSupported"/);
    assert.match(customOrderCallerMigration, /BEGIN;[\s\S]*COMMIT;/);
    assert.doesNotMatch(customOrderCallerMigration, /DROP\s+(?:COLUMN|TABLE|FUNCTION)/i);
    assert.doesNotMatch(customOrderCallerMigration, /GRANT\s|REVOKE\s/i);
  });

  it("moves the Case Guild guard onto the private companion", () => {
    assert.match(
      caseGuildCallerMigration,
      /CREATE OR REPLACE FUNCTION public\.grainline_case_guild_unresolved_guard\(/,
    );
    assert.match(caseGuildCallerMigration, /public\."SellerProfilePrivate"/);
    assert.match(
      caseGuildCallerMigration,
      /seller_private\."guildMemberApprovedAt" IS NOT NULL/,
    );
    assert.doesNotMatch(
      caseGuildCallerMigration,
      /seller\."guildMemberApprovedAt"/,
    );
    assert.match(caseGuildCallerMigration, /BEGIN;[\s\S]*COMMIT;/);
    assert.doesNotMatch(caseGuildCallerMigration, /DROP\s+(?:COLUMN|TABLE|FUNCTION)/i);
    assert.doesNotMatch(caseGuildCallerMigration, /GRANT\s|REVOKE\s/i);
  });

  it("moves the order label preflight onto the private companion", () => {
    assert.match(
      orderLabelCallerMigration,
      /CREATE OR REPLACE FUNCTION public\.grainline_order_seller_label_preflight\(/,
    );
    assert.match(orderLabelCallerMigration, /public\."SellerProfilePrivate"/);
    for (const field of [
      "shipFromLine1",
      "shipFromPhone",
      "defaultPkgWeightGrams",
      "defaultPkgHeightCm",
    ]) {
      assert.match(
        orderLabelCallerMigration,
        new RegExp(`seller_private\\."${field}"`),
      );
      assert.doesNotMatch(
        orderLabelCallerMigration,
        new RegExp(`seller\\."${field}"`),
      );
    }
    assert.match(orderLabelCallerMigration, /BEGIN;[\s\S]*COMMIT;/);
    assert.doesNotMatch(orderLabelCallerMigration, /DROP\s+(?:COLUMN|TABLE|FUNCTION)/i);
    assert.doesNotMatch(orderLabelCallerMigration, /GRANT\s|REVOKE\s/i);
  });

  it("moves provider identity callers onto the private companion", () => {
    const callers = [
      "grainline_seller_payout_event_apply",
      "grainline_stripe_seller_deauthorization_apply",
      "grainline_user_ban_repair_target",
    ];
    for (const caller of callers) {
      const definition = functionDefinition(providerIdentityCallerMigration, caller);
      assert.match(definition, /public\."SellerProfilePrivate"/);
      assert.doesNotMatch(definition, /seller\."stripeAccountId"/);
    }

    const bridge = functionDefinition(
      providerIdentityCallerMigration,
      "grainline_seller_profile_deauthorize_compat",
    );
    assert.match(bridge, /FOR UPDATE OF seller, seller_private/);
    assert.match(bridge, /UPDATE public\."SellerProfilePrivate"/);
    assert.match(bridge, /UPDATE public\."SellerProfile"/);
    assert.match(
      providerIdentityCallerMigration,
      /REVOKE ALL ON FUNCTION public\.grainline_seller_profile_deauthorize_compat\(text, text\)[\s\S]*FROM PUBLIC, grainline_app_runtime/,
    );
    assert.doesNotMatch(providerIdentityCallerMigration, /\nGRANT\s/i);
    assert.match(providerIdentityCallerMigration, /BEGIN;[\s\S]*COMMIT;/);
    assert.doesNotMatch(
      providerIdentityCallerMigration,
      /DROP\s+(?:COLUMN|TABLE|FUNCTION)/i,
    );
  });

  it("moves refund reconciliation writers behind one private compatibility boundary", () => {
    const callers = [
      "grainline_blocked_checkout_refund_record_core",
      "grainline_seller_refund_record",
      "grainline_case_staff_resolution_provider_record",
      "grainline_case_staff_resolution_provider_recovery_record",
    ];
    for (const caller of callers) {
      const definition = functionDefinition(reconciliationCallerMigration, caller);
      assert.match(
        definition,
        /public\.grainline_seller_profile_reconciliation_required_compat\(/,
      );
      assert.doesNotMatch(
        definition,
        /UPDATE public\."SellerProfile"[\s\S]{0,240}"manualStripeReconciliationNeeded"/,
      );
    }

    const bridge = functionDefinition(
      reconciliationCallerMigration,
      "grainline_seller_profile_reconciliation_required_compat",
    );
    assert.match(bridge, /FOR UPDATE OF seller, seller_private/);
    assert.match(bridge, /UPDATE public\."SellerProfile"/);
    assert.match(bridge, /UPDATE public\."SellerProfilePrivate"/);
    assert.match(
      reconciliationCallerMigration,
      /REVOKE ALL ON FUNCTION[\s\S]*grainline_seller_profile_reconciliation_required_compat\([\s\S]*timestamp without time zone[\s\S]*FROM PUBLIC, grainline_app_runtime/,
    );
    assert.doesNotMatch(reconciliationCallerMigration, /\nGRANT\s/iu);
    assert.match(reconciliationCallerMigration, /BEGIN;[\s\S]*COMMIT;/);
    assert.doesNotMatch(
      reconciliationCallerMigration,
      /DROP\s+(?:COLUMN|TABLE|FUNCTION)/iu,
    );
  });

  it("keeps provider refund recording durable when a reconciliation target is missing", () => {
    const bridge = functionDefinition(
      reconciliationTargetCorrectionMigration,
      "grainline_seller_profile_reconciliation_required_compat",
    );
    assert.match(bridge, /SELLER_RECONCILIATION_FLAG_SKIPPED/);
    assert.match(bridge, /seller_profile_missing/);
    assert.match(bridge, /seller_profile_private_missing/);
    assert.match(bridge, /INSERT INTO public\."SystemAuditLog"/);
    assert.match(bridge, /RETURN;/);
    assert.doesNotMatch(
      bridge,
      /Seller reconciliation target is missing[\s\S]*foreign_key_violation/,
    );
    assert.match(bridge, /UPDATE public\."SellerProfile"/);
    assert.match(bridge, /UPDATE public\."SellerProfilePrivate"/);
    assert.match(
      reconciliationTargetCorrectionMigration,
      /REVOKE ALL ON FUNCTION[\s\S]*grainline_seller_profile_reconciliation_required_compat\([\s\S]*timestamp without time zone[\s\S]*FROM PUBLIC, grainline_app_runtime/,
    );
    assert.doesNotMatch(reconciliationTargetCorrectionMigration, /\nGRANT\s/iu);
    assert.match(reconciliationTargetCorrectionMigration, /BEGIN;[\s\S]*COMMIT;/);
    assert.match(reconciliationTargetCorrectionMigration, /SET LOCAL lock_timeout = '5s'/);
    assert.match(reconciliationTargetCorrectionMigration, /SET LOCAL statement_timeout = '30s'/);
    assert.doesNotMatch(
      reconciliationTargetCorrectionMigration,
      /DROP\s+(?:COLUMN|TABLE|FUNCTION)/iu,
    );
  });

  it("moves the final business-function reads off predecessor private fields", () => {
    const notification = functionDefinition(
      finalCallerMigration,
      "grainline_notification_create_core",
    );
    assert.match(notification, /public\."SellerProfilePrivate"/);
    assert.match(
      notification,
      /source_seller_private\."consecutiveMetricFailures"/,
    );
    assert.match(notification, /source_seller_private\."metricWarningSentAt"/);
    assert.equal(
      notification.match(/source_seller\."stripeAccountSupported" = true/gu)?.length,
      4,
    );
    assert.match(
      notification,
      /IF p_type IS NULL OR \(p_source_type = 'blog_comment'/,
    );
    assert.doesNotMatch(notification, /source_seller\."stripeAccountVersion"/);
    assert.doesNotMatch(notification, /source_seller\."consecutiveMetricFailures"/);
    assert.doesNotMatch(notification, /source_seller\."metricWarningSentAt"/);

    const checkout = functionDefinition(
      finalCallerMigration,
      "grainline_stripe_checkout_order_create",
    );
    assert.match(checkout, /public\."SellerProfilePrivate"/);
    assert.match(checkout, /seller_private\."stripeAccountId"/);
    assert.match(checkout, /seller_private\."stripeAccountVersion"/);
    assert.match(checkout, /FOR UPDATE OF seller, seller_private/);
    assert.doesNotMatch(checkout, /\bseller\."stripeAccountId"/);
    assert.doesNotMatch(checkout, /\bseller\."stripeAccountVersion"/);

    assert.equal(
      finalCallerMigration.match(/CREATE OR REPLACE FUNCTION/gu)?.length,
      2,
    );
    assert.doesNotMatch(finalCallerMigration, /\n(?:GRANT|REVOKE)\s/iu);
    assert.match(finalCallerMigration, /BEGIN;[\s\S]*COMMIT;/);
    assert.doesNotMatch(
      finalCallerMigration,
      /DROP\s+(?:COLUMN|TABLE|FUNCTION)/iu,
    );
  });

  it("moves account-deletion provider and ship-from reads onto the private companion", () => {
    const callers = [
      "grainline_user_account_deletion_preflight",
      "grainline_user_account_deletion_snapshot",
      "grainline_message_redact_for_account_deletion",
      "grainline_case_account_deletion_redact",
    ];
    for (const caller of callers) {
      assert.match(
        accountDeletionCallerMigration,
        new RegExp(`CREATE OR REPLACE FUNCTION public\\.${caller}\\(`),
      );
    }
    assert.equal(
      accountDeletionCallerMigration.match(/CREATE OR REPLACE FUNCTION public\./g)?.length,
      callers.length,
    );
    assert.match(accountDeletionCallerMigration, /public\."SellerProfilePrivate"/);
    assert.doesNotMatch(
      accountDeletionCallerMigration,
      /\bseller\."(?:stripeAccountId|stripeAccountVersion|stripeControllerType|shipFrom(?:Name|Line1|Line2|City|State|Postal|Phone))"/,
    );
    assert.match(accountDeletionCallerMigration, /\bseller\."displayName"/);
    assert.match(accountDeletionCallerMigration, /BEGIN;[\s\S]*COMMIT;/);
    assert.doesNotMatch(accountDeletionCallerMigration, /DROP\s+(?:COLUMN|TABLE|FUNCTION)/i);
    assert.doesNotMatch(accountDeletionCallerMigration, /GRANT\s|REVOKE\s/i);
  });

  it("keeps the companion inaccessible to ordinary runtime and PUBLIC", () => {
    assert.match(migration, /REVOKE ALL ON TABLE public\."SellerProfilePrivate" FROM PUBLIC/);
    assert.match(migration, /to_regrole\('grainline_app_runtime'\)/);
    assert.match(migration, /REVOKE ALL ON TABLE public\."SellerProfilePrivate" FROM grainline_app_runtime/);
    assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path = pg_catalog/);
    assert.match(grantAudit, /RUNTIME_PRIVATE_TABLES[\s\S]*"SellerProfilePrivate"/);
    assert.match(
      grantAudit,
      /RUNTIME_PRIVATE_FUNCTIONS[\s\S]*"grainline_seller_profile_private_initialize"/,
    );
    assert.match(provisioning, /\('SellerProfilePrivate'\)/);
    assert.match(provisioning, /"grainline_seller_profile_private_initialize"\(\)/);
  });

  it("provides a rollback-only exact-migration PostgreSQL proof", () => {
    assert.equal(
      parseSellerProfilePrivateBoundaryProofConfig({
        SELLER_PROFILE_PRIVATE_BOUNDARY_PROOF_DATABASE_URL:
          "postgresql://ci:ci@127.0.0.1:5432/grainline_ci?sslmode=disable",
      }).databaseUrl,
      "postgresql://ci:ci@127.0.0.1:5432/grainline_ci?sslmode=disable",
    );
    assert.throws(
      () => parseSellerProfilePrivateBoundaryProofConfig({
        SELLER_PROFILE_PRIVATE_BOUNDARY_PROOF_DATABASE_URL:
          "postgresql://ci:ci@database.example/grainline_ci",
      }),
      /refuses a non-loopback database/,
    );
    assert.throws(
      () => parseSellerProfilePrivateBoundaryProofConfig({
        SELLER_PROFILE_PRIVATE_BOUNDARY_PROOF_DATABASE_URL:
          "postgresql://ci:ci@127.0.0.1:5432/not_grainline",
      }),
      /requires the grainline_ci database/,
    );
    assert.throws(
      () => parseSellerProfilePrivateBoundaryProofConfig({
        SELLER_PROFILE_PRIVATE_BOUNDARY_PROOF_DATABASE_URL:
          "postgresql://ci:ci@127.0.0.1:5432/grainline_ci",
        SELLER_PROFILE_PRIVATE_BOUNDARY_ALLOW_DOCKER_BRIDGE: "yes",
      }),
      /must be absent or exactly true/,
    );
    const qualified = qualifySellerProfilePrivateBoundaryMigration(
      migration,
      "seller_profile_private_proof_0123456789abcdef0123456789abcdef",
    );
    assert.doesNotMatch(qualified, /\nBEGIN;\n/u);
    assert.doesNotMatch(qualified, /\nCOMMIT;\s*$/u);
    assert.doesNotMatch(qualified, /public\."SellerProfilePrivate"/);
    assert.match(
      qualified,
      /"seller_profile_private_proof_0123456789abcdef0123456789abcdef"\."SellerProfilePrivate"/,
    );
    assert.match(proof, /await client\.query\("ROLLBACK"\)/);
    assert.match(proof, /runtime role unexpectedly read SellerProfilePrivate/);
    assert.match(proof, /runtimeDirectCrudDenied: true/);
  });

  it("isolates the additive migration from sealed historical release guards", () => {
    const verify = ci.indexOf("Verify SellerProfile private-boundary source package");
    const isolate = ci.indexOf("Isolate SellerProfile private-boundary migration from historical release guards");
    const historical = ci.indexOf("Verify compatible Order checkout receipt authority release");
    const finalPredecessor = ci.indexOf("Audit runtime grants after seller listing Hide/Delete migration");
    const restore = ci.indexOf("Restore SellerProfile private-boundary migration after all predecessors");
    const deploy = ci.indexOf("Apply SellerProfile private-boundary migration in disposable PostgreSQL");
    const ledger = ci.indexOf("Stage exact SellerProfile private-boundary migration ledger");
    const callerApply = ci.indexOf("Apply SellerProfile private-boundary caller migrations in disposable PostgreSQL");
    const applicationApply = ci.indexOf("Apply SellerProfile private application-operation migrations in disposable PostgreSQL");
    const staffConverge = ci.indexOf("Converge staff grants after SellerProfile private boundary");
    const postgresProof = ci.indexOf("Prove SellerProfile private boundary in ephemeral PostgreSQL");

    assert.ok(verify >= 0);
    assert.ok(verify < isolate);
    assert.ok(isolate < historical);
    assert.ok(historical < finalPredecessor);
    assert.ok(finalPredecessor < restore);
    assert.ok(historical < restore);
    assert.ok(restore < deploy);
    assert.ok(deploy < ledger);
    assert.ok(ledger < callerApply);
    assert.ok(callerApply < applicationApply);
    assert.ok(applicationApply < staffConverge);
    assert.ok(staffConverge < postgresProof);
    assert.ok(callerApply < postgresProof);
    assert.ok(ledger < postgresProof);
    assert.ok(deploy < postgresProof);
    for (const candidate of [
      "20261013120000_prepare_seller_profile_private_boundary",
      "20261013130000_move_seller_supported_snapshot_sql_callers",
      "20261013140000_move_checkout_seller_private_sql_callers",
      "20261013150000_move_custom_order_seller_private_sql_callers",
      "20261013160000_move_case_guild_seller_private_sql_caller",
      "20261013170000_move_order_label_seller_private_sql_caller",
      "20261013180000_move_provider_identity_seller_private_sql_callers",
      "20261013190000_move_reconciliation_seller_private_sql_callers",
      "20261013200000_move_final_seller_private_sql_callers",
      "20261013210000_move_account_deletion_seller_private_sql_callers",
      "20261014010000_tolerate_missing_seller_reconciliation_target",
    ]) {
      const occurrences = ci.split(candidate).length - 1;
      assert.ok(occurrences >= 2, `${candidate} must be isolated and restored/applied`);
    }
    assert.match(ci, /mv "prisma\/migrations\/\$migration" "\$holding\/\$migration"/);
    assert.match(ci, /mv "\$holding\/\$migration" "prisma\/migrations\/\$migration"/);
    assert.match(
      ci,
      /Isolate SellerProfile private-boundary migration[\s\S]*SELLER_PROFILE_PRIVATE_BOUNDARY_MIGRATION_ISOLATED=true/,
    );
    assert.match(
      ci,
      /Isolate SellerProfile private-boundary migration[\s\S]*SELLER_PROFILE_PRIVATE_BOUNDARY_MIGRATION_PATH=\$holding\/20261013120000_prepare_seller_profile_private_boundary\/migration\.sql/,
    );
    assert.match(
      ci,
      /Isolate SellerProfile private-boundary migration[\s\S]*SELLER_PROFILE_PRIVATE_BOUNDARY_MIGRATIONS_DIR=\$holding/,
    );
    assert.match(
      ci,
      /Restore SellerProfile private-boundary migration after all predecessors[\s\S]*SELLER_PROFILE_PRIVATE_BOUNDARY_MIGRATION_ISOLATED=/,
    );
    assert.match(
      ci,
      /Restore SellerProfile private-boundary migration after all predecessors[\s\S]*"\$holding\/provision-order-staff-read-role\.sql"[\s\S]*scripts\/provision-order-staff-read-role\.sql/,
    );
    assert.match(
      ci,
      /Restore SellerProfile private-boundary migration after all predecessors[\s\S]*"\$holding\/audit-runtime-db-grants\.mjs"[\s\S]*scripts\/audit-runtime-db-grants\.mjs/,
    );
    assert.match(
      ci,
      /Restore SellerProfile private-boundary migration after all predecessors[\s\S]*"\$holding\/provision-runtime-db-role\.sql"[\s\S]*scripts\/provision-runtime-db-role\.sql/,
    );
    assert.match(
      ci,
      /Restore SellerProfile private-boundary migration after all predecessors[\s\S]*SELLER_PROFILE_PRIVATE_BOUNDARY_MIGRATION_PATH=/,
    );
    assert.match(
      ci,
      /Restore SellerProfile private-boundary migration after all predecessors[\s\S]*SELLER_PROFILE_PRIVATE_BOUNDARY_MIGRATIONS_DIR=/,
    );
    assert.match(
      ci,
      /Apply SellerProfile private-boundary migration in disposable PostgreSQL[\s\S]*--file=prisma\/migrations\/20261013120000_prepare_seller_profile_private_boundary\/migration\.sql/,
    );
    assert.match(
      ci,
      /Apply SellerProfile private-boundary caller migrations in disposable PostgreSQL[\s\S]*--file="prisma\/migrations\/\$migration\/migration\.sql"[\s\S]*'spc-' \|\| pg_catalog\.md5\(:'migration'\)/,
    );
    assert.match(
      ci,
      /Converge staff grants after SellerProfile private boundary[\s\S]*--set=staff_role=grainline_staff_read_runtime[\s\S]*--file=scripts\/provision-order-staff-read-role\.sql/,
    );
    assert.match(
      zeroDirectProof,
      /resolveTemporarilyAbsentCiTables\(env,[\s\S]*allowLoopbackCi: true/,
    );
    assert.match(
      zeroDirectProof,
      /proveZeroDirectReleaseScope\(client, zeroDirectScopeCiAuditOptions\(env\)\)/,
    );
    assert.match(
      zeroDirectStructureProof,
      /const auditOptions = zeroDirectScopeCiAuditOptions\(env\);[\s\S]*proveZeroDirectReleaseScope\(client, auditOptions\)/,
    );
    assert.match(
      zeroDirectStructureProof,
      /auditLiveDatabase\([\s\S]*temporarilyAbsentTables: auditOptions\.temporarilyAbsentTables/,
    );
    assert.match(
      zeroDirectScope,
      /auditZeroDirectAuthority\([\s\S]*expected\.owner,[\s\S]*auditOptions/,
    );
    assert.match(
      zeroDirectAuthority,
      /auditLiveDatabase\([\s\S]*temporarilyAbsentTables/,
    );
  });

  it("funnels the Stripe provider family through one compatibility boundary", () => {
    const callers = [
      "src/app/api/stripe/connect/create/route.ts",
      "src/app/api/stripe/connect/status/route.ts",
      "src/app/api/stripe/connect/login-link/route.ts",
      "src/app/api/stripe/connect/dashboard/route.ts",
      "src/lib/stripeConnectReconcile.ts",
      "src/lib/stripeWebhookMirror.ts",
    ];
    for (const path of callers) {
      const caller = readFileSync(path, "utf8");
      assert.match(caller, /sellerStripe(?:OwnerState|ReconciliationPage|MirrorState|ChargesEnabled|Account)/);
      assert.doesNotMatch(
        caller,
        /(?:prisma|tx)\.sellerProfile\.(?:findUnique|findFirst|findMany|update|updateMany|upsert)/,
        `${path} must not bypass the private Stripe compatibility boundary`,
      );
    }
    assert.match(stripePrivateAccess, /Fixed database-operation boundary for private Stripe state/);
    assert.match(stripePrivateAccess, /sellerStripeReconciliationPage/);
    assert.match(stripePrivateAccess, /sellerStripeMirrorState/);
    assert.match(stripePrivateAccess, /updateSellerStripeChargesEnabled/);
    assert.match(stripePrivateAccess, /grainline_seller_stripe_owner_state/);
    assert.match(stripePrivateAccess, /grainline_seller_stripe_account_bind/);
    assert.match(stripePrivateAccess, /grainline_seller_stripe_reconciliation_page/);
    assert.match(stripePrivateAccess, /grainline_seller_stripe_mirror_state/);
    assert.match(stripePrivateAccess, /grainline_seller_stripe_charges_update/);
    assert.doesNotMatch(stripePrivateAccess, /\.sellerProfile\./);
    assert.doesNotMatch(stripePrivateAccess, /\.sellerProfilePrivate\./);
    assert.doesNotMatch(stripeAppAuthorityMigration, /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)[\s\S]*SellerProfilePrivate/i);
    for (const operation of [
      "grainline_seller_stripe_owner_state",
      "grainline_seller_stripe_account_bind",
      "grainline_seller_stripe_reconciliation_page",
      "grainline_seller_stripe_mirror_state",
      "grainline_seller_stripe_charges_update",
    ]) {
      assert.match(stripeAppAuthorityMigration, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${operation}\\(`));
      assert.match(stripeAppAuthorityMigration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${operation}\\(`));
      assert.match(provisioning, new RegExp(`public\."${operation}"`));
    }
  });

  it("funnels shipping quote private inputs through one compatibility boundary", () => {
    const route = readFileSync("src/app/api/shipping/quote/route.ts", "utf8");
    assert.equal(
      route.split("sellerShippingQuoteState({").length - 1,
      2,
    );
    assert.doesNotMatch(
      route,
      /prisma\.sellerProfile\.findUnique\([\s\S]{0,500}shipFromLine1/,
    );
    assert.match(shippingPrivateAccess, /Fixed database-operation boundary for private seller fulfillment inputs/);
    assert.match(shippingPrivateAccess, /grainline_seller_shipping_quote_state/);
    assert.doesNotMatch(shippingPrivateAccess, /\.sellerProfile\./);
    assert.doesNotMatch(shippingPrivateAccess, /\.sellerProfilePrivate\./);
    assert.match(shippingPrivateAccess, /sellerShippingQuoteState/);
    assert.match(route, /buyerUserId: me\.id,[\s\S]*cartId: cart\.id,[\s\S]*listingId: null/);
    assert.match(route, /buyerUserId: me\.id,[\s\S]*cartId: null,[\s\S]*listingId: listing\.id/);
    assert.match(shippingAppAuthorityMigration, /CREATE OR REPLACE FUNCTION public\.grainline_seller_shipping_quote_state\(/);
    assert.match(shippingAppAuthorityMigration, /JOIN public\."SellerProfilePrivate"/);
    assert.match(shippingAppAuthorityMigration, /p_cart_id IS NOT NULL[\s\S]*cart\."userId" = buyer\.id/);
    assert.match(shippingAppAuthorityMigration, /p_listing_id IS NOT NULL[\s\S]*listing\."reservedForUserId" = buyer\.id/);
    assert.doesNotMatch(shippingAppAuthorityMigration, /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)[\s\S]*SellerProfilePrivate/i);
    assert.match(provisioning, /public\."grainline_seller_shipping_quote_state"\(text, text, text, text\)/);
  });

  it("funnels owner onboarding and export reads through one compatibility boundary", () => {
    const onboarding = readFileSync("src/app/dashboard/onboarding/page.tsx", "utf8");
    const onboardingActions = readFileSync("src/app/dashboard/onboarding/actions.ts", "utf8");
    const shopSettings = readFileSync("src/app/dashboard/seller/page.tsx", "utf8");
    const profileEditor = readFileSync("src/app/dashboard/profile/page.tsx", "utf8");
    const guildDashboard = readFileSync("src/app/dashboard/verification/page.tsx", "utf8");
    const guildMemberCron = readFileSync("src/app/api/cron/guild-member-check/route.ts", "utf8");
    const guildMetricsCron = readFileSync("src/app/api/cron/guild-metrics/route.ts", "utf8");
    const guildPrivateAccess = readFileSync("src/lib/sellerGuildPrivateAccess.ts", "utf8");
    const accountExport = readFileSync("src/app/api/account/export/route.ts", "utf8");
    assert.match(onboarding, /sellerOwnerOnboardingState\(seller\.id, seller\.userId\)/);
    assert.match(accountExport, /sellerOwnerExportProfile\(user\.id\)/);
    assert.doesNotMatch(onboarding, /prisma\.sellerProfile\./);
    assert.doesNotMatch(onboardingActions, /(?:prisma|tx)\.sellerProfile\./);
    assert.doesNotMatch(shopSettings, /prisma\.sellerProfile\./);
    assert.doesNotMatch(profileEditor, /(?:prisma|tx)\.sellerProfile\./);
    assert.doesNotMatch(guildDashboard, /(?:prisma|tx)\.sellerProfile\./);
    assert.doesNotMatch(guildMemberCron, /(?:prisma|tx)\.sellerProfile\./);
    assert.doesNotMatch(guildMetricsCron, /(?:prisma|tx)\.sellerProfile\./);
    assert.doesNotMatch(accountExport, /prisma\.sellerProfile\./);
    assert.match(ownerPrivateAccess, /sellerOwnerOnboardingSelect/);
    assert.match(ownerPrivateAccess, /sellerOwnerExportSelect/);
    assert.match(ownerPrivateAccess, /grainline_seller_owner_private_state/);
    assert.match(ownerPrivateAccess, /manualStripeReconciliationNeeded: boolean/);
    assert.match(ownerPrivateAccess, /guildMasterReviewNotes: string \| null/);
    assert.match(ownerAppAuthorityMigration, /CREATE OR REPLACE FUNCTION public\.grainline_seller_owner_private_state\(/);
    assert.match(ownerAppAuthorityMigration, /CREATE OR REPLACE FUNCTION public\.grainline_seller_owner_onboarding_step_update\(/);
    assert.match(ownerAppAuthorityMigration, /CREATE OR REPLACE FUNCTION public\.grainline_seller_owner_onboarding_complete\(/);
    assert.match(ownerAppAuthorityMigration, /CREATE OR REPLACE FUNCTION public\.grainline_seller_owner_shop_settings_update\(/);
    assert.match(ownerAppAuthorityMigration, /JOIN public\."SellerProfilePrivate"/);
    assert.doesNotMatch(ownerAppAuthorityMigration, /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)[\s\S]*SellerProfilePrivate/i);
    assert.match(provisioning, /public\."grainline_seller_owner_private_state"\(text\)/);
    assert.match(provisioning, /public\."grainline_seller_owner_onboarding_complete"\(text, text\)/);
    assert.match(onboardingActions, /sellerOwnerOnboardingMutationState/);
    assert.match(onboardingActions, /updateSellerOwnerOnboardingStepOne/);
    assert.match(onboardingActions, /updateSellerOwnerOnboardingStepTwo/);
    assert.match(onboardingActions, /advanceSellerOwnerOnboardingStep/);
    assert.match(onboardingActions, /completeSellerOwnerOnboarding/);
    assert.match(shopSettings, /sellerOwnerShopSettingsState/);
    assert.match(shopSettings, /updateSellerOwnerShopSettings/);
    assert.match(shopSettings, /updateSellerOwnerMetroAssignment/);
    assert.match(profileEditor, /sellerOwnerProfileEditorState/);
    assert.match(profileEditor, /updateSellerOwnerProfile/);
    assert.match(profileEditor, /clearSellerOwnerAvatar/);
    assert.match(profileEditor, /sellerOwnerFeaturedListingIds/);
    assert.match(profileEditor, /updateSellerOwnerFeaturedListingIds/);
    assert.match(guildDashboard, /sellerOwnerGuildDashboardState/);
    assert.match(guildDashboard, /sellerOwnerGuildApplicationState/);
    assert.match(guildDashboard, /recordSellerOwnerGuildMasterApplication/);
    assert.match(guildMemberCron, /sellerGuildMemberCronBatch/);
    assert.match(guildMemberCron, /applySellerGuildMemberRevocation/);
    assert.match(guildMetricsCron, /sellerGuildMetricsCronBatch/);
    assert.match(guildMetricsCron, /applySellerGuildMetrics/);
    assert.match(guildPrivateAccess, /grainline_seller_guild_member_revoke/);
    assert.match(guildPrivateAccess, /grainline_seller_guild_member_cron_batch/);
    assert.match(guildPrivateAccess, /grainline_seller_guild_metrics_cron_batch/);
    assert.match(guildPrivateAccess, /grainline_seller_guild_metrics_apply/);
    assert.doesNotMatch(
      guildPrivateAccess,
      /sellerProfile\.findMany/,
    );
    assert.match(
      guildCronBatchMigration,
      /CREATE OR REPLACE FUNCTION public\.grainline_seller_guild_member_cron_batch\(/,
    );
    assert.match(
      guildCronBatchMigration,
      /CREATE OR REPLACE FUNCTION public\.grainline_seller_guild_metrics_cron_batch\(/,
    );
    assert.match(guildCronBatchMigration, /JOIN public\."SellerProfilePrivate"/);
    assert.match(
      guildMetricsAuthorityMigration,
      /CREATE OR REPLACE FUNCTION public\.grainline_seller_guild_metrics_apply\(/,
    );
    assert.match(guildMetricsAuthorityMigration, /FOR UPDATE/);
    assert.match(guildMetricsAuthorityMigration, /metrics\."calculatedAt" = p_calculated_at/);
    assert.match(guildMetricsAuthorityMigration, /INTERVAL '30 days'/);
    assert.match(guildMetricsAuthorityMigration, /INSERT INTO public\."SystemAuditLog"/);
    assert.match(
      guildMemberRevocationAuthorityMigration,
      /CREATE OR REPLACE FUNCTION public\.grainline_seller_guild_member_revoke\(/,
    );
    assert.match(guildMemberRevocationAuthorityMigration, /grainline_case_guild_unresolved_guard/);
    assert.match(guildMemberRevocationAuthorityMigration, /pg_catalog\.count\(\*\)/);
    assert.match(guildMemberRevocationAuthorityMigration, /INTERVAL '30 days'/);
    assert.match(guildMemberRevocationAuthorityMigration, /INSERT INTO public\."SystemAuditLog"/);
    assert.match(
      provisioning,
      /public\."grainline_seller_guild_member_cron_batch"\(text, integer\)/,
    );
    assert.match(
      provisioning,
      /public\."grainline_seller_guild_metrics_apply"\(text, timestamp without time zone\)/,
    );
    assert.match(
      provisioning,
      /public\."grainline_seller_guild_member_revoke"\(text\)/,
    );
    assert.doesNotMatch(guildMemberCron, /(?:prisma|tx)\.makerVerification\./);
    assert.doesNotMatch(guildMetricsCron, /(?:prisma|tx)\.makerVerification\./);
    assert.doesNotMatch(guildPrivateAccess, /consecutiveMetricFailures:\s*\{/);
    assert.match(ownerPrivateAccess, /where: \{ id: input\.sellerProfileId, userId: input\.userId \}/);
  });

  it("funnels staff ban and undo seller state through one compatibility boundary", () => {
    const ban = readFileSync("src/lib/ban.ts", "utf8");
    const audit = readFileSync("src/lib/audit.ts", "utf8");
    assert.match(ban, /sellerStaffOrderabilityState/);
    assert.match(ban, /disableSellerForStaff/);
    assert.match(audit, /setSellerStaffOrderability/);
    assert.match(staffPrivateAccess, /grainline_seller_staff_orderability_state/);
    assert.doesNotMatch(staffPrivateAccess, /stripeAccountId: true/);
    assert.match(remainingAppAuthorityMigration, /SESSION_USER <> 'grainline_staff_read_runtime'/);
    assert.match(remainingAppAuthorityMigration, /grainline_seller_staff_orderability_state/);
    assert.match(remainingAppAuthorityMigration, /TO grainline_staff_read_runtime/);
    assert.doesNotMatch(
      `${ban}\n${audit}`,
      /sellerProfile\.(?:findUnique|findFirst)[\s\S]{0,300}stripeAccountId:\s*true/,
    );
  });

  it("funnels account-deletion seller mutations through one compatibility boundary", () => {
    const accountDeletion = readFileSync("src/lib/accountDeletion.ts", "utf8");
    assert.match(accountDeletion, /pauseSellerForAccountDeletion/);
    assert.match(accountDeletion, /anonymizeSellerForAccountDeletion/);
    assert.doesNotMatch(
      accountDeletion,
      /(?:prisma|tx)\.sellerProfile\.(?:update|updateMany)/,
    );
    assert.match(accountDeletionPrivateAccess, /grainline_seller_account_deletion_pause/);
    assert.match(accountDeletionPrivateAccess, /grainline_seller_account_deletion_anonymize/);
    assert.match(accountDeletionPrivateAccess, /grainline_seller_account_deletion_reconciliation_clear/);
    assert.match(accountDeletionPrivateAccess, /Pick<Prisma\.TransactionClient, "\$queryRaw">/);
    assert.doesNotMatch(accountDeletionPrivateAccess, /sellerProfile\.(?:update|updateMany)/);
  });

  it("moves remaining profile views and owner Guild application writes to fixed operations", () => {
    const sellerProfileView = readFileSync("src/app/api/seller/[id]/view/route.ts", "utf8");
    const ownerGuild = readFileSync("src/app/dashboard/verification/page.tsx", "utf8");
    assert.match(profileViewAccess, /grainline_seller_profile_view_record/);
    assert.match(sellerProfileView, /recordSellerProfileView\(id, todayUtcBucket\(\)\)/);
    assert.doesNotMatch(sellerProfileView, /sellerProfile\.update|sellerProfileViewDaily\.upsert/);
    assert.match(ownerPrivateAccess, /grainline_seller_owner_guild_master_application_record/);
    assert.match(ownerGuild, /recordSellerOwnerGuildMasterApplication/);
    assert.match(remainingAppAuthorityMigration, /FOR UPDATE OF seller, seller_private/);
    assert.match(provisioning, /grainline_seller_profile_view_record"\(text, date\)/);
    assert.match(provisioning, /grainline_seller_owner_guild_master_application_record/);
  });

  it("derives Guild listing-threshold state inside one fixed database operation", () => {
    assert.match(guildListingThreshold, /grainline_seller_guild_listing_threshold_sync/);
    assert.doesNotMatch(guildListingThreshold, /UPDATE\s+"SellerProfile"/);
    assert.match(
      guildListingThresholdMigration,
      /CREATE OR REPLACE FUNCTION public\.grainline_seller_guild_listing_threshold_sync\(/,
    );
    assert.match(guildListingThresholdMigration, /JOIN public\."SellerProfilePrivate"/);
    assert.match(guildListingThresholdMigration, /FROM public\."Listing" AS listing/);
    assert.match(guildListingThresholdMigration, /UPDATE public\."SellerProfilePrivate"/);
    assert.match(guildListingThresholdMigration, /UPDATE public\."SellerProfile"/);
    assert.doesNotMatch(
      guildListingThresholdMigration,
      /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)[\s\S]*SellerProfilePrivate/i,
    );
    assert.match(
      provisioning,
      /public\."grainline_seller_guild_listing_threshold_sync"\(text\)/,
    );
  });
});
