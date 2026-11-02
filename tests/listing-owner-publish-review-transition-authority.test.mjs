import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("every owner AI review result uses one version-bound transition matrix", async () => {
  const [migration, helper, shopActions, newPage, customPage, editPage, provision] = await Promise.all([
    readFile(new URL("prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql", root), "utf8"),
    readFile(new URL("src/lib/listingAiReviewTransition.ts", root), "utf8"),
    readFile(new URL("src/app/seller/[id]/shop/actions.ts", root), "utf8"),
    readFile(new URL("src/app/dashboard/listings/new/page.tsx", root), "utf8"),
    readFile(new URL("src/app/dashboard/listings/custom/page.tsx", root), "utf8"),
    readFile(new URL("src/app/dashboard/listings/[id]/edit/page.tsx", root), "utf8"),
    readFile(new URL("scripts/provision-runtime-db-role.sql", root), "utf8"),
  ]);

  assert.match(
    migration,
    /CREATE FUNCTION public\.grainline_listing_owner_review_transition\(\s*p_listing_id text,\s*p_reviewed_at timestamp without time zone,\s*p_source_status text,\s*p_status text,\s*p_flags text\[\],\s*p_score double precision\s*\)/u,
  );
  assert.match(migration, /source_listing\.status::text <> p_source_status/u);
  assert.match(migration, /p_source_status = 'PENDING_REVIEW'[\s\S]*p_status IN \('PENDING_REVIEW', 'ACTIVE', 'SOLD_OUT', 'DRAFT'\)/u);
  assert.match(migration, /p_source_status IN \('DRAFT', 'HIDDEN', 'SOLD', 'SOLD_OUT', 'REJECTED'\)[\s\S]*p_status IN \('PENDING_REVIEW', 'ACTIVE'\)/u);
  assert.match(migration, /source_listing\."rejectionReason" = 'Removed by Grainline staff\.'/u);
  assert.match(migration, /source_listing\."listingType"::text = 'IN_STOCK'[\s\S]*COALESCE\(source_listing\."stockQuantity", 0\) <= 0/u);

  assert.match(helper, /sourceStatus: ListingStatus/u);
  assert.match(helper, /\$\{input\.sourceStatus\}::text/u);
  assert.equal(shopActions.match(/applyVersionBoundListingAiReviewTransition\(\s*listing\.seller\.userId,/gu)?.length, 3);
  const publishAction = shopActions.slice(shopActions.indexOf("export async function publishListingAction"));
  assert.doesNotMatch(publishAction, /prisma\.listing\.updateMany/u);
  assert.doesNotMatch(publishAction, /UPDATE "Listing"[\s\S]*SET status = 'SOLD_OUT'/u);

  assert.equal(newPage.match(/sourceStatus: ListingStatus\.PENDING_REVIEW/gu)?.length, 3);
  assert.equal(customPage.match(/sourceStatus: ListingStatus\.PENDING_REVIEW/gu)?.length, 2);
  assert.equal(editPage.match(/sourceStatus: ListingStatus\.PENDING_REVIEW/gu)?.length, 3);
  assert.match(
    provision,
    /public\."grainline_listing_owner_review_transition"\(text,timestamp without time zone,text,text,text\[\],double precision\)'\s*,\s*true/u,
  );
});
