import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("listing AI review uses one actor-bound owner context", async () => {
  const [migration, access, aiReview, shopActions, editPage, newPage, customPage, provision] =
    await Promise.all([
      readFile(new URL("prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql", root), "utf8"),
      readFile(new URL("src/lib/listingOwnerAccess.ts", root), "utf8"),
      readFile(new URL("src/lib/ai-review.ts", root), "utf8"),
      readFile(new URL("src/app/seller/[id]/shop/actions.ts", root), "utf8"),
      readFile(new URL("src/app/dashboard/listings/[id]/edit/page.tsx", root), "utf8"),
      readFile(new URL("src/app/dashboard/listings/new/page.tsx", root), "utf8"),
      readFile(new URL("src/app/dashboard/listings/custom/page.tsx", root), "utf8"),
      readFile(new URL("scripts/provision-runtime-db-role.sql", root), "utf8"),
    ]);

  const contextStart = migration.indexOf(
    "CREATE FUNCTION public.grainline_listing_owner_ai_review_context(",
  );
  const contextEnd = migration.indexOf(
    "CREATE FUNCTION public.grainline_listing_owner_alt_text_backfill(",
    contextStart,
  );
  assert.ok(contextStart >= 0 && contextEnd > contextStart);
  const contextAuthority = migration.slice(contextStart, contextEnd);

  assert.match(
    contextAuthority,
    /CREATE FUNCTION public\.grainline_listing_owner_ai_review_context\(\s*p_listing_id text\s*\)[\s\S]*current_setting\('app\.user_id', true\)/u,
  );
  assert.match(contextAuthority, /listing\."sellerId" = seller\.id/u);
  assert.match(contextAuthority, /photo\."listingId" = p_listing_id/u);
  assert.match(contextAuthority, /recent_listing\."createdAt" >= source_now - INTERVAL '7 days'/u);
  assert.match(
    contextAuthority,
    /GRANT EXECUTE ON FUNCTION public\.grainline_listing_owner_ai_review_context\(text\)[\s\S]*TO grainline_app_runtime/u,
  );

  assert.match(access, /export function listingOwnerAiReviewContext\(userId: string, listingId: string\)/u);
  assert.match(access, /FROM public\.grainline_listing_owner_ai_review_context\(/u);
  assert.match(aiReview, /recentListingTitles/u);
  assert.doesNotMatch(aiReview, /prisma\.listing\.findMany/u);
  assert.doesNotMatch(shopActions, /prisma\.photo\.findMany/u);
  assert.doesNotMatch(editPage, /prisma\.photo\.findMany/u);

  for (const source of [shopActions, editPage, newPage, customPage]) {
    assert.match(source, /listingOwnerAiReviewContext\(/u);
  }

  assert.match(
    provision,
    /public\."grainline_listing_owner_ai_review_context"\(text\)'\s*,\s*true/u,
  );
});
