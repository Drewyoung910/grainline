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
    const blogPost = source("src/app/blog/[slug]/page.tsx");

    assert.match(adminBlog, /blogComment\.updateMany\(\{\s*where: \{ id: commentId, approved: false \}/s);
    assert.match(adminBlog, /if \(approved\.count !== 1\) return/);
    assert.match(adminBlog, /link: `\/blog\/\$\{comment\.post\.slug\}#comment-\$\{commentId\}`/);
    assert.match(adminBlog, /type: "BLOG_COMMENT_REPLY"[\s\S]*dedupScope: commentId/);
    assert.match(adminBlog, /type: "NEW_BLOG_COMMENT"[\s\S]*dedupScope: commentId/);
    assert.match(blogPost, /id=\{`comment-\$\{c\.id\}`\}/);
  });

  it("removes source-specific blog comment notifications when staff delete a comment", () => {
    const adminBlog = source("src/app/admin/blog/page.tsx");

    assert.match(adminBlog, /tx\.notification\.deleteMany\(\{/);
    assert.match(adminBlog, /type = deleted\.parentId \? "BLOG_COMMENT_REPLY" : "NEW_BLOG_COMMENT"/);
    assert.match(adminBlog, /link: `\/blog\/\$\{deleted\.post\.slug\}#comment-\$\{deleted\.id\}`/);
    assert.match(adminBlog, /link: `\/blog\/\$\{deleted\.post\.slug\}`/);
  });

  it("does not treat archive and republish as a brand-new blog post", () => {
    const editPage = source("src/app/dashboard/blog/[id]/edit/page.tsx");

    assert.match(editPage, /const transitioningToPublished = newStatus === "PUBLISHED" && existing\.status !== "PUBLISHED"/);
    assert.match(editPage, /const isFirstPublish = transitioningToPublished && existing\.publishedAt === null/);
    assert.match(editPage, /if \(isFirstPublish\) \{\s*publishedAt = new Date\(\);/);
    assert.match(editPage, /if \(isFirstPublish && updated\.sellerProfileId && updated\.sellerProfile\?\.userId\)/);
    assert.match(editPage, /const sellerUserId = updated\.sellerProfile!\.userId/);
    assert.match(editPage, /blocks: \{ none: \{ blockedId: sellerUserId \} \}/);
    assert.match(editPage, /blockedBy: \{ none: \{ blockerId: sellerUserId \} \}/);
    assert.doesNotMatch(editPage, /else if \(newStatus !== "PUBLISHED"\) \{\s*publishedAt = null/);
  });

  it("guards blog edit status writes against stale reads", () => {
    const editPage = source("src/app/dashboard/blog/[id]/edit/page.tsx");

    assert.match(editPage, /updatedAt: true/);
    assert.match(editPage, /tx\.blogPost\.updateMany\(\{\s*where: \{\s*id,\s*authorId: author\.id,\s*status: existing\.status,\s*updatedAt: existing\.updatedAt/s);
    assert.match(editPage, /if \(claimed\.count === 0\) return null/);
    assert.match(editPage, /Post changed while saving\. Refresh and try again\./);
    assert.doesNotMatch(editPage, /prisma\.blogPost\.update\(\{\s*where: \{ id \}/);
  });

  it("validates blog status input instead of relying on enum casts", () => {
    const helper = source("src/lib/blogStatusInput.ts");
    const newPage = source("src/app/dashboard/blog/new/page.tsx");
    const editPage = source("src/app/dashboard/blog/[id]/edit/page.tsx");

    assert.match(helper, /CREATE_STATUSES/);
    assert.match(helper, /UPDATE_STATUSES/);
    assert.match(helper, /allowed\.has\(status as BlogPostStatus\)/);
    assert.match(newPage, /parseCreateBlogStatus\(formData\.get\("status"\)\)/);
    assert.match(editPage, /parseUpdateBlogStatus\(formData\.get\("status"\)\)/);
    assert.doesNotMatch(newPage, /formData\.get\("status"\) as/);
    assert.doesNotMatch(editPage, /formData\.get\("status"\) as/);
  });

  it("includes public blog tags in publish-time profanity checks", () => {
    const newPage = source("src/app/dashboard/blog/new/page.tsx");
    const editPage = source("src/app/dashboard/blog/[id]/edit/page.tsx");

    assert.match(newPage, /containsProfanity\(`\$\{title\} \$\{excerpt \?\? ""\} \$\{body\} \$\{tags\.join\(" "\)\}`\)/);
    assert.match(editPage, /containsProfanity\(`\$\{title\} \$\{excerpt \?\? ""\} \$\{body\} \$\{tags\.join\(" "\)\}`\)/);
  });

  it("retries create-time blog slug collisions instead of surfacing P2002", () => {
    const newPage = source("src/app/dashboard/blog/new/page.tsx");

    assert.match(newPage, /Prisma\.PrismaClientKnownRequestError/);
    assert.match(newPage, /error\.code === "P2002"/);
    assert.match(newPage, /error\.meta\?\.target[\s\S]*includes\("slug"\)/);
    assert.match(newPage, /slug = `\$\{baseSlug\}-\$\{attempt\+\+\}`/);
  });
});
