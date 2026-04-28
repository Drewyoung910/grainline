import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.CLOUDFLARE_R2_ACCOUNT_ID = "test-account";
process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = "test-access-key";
process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = "test-secret-key";
process.env.CLOUDFLARE_R2_BUCKET_NAME = "test-bucket";
process.env.CLOUDFLARE_R2_PUBLIC_URL = "https://media.example.com/grain";
process.env.CLOUDFLARE_R2_PUBLIC_URLS = "https://assets.example.com/base,not-a-url";

const {
  filterR2PublicUrls,
  filterTrustedMediaUrls,
  isR2PublicUrl,
  isTrustedMediaUrl,
} = await import("../src/lib/urlValidation.ts");
const { extractR2KeyFromUrl } = await import("../src/lib/r2.ts");

describe("media URL validation", () => {
  it("accepts configured first-party media origins and legacy display origins", () => {
    assert.equal(isR2PublicUrl("https://media.example.com/grain/listings/photo.jpg"), true);
    assert.equal(isR2PublicUrl("https://assets.example.com/base/reviews/photo.webp"), true);
    assert.equal(isR2PublicUrl("https://cdn.thegrainline.com/listings/photo.jpg"), true);
    assert.equal(isR2PublicUrl("https://utfs.io/f/legacy.jpg"), true);
  });

  it("rejects arbitrary hosts, wildcard R2 domains, and path-prefix lookalikes", () => {
    assert.equal(isR2PublicUrl("https://evil.example.com/grain/listings/photo.jpg"), false);
    assert.equal(isR2PublicUrl("https://attacker.r2.dev/listings/photo.jpg"), false);
    assert.equal(isR2PublicUrl("http://media.example.com/grain/listings/photo.jpg"), false);
    assert.equal(isR2PublicUrl("https://media.example.com/grainery/photo.jpg"), false);
  });

  it("keeps display-only hosts out of R2 write-path validation", () => {
    assert.equal(isTrustedMediaUrl("https://i.postimg.cc/example/photo.jpg"), true);
    assert.equal(isR2PublicUrl("https://i.postimg.cc/example/photo.jpg"), false);
    assert.deepEqual(
      filterTrustedMediaUrls([
        "https://i.postimg.cc/example/photo.jpg",
        "https://attacker.example.com/photo.jpg",
      ], 5),
      ["https://i.postimg.cc/example/photo.jpg"],
    );
  });

  it("filters media URLs without preserving rejected entries", () => {
    assert.deepEqual(
      filterR2PublicUrls([
        "https://media.example.com/grain/a.jpg",
        "https://attacker.r2.dev/b.jpg",
        "https://cdn.thegrainline.com/c.jpg",
      ], 2),
      ["https://media.example.com/grain/a.jpg", "https://cdn.thegrainline.com/c.jpg"],
    );
  });

  it("extracts R2 keys only from configured public bases", () => {
    assert.equal(
      extractR2KeyFromUrl("https://media.example.com/grain/listings/my%20photo.jpg"),
      "listings/my photo.jpg",
    );
    assert.equal(extractR2KeyFromUrl("https://cdn.thegrainline.com/reviews/photo.jpg"), "reviews/photo.jpg");
    assert.equal(extractR2KeyFromUrl("https://media.example.com/other/photo.jpg"), null);
    assert.equal(extractR2KeyFromUrl("https://attacker.r2.dev/listings/photo.jpg"), null);
  });
});
