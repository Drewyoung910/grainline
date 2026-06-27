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
    assert.match(deletion, /tx\.orderShippingRateQuote\.deleteMany\(\{/);
    assert.match(deletion, /order: \{ buyerId: user\.id \}/);
    assert.match(deletion, /some: \{ listing: \{ sellerId: user\.sellerProfile\.id \} \}/);
    assert.match(deletion, /every: \{ listing: \{ sellerId: user\.sellerProfile\.id \} \}/);
    assert.match(retention, /EXISTS \(\s*SELECT 1\s*FROM "OrderShippingRateQuote" quote/s);
    assert.match(retention, /DELETE FROM "OrderShippingRateQuote" quote/s);
    assert.match(retention, /WHERE quote\."orderId" = pii_candidates\.id/);
  });

  it("prevents seller notes from reintroducing retained order PII after prune", () => {
    const retention = source("src/lib/orderPiiRetention.ts");
    const fulfillment = source("src/app/api/orders/[id]/fulfillment/route.ts");
    const salesPage = source("src/app/dashboard/sales/[orderId]/page.tsx");

    assert.doesNotMatch(retention, /WHERE "buyerDataPurgedAt" IS NULL/);
    assert.match(fulfillment, /const sellerNotes = payload\.sellerNotes \? truncateText\(sanitizeText\(payload\.sellerNotes\), 2000\) \|\| null : null/);
    assert.match(fulfillment, /if \(sellerNotes && authz\.order\.buyerDataPurgedAt\)/);
    assert.match(fulfillment, /notesWriteRequiresUnpurgedOrder = sellerNotes !== null/);
    assert.match(fulfillment, /\.\.\.\(notesWriteRequiresUnpurgedOrder \? \{ buyerDataPurgedAt: null \} : \{\}\)/);
    assert.ok(
      salesPage.indexOf("order.buyerDataPurgedAt ?") < salesPage.indexOf("<SellerNotesForm"),
      "seller notes form should only render before buyer data is purged",
    );
  });

  it("scrubs seller-owned retained order fulfillment artifacts on seller deletion", () => {
    const deletion = source("src/lib/accountDeletion.ts");
    const sellerOrderStart = deletion.indexOf(
      "await tx.order.updateMany({",
      deletion.indexOf("await tx.sellerFaq.deleteMany"),
    );
    const sellerOrderEnd = deletion.indexOf("await tx.sellerProfile.update", sellerOrderStart);
    const sellerOrderUpdate = deletion.slice(sellerOrderStart, sellerOrderEnd);

    assert.ok(sellerOrderStart > -1, "seller deletion must update seller-owned retained orders");
    assert.match(sellerOrderUpdate, /some: \{ listing: \{ sellerId: user\.sellerProfile\.id \} \}/);
    assert.match(sellerOrderUpdate, /every: \{ listing: \{ sellerId: user\.sellerProfile\.id \} \}/);
    for (const field of [
      "trackingCarrier",
      "trackingNumber",
      "sellerNotes",
      "shippoShipmentId",
      "shippoRateObjectId",
      "shippoTransactionId",
      "labelUrl",
      "labelCarrier",
      "labelTrackingNumber",
    ]) {
      assert.match(sellerOrderUpdate, new RegExp(`${field}: null`), `seller deletion must clear ${field}`);
    }
  });

  it("removes only deleted-user-created blocks and keeps media cleanup scoped to the deleted sender", () => {
    const deletion = source("src/lib/accountDeletion.ts");

    assert.match(deletion, /tx\.block\.deleteMany\(\{\s*where: \{ blockerId: user\.id \} \}\)/);
    assert.doesNotMatch(deletion, /blockedId: user\.id/);
    assert.match(deletion, /db\.message\.findMany\(\{\s*where: \{ senderId: userId \}/s);
    assert.doesNotMatch(deletion, /where: \{ OR: \[\{ senderId: userId \}, \{ recipientId: userId \}\] \}/);
  });

  it("redacts other-party message and case-message bodies that quote deleted-account values", () => {
    const deletion = source("src/lib/accountDeletion.ts");

    assert.match(deletion, /function bodyTextMatchSql\(value: string\)/);
    assert.match(deletion, /function caseDescriptionTextMatchSql\(value: string\)/);
    assert.match(deletion, /FROM "Message"[\s\S]*"senderId" <> \$\{deletedUserId\}[\s\S]*"recipientId" = \$\{deletedUserId\}/);
    assert.match(deletion, /FROM "CaseMessage"[\s\S]*"authorId" <> \$\{deletedUserId\}[\s\S]*"caseId" IN \([\s\S]*FROM "Case"[\s\S]*"buyerId" = \$\{deletedUserId\}[\s\S]*OR "sellerId" = \$\{deletedUserId\}/);
    assert.match(deletion, /FROM "Case"[\s\S]*\("buyerId" = \$\{deletedUserId\} OR "sellerId" = \$\{deletedUserId\}\)/);
    assert.match(deletion, /redactMessagesAboutDeletedAccount\(tx, user\.id, accountSensitiveValues\)/);
    assert.match(deletion, /redactCaseMessagesAboutDeletedAccount\(tx, user\.id, accountSensitiveValues\)/);
    assert.match(deletion, /redactCasesAboutDeletedAccount\(tx, user\.id, accountSensitiveValues\)/);
  });

  it("redacts deleted-account values from retained order review notes", () => {
    const deletion = source("src/lib/accountDeletion.ts");

    assert.match(deletion, /async function redactOrderReviewNotesForDeletedAccount/);
    assert.match(deletion, /reviewNote: \{ not: null \}/);
    assert.match(deletion, /\{ buyerId: deletedUserId \}/);
    assert.match(deletion, /items: \{ some: \{ listing: \{ sellerId: sellerProfileId \} \} \}/);
    assert.match(deletion, /redactAccountDeletionText\(order\.reviewNote, sensitiveValues\)/);
    assert.match(deletion, /data: \{ reviewNote: reviewNote\.text \}/);
    assert.match(deletion, /redactOrderReviewNotesForDeletedAccount\(\s*tx,\s*user\.id,\s*user\.sellerProfile\?\.id \?\? null,\s*accountSensitiveValues,\s*\)/s);
  });

  it("preserves conversations without deleted-account email fallbacks", () => {
    const deletion = source("src/lib/accountDeletion.ts");
    const threadPage = source("src/app/messages/[id]/page.tsx");
    const inboxPage = source("src/app/messages/page.tsx");
    const threadRenderQueryStart = threadPage.indexOf("const convo = await prisma.conversation.findFirst");
    const threadRenderQueryEnd = threadPage.indexOf("  // Auto-mark any unread NEW_MESSAGE notifications", threadRenderQueryStart);
    assert.ok(threadRenderQueryStart > -1, "thread page must keep a conversation render query");
    assert.ok(threadRenderQueryEnd > threadRenderQueryStart, "thread render query must stay bounded before side effects");
    const threadRenderQuery = threadPage.slice(
      threadRenderQueryStart,
      threadRenderQueryEnd,
    );

    assert.doesNotMatch(deletion, /conversation\.deleteMany/);
    assert.match(deletion, /tx\.message\.updateMany\(\{\s*where: \{ senderId: user\.id \}/s);
    assert.doesNotMatch(threadRenderQuery, /email: true/);
    assert.doesNotMatch(inboxPage, /select: \{[^}]*email: true/s);
    assert.doesNotMatch(inboxPage, /email:\s*\{\s*contains:\s*q/);
    assert.match(threadPage, /otherSellerProfile\?\.displayName \|\| other\?\.name \|\| "User"/);
    assert.match(inboxPage, /seller\?\.displayName \|\| other\?\.name \|\| "User"/);
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

  it("uses seller contact, address, and profile URLs as deletion redaction needles", () => {
    const deletion = source("src/lib/accountDeletion.ts");
    const userSelectStart = deletion.indexOf("const user = await tx.user.findUnique");
    const userSelectEnd = deletion.indexOf("if (!user) return", userSelectStart);
    const userSelect = deletion.slice(userSelectStart, userSelectEnd);
    const sensitiveStart = deletion.indexOf("const accountSensitiveValues = normalizedSensitiveValues");
    const sensitiveEnd = deletion.indexOf("]);", sensitiveStart);
    const sensitiveBlock = deletion.slice(sensitiveStart, sensitiveEnd);

    for (const field of [
      "shipFromName",
      "shipFromLine1",
      "shipFromLine2",
      "shipFromCity",
      "shipFromState",
      "shipFromPostal",
      "instagramUrl",
      "facebookUrl",
      "pinterestUrl",
      "tiktokUrl",
      "websiteUrl",
    ]) {
      assert.match(userSelect, new RegExp(`${field}: true`), `seller profile select must include ${field}`);
      assert.match(sensitiveBlock, new RegExp(`user\\.sellerProfile\\?\\.${field}`), `sensitive values must include ${field}`);
    }
  });

  it("scrubs seller gallery alt text and email outbox content on account deletion", () => {
    const deletion = source("src/lib/accountDeletion.ts");

    assert.match(deletion, /const accountEmailState = await userAccountEmailAddressState\(tx, \{/);
    assert.match(deletion, /const accountEmails = await accountEmailFallbackEmailsForUser\(tx, \{/);
    assert.match(deletion, /emails: accountEmailState\.emails/);
    assert.match(deletion, /\.\.\.accountEmails/);
    assert.match(deletion, /const accountEmailSuppressionKeys = accountEmailSuppressionKeysForEmails\(accountEmails\)/);
    assert.match(deletion, /accountEmailSuppressionKeys\.length > 0/);
    assert.match(deletion, /galleryImageUrls: \[\]/);
    assert.match(deletion, /galleryAltTexts: \[\]/);
    assert.match(deletion, /tx\.emailOutbox\.updateMany\(\{/);
    assert.match(deletion, /OR: \[\{ userId: user\.id \}, \{ recipientEmail: \{ in: suppressionEmailMatches \} \}\]/);
    assert.match(deletion, /sentAt: null/);
    assert.match(deletion, /status: \{ in: \["PENDING", "PROCESSING", "FAILED", "DEAD"\] \}/);
    assert.match(deletion, /status: "SKIPPED"/);
    assert.match(deletion, /html: "\[Email removed after account deletion\]"/);
    assert.match(deletion, /recipientEmail: "deleted-account@deleted\.thegrainline\.local"/);
    assert.match(deletion, /subject: "Email removed after account deletion"/);
    assert.match(deletion, /tx\.emailFailureCount\.deleteMany\(\{\s*where: \{ email: \{ in: suppressionEmailMatches \} \},\s*\}\)/s);
    assert.match(deletion, /tx\.newsletterSubscriber\.deleteMany\(\{\s*where: \{ email: \{ in: suppressionEmailMatches \} \},\s*\}\)/s);
    assert.match(deletion, /tx\.userEmailAddress\.deleteMany\(\{\s*where: \{ userId: user\.id \},\s*\}\)/s);
    assert.match(deletion, /tx\.directUpload\.deleteMany\(\{\s*where: \{ userId: user\.id \}\s*,?\s*\}\)/s);
  });

  it("scrubs account-linked support and data-request contact fields on account deletion", () => {
    const deletion = source("src/lib/accountDeletion.ts");

    assert.match(deletion, /import \{[^}]*supportRequestAccountExportWhere[^}]*\} from "@\/lib\/supportRequest"/);
    assert.match(deletion, /const DELETED_SUPPORT_REQUEST_EMAIL = "deleted-account@deleted\.thegrainline\.local"/);
    assert.match(deletion, /const DELETED_SUPPORT_REQUEST_MESSAGE = "\[Support request removed after account deletion\]"/);
    assert.match(deletion, /async function redactSupportRequestsForDeletedAccount/);
    assert.match(deletion, /supportRequestAccountExportWhere\(deletedUserId, accountEmails\)/);
    assert.match(deletion, /tx\.supportRequest\.findMany\(\{/);
    assert.match(deletion, /redactAccountDeletionText\(request\.closureEvidence, sensitiveValues\)\.text/);
    assert.match(deletion, /redactAccountDeletionText\(request\.emailLastError, sensitiveValues\)\.text/);
    assert.match(deletion, /userId: null/);
    assert.match(deletion, /name: null/);
    assert.match(deletion, /email: DELETED_SUPPORT_REQUEST_EMAIL/);
    assert.match(deletion, /orderId: null/);
    assert.match(deletion, /listingId: null/);
    assert.match(deletion, /message: DELETED_SUPPORT_REQUEST_MESSAGE/);
    assert.match(deletion, /redactSupportRequestsForDeletedAccount\(tx, user\.id, accountEmails, accountSensitiveValues\)/);
  });

  it("does not let one hard provider suppression block account-deletion suppressions for other aliases", () => {
    const deletion = source("src/lib/accountDeletion.ts");

    assert.match(deletion, /const providerHardSuppressionEmails = new Set\(/);
    assert.match(deletion, /suppressionEmailMatches\.filter\(\s*\(email\) => !providerHardSuppressionEmails\.has\(email\),\s*\)/s);
    assert.match(deletion, /email: \{ in: manualSuppressionEmails \}/);
    assert.doesNotMatch(deletion, /const hasProviderHardSuppression/);
    assert.doesNotMatch(deletion, /if \(!hasProviderHardSuppression\)/);
  });

  it("scrubs authored blog comments on account deletion", () => {
    const deletion = source("src/lib/accountDeletion.ts");

    assert.match(deletion, /tx\.blogComment\.updateMany\(\{\s*where: \{ authorId: user\.id \},\s*data: \{ body: "\[Comment deleted\]", approved: false \},\s*\}\)/s);
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

  it("scrubs maker verification personal details and reviewer linkage", () => {
    const deletion = source("src/lib/accountDeletion.ts");

    const verificationUpdateStart = deletion.indexOf("await tx.makerVerification.updateMany({");
    const verificationUpdateEnd = deletion.indexOf("await tx.follow.deleteMany", verificationUpdateStart);
    const verificationUpdate = deletion.slice(verificationUpdateStart, verificationUpdateEnd);

    assert.ok(verificationUpdateStart > -1, "account deletion must update maker verification rows");
    assert.match(verificationUpdate, /craftDescription: "\[Deleted\]"/);
    assert.match(verificationUpdate, /guildMasterCraftBusiness: null/);
    assert.match(verificationUpdate, /yearsExperience: 0/);
    assert.match(verificationUpdate, /portfolioUrl: null/);
    assert.match(verificationUpdate, /status: "REJECTED"/);
    assert.match(verificationUpdate, /reviewedById: null/);
    assert.match(verificationUpdate, /reviewNotes: null/);
    assert.match(verificationUpdate, /appliedAt: now/);
    assert.match(verificationUpdate, /reviewedAt: null/);
  });

  it("redacts account identifiers from admin audit reasons as well as metadata", () => {
    const deletion = source("src/lib/accountDeletion.ts");

    assert.match(deletion, /COALESCE\(reason, ''\)/);
    assert.match(deletion, /redactAccountDeletionText\(candidate\.reason, sensitiveValues\)/);
    assert.match(deletion, /reason\.changed && reason\.text !== null \? \{ reason: reason\.text \} : \{\}/);
  });

  it("resets retained deleted-account role while keeping deleted accounts blocked", () => {
    const deletion = source("src/lib/accountDeletion.ts");

    const userUpdateStart = deletion.indexOf("await tx.user.update({");
    const userUpdate = deletion.slice(userUpdateStart, deletion.indexOf("return {", userUpdateStart));

    assert.ok(userUpdateStart > -1, "account deletion must anonymize the retained user row");
    assert.match(userUpdate, /role: "USER"/);
    assert.match(userUpdate, /banned: true/);
    assert.match(userUpdate, /deletedAt: now/);
  });

  it("allocates collision-safe deleted-account blog archive slugs", () => {
    const deletion = source("src/lib/accountDeletion.ts");
    const exportRoute = source("src/app/api/account/export/route.ts");

    assert.match(deletion, /function deletedAccountBlogSlug\(postId: string, collisionIndex = 0\)/);
    assert.match(deletion, /`deleted-\$\{postId\}-\$\{collisionIndex\}`/);
    assert.match(deletion, /async function deletedAccountAvailableBlogSlug\(postId: string\)/);
    assert.match(deletion, /tx\.blogPost\.findUnique\(\{\s*where: \{ slug \}/s);
    assert.match(deletion, /const archivedSlug = await deletedAccountAvailableBlogSlug\(post\.id\)/);
    assert.match(deletion, /materialDisclosure: null/);
    assert.match(exportRoute, /materialDisclosure: true/);
    assert.doesNotMatch(deletion, /slug: `deleted-\$\{post\.id\}`/);
  });
});
