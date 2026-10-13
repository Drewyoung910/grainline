import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  parseSellerProfilePrivateBoundaryProofConfig,
  qualifySellerProfilePrivateBoundaryMigration,
} from "../scripts/seller-profile-private-boundary-postgres-proof.mjs";

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
const shippingPrivateAccess = readFileSync(
  "src/lib/sellerShippingPrivateAccess.ts",
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
const accountDeletionPrivateAccess = readFileSync(
  "src/lib/sellerAccountDeletionPrivateAccess.ts",
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

describe("SellerProfile private-boundary additive preparation", () => {
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
    assert.match(schema, /model SellerProfile \{[\s\S]*shipFromLine1\s+String\?/);
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

  it("keeps the companion inaccessible to ordinary runtime and PUBLIC", () => {
    assert.match(migration, /REVOKE ALL ON TABLE public\."SellerProfilePrivate" FROM PUBLIC/);
    assert.match(migration, /to_regrole\('grainline_app_runtime'\)/);
    assert.match(migration, /REVOKE ALL ON TABLE public\."SellerProfilePrivate" FROM grainline_app_runtime/);
    assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path = pg_catalog/);
    assert.match(grantAudit, /RUNTIME_PRIVATE_TABLES[\s\S]*"SellerProfilePrivate"/);
    assert.match(
      grantAudit,
      /RUNTIME_PRIVATE_FUNCTIONS[\s\S]*"grainline_seller_profile_private_mirror"[\s\S]*"grainline_seller_profile_supported_snapshot"/,
    );
    assert.match(provisioning, /\('SellerProfilePrivate'\)/);
    assert.match(provisioning, /"grainline_seller_profile_private_mirror"\(\)/);
    assert.match(provisioning, /"grainline_seller_profile_supported_snapshot"\(\)/);
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
    const postgresProof = ci.indexOf("Prove SellerProfile private boundary in ephemeral PostgreSQL");

    assert.ok(verify >= 0);
    assert.ok(verify < isolate);
    assert.ok(isolate < historical);
    assert.ok(historical < finalPredecessor);
    assert.ok(finalPredecessor < restore);
    assert.ok(historical < restore);
    assert.ok(restore < deploy);
    assert.ok(deploy < ledger);
    assert.ok(ledger < postgresProof);
    assert.ok(deploy < postgresProof);
    assert.match(
      ci,
      /Isolate SellerProfile private-boundary migration[\s\S]*mv \\\s+prisma\/migrations\/20261013120000_prepare_seller_profile_private_boundary/,
    );
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
      /Restore SellerProfile private-boundary migration after all predecessors[\s\S]*prisma\/migrations\/20261013120000_prepare_seller_profile_private_boundary[\s\S]*SELLER_PROFILE_PRIVATE_BOUNDARY_MIGRATION_ISOLATED=/,
    );
    assert.match(
      ci,
      /Restore SellerProfile private-boundary migration after all predecessors[\s\S]*SELLER_PROFILE_PRIVATE_BOUNDARY_MIGRATION_PATH=/,
    );
    assert.match(
      ci,
      /Apply SellerProfile private-boundary migration in disposable PostgreSQL[\s\S]*--file=prisma\/migrations\/20261013120000_prepare_seller_profile_private_boundary\/migration\.sql/,
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
    assert.match(stripePrivateAccess, /Compatibility boundary for private Stripe state/);
    assert.match(stripePrivateAccess, /sellerStripeOwnerSelect/);
    assert.match(stripePrivateAccess, /sellerStripeReconciliationPage/);
    assert.match(stripePrivateAccess, /sellerStripeMirrorState/);
    assert.match(stripePrivateAccess, /updateSellerStripeChargesEnabled/);
  });

  it("funnels shipping quote private inputs through one compatibility boundary", () => {
    const route = readFileSync("src/app/api/shipping/quote/route.ts", "utf8");
    assert.equal(
      route.split("sellerShippingQuoteState(sellerId)").length - 1,
      2,
    );
    assert.doesNotMatch(
      route,
      /prisma\.sellerProfile\.findUnique\([\s\S]{0,500}shipFromLine1/,
    );
    assert.match(shippingPrivateAccess, /Compatibility boundary for private seller fulfillment inputs/);
    assert.match(shippingPrivateAccess, /const sellerShippingQuoteSelect/);
    assert.match(shippingPrivateAccess, /shipFromLine1: true/);
    assert.match(shippingPrivateAccess, /defaultPkgWeightGrams: true/);
    assert.match(shippingPrivateAccess, /preferredCarriers: true/);
    assert.match(shippingPrivateAccess, /sellerShippingQuoteState/);
  });

  it("funnels owner onboarding and export reads through one compatibility boundary", () => {
    const onboarding = readFileSync("src/app/dashboard/onboarding/page.tsx", "utf8");
    const onboardingActions = readFileSync("src/app/dashboard/onboarding/actions.ts", "utf8");
    const shopSettings = readFileSync("src/app/dashboard/seller/page.tsx", "utf8");
    const profileEditor = readFileSync("src/app/dashboard/profile/page.tsx", "utf8");
    const accountExport = readFileSync("src/app/api/account/export/route.ts", "utf8");
    assert.match(onboarding, /sellerOwnerOnboardingState\(seller\.id\)/);
    assert.match(accountExport, /sellerOwnerExportProfile\(user\.id\)/);
    assert.doesNotMatch(onboarding, /prisma\.sellerProfile\./);
    assert.doesNotMatch(onboardingActions, /(?:prisma|tx)\.sellerProfile\./);
    assert.doesNotMatch(shopSettings, /prisma\.sellerProfile\./);
    assert.doesNotMatch(profileEditor, /(?:prisma|tx)\.sellerProfile\./);
    assert.doesNotMatch(accountExport, /prisma\.sellerProfile\./);
    assert.match(ownerPrivateAccess, /sellerOwnerOnboardingSelect/);
    assert.match(ownerPrivateAccess, /sellerOwnerExportSelect/);
    assert.match(ownerPrivateAccess, /manualStripeReconciliationNeeded: true/);
    assert.match(ownerPrivateAccess, /guildMasterReviewNotes: true/);
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
    assert.match(ownerPrivateAccess, /where: \{ id: input\.sellerProfileId, userId: input\.userId \}/);
  });

  it("funnels staff ban and undo seller state through one compatibility boundary", () => {
    const ban = readFileSync("src/lib/ban.ts", "utf8");
    const audit = readFileSync("src/lib/audit.ts", "utf8");
    assert.doesNotMatch(ban, /(?:prisma|tx)\.sellerProfile\./);
    assert.doesNotMatch(audit, /(?:prisma|tx)\.sellerProfile\./);
    assert.match(ban, /sellerStaffOrderabilityState/);
    assert.match(ban, /disableSellerForStaff/);
    assert.match(audit, /setSellerStaffOrderability/);
    assert.match(staffPrivateAccess, /sellerStaffOrderabilitySelect/);
    assert.match(staffPrivateAccess, /stripeAccountId: true/);
  });

  it("funnels account-deletion seller mutations through one compatibility boundary", () => {
    const accountDeletion = readFileSync("src/lib/accountDeletion.ts", "utf8");
    assert.match(accountDeletion, /pauseSellerForAccountDeletion/);
    assert.match(accountDeletion, /anonymizeSellerForAccountDeletion/);
    assert.doesNotMatch(
      accountDeletion,
      /(?:prisma|tx)\.sellerProfile\.(?:update|updateMany)/,
    );
    assert.match(accountDeletionPrivateAccess, /where: \{ id: input\.sellerProfileId, userId: input\.userId \}/);
    assert.match(accountDeletionPrivateAccess, /if \(result\.count !== 1\)/);
    assert.match(accountDeletionPrivateAccess, /galleryImageUrls: \[\]/);
    assert.match(accountDeletionPrivateAccess, /manualStripeReconciliationNeeded: !input\.stripeRejectSucceeded/);
  });
});
