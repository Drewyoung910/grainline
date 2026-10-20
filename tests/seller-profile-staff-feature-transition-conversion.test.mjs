import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "prisma/migrations/20261020140000_prepare_seller_profile_staff_feature_transition/migration.sql",
  "utf8",
);
const access = readFileSync("src/lib/sellerGuildStaffPrivateAccess.ts", "utf8");
const page = readFileSync("src/app/admin/verification/page.tsx", "utf8");

test("seller feature transitions are atomic isolated-admin operations", () => {
  assert.match(migration, /SESSION_USER <> 'grainline_staff_read_runtime'/u);
  assert.match(migration, /actor\.role::text = 'ADMIN'/u);
  assert.match(migration, /source_seller\."userId" = p_actor_id/u);
  assert.match(migration, /"featuredUntil" = source_now \+ INTERVAL '7 days'/u);
  assert.match(migration, /"featuredUntil" = NULL/u);
  assert.match(migration, /INSERT INTO public\."AdminAuditLog"/u);
  assert.match(migration, /SET search_path = pg_catalog/u);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime/u,
  );
  assert.match(migration, /GRANT EXECUTE ON FUNCTION[\s\S]*TO grainline_staff_read_runtime/u);
});

test("admin verification no longer directly reads or writes SellerProfile", () => {
  assert.match(access, /grainline_seller_staff_feature_transition/u);
  assert.match(page, /applySellerStaffFeatureTransition\(getOrderStaffReadClient\(\), \{/u);
  assert.doesNotMatch(page, /prisma\.sellerProfile\./u);
  assert.doesNotMatch(page, /tx\.sellerProfile\./u);
  assert.doesNotMatch(page, /logAdminActionOrThrow/u);
});
