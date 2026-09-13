import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const {
  isR2PublicUrl,
} = await import("../src/lib/urlValidation.ts");
const {
  renderBlogMarkdown,
} = await import("../src/lib/blogMarkdown.ts");

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
    assert.match(blogMarkdownSource, /truncateText\(body, MAX_RENDERED_BLOG_MARKDOWN_CHARS\)/);
    assert.doesNotMatch(blogMarkdownSource, /body\.slice\(0, MAX_RENDERED_BLOG_MARKDOWN_CHARS\)/);
  });

  it("relies on the shared code-point-safe truncation helper", () => {
    assert.match(blogMarkdownSource, /import \{ truncateText \} from "\.\/sanitize(?:\.ts)?"/);
    assert.doesNotMatch(blogMarkdownSource, /\.slice\(0, MAX_RENDERED_BLOG_MARKDOWN_CHARS\)/);
  });

  it("strips active HTML, scripts, and dangerous link protocols at render time", () => {
    const html = renderBlogMarkdown(`
<svg onload="alert(1)">bad</svg>
<math><mi xlink:href="javascript:alert(1)">x</mi></math>
<style>body{background:red}</style>
<script>alert(1)</script>
<object data="https://evil.example/payload"></object>
<form action="https://evil.example"><input name="token"></form>
[bad link](javascript:alert(1))
[entity link](j&#x61;vascript:alert(1))
<a href="https://example.com" onclick="alert(1)">safe link text</a>
`);

    assert.doesNotMatch(html, /<script|<svg|<math|<style|<object|<form|<input/i);
    assert.doesNotMatch(html, /onload|onclick|href=["']javascript:|href=["']j&#x61;vascript/i);
    assert.match(html, /safe link text/);
  });

  it("keeps only first-party markdown images and drops remote tracking pixels", () => {
    const html = renderBlogMarkdown(`
![first party](https://cdn.thegrainline.com/blog/user/photo.jpg)
![remote pixel](https://tracker.example/pixel.jpg)
![insecure](http://cdn.thegrainline.com/blog/user/photo.jpg)
`);

    assert.match(html, /https:\/\/cdn\.thegrainline\.com\/blog\/user\/photo\.jpg/);
    assert.doesNotMatch(html, /tracker\.example/);
    assert.doesNotMatch(html, /http:\/\/cdn\.thegrainline\.com/);
  });
});
