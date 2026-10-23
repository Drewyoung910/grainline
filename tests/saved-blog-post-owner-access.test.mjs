import assert from "node:assert/strict";
import test from "node:test";
import { parseOwnerSavedBlogPostPageRows } from "../src/lib/savedBlogPostPageState.ts";

function savedPostRow(title) {
  return {
    blogPostId: "post-1",
    slug: "emoji-title",
    title,
    excerpt: null,
    coverImageUrl: null,
    type: "STANDARD",
    readingTimeMinutes: 2,
    publishedAt: new Date("2026-10-23T12:00:00.000Z"),
    authorName: "Maker",
    authorImageUrl: null,
    authorSellerName: "Maker Shop",
    authorSellerAvatarUrl: null,
    sellerProfileId: "seller-1",
    sellerDisplayName: "Maker Shop",
    sellerAvatarImageUrl: null,
  };
}

test("saved-blog page validation counts Unicode code points like PostgreSQL varchar", () => {
  const title = "🧵".repeat(200);
  const rows = parseOwnerSavedBlogPostPageRows([savedPostRow(title)], 24);
  assert.equal(rows[0].blogPost.title, title);

  assert.throws(
    () => parseOwnerSavedBlogPostPageRows([savedPostRow(`${title}🧵`)], 24),
    /invalid result/,
  );
});
