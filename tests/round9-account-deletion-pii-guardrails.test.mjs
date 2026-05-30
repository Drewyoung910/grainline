import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

const ORDER_PII_FIELDS = [
  "shipToCity",
  "shipToState",
  "shipToPostalCode",
  "shipToCountry",
  "quotedToCity",
  "quotedToState",
  "quotedToPostalCode",
  "quotedToCountry",
  "trackingCarrier",
  "trackingNumber",
  "sellerNotes",
  "shippoShipmentId",
  "shippoRateObjectId",
  "shippoTransactionId",
  "labelUrl",
  "labelCarrier",
  "labelTrackingNumber",
];

describe("Round 9 account deletion PII guardrails", () => {
  it("scrubs retained order address, tracking, label, and seller-note PII on delete and retention prune", () => {
    const deletion = source("src/lib/accountDeletion.ts");
    const retention = source("src/lib/orderPiiRetention.ts");

    for (const field of ORDER_PII_FIELDS) {
      assert.match(deletion, new RegExp(`${field}: null`), `account deletion must clear ${field}`);
      assert.match(retention, new RegExp(`"${field}" = NULL`), `retention prune must clear ${field}`);
      assert.match(retention, new RegExp(`"${field}" IS NOT NULL`), `retention prune must detect ${field}`);
    }

    assert.match(deletion, /buyerDataPurgedAt: now/);
    assert.match(retention, /"buyerDataPurgedAt" = NOW\(\)/);
  });

  it("removes bidirectional block residue and keeps media cleanup scoped to the deleted sender", () => {
    const deletion = source("src/lib/accountDeletion.ts");

    assert.match(deletion, /tx\.block\.deleteMany\(\{\s*where: \{ OR: \[\{ blockerId: user\.id \}, \{ blockedId: user\.id \}\] \} \}\)/);
    assert.match(deletion, /db\.message\.findMany\(\{\s*where: \{ senderId: userId \}/s);
    assert.doesNotMatch(deletion, /where: \{ OR: \[\{ senderId: userId \}, \{ recipientId: userId \}\] \}/);
  });

  it("redacts other-party message and case-message bodies that quote deleted-account values", () => {
    const deletion = source("src/lib/accountDeletion.ts");

    assert.match(deletion, /function bodyTextMatchSql\(value: string\)/);
    assert.match(deletion, /FROM "Message"[\s\S]*"senderId" <> \$\{deletedUserId\}[\s\S]*"recipientId" = \$\{deletedUserId\}/);
    assert.match(deletion, /FROM "CaseMessage"[\s\S]*"authorId" <> \$\{deletedUserId\}[\s\S]*"caseId" IN \([\s\S]*FROM "Case"[\s\S]*"buyerId" = \$\{deletedUserId\}[\s\S]*OR "sellerId" = \$\{deletedUserId\}/);
    assert.match(deletion, /redactMessagesAboutDeletedAccount\(tx, user\.id, accountSensitiveValues\)/);
    assert.match(deletion, /redactCaseMessagesAboutDeletedAccount\(tx, user\.id, accountSensitiveValues\)/);
  });

  it("uses saved shipping fields as deletion redaction needles", () => {
    const deletion = source("src/lib/accountDeletion.ts");

    for (const field of [
      "shippingName",
      "shippingLine1",
      "shippingLine2",
      "shippingCity",
      "shippingState",
      "shippingPostalCode",
      "shippingPhone",
    ]) {
      assert.match(deletion, new RegExp(`user\\.${field}`), `sensitive values must include ${field}`);
    }
  });

  it("scrubs seller gallery alt text and pending outbox content on account deletion", () => {
    const deletion = source("src/lib/accountDeletion.ts");

    assert.match(deletion, /galleryImageUrls: \[\]/);
    assert.match(deletion, /galleryAltTexts: \[\]/);
    assert.match(deletion, /tx\.emailOutbox\.updateMany\(\{/);
    assert.match(deletion, /OR: \[\{ userId: user\.id \}, \{ recipientEmail: suppressionEmail \}\]/);
    assert.match(deletion, /status: "SKIPPED"/);
    assert.match(deletion, /html: "\[Email removed after account deletion\]"/);
  });

  it("scrubs seller listing title and body fields on account deletion", () => {
    const deletion = source("src/lib/accountDeletion.ts");

    const listingUpdateStart = deletion.indexOf("await tx.listing.updateMany({");
    const listingUpdateEnd = deletion.indexOf("await tx.makerVerification.updateMany", listingUpdateStart);
    const listingUpdate = deletion.slice(listingUpdateStart, listingUpdateEnd);

    assert.ok(listingUpdateStart > -1, "account deletion must update seller listings");
    assert.match(listingUpdate, /title: "Deleted listing"/);
    assert.match(listingUpdate, /status: "HIDDEN"/);
    assert.match(listingUpdate, /isPrivate: true/);
    assert.match(listingUpdate, /description: "\[Listing removed\]"/);
    assert.match(listingUpdate, /tags: \[\]/);
    assert.match(listingUpdate, /metaDescription: null/);
    assert.match(listingUpdate, /materials: \[\]/);
  });

  it("redacts account identifiers from admin audit reasons as well as metadata", () => {
    const deletion = source("src/lib/accountDeletion.ts");

    assert.match(deletion, /COALESCE\(reason, ''\)/);
    assert.match(deletion, /redactAccountDeletionText\(candidate\.reason, sensitiveValues\)/);
    assert.match(deletion, /reason\.changed && reason\.text !== null \? \{ reason: reason\.text \} : \{\}/);
  });

  it("allocates collision-safe deleted-account blog archive slugs", () => {
    const deletion = source("src/lib/accountDeletion.ts");

    assert.match(deletion, /function deletedAccountBlogSlug\(postId: string, collisionIndex = 0\)/);
    assert.match(deletion, /`deleted-\$\{postId\}-\$\{collisionIndex\}`/);
    assert.match(deletion, /async function deletedAccountAvailableBlogSlug\(postId: string\)/);
    assert.match(deletion, /tx\.blogPost\.findUnique\(\{\s*where: \{ slug \}/s);
    assert.match(deletion, /const archivedSlug = await deletedAccountAvailableBlogSlug\(post\.id\)/);
    assert.doesNotMatch(deletion, /slug: `deleted-\$\{post\.id\}`/);
  });
});
