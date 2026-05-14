import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.CLOUDFLARE_R2_PUBLIC_URL = "https://media.example.com/grain";
process.env.CLOUDFLARE_R2_PUBLIC_URLS = "https://assets.example.com/base";

const { accountDeletionMediaUrlsForCleanup } = await import("../src/lib/urlValidation.ts");

describe("account deletion media cleanup scoping", () => {
  it("deletes only first-party media owned by the deleted Clerk user", () => {
    assert.deepEqual(
      accountDeletionMediaUrlsForCleanup([
        "https://media.example.com/grain/listingImage/user_123/a.jpg",
        "https://media.example.com/grain/listingImage/user_456/b.jpg",
        "https://assets.example.com/base/galleryImage/user_123/c.webp",
        "https://cdn.thegrainline.com/reviewPhoto/user_123/d.jpg",
        "https://utfs.io/f/legacy.jpg",
        "https://media.example.com/grain/listingImage/user_123/a.jpg",
        "https://attacker.example.com/listingImage/user_123/e.jpg",
      ], "user_123"),
      [
        "https://media.example.com/grain/listingImage/user_123/a.jpg",
        "https://assets.example.com/base/galleryImage/user_123/c.webp",
        "https://cdn.thegrainline.com/reviewPhoto/user_123/d.jpg",
      ],
    );
  });

  it("does not let markdown cleanup delete another user's uploaded image", () => {
    assert.deepEqual(
      accountDeletionMediaUrlsForCleanup([
        "https://media.example.com/grain/galleryImage/user_999/embedded-in-markdown.jpg",
      ], "user_123"),
      [],
    );
  });
});
