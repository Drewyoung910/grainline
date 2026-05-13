import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const {
  isR2PublicUrl,
} = await import("../src/lib/urlValidation.ts");

const blogMarkdownSource = fs.readFileSync(
  new URL("../src/lib/blogMarkdown.ts", import.meta.url),
  "utf8",
);
const blogPageSource = fs.readFileSync(
  new URL("../src/app/blog/[slug]/page.tsx", import.meta.url),
  "utf8",
);

describe("blog markdown sanitization", () => {
  it("uses the first-party media policy for markdown images", () => {
    assert.equal(isR2PublicUrl("https://cdn.thegrainline.com/blog/user/photo.jpg"), true);
    assert.equal(isR2PublicUrl("https://tracker.example/pixel.jpg"), false);
    assert.equal(isR2PublicUrl("http://cdn.thegrainline.com/blog/user/photo.jpg"), false);

    assert.match(blogMarkdownSource, /exclusiveFilter/);
    assert.match(blogMarkdownSource, /frame\.tag !== "img"/);
    assert.match(blogMarkdownSource, /isR2PublicUrl\(src\)/);
  });

  it("keeps blog markdown rendering behind a centralized sanitizer", () => {
    assert.match(blogPageSource, /renderBlogMarkdown\(post\.body\)/);
    assert.doesNotMatch(blogPageSource, /sanitizeHtml\(/);
    assert.doesNotMatch(blogPageSource, /marked\.parse/);
    assert.match(blogMarkdownSource, /allowedSchemes: \["https", "mailto"\]/);
    assert.doesNotMatch(blogMarkdownSource, /allowedSchemes: \["http"/);
    assert.doesNotMatch(blogMarkdownSource, /a: \["href", "target", "rel"\]/);
  });

  it("caps rendered markdown input before parsing", () => {
    assert.match(blogMarkdownSource, /MAX_RENDERED_BLOG_MARKDOWN_CHARS = 200_000/);
    assert.match(blogMarkdownSource, /body\.slice\(0, MAX_RENDERED_BLOG_MARKDOWN_CHARS\)/);
  });
});
