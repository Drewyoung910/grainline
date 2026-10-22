import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  "src/app/dashboard/listings/[id]/edit/page.tsx",
  "utf8",
);

test("listing edit reuses owner authorities without SellerProfile table access", () => {
  assert.match(
    source,
    /sellerOwnerCore\(actor\.id\)/u,
  );
  assert.match(
    source,
    /sellerOwnerListingReview\(actor\.id\)/u,
  );
  assert.doesNotMatch(source, /prisma\.sellerProfile\./u);
  assert.doesNotMatch(source, /seller:\s*\{\s*(?:select|include|userId|user):/u);
  assert.match(source, /where:\s*\{\s*id:\s*listingId,\s*sellerId:\s*sellerCore\.sellerProfileId/u);
  assert.match(source, /listingCount:\s*sellerReview\.totalListingCount/u);
  assert.match(source, /sellerName:\s*sellerCore\.displayName/u);
});
