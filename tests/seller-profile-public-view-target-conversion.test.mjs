import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/seller/[id]/view/route.ts", "utf8");
const migration = readFileSync(
  "prisma/migrations/20261019130000_prepare_seller_profile_public_view_target/migration.sql",
  "utf8",
);

test("seller-view telemetry uses only its bounded visibility target", () => {
  assert.match(route, /sellerPublicViewTarget\(id\)/u);
  assert.doesNotMatch(route, /prisma\.sellerProfile|visibleSellerProfileWhere/u);
  assert.match(route, /id\.length < 1 \|\| id\.length > 191/u);
  assert.match(route, /viewer\?\.id === seller\.ownerUserId/u);
  assert.match(route, /recordSellerProfileView\(id, todayUtcBucket\(\)\)/u);
});

test("seller-view target authority preserves visible eligibility and exact grants", () => {
  assert.match(migration, /grainline_seller_public_view_target/u);
  assert.match(migration, /"ownerAccountActive" = true/u);
  assert.match(migration, /"chargesEnabled" = true/u);
  assert.match(migration, /"stripeAccountSupported" = true/u);
  assert.doesNotMatch(migration, /"vacationMode" = false/u);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.grainline_seller_public_view_target\(text\)\s+FROM PUBLIC, grainline_app_runtime/u,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.grainline_seller_public_view_target\(text\)\s+TO grainline_app_runtime/u,
  );
});
