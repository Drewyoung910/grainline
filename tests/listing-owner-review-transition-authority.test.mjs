import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("version-bound owner AI review writes use one actor-bound authority", async () => {
  const [migration, helper, newPage, customPage, editPage, provision] = await Promise.all([
    readFile(new URL("prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql", root), "utf8"),
    readFile(new URL("src/lib/listingAiReviewTransition.ts", root), "utf8"),
    readFile(new URL("src/app/dashboard/listings/new/page.tsx", root), "utf8"),
    readFile(new URL("src/app/dashboard/listings/custom/page.tsx", root), "utf8"),
    readFile(new URL("src/app/dashboard/listings/[id]/edit/page.tsx", root), "utf8"),
    readFile(new URL("scripts/provision-runtime-db-role.sql", root), "utf8"),
  ]);

  assert.match(
    migration,
    /CREATE FUNCTION public\.grainline_listing_owner_review_transition\(\s*p_listing_id text,\s*p_reviewed_at timestamp without time zone,\s*p_status text,\s*p_flags text\[\],\s*p_score double precision\s*\)/u,
  );
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /p_status NOT IN \('PENDING_REVIEW', 'ACTIVE', 'SOLD_OUT', 'DRAFT'\)/u);
  assert.match(migration, /source_listing\.status::text <> 'PENDING_REVIEW'/u);
  assert.match(migration, /source_listing\."updatedAt" IS DISTINCT FROM p_reviewed_at/u);
  assert.match(migration, /FOR UPDATE/u);
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.grainline_listing_owner_review_transition\(\s*text,timestamp without time zone,text,text\[\],double precision\s*\)[\s\S]*TO grainline_app_runtime/u,
  );

  assert.match(helper, /withDbUserContext\(userId,/u);
  assert.match(helper, /FROM public\.grainline_listing_owner_review_transition\(/u);
  assert.doesNotMatch(helper, /client\.listing\.updateMany/u);
  assert.equal(newPage.match(/applyVersionBoundListingAiReviewTransition\(seller\.userId,/gu)?.length, 3);
  assert.equal(customPage.match(/applyVersionBoundListingAiReviewTransition\(seller\.userId,/gu)?.length, 2);
  assert.equal(editPage.match(/applyVersionBoundListingAiReviewTransition\(actor\.id,/gu)?.length, 3);
  assert.match(
    provision,
    /public\."grainline_listing_owner_review_transition"\(text,timestamp without time zone,text,text\[\],double precision\)'\s*,\s*true/u,
  );
});
