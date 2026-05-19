import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("blog dashboard action guardrails", () => {
  it("blocks suspended or deleted accounts inside blog server actions", () => {
    for (const path of [
      "src/app/dashboard/blog/new/page.tsx",
      "src/app/dashboard/blog/[id]/edit/page.tsx",
      "src/app/dashboard/blog/page.tsx",
    ]) {
      const text = source(path);
      assert.match(
        text,
        /banned:\s*true/,
        `${path} must select account banned state inside the action/page`,
      );
      assert.match(
        text,
        /deletedAt:\s*true/,
        `${path} must select account deletion state inside the action/page`,
      );
      assert.match(
        text,
        /banned\s*\|\|\s*[^;\n]*deletedAt/,
        `${path} must block suspended or deleted accounts`,
      );
    }
  });

  it("captures follower notification failures instead of silently swallowing them", () => {
    for (const [path, sourceTag] of [
      ["src/app/dashboard/blog/new/page.tsx", "blog_create_follower_notification"],
      ["src/app/dashboard/blog/[id]/edit/page.tsx", "blog_update_follower_notification"],
    ]) {
      const text = source(path);
      assert.match(text, /Sentry\.captureException/);
      assert.match(text, new RegExp(`source: "${sourceTag}"`));
      assert.doesNotMatch(text, /catch \{\s*\/\* non-fatal \*\/\s*\}/);
    }
  });

  it("deduplicates approved blog comment notifications per comment", () => {
    const adminBlog = source("src/app/admin/blog/page.tsx");

    assert.match(adminBlog, /blogComment\.updateMany\(\{\s*where: \{ id: commentId, approved: false \}/s);
    assert.match(adminBlog, /if \(approved\.count !== 1\) return/);
    assert.match(adminBlog, /type: "BLOG_COMMENT_REPLY"[\s\S]*dedupScope: commentId/);
    assert.match(adminBlog, /type: "NEW_BLOG_COMMENT"[\s\S]*dedupScope: commentId/);
  });

  it("does not treat archive and republish as a brand-new blog post", () => {
    const editPage = source("src/app/dashboard/blog/[id]/edit/page.tsx");

    assert.match(editPage, /const transitioningToPublished = newStatus === "PUBLISHED" && existing\.status !== "PUBLISHED"/);
    assert.match(editPage, /const isFirstPublish = transitioningToPublished && existing\.publishedAt === null/);
    assert.match(editPage, /if \(isFirstPublish\) \{\s*publishedAt = new Date\(\);/);
    assert.match(editPage, /if \(isFirstPublish && updated\.sellerProfileId\)/);
    assert.doesNotMatch(editPage, /else if \(newStatus !== "PUBLISHED"\) \{\s*publishedAt = null/);
  });
});
