import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migrationPath =
  "prisma/migrations/20261020100000_prepare_seller_profile_public_profile_authority/migration.sql";
const correctionPath =
  "prisma/migrations/20261020235700_correct_seller_profile_projection_timestamps/migration.sql";

test("public profile authority owns viewer eligibility and reciprocal-block denial", () => {
  const sql = source(migrationPath);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.grainline_seller_public_profile\(/u);
  assert.match(sql, /request_user_id = seller\."userId"/u);
  assert.match(sql, /seller\."ownerAccountActive" = true/u);
  assert.match(sql, /seller\."chargesEnabled" = true/u);
  assert.match(sql, /seller\."stripeAccountSupported" = true/u);
  assert.match(sql, /relationship\."blockerId" = request_user_id/u);
  assert.match(sql, /relationship\."blockedId" = request_user_id/u);
  assert.match(sql, /viewer\.banned = false/u);
  assert.match(sql, /viewer\."deletedAt" IS NULL/u);
});

test("public profile output excludes owner, coordinate, consent, and control columns", () => {
  const sql = source(migrationPath);
  const returns = sql.slice(sql.indexOf("RETURNS TABLE"), sql.indexOf("LANGUAGE plpgsql"));
  for (const forbidden of [
    "userId",
    "lat",
    "lng",
    "radiusMeters",
    "publicMapOptIn",
    "chargesEnabled",
    "stripeAccountSupported",
    "ownerAccountActive",
    "publicMapExactConsent",
  ]) {
    assert.doesNotMatch(returns, new RegExp(forbidden, "u"));
  }
  assert.match(returns, /"viewerIsOwner" boolean/u);
  assert.match(returns, /faqs jsonb/u);
  assert.match(returns, /metro jsonb/u);
  assert.match(returns, /"cityMetro" jsonb/u);
});

test("runtime receives only the hardened fixed public profile operation", () => {
  const sql = source(migrationPath);
  assert.match(sql, /SECURITY DEFINER/u);
  assert.match(sql, /SET search_path = pg_catalog/u);
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.grainline_seller_public_profile\(text\)\s+FROM PUBLIC, grainline_app_runtime/u,
  );
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.grainline_seller_public_profile\(text\)\s+TO grainline_app_runtime/u,
  );
});

test("public profile projection restores stored UTC timestamps at the SQL boundary", () => {
  const sql = source(correctionPath);
  const start = sql.indexOf("DROP FUNCTION public.grainline_seller_public_profile(text)");
  const end = sql.indexOf(
    "DROP FUNCTION public.grainline_seller_owner_guild_application_state(text)",
    start,
  );
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const corrected = sql.slice(start, end);
  assert.match(corrected, /"createdAt" timestamp\(3\) with time zone/u);
  assert.match(corrected, /"vacationReturnDate" timestamp\(3\) with time zone/u);
  assert.match(corrected, /seller\."createdAt" AT TIME ZONE 'UTC'/u);
  assert.match(corrected, /seller\."vacationReturnDate" AT TIME ZONE 'UTC'/u);
});

test("application helper validates output and binds authenticated viewers to transaction context", () => {
  const access = source("src/lib/sellerProfilePublicAccess.ts");
  assert.match(access, /SELECT \* FROM public\.grainline_seller_public_profile\(\$\{sellerProfileId\}\)/u);
  assert.match(access, /return withDbUserContext\(viewerUserId, \(client\) =>\s*readSellerPublicProfile\(client, sellerProfileId\)\)/u);
  assert.match(access, /parseSellerPublicProfileFaqs\(row\.faqs\)/u);
  assert.match(access, /parseSellerPublicProfileMetro\(row\.metro, "metro"\)/u);
});

test("seller profile and shop pages no longer read SellerProfile directly", () => {
  const profilePage = source("src/app/seller/[id]/page.tsx");
  const shopPage = source("src/app/seller/[id]/shop/page.tsx");
  for (const page of [profilePage, shopPage]) {
    assert.match(page, /sellerPublicProfile/u);
    assert.doesNotMatch(page, /prisma\.sellerProfile\./u);
    assert.match(page, /viewerIsOwner/u);
  }
  assert.match(profilePage, /sellerPublicViewTarget\(seller\.id\)/u);
  assert.match(profilePage, /blockedUserIds\.has\(sellerUserId\)/u);
  assert.doesNotMatch(shopPage, /getBlockedUserIdsFor/u);
});
