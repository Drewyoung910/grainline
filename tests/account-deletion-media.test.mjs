import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

process.env.CLOUDFLARE_R2_PUBLIC_URL = "https://media.example.com/grain";
process.env.CLOUDFLARE_R2_PUBLIC_URLS = "https://assets.example.com/base";

const { accountDeletionMediaUrlsForCleanup } = await import("../src/lib/urlValidation.ts");

function source(path) {
  return readFileSync(path, "utf8");
}

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

  it("collects listing photo originals for deleted-account media cleanup", () => {
    const deletion = source("src/lib/accountDeletion.ts");
    const collectStart = deletion.indexOf("async function collectAccountDeletionMediaUrls");
    const collectEnd = deletion.indexOf("function revalidateDeletedAccountSearchCaches", collectStart);
    const collect = deletion.slice(collectStart, collectEnd);

    assert.match(collect, /photos: \{ select: \{ url: true, originalUrl: true \} \}/);
    assert.match(collect, /urls\.add\(photo\.url\)/);
    assert.match(collect, /if \(photo\.originalUrl\) urls\.add\(photo\.originalUrl\)/);
    assert.ok(
      collect.indexOf("photos: { select: { url: true, originalUrl: true } }") <
        collect.indexOf("accountDeletionMediaUrlsForCleanup(urls, clerkUserId)"),
      "listing photo originals must be ownership-filtered before deletion",
    );
  });

  it("collects direct-upload lifecycle URLs before deleting account-owned lifecycle rows", () => {
    const deletion = source("src/lib/accountDeletion.ts");
    const collectStart = deletion.indexOf("async function collectAccountDeletionMediaUrls");
    const collectEnd = deletion.indexOf("function revalidateDeletedAccountSearchCaches", collectStart);
    const collect = deletion.slice(collectStart, collectEnd);
    const collectCall = deletion.indexOf("const mediaUrls = await collectAccountDeletionMediaUrls(tx, user.id, user.clerkId)");
    const enqueueCall = deletion.indexOf("await enqueueAccountDeletionMediaDeleteSideEffects(tx, user.id, mediaUrls)");
    const deleteRows = deletion.indexOf("await tx.directUpload.deleteMany({");

    assert.match(deletion, /"sellerProfile" \| "reviewPhoto" \| "commissionRequest" \| "blogPost" \| "directUpload" \| "\$queryRaw"/);
    assert.match(collect, /listActorSentMessageBodiesForDeletion\(userId, db\)/);
    assert.doesNotMatch(collect, /db\.message\./);
    assert.match(collect, /db\.directUpload\.findMany\(\{\s*where: \{ userId \},\s*select: \{ publicUrl: true \},\s*\}\)/s);
    assert.match(
      collect,
      /directUploads\.forEach\(\(upload\) => \{\s*if \(upload\.publicUrl\) urls\.add\(upload\.publicUrl\);\s*\}\)/s,
    );
    assert.doesNotMatch(
      collect,
      /deletePrivateR2ObjectByKey|deleteR2ObjectByStorageClass/,
      "private dispute evidence must be retained with the order/case record",
    );
    assert.ok(collectCall >= 0, "account deletion must collect media URLs");
    assert.ok(enqueueCall > collectCall, "media deletion side effects must be enqueued after collection");
    assert.ok(deleteRows > enqueueCall, "public DirectUpload rows should be deleted only after durable media cleanup side effects are queued");
    assert.match(
      deletion,
      /tx\.directUpload\.deleteMany\(\{\s*where: \{ userId: user\.id, storageClass: "PUBLIC" \}/s,
    );
    assert.doesNotMatch(
      deletion,
      /tx\.directUpload\.deleteMany\(\{\s*where: \{ userId: user\.id \}\s*\}\)/s,
    );
  });
});
