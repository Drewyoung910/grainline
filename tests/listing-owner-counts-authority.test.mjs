import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql",
  import.meta.url,
);
const accessPath = new URL("../src/lib/listingOwnerAccess.ts", import.meta.url);
const sellerSettingsPath = new URL("../src/app/dashboard/seller/page.tsx", import.meta.url);
const verificationPath = new URL("../src/app/dashboard/verification/page.tsx", import.meta.url);
const verificationApplyPath = new URL("../src/app/api/verification/apply/route.ts", import.meta.url);
const analyticsPath = new URL("../src/app/api/seller/analytics/route.ts", import.meta.url);
const provisionPath = new URL("../scripts/provision-runtime-db-role.sql", import.meta.url);

test("owner listing counts use one actor-bound aggregate authority", async () => {
  const [
    migration,
    access,
    sellerSettings,
    verification,
    verificationApply,
    analytics,
    provision,
  ] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(accessPath, "utf8"),
    readFile(sellerSettingsPath, "utf8"),
    readFile(verificationPath, "utf8"),
    readFile(verificationApplyPath, "utf8"),
    readFile(analyticsPath, "utf8"),
    readFile(provisionPath, "utf8"),
  ]);

  assert.match(
    migration,
    /CREATE FUNCTION public\.grainline_listing_owner_counts\(\)[\s\S]*RETURNS TABLE \([\s\S]*"draftCount" bigint,[\s\S]*"activeCount" bigint,[\s\S]*"activePublicCount" bigint/u,
  );
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /listing\.status = 'DRAFT'/u);
  assert.match(migration, /listing\.status = 'ACTIVE'/u);
  assert.match(migration, /listing\."isPrivate" = false/u);
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.grainline_listing_owner_counts\(\)[\s\S]*TO grainline_app_runtime/u,
  );

  assert.match(access, /export function listingOwnerCounts\(userId: string\)/u);
  assert.match(access, /FROM public\.grainline_listing_owner_counts\(\)/u);

  assert.match(sellerSettings, /listingOwnerCounts\(me\.id\)/u);
  assert.match(verification, /listingOwnerCounts\(sellerUserId\)/u);
  assert.match(verificationApply, /listingOwnerCounts\(me\.id\)/u);
  assert.match(analytics, /listingOwnerCounts\(me\.id\)/u);
  for (const source of [sellerSettings, verification, verificationApply, analytics]) {
    assert.doesNotMatch(source, /prisma\.listing\.count\(/u);
  }

  assert.match(
    provision,
    /public\."grainline_listing_owner_counts"\(\)'\s*,\s*true/u,
  );
});
