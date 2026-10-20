import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "prisma/migrations/20261020180000_prepare_seller_profile_owner_onboarding_state/migration.sql",
  "utf8",
);
const access = readFileSync("src/lib/sellerOwnerPrivateAccess.ts", "utf8");
const provision = readFileSync("scripts/provision-runtime-db-role.sql", "utf8");

test("owner onboarding reads use one actor-bound database projection", () => {
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /actor\.banned = false/u);
  assert.match(migration, /actor\."deletedAt" IS NULL/u);
  assert.match(migration, /count\(\*\)[\s\S]*counted_listing\."sellerId" = seller\.id/u);
  assert.match(migration, /ORDER BY listing\."createdAt" DESC, listing\.id DESC/u);
  assert.match(migration, /SET search_path = pg_catalog/u);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime/u,
  );
  assert.match(access, /readSellerOwnerOnboardingState/u);
  assert.equal(
    [...access.matchAll(/grainline_seller_owner_onboarding_state/g)].length,
    1,
  );
  assert.doesNotMatch(access, /sellerOwnerOnboardingSelect/u);
  assert.doesNotMatch(access, /sellerOwnerOnboardingMutationSelect/u);
  assert.match(access, /withDbUserContext\(userId, async \(client\)/u);
  assert.equal(
    [...provision.matchAll(/grainline_seller_owner_onboarding_state/g)].length,
    2,
  );
});
