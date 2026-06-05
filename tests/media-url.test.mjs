import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.CLOUDFLARE_R2_ACCOUNT_ID = "test-account";
process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = "test-access-key";
process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = "test-secret-key";
process.env.CLOUDFLARE_R2_BUCKET_NAME = "test-bucket";
process.env.CLOUDFLARE_R2_PUBLIC_URL = "https://media.example.com/grain";
process.env.CLOUDFLARE_R2_PUBLIC_URLS = "https://assets.example.com/base,not-a-url";

const {
  filterFirstPartyMediaUrls,
  filterFirstPartyMediaUrlsForUser,
  firstPartyMediaKey,
  filterR2PublicUrls,
  isFirstPartyMediaUrl,
  isFirstPartyMediaUrlForUser,
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
    assert.equal(isR2PublicUrl("https://\u0441dn.thegrainline.com/listings/photo.jpg"), false);
  });

  it("keeps retired display-only hosts out of trusted media validation", () => {
    assert.equal(isTrustedMediaUrl("https://i.postimg.cc/example/photo.jpg"), false);
    assert.equal(isR2PublicUrl("https://i.postimg.cc/example/photo.jpg"), false);
    assert.deepEqual(
      filterTrustedMediaUrls([
        "https://i.postimg.cc/example/photo.jpg",
        "https://attacker.example.com/photo.jpg",
      ], 5),
      [],
    );
  });

  it("keeps legacy display hosts out of first-party write-path validation", () => {
    assert.equal(isR2PublicUrl("https://utfs.io/f/legacy.jpg"), true);
    assert.equal(isFirstPartyMediaUrl("https://utfs.io/f/legacy.jpg"), false);
    assert.equal(isFirstPartyMediaUrl("https://cdn.thegrainline.com/listings/photo.jpg"), true);
    assert.deepEqual(
      filterFirstPartyMediaUrls([
        "https://media.example.com/grain/a.jpg",
        "https://utfs.io/f/legacy.jpg",
        "https://cdn.thegrainline.com/c.jpg",
      ], 5),
      ["https://media.example.com/grain/a.jpg", "https://cdn.thegrainline.com/c.jpg"],
    );
  });

  it("extracts first-party media keys and scopes new media writes to the current uploader", () => {
    assert.equal(
      firstPartyMediaKey("https://media.example.com/grain/listingImage/user_123/photo.jpg"),
      "listingImage/user_123/photo.jpg",
    );
    assert.equal(firstPartyMediaKey("https://media.example.com/grain/../photo.jpg"), null);
    assert.equal(firstPartyMediaKey("https://media.example.com/grain/listingImage/user_123/%E0%A4%A.jpg"), null);
    assert.equal(
      isFirstPartyMediaUrlForUser(
        "https://media.example.com/grain/listingImage/user_123/photo.jpg",
        "user_123",
        ["listingImage"],
      ),
      true,
    );
    assert.equal(
      isFirstPartyMediaUrlForUser(
        "https://media.example.com/grain/listingImage/user_456/photo.jpg",
        "user_123",
        ["listingImage"],
      ),
      false,
    );
    assert.equal(
      isFirstPartyMediaUrlForUser(
        "https://media.example.com/grain/galleryImage/user_123/photo.jpg",
        "user_123",
        ["listingImage"],
      ),
      false,
    );
    assert.equal(
      isFirstPartyMediaUrlForUser(
        "https://media.example.com/grain/blogImage/user_123/photo.jpg",
        "user_123",
        ["blogImage"],
      ),
      true,
    );
    assert.deepEqual(
      filterFirstPartyMediaUrlsForUser([
        "https://media.example.com/grain/listingImage/user_123/a.jpg",
        "https://media.example.com/grain/listingImage/user_456/b.jpg",
        "https://cdn.thegrainline.com/listingImage/user_123/c.jpg",
      ], 5, "user_123", ["listingImage"]),
      [
        "https://media.example.com/grain/listingImage/user_123/a.jpg",
        "https://cdn.thegrainline.com/listingImage/user_123/c.jpg",
      ],
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
