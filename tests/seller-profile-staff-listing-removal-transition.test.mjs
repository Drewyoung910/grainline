import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/admin/listings/[id]/route.ts", "utf8");
const access = readFileSync("src/lib/sellerProfileStaffAccess.ts", "utf8");
const reviewPage = readFileSync("src/app/admin/review/page.tsx", "utf8");
const removeButton = readFileSync("src/components/admin/DeleteListingButton.tsx", "utf8");
const migration = readFileSync(
  "prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql",
  "utf8",
);

test("staff listing removal binds the reviewed card version", () => {
  assert.match(reviewPage, /<DeleteListingButton[\s\S]*reviewedAt=\{listing\.updatedAt\.toISOString\(\)\}/u);
  assert.match(removeButton, /reviewedAt: string/u);
  assert.match(removeButton, /JSON\.stringify\(\{ reviewedAt \}\)/u);
  assert.match(route, /reviewedAt: z\.iso\.datetime/u);
  assert.match(route, /sellerProfileStaffListingRemovalTransition\([\s\S]*getOrderStaffReadClient\(\)/u);
  assert.match(route, /reviewedAt: new Date\(reviewedAt\)/u);
  assert.match(route, /blockReason === "LISTING_VERSION_CHANGED"/u);
  assert.doesNotMatch(route, /prisma\.listing\.(?:findUnique|update)/u);
  assert.doesNotMatch(route, /withDbUserContext/u);
  assert.doesNotMatch(route, /deleteFavoritesForAdminListing/u);
  assert.doesNotMatch(route, /deleteStockNotificationsForAdminListing/u);
  assert.doesNotMatch(route, /deleteCartItemsForAdminListing/u);
  assert.doesNotMatch(route, /logAdminActionOrThrow/u);
});

test("staff listing removal is one isolated-role cleanup and audit transition", () => {
  assert.match(access, /sellerProfileStaffListingRemovalTransition/u);
  assert.match(access, /grainline_seller_staff_listing_remove_transition/u);
  assert.match(access, /reviewedAt: Date/u);
  assert.match(
    migration,
    /grainline_seller_staff_listing_remove_transition\(\s*p_actor_id text,\s*p_listing_id text,\s*p_reviewed_updated_at timestamp without time zone/u,
  );
  assert.match(migration, /SESSION_USER <> 'grainline_staff_read_runtime'/u);
  assert.match(migration, /actor\.role::text = 'ADMIN'/u);
  assert.match(migration, /FROM public\."Listing" AS listing[\s\S]*FOR UPDATE/u);
  assert.match(migration, /source_listing\."updatedAt" IS DISTINCT FROM p_reviewed_updated_at/u);
  assert.match(migration, /'LISTING_VERSION_CHANGED'::text/u);
  assert.match(migration, /pg_catalog\.set_config\('app\.user_id', p_actor_id, true\)/u);
  assert.match(migration, /grainline_favorite_admin_listing_cleanup\(p_listing_id\)/u);
  assert.match(migration, /grainline_stock_notification_admin_listing_cleanup\(p_listing_id\)/u);
  assert.match(migration, /grainline_cart_item_admin_listing_cleanup\(p_listing_id\)/u);
  assert.match(migration, /UPDATE public\."Listing"[\s\S]*status = 'REJECTED'/u);
  assert.match(migration, /INSERT INTO public\."AdminAuditLog"/u);
  assert.match(migration, /'previousStatus', source_listing\.status::text/u);
  assert.match(migration, /'previousIsPrivate', source_listing\."isPrivate"/u);
  assert.match(migration, /'previousRejectionReason', source_listing\."rejectionReason"/u);
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.grainline_seller_staff_listing_remove_transition\(\s*text,text,timestamp without time zone\s*\) TO grainline_staff_read_runtime/u,
  );
});
