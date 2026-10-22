import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const browseMetro = readFileSync("src/app/browse/[metroSlug]/page.tsx", "utf8");
const makersMetro = readFileSync("src/app/makers/[metroSlug]/page.tsx", "utf8");

test("public metro seller counts use the bounded aggregate authority", () => {
  assert.match(browseMetro, /sellerPublicMetroCount\(null, metro\.id, isMajor, false\)/u);
  assert.match(browseMetro, /sellerPublicMetroCount\(meDbId, metro\.id, isMajorMetro, false\)/u);
  assert.doesNotMatch(browseMetro, /prisma\.sellerProfile\.count\(/u);
  assert.match(makersMetro, /sellerPublicMetroCount\(\s*meDbId,\s*metro\.id,\s*isMajorMetro,\s*true/u);
  assert.doesNotMatch(makersMetro, /prisma\.sellerProfile\.count\(/u);
});

test("metro count authority owns active, listing, location and block predicates", () => {
  const migration = readFileSync(
    "prisma/migrations/20261019070000_prepare_seller_profile_public_metro_count/migration.sql",
    "utf8",
  );
  assert.match(migration, /seller\."ownerAccountActive" = true[\s\S]*seller\."chargesEnabled" = true[\s\S]*seller\."stripeAccountSupported" = true[\s\S]*seller\."vacationMode" = false/u);
  assert.match(migration, /p_is_major = true AND seller\."metroId" = p_metro_id/u);
  assert.match(migration, /p_is_major = false AND seller\."cityMetroId" = p_metro_id/u);
  assert.match(migration, /p_require_public_listing = false[\s\S]*listing\.status::text = 'ACTIVE'[\s\S]*listing\."isPrivate" = false[\s\S]*listing\."archivedAt" IS NULL/u);
  assert.match(migration, /relationship\."blockerId" = request_user_id[\s\S]*relationship\."blockedId" = request_user_id/u);
});
