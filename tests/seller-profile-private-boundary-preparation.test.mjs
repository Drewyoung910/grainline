import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  parseSellerProfilePrivateBoundaryProofConfig,
  qualifySellerProfilePrivateBoundaryMigration,
} from "../scripts/seller-profile-private-boundary-postgres-proof.mjs";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20261013120000_prepare_seller_profile_private_boundary/migration.sql",
  "utf8",
);
const grantAudit = readFileSync("scripts/audit-runtime-db-grants.mjs", "utf8");
const provisioning = readFileSync("scripts/provision-runtime-db-role.sql", "utf8");
const proof = readFileSync(
  "scripts/seller-profile-private-boundary-postgres-proof.mjs",
  "utf8",
);

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
    assert.match(provisioning, /\('SellerProfilePrivate'\)/);
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
    assert.doesNotMatch(qualified, /public\."SellerProfilePrivate"/);
    assert.match(
      qualified,
      /"seller_profile_private_proof_0123456789abcdef0123456789abcdef"\."SellerProfilePrivate"/,
    );
    assert.match(proof, /await client\.query\("ROLLBACK"\)/);
    assert.match(proof, /runtime role unexpectedly read SellerProfilePrivate/);
  });
});
