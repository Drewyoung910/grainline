import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/users/[id]/report/route.ts", "utf8");
const migration = readFileSync(
  "prisma/migrations/20261019150000_prepare_seller_profile_public_report_target/migration.sql",
  "utf8",
);

test("seller-profile reports use one boolean target authority", () => {
  assert.match(route, /sellerPublicReportTarget\(body\.targetId, reportedId\)/u);
  assert.doesNotMatch(route, /prisma\.sellerProfile|visibleSellerProfileWhere/u);
});

test("seller-profile report target owns visible eligibility and exact grants", () => {
  assert.match(migration, /RETURNS boolean/u);
  assert.match(migration, /seller\.id = p_seller_profile_id/u);
  assert.match(migration, /seller\."userId" = p_reported_user_id/u);
  assert.match(migration, /seller\."ownerAccountActive" = true/u);
  assert.match(migration, /seller\."chargesEnabled" = true/u);
  assert.match(migration, /seller\."stripeAccountSupported" = true/u);
  assert.doesNotMatch(migration, /seller\."vacationMode" = false/u);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.grainline_seller_public_report_target\(text, text\)\s+FROM PUBLIC, grainline_app_runtime/u,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.grainline_seller_public_report_target\(text, text\)\s+TO grainline_app_runtime/u,
  );
});
