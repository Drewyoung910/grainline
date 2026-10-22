import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/reviews/route.ts", "utf8");
const access = readFileSync("src/lib/sellerProfilePublicAccess.ts", "utf8");
const migration = readFileSync(
  "prisma/migrations/20261020235998_prepare_seller_profile_actor_review_listing_target/migration.sql",
  "utf8",
);

test("review creation resolves listing seller fields through one actor-bound authority", () => {
  assert.equal(
    (route.match(/sellerActorReviewListingTarget\(me\.id, listingId\)/gu) ?? []).length,
    2,
  );
  assert.doesNotMatch(route, /prisma\.listing\.findUnique/u);
  assert.doesNotMatch(route, /seller:\s*\{\s*select:/u);
  assert.match(
    access,
    /withDbUserContext\(actorUserId, \(client\) =>\s*readSellerActorReviewListingTarget/u,
  );
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /actor\.banned = false[\s\S]*actor\."deletedAt" IS NULL/u);
  assert.match(migration, /listing\.title::text[\s\S]*seller\."ownerAccountActive"/u);
  assert.doesNotMatch(
    migration,
    /listing\.status|listing\."isPrivate"|listing\."archivedAt"|seller\."chargesEnabled"/u,
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.grainline_seller_actor_review_listing_target\(text\)\s*FROM PUBLIC, grainline_app_runtime/u,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.grainline_seller_actor_review_listing_target\(text\)\s*TO grainline_app_runtime/u,
  );
});
