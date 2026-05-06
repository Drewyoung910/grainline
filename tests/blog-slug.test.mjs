import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { calculateReadingTime, generateSlug } = await import("../src/lib/blog.ts");

describe("blog slugs", () => {
  it("keeps ASCII Latin titles readable", () => {
    assert.equal(generateSlug("Cafe Creme Cutting Board"), "cafe-creme-cutting-board");
  });

  it("adds a stable hash suffix to non-ASCII readable slugs", () => {
    const slug = generateSlug("Café Crème Cutting Board");
    assert.match(slug, /^cafe-creme-cutting-board-[0-9a-z]+$/);
    assert.equal(slug, generateSlug("Café Crème Cutting Board"));
    assert.notEqual(generateSlug("naïve"), generateSlug("naive"));
  });

  it("uses a stable 64-bit hash fallback for non-Latin titles", () => {
    const slug = generateSlug("中文家具");
    assert.match(slug, /^post-[0-9a-z]+$/);
    assert.equal(slug, generateSlug("中文家具"));
    assert.equal(slug.length > "post-zzzzzz".length, true);
  });
});

describe("blog reading time", () => {
  it("counts CJK characters instead of treating a full article as one word", () => {
    assert.equal(calculateReadingTime("木".repeat(801)), 3);
  });

  it("keeps existing English reading-time behavior", () => {
    assert.equal(calculateReadingTime(Array.from({ length: 240 }, () => "wood").join(" ")), 1);
  });
});
