import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { sellerProfilePrivateMigrationPath } from "./helpers/seller-profile-private-migration-path.mjs";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("seller display-name lookup normalization guardrails", () => {
  it("persists and backfills a normalized seller display-name lookup key", () => {
    const schema = source("prisma/schema.prisma");
    const migration = source("prisma/migrations/20260530220000_seller_display_name_normalized/migration.sql");

    assert.match(schema, /displayNameNormalized\s+String\s+@db\.VarChar\(100\)/);
    assert.match(schema, /@@index\(\[displayNameNormalized\]\)/);
    assert.match(migration, /ADD COLUMN "displayNameNormalized" VARCHAR\(100\)/);
    assert.match(migration, /translate\(/);
    assert.match(migration, /ALTER COLUMN "displayNameNormalized" SET NOT NULL/);
    assert.match(migration, /CREATE INDEX "SellerProfile_displayNameNormalized_idx"/);
  });

  it("updates normalized names on seller creation, onboarding, profile edit, and deletion", () => {
    const ensureSeller = source("src/lib/ensureSeller.ts");
    const onboarding = source("src/app/dashboard/onboarding/actions.ts");
    const profile = source("src/app/dashboard/profile/page.tsx");
    const ownerAccess = source("src/lib/sellerOwnerPrivateAccess.ts");
    const deletion = readFileSync(
      sellerProfilePrivateMigrationPath("20261014160000_prepare_seller_profile_private_account_deletion_app_authorities"),
      "utf8",
    );

    assert.match(ensureSeller, /displayNameNormalized: normalizeDisplayNameForLookup\(displayName\)/);
    assert.match(onboarding, /displayNameNormalized: normalizeDisplayNameForLookup\(displayName\)/);
    assert.match(profile, /const displayNameNormalized = normalizeDisplayNameForLookup\(displayName\)/);
    assert.match(ownerAccess, /displayNameNormalized: \{\s*equals: input\.displayNameNormalized,\s*mode: "insensitive",?\s*\}/s);
    assert.match(profile, /displayNameNormalized,/);
    assert.match(deletion, /"displayNameNormalized" = 'Deleted maker'/);
  });

  it("uses normalized seller display names in public search surfaces", () => {
    const suggestions = source("src/app/api/search/suggestions/route.ts");
    const blogSuggestions = source("src/app/api/blog/search/suggestions/route.ts");
    const browse = source("src/app/browse/page.tsx");

    for (const text of [suggestions, blogSuggestions, browse]) {
      assert.match(text, /normalizeDisplayNameForLookup\(q\)/);
      assert.match(text, /displayNameNormalized: \{ contains: normalizedDisplayNameQuery, mode: "insensitive"/);
    }
  });
});
