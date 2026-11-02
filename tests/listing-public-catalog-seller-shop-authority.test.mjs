import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("seller shop bounds public counts and facets without weakening owner reads", async () => {
  const shop = await readFile(
    new URL("src/app/seller/[id]/shop/page.tsx", root),
    "utf8",
  );

  assert.match(
    shop,
    /import \{ listingPublicCatalogCount, listingPublicCatalogPage \} from "@\/lib\/listingPublicCatalogAccess"/u,
  );
  assert.match(
    shop,
    /isOwner\s*\?\s*prisma\.listing\.groupBy\([\s\S]*:\s*listingPublicCatalogPage\(/u,
  );
  assert.match(
    shop,
    /isOwner\s*\?\s*prisma\.listing\.count\([\s\S]*:\s*listingPublicCatalogCount\(/u,
  );
  assert.match(shop, /sellerId,[\s\S]*includeCategoryCounts: true/u);
  assert.match(shop, /sellerId,[\s\S]*\.\.\.\(tag \? \{ tag \} : \{\}\)/u);

  // This page intentionally keeps its safe-column card list direct. The public
  // policy and explicit column grants protect that read after activation, while
  // owner-only drafts remain on the separately reviewed owner path.
  assert.match(shop, /const listings = await prisma\.listing\.findMany\(/u);
});
