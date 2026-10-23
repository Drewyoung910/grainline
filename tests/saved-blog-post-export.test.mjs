import assert from "node:assert/strict";
import test from "node:test";

import { buildOwnerSavedBlogPostExportRows } from "../src/lib/savedBlogPostExport.ts";

test("saved-blog export preserves the relationship without exposing a private target", () => {
  const activeSavedAt = new Date("2026-10-23T12:00:00.000Z");
  const hiddenSavedAt = new Date("2026-10-22T12:00:00.000Z");
  assert.deepEqual(
    buildOwnerSavedBlogPostExportRows(
      [
        { blogPostId: "active", createdAt: activeSavedAt },
        { blogPostId: "now-private", createdAt: hiddenSavedAt },
      ],
      [{ id: "active", title: "Public title", slug: "public-title" }],
    ),
    [
      {
        blogPostId: "active",
        createdAt: activeSavedAt,
        blogPost: { title: "Public title", slug: "public-title" },
      },
      {
        blogPostId: "now-private",
        createdAt: hiddenSavedAt,
        blogPost: null,
      },
    ],
  );
});
