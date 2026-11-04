import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { RUNTIME_PRIVATE_FUNCTIONS } from "../scripts/audit-runtime-db-grants.mjs";

const root = new URL("../", import.meta.url);

test("Listing review and customer-photo history use bounded reusable authorities", async () => {
  const [
    migration,
    access,
    accountReviews,
    accountExport,
    reviewRoute,
    reviewReplyRoute,
    adminReviews,
    adminReviewRoute,
    sellerPage,
    customerPhotosPage,
    deletion,
    provision,
    staffProvision,
    fullChain,
  ] = await Promise.all([
    readFile(new URL("prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql", root), "utf8"),
    readFile(new URL("src/lib/listingReviewHistoryAccess.ts", root), "utf8"),
    readFile(new URL("src/app/account/reviews/page.tsx", root), "utf8"),
    readFile(new URL("src/app/api/account/export/route.ts", root), "utf8"),
    readFile(new URL("src/app/api/reviews/[id]/route.ts", root), "utf8"),
    readFile(new URL("src/app/api/reviews/[id]/reply/route.ts", root), "utf8"),
    readFile(new URL("src/app/admin/reviews/page.tsx", root), "utf8"),
    readFile(new URL("src/app/api/admin/reviews/[id]/route.ts", root), "utf8"),
    readFile(new URL("src/app/seller/[id]/page.tsx", root), "utf8"),
    readFile(new URL("src/app/seller/[id]/customer-photos/page.tsx", root), "utf8"),
    readFile(new URL("src/lib/accountDeletion.ts", root), "utf8"),
    readFile(new URL("scripts/provision-runtime-db-role.sql", root), "utf8"),
    readFile(new URL("scripts/provision-order-staff-read-role.sql", root), "utf8"),
    readFile(new URL("tests/database-full-chain-postgres.test.mjs", root), "utf8"),
  ]);

  assert.match(migration, /CREATE FUNCTION public\.grainline_listing_actor_review_contexts\(/u);
  assert.match(migration, /CREATE FUNCTION public\.grainline_listing_public_customer_photo_page\(/u);
  assert.match(migration, /UPDATE public\."Review" AS review[\s\S]*sellerReply/u);
  assert.match(migration, /grainline_listing_staff_reference_targets[\s\S]*"sellerProfileId"/u);

  assert.match(access, /export function listingActorReviewContexts/u);
  assert.match(access, /export function listingPublicCustomerPhotoPage/u);
  assert.match(accountReviews, /listingActorReviewContexts/u);
  assert.match(accountExport, /listingActorReviewContexts/u);
  assert.match(reviewRoute, /listingActorReviewContexts/u);
  assert.match(reviewReplyRoute, /listingActorReviewContexts/u);
  assert.match(adminReviews, /listingStaffReferenceTargets/u);
  assert.match(adminReviewRoute, /listingStaffReferenceTargets/u);
  assert.match(sellerPage, /listingPublicCustomerPhotoPage/u);
  assert.match(customerPhotosPage, /listingPublicCustomerPhotoPage/u);

  for (const source of [
    accountReviews,
    accountExport,
    reviewRoute,
    reviewReplyRoute,
    adminReviews,
    adminReviewRoute,
    sellerPage,
    customerPhotosPage,
  ]) {
    assert.doesNotMatch(source, /listing:\s*\{\s*select:/u);
  }
  assert.doesNotMatch(deletion, /where:\s*\{\s*listing:\s*\{\s*sellerId:/u);

  assert.match(provision, /public\."grainline_listing_actor_review_contexts"\(text\[\]\)/u);
  assert.match(provision, /public\."grainline_listing_public_customer_photo_page"\(text,integer,integer\)/u);
  assert.equal(
    RUNTIME_PRIVATE_FUNCTIONS.includes("grainline_listing_actor_review_contexts"),
    false,
  );
  assert.equal(
    RUNTIME_PRIVATE_FUNCTIONS.includes("grainline_listing_public_customer_photo_page"),
    false,
  );
  assert.match(staffProvision, /public\."grainline_listing_staff_reference_targets"\(text, text\[\]\)/u);
  assert.match(fullChain, /proveListingDomainReviewHistory/u);
});
