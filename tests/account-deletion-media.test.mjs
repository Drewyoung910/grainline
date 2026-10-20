import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

process.env.CLOUDFLARE_R2_PUBLIC_URL = "https://media.example.com/grain";
process.env.CLOUDFLARE_R2_PUBLIC_URLS = "https://assets.example.com/base";

const {
  ACCOUNT_DELETION_MEDIA_KEY_BATCH_SIZE,
  accountDeletionMediaKeyBatches,
  accountDeletionMediaKeysForCleanup,
  accountDeletionMediaUrlsForCleanup,
} = await import("../src/lib/urlValidation.ts");

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

  it("canonicalizes accepted media URLs to scoped public object keys", () => {
    assert.deepEqual(
      accountDeletionMediaKeysForCleanup([
        "https://media.example.com/grain/listingImage/user_123/a.jpg?download=1#preview",
        "https://assets.example.com/base/galleryImage/user_123/c.webp",
        "https://media.example.com/grain/listingImage/user_456/b.jpg",
      ], "user_123"),
      ["listingImage/user_123/a.jpg", "galleryImage/user_123/c.webp"],
    );
  });

  it("drops keys that the database media fence rejects", () => {
    const overlong = `https://media.example.com/grain/listingImage/user_123/${"a".repeat(480)}.jpg`;
    assert.deepEqual(
      accountDeletionMediaKeysForCleanup([
        "https://media.example.com/grain/listingImage/user_123/valid.jpg",
        "https://media.example.com/grain/listingImage/user_123/%0Ahidden.jpg",
        "https://media.example.com/grain/galleryImage/user_123/",
        overlong,
      ], "user_123"),
      ["listingImage/user_123/valid.jpg"],
    );
  });

  it("deduplicates URL aliases and batches every media key without truncation", () => {
    assert.deepEqual(
      accountDeletionMediaKeysForCleanup([
        "https://media.example.com/grain/listingImage/user_123/a.jpg?download=1",
        "https://assets.example.com/base/listingImage/user_123/a.jpg#preview",
      ], "user_123"),
      ["listingImage/user_123/a.jpg"],
    );
    const keys = Array.from(
      { length: ACCOUNT_DELETION_MEDIA_KEY_BATCH_SIZE * 2 + 1 },
      (_, index) => `listingImage/user_123/${index}.jpg`,
    );
    const batches = accountDeletionMediaKeyBatches([
      ...keys,
      keys[0],
    ]);
    assert.deepEqual(batches.map((batch) => batch.length), [500, 500, 1]);
    assert.deepEqual(batches.flat(), keys);
  });

  it("does not let markdown cleanup delete another user's uploaded image", () => {
    assert.deepEqual(
      accountDeletionMediaUrlsForCleanup([
        "https://media.example.com/grain/galleryImage/user_999/embedded-in-markdown.jpg",
      ], "user_123"),
      [],
    );
  });

  it("collects seller media through the generation-bound deletion authority", () => {
    const deletion = source("src/lib/accountDeletion.ts");
    const access = source("src/lib/sellerAccountDeletionMediaAccess.ts");
    const collectStart = deletion.indexOf("async function collectAccountDeletionMediaKeys");
    const collectEnd = deletion.indexOf("function revalidateDeletedAccountSearchCaches", collectStart);
    const collect = deletion.slice(collectStart, collectEnd);

    assert.match(collect, /sellerAccountDeletionPublicMediaUrls\(db, \{/u);
    assert.match(collect, /sideEffectId: claim\.sideEffectId/u);
    assert.match(collect, /claimGeneration: claim\.claimGeneration/u);
    assert.match(collect, /claimToken: claim\.claimToken/u);
    assert.doesNotMatch(collect, /db\.sellerProfile\./u);
    assert.match(access, /grainline_seller_account_deletion_public_media_urls/u);
    assert.match(access, /\$\{input\.claimGeneration\}::bigint/u);
    assert.match(access, /\$\{input\.claimToken\}::uuid/u);
  });

  it("collects direct-upload URLs before releasing account-owned lifecycle references", () => {
    const deletion = source("src/lib/accountDeletion.ts");
    const collectStart = deletion.indexOf("async function collectAccountDeletionMediaKeys");
    const collectEnd = deletion.indexOf("function revalidateDeletedAccountSearchCaches", collectStart);
    const collect = deletion.slice(collectStart, collectEnd);
    const collectCall = deletion.indexOf("const mediaKeys = await collectAccountDeletionMediaKeys(tx, user.id, user.clerkId, {");
    const enqueueCall = deletion.indexOf("await enqueueAccountDeletionMediaDeleteSideEffects(");
    const releaseRows = deletion.indexOf("await releaseDirectUploadsForAccount({");

    assert.match(deletion, /"reviewPhoto" \| "commissionRequest" \| "blogPost" \| "\$queryRaw"/);
    assert.doesNotMatch(deletion, /"sellerProfile" \| "reviewPhoto"/u);
    assert.match(collect, /listActorSentMessageBodiesForDeletion\(userId, db\)/);
    assert.doesNotMatch(collect, /db\.message\./);
    assert.match(collect, /accountDirectUploadPublicUrls\(\{\s*client: db,\s*userId,\s*\}\)/s);
    assert.match(
      collect,
      /directUploads\.forEach\(\(upload\) => \{\s*if \(upload\.publicUrl\) urls\.add\(upload\.publicUrl\);\s*\}\)/s,
    );
    assert.doesNotMatch(
      collect,
      /deletePrivateR2ObjectByKey|deleteR2ObjectByStorageClass/,
      "private dispute evidence must be retained with the order/case record",
    );
    assert.ok(collectCall >= 0, "account deletion must collect canonical media keys");
    assert.ok(enqueueCall > collectCall, "media deletion side effects must be enqueued after collection");
    assert.ok(releaseRows > enqueueCall, "public DirectUpload references should be released only after durable media cleanup side effects are queued");
    assert.match(
      deletion,
      /enqueueAccountDeletionMediaDeleteSideEffects\([\s\S]*sideEffectId: localAnonymizeSideEffectId,[\s\S]*claimGeneration: localClaimGeneration,[\s\S]*claimToken: localClaimToken,[\s\S]*mediaKeys,/,
    );
    assert.match(
      deletion,
      /releaseDirectUploadsForAccount\(\{\s*client: tx,\s*userId: user\.id,\s*\}\)/s,
    );
    assert.doesNotMatch(deletion, /tx\.directUpload\.deleteMany/);
  });
});
