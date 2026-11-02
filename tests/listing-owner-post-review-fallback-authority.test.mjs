import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("post-review fallback transitions preserve exact owner and version binding", async () => {
  const [migration, ownerAccess, reviewAccess, customPage, editPage] = await Promise.all([
    readFile(new URL("prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql", root), "utf8"),
    readFile(new URL("src/lib/listingOwnerAccess.ts", root), "utf8"),
    readFile(new URL("src/lib/listingAiReviewTransition.ts", root), "utf8"),
    readFile(new URL("src/app/dashboard/listings/custom/page.tsx", root), "utf8"),
    readFile(new URL("src/app/dashboard/listings/[id]/edit/page.tsx", root), "utf8"),
  ]);

  assert.match(
    migration,
    /p_operation NOT IN \('HIDE', 'MARK_SOLD', 'WITHDRAW_REVIEW', 'RETURN_TO_DRAFT'\)/u,
  );
  assert.match(
    migration,
    /p_operation = 'RETURN_TO_DRAFT'[\s\S]*source_listing\.status::text NOT IN \('PENDING_REVIEW', 'ACTIVE', 'SOLD_OUT'\)/u,
  );
  assert.match(migration, /source_listing\."updatedAt" IS DISTINCT FROM p_expected_updated_at/u);
  assert.match(
    migration,
    /RETURNS TABLE \(applied boolean, "updatedAt" timestamp without time zone\)/u,
  );

  assert.match(ownerAccess, /"RETURN_TO_DRAFT"/u);
  assert.match(reviewAccess, /applyVersionBoundListingAiReviewTransitionState/u);
  assert.match(reviewAccess, /updatedAt: unknown/u);
  assert.match(reviewAccess, /row\.updatedAt instanceof Date/u);

  assert.match(customPage, /applyVersionBoundListingAiReviewTransitionState\(seller\.userId,/u);
  assert.match(customPage, /operation: "RETURN_TO_DRAFT"/u);
  assert.match(customPage, /expectedUpdatedAt: activation\.updatedAt/u);
  assert.doesNotMatch(customPage, /prisma\.listing\.updateMany/u);

  assert.match(editPage, /operation: "RETURN_TO_DRAFT"/u);
  assert.match(editPage, /expectedUpdatedAt: updatedListing\.updatedAt/u);
  assert.doesNotMatch(editPage, /prisma\.listing\.updateMany/u);
});
