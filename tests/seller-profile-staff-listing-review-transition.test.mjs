import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/admin/listings/[id]/review/route.ts", "utf8");
const access = readFileSync("src/lib/sellerProfileStaffAccess.ts", "utf8");
const migration = readFileSync(
  "prisma/migrations/20261020235999_prepare_seller_profile_staff_listing_review_transition/migration.sql",
  "utf8",
);

test("admin listing review uses one isolated-staff transition", () => {
  assert.match(
    route,
    /sellerProfileStaffListingReviewTransition\(\s*getOrderStaffReadClient\(\),\s*\{/u,
  );
  assert.match(route, /actorId: admin\.id/u);
  assert.doesNotMatch(route, /prisma\.listing\.findUnique/u);
  assert.doesNotMatch(route, /include:\s*\{[\s\S]*?seller:\s*\{/u);
  assert.doesNotMatch(route, /logAdminActionOrThrow/u);
  assert.match(access, /grainline_seller_staff_listing_review_transition/u);
});

test("listing review transition retains staff, state, availability, and audit gates", () => {
  assert.match(migration, /SESSION_USER <> 'grainline_staff_read_runtime'/u);
  assert.match(migration, /actor\.role::text IN \('ADMIN', 'EMPLOYEE'\)/u);
  assert.match(migration, /actor\.banned = false/u);
  assert.match(migration, /actor\."deletedAt" IS NULL/u);
  assert.match(migration, /FROM public\."Listing" AS listing[\s\S]*FOR UPDATE/u);
  assert.match(migration, /FROM public\."SellerProfile" AS seller[\s\S]*FOR UPDATE/u);
  assert.match(migration, /source_listing\.status <> 'PENDING_REVIEW'::public\."ListingStatus"/u);
  assert.match(migration, /NOT source_seller\."ownerAccountActive"/u);
  assert.match(migration, /NOT source_seller\."chargesEnabled"/u);
  assert.match(migration, /source_seller\."vacationMode"/u);
  assert.match(migration, /INSERT INTO public\."AdminAuditLog"/u);
  assert.match(migration, /SET search_path = pg_catalog/u);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime/u,
  );
  assert.match(migration, /GRANT EXECUTE ON FUNCTION[\s\S]*TO grainline_staff_read_runtime/u);
});
