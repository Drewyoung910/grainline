import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const root = new URL("../", import.meta.url);

function source(path) {
  return readFileSync(new URL(path, root), "utf8");
}

describe("public card media styling", () => {
  it("keeps Browse's no-results recommendations on the shared floating listing card", () => {
    const browse = source("src/app/browse/page.tsx");
    const emptyStart = browse.indexOf("// ── No results experience");
    const pagerStart = browse.indexOf("// ── Pager component", emptyStart);
    const emptyState = browse.slice(emptyStart, pagerStart);

    assert.match(emptyState, /const featured = await fetchListings\(/);
    assert.match(emptyState, /featuredFavorites/);
    assert.match(emptyState, /featuredRatings/);
    assert.match(emptyState, /<h1 className="font-display text-2xl font-semibold">/);
    assert.match(emptyState, /<GridCard key=\{listing\.id\} l=\{listing\} \/>/);
    assert.match(emptyState, /href="\/browse" className="inline-flex items-center rounded-md/);
    assert.doesNotMatch(emptyState, /className="border border-neutral-200 overflow-hidden"/);
    assert.doesNotMatch(emptyState, /className="h-36 w-full object-cover"/);
  });

  it("uses 4:3 media for regular blog-card grids while preserving the featured hero", () => {
    const blogIndex = source("src/app/blog/page.tsx");
    const blogAuthor = source("src/app/blog/author/[slug]/page.tsx");
    const saved = source("src/app/account/saved/page.tsx");
    const blogDetail = source("src/app/blog/[slug]/page.tsx");
    const publicSkeletons = source("src/components/PublicRouteSkeletons.tsx");

    assert.match(blogIndex, /md:w-1\/2 aspect-\[16\/9\]/);
    assert.match(blogIndex, /<div className="aspect-\[4\/3\] bg-neutral-100 overflow-hidden">/);
    assert.doesNotMatch(blogAuthor, /aspect-\[16\/9\]/);
    assert.match(blogAuthor, /aspect-\[4\/3\] overflow-hidden bg-neutral-100/);
    assert.match(saved, /<div className="aspect-\[4\/3\] bg-neutral-100 overflow-hidden">/);
    assert.doesNotMatch(saved, /<div className="h-44 bg-neutral-100 overflow-hidden">/);

    const relatedStart = blogDetail.indexOf("{/* Related posts */}");
    const related = blogDetail.slice(relatedStart);
    assert.match(related, /<div className="aspect-\[4\/3\] bg-neutral-100 overflow-hidden">/);
    assert.doesNotMatch(related, /<div className="h-32 bg-neutral-100 overflow-hidden">/);

    const authorSkeletonStart = publicSkeletons.indexOf("export function BlogAuthorSkeleton");
    const customerPhotosStart = publicSkeletons.indexOf("export function CustomerPhotosSkeleton");
    const authorSkeleton = publicSkeletons.slice(authorSkeletonStart, customerPhotosStart);
    assert.match(authorSkeleton, /aspect-\[4\/3\] w-full rounded-none/);
    assert.doesNotMatch(authorSkeleton, /aspect-\[16\/9\]/);
  });
});
