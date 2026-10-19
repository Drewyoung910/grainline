import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync("src/components/SimilarMakers.tsx", "utf8");
const listingPage = readFileSync("src/app/listing/[id]/page.tsx", "utf8");
const migration = readFileSync(
  "prisma/migrations/20261019080000_prepare_seller_profile_public_similar_makers/migration.sql",
  "utf8",
);

test("similar makers use one listing-bound public authority", () => {
  const call = /<SimilarMakers[\s\S]*?\/>/u.exec(listingPage)?.[0] ?? "";
  assert.match(component, /sellerPublicSimilarMakers\(\s*viewerUserId,\s*listingId,\s*MAX_SIMILAR_MAKERS/u);
  assert.doesNotMatch(component, /prisma\.sellerProfile/u);
  assert.doesNotMatch(component, /activeSellerProfileWhere|publicListingWhere/u);
  assert.match(call, /viewerUserId=\{meId\}/u);
  assert.match(call, /listingId=\{listing\.id\}/u);
  assert.doesNotMatch(call, /blockedUserIds=/u);
});

test("similar-maker authority owns visibility, scope, ordering and card projection", () => {
  assert.match(migration, /seller\."ownerAccountActive" = true[\s\S]*seller\."chargesEnabled" = true[\s\S]*seller\."stripeAccountSupported" = true[\s\S]*seller\."vacationMode" = false/u);
  assert.match(migration, /source_seller\."metroId"[\s\S]*source_seller\."cityMetroId"[\s\S]*pg_catalog\.lower\(seller\.state::text\)/u);
  assert.match(migration, /source_listing\.id = p_source_listing_id[\s\S]*source_listing\."archivedAt" IS NULL/u);
  assert.match(migration, /source_listing\.status::text IN \('ACTIVE', 'SOLD_OUT'\)[\s\S]*source_listing\."isPrivate" = false/u);
  assert.match(migration, /source_listing\.status::text IN \('ACTIVE', 'SOLD'\)[\s\S]*source_listing\."reservedForUserId" = request_user_id/u);
  assert.match(migration, /public_listing\.status::text = 'ACTIVE'[\s\S]*public_listing\."isPrivate" = false[\s\S]*public_listing\."archivedAt" IS NULL/u);
  assert.match(migration, /FROM public\."Block" AS relationship/u);
  assert.match(migration, /ORDER BY candidates\.scope_priority ASC,[\s\S]*candidates\."guildLevel"::public\."GuildLevel" DESC,[\s\S]*candidates\.follower_count DESC,[\s\S]*candidates\.id ASC/u);
  assert.match(migration, /LIMIT p_limit/u);
  assert.doesNotMatch(migration, /seller\."userId"[^\n]*AS/u);
});
