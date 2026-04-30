import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { extractBlogVideoEmbed, normalizeBlogVideoUrlString } = await import("../src/lib/blogVideo.ts");

describe("blog video input", () => {
  it("normalizes YouTube watch URLs and strips tracking parameters", () => {
    assert.equal(
      normalizeBlogVideoUrlString("https://www.youtube.com/watch?v=dQw4w9WgXcQ&utm_source=x&start=30"),
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&start=30",
    );
  });

  it("allows only concrete YouTube video paths", () => {
    assert.equal(
      normalizeBlogVideoUrlString("https://youtu.be/dQw4w9WgXcQ?si=tracking&t=12"),
      "https://youtu.be/dQw4w9WgXcQ?t=12",
    );
    assert.equal(
      normalizeBlogVideoUrlString("https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share"),
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    );
    assert.throws(
      () => normalizeBlogVideoUrlString("https://www.youtube.com/redirect?q=https%3A%2F%2Fevil.example"),
      /valid YouTube or Vimeo video URL/,
    );
    assert.throws(
      () => normalizeBlogVideoUrlString("https://www.youtube.com/playlist?list=PL123"),
      /valid YouTube or Vimeo video URL/,
    );
  });

  it("allows only canonical Vimeo video URLs", () => {
    assert.equal(normalizeBlogVideoUrlString("https://vimeo.com/123456789?share=copy"), "https://vimeo.com/123456789");
    assert.equal(
      normalizeBlogVideoUrlString("https://player.vimeo.com/video/123456789?h=tracking"),
      "https://vimeo.com/123456789",
    );
    assert.throws(
      () => normalizeBlogVideoUrlString("https://vimeo.com/channels/staffpicks/123456789"),
      /valid YouTube or Vimeo video URL/,
    );
  });

  it("extracts embeds only from normalized, supported video URLs", () => {
    assert.deepEqual(extractBlogVideoEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), {
      type: "youtube",
      id: "dQw4w9WgXcQ",
    });
    assert.deepEqual(extractBlogVideoEmbed("https://vimeo.com/123456789"), {
      type: "vimeo",
      id: "123456789",
    });
    assert.equal(extractBlogVideoEmbed("https://www.youtube.com/v/dQw4w9WgXcQ"), null);
  });
});
