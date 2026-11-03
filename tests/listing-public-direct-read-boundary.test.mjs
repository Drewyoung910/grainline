import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url);
const workspace = root.pathname;

function source(path) {
  return readFileSync(new URL(path, root), "utf8");
}

function sourceFiles(directory) {
  const result = [];
  const visit = (absolute) => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const child = join(absolute, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (/\.(?:ts|tsx)$/u.test(entry.name)) result.push(relative(workspace, child));
    }
  };
  visit(join(workspace, directory));
  return result.sort();
}

test("Listing direct ORM access is limited to reviewed public catalog reads", () => {
  const directListingCall =
    /\b(?:prisma|tx|client|db)\.listing\.(?:aggregate|count|create|delete|deleteMany|findFirst|findMany|findUnique|groupBy|upsert|update|updateMany)\b/gu;
  const callsByFile = {};
  for (const file of sourceFiles("src")) {
    const calls = [...source(file).matchAll(directListingCall)].map((match) => match[0]);
    if (calls.length > 0) callsByFile[file] = calls;
  }

  assert.deepEqual(callsByFile, {
    "src/app/api/account/feed/route.ts": ["prisma.listing.findMany"],
    "src/app/api/search/suggestions/route.ts": Array(2).fill("prisma.listing.findMany"),
    "src/app/blog/[slug]/page.tsx": ["prisma.listing.findMany"],
    "src/app/page.tsx": Array(6).fill("prisma.listing.findMany"),
    "src/app/seller/[id]/page.tsx": Array(2).fill("prisma.listing.findMany"),
    "src/app/seller/[id]/shop/page.tsx": ["prisma.listing.findMany"],
    "src/app/sitemap.ts": [
      "prisma.listing.findMany",
      "prisma.listing.groupBy",
      "prisma.listing.groupBy",
    ],
    "src/lib/foundingMaker.ts": ["prisma.listing.findMany"],
  });
});

test("the followed-maker feed uses the complete public Listing predicate", () => {
  const feed = source("src/app/api/account/feed/route.ts");

  assert.match(feed, /import \{ publicListingWhere \} from "@\/lib\/listingVisibility"/u);
  assert.match(
    feed,
    /prisma\.listing\.findMany\(\{\s*where: publicListingWhere\(\{\s*sellerId: \{ in: visibleSellerIds \},[\s\S]*timestampCursorWhere\("listing", "createdAt"\),\s*\}\),/u,
  );
  assert.doesNotMatch(
    feed,
    /where: \{\s*sellerId: \{ in: visibleSellerIds \},\s*status: "ACTIVE",\s*isPrivate: false,/u,
  );
});
