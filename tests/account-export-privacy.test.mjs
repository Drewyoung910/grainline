import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("account export privacy coverage", () => {
  it("exports only actor-related messages through the fixed recipient projection", () => {
    const route = source("src/app/api/account/export/route.ts");
    const authority = source("src/lib/conversationMessageAuthority.ts");

    assert.match(route, /exportActorMessages\(user\.id\)/);
    assert.match(route, /message\.senderId === user\.id/);
    assert.match(route, /message\.recipientId === user\.id/);
    assert.match(authority, /public\.grainline_message_export/);
    assert.doesNotMatch(route, /prisma\.message\.(?:find|count|create|update|delete)/);
  });

  it("exports owned listing photo originals and only actor-safe refund history", () => {
    const route = source("src/app/api/account/export/route.ts");
    const authority = source("src/lib/orderParticipantExportAuthority.ts");
    const migration = source(
      "prisma/migrations/20260901030000_prepare_order_participant_export_authority/migration.sql",
    );

    assert.match(route, /photos: \{ orderBy: \{ sortOrder: "asc" \}, select: \{ url: true, originalUrl: true/);
    assert.match(route, /exportBuyerOrders\(user\.id\)/);
    assert.match(route, /exportSellerOrders\(user\.id\)/);
    assert.doesNotMatch(route, /prisma\.order\.findMany|shippingRateQuotes/);
    assert.match(authority, /grainline_order_buyer_export_page/);
    assert.match(authority, /grainline_order_seller_export_page/);
    assert.doesNotMatch(migration, /OrderShippingRateQuote|'sellerRefundId'|'shipmentId'|'rates'/);
    assert.match(route, /exportBuyerOrderPaymentHistory\(user\.id\)/);
    assert.match(route, /exportSellerOrderPaymentHistory\(user\.id\)/);
    assert.match(route, /paymentEvents: buyerPaymentHistory\.get\(order\.id\) \?\? \[\]/);
    assert.match(route, /paymentEvents: sellerPaymentHistory\.get\(order\.id\) \?\? \[\]/);
  });

  it("exports non-note Stripe Connect diagnostics for sellers", () => {
    const schema = source("prisma/schema.prisma");
    const route = source("src/app/api/account/export/route.ts");
    const sellerSelectStart = route.indexOf("const sellerProfile = await prisma.sellerProfile.findUnique");
    const sellerSelectEnd = route.indexOf("const [", sellerSelectStart);
    const sellerSelect = route.slice(sellerSelectStart, sellerSelectEnd);

    for (const field of [
      "stripeAccountId",
      "stripeAccountVersion",
      "stripeControllerType",
      "manualStripeReconciliationNeeded",
    ]) {
      assert.match(schema, new RegExp(`\\b${field}\\b`), `schema must retain ${field}`);
      assert.match(sellerSelect, new RegExp(`${field}: true`), `account export must select ${field}`);
    }
  });

  it("exports user-authored blog material disclosures", () => {
    const route = source("src/app/api/account/export/route.ts");
    const blogStart = route.indexOf("prisma.blogPost.findMany({");
    const blogEnd = route.indexOf("prisma.blogComment.findMany", blogStart);
    const blogBlock = route.slice(blogStart, blogEnd);

    assert.ok(blogStart >= 0, "account export must query authored blog posts");
    assert.ok(blogEnd > blogStart, "blog post export block must stay bounded");
    assert.match(blogBlock, /materialDisclosure: true/);
  });

  it("keeps explicit export collections for common user-owned records", () => {
    const route = source("src/app/api/account/export/route.ts");
    const payload = source("src/lib/accountExportPayload.ts");

    for (const model of [
      "block",
      "userReport",
      "supportRequest",
      "emailSuppression",
      "emailOutbox",
      "emailFailureCount",
      "stockNotification",
      "makerVerification",
      "sellerFaq",
      "newsletterSubscriber",
      "sellerBroadcast",
      "reviewVote",
    ]) {
      assert.match(route, new RegExp(`prisma\\.${model}`), `account export must query ${model}`);
    }
    assert.match(
      route,
      /exportCheckoutStockReservations\(user\.id\)/,
      "account export must query checkout reservations through its sanitized fixed operation",
    );
    assert.match(
      route,
      /exportSellerPayoutEvents\(user\.id\)/,
      "account export must query payout events through its seller-scoped fixed operation",
    );
    assert.match(
      route,
      /exportOwnedDirectUploads\(user\.id\)/,
      "account export must query DirectUpload through its sanitized fixed operation",
    );

    for (const key of [
      "blocks",
      "userReportsSubmitted",
      "userReportsReceived",
      "accountEmailAddresses",
      "supportRequests",
      "emailSuppressions",
      "emailOutboxRows",
      "emailFailureCounts",
      "stockNotifications",
      "checkoutStockReservations",
      "makerVerification",
      "sellerFaqs",
      "newsletterSubscriptions",
      "sellerBroadcasts",
      "sellerPayoutEvents",
      "directUploads",
      "reviewVotes",
    ]) {
      assert.match(payload, new RegExp(`${key}: data\\.${key}`), `payload must expose ${key}`);
    }
  });

  it("exports checkout stock reservations without counterparty identifiers", () => {
    const route = source("src/app/api/account/export/route.ts");
    const payload = source("src/lib/accountExportPayload.ts");
    const appAuthority = source("src/lib/checkoutStockReservationAuthority.ts");
    const sqlAuthority = source("docs/rls-drafts/checkout-stock-reservation-authority.sql")
      .replace(/\s+/g, " ");

    assert.match(route, /import \{ exportCheckoutStockReservations \} from "@\/lib\/checkoutStockReservationAuthority"/);
    assert.match(route, /exportCheckoutStockReservations\(user\.id\)/);
    assert.match(route, /const checkoutStockReservations = checkoutStockReservationRows/);
    assert.doesNotMatch(route, /prisma\.checkoutStockReservation\./);
    assert.match(appAuthority, /grainline_checkout_reservation_export\(\$\{userId\}\)/);
    assert.match(sqlAuthority, /reservation\."buyerId" = p_user_id OR \(source_seller_id IS NOT NULL AND reservation\."sellerId" = source_seller_id\)/);
    assert.match(sqlAuthority, /CASE WHEN reservation\."buyerId" = p_user_id THEN reservation\."buyerId"::text END/);
    assert.match(sqlAuthority, /CASE WHEN source_seller_id IS NOT NULL AND reservation\."sellerId" = source_seller_id THEN reservation\."sellerId"::text END/);
    assert.match(sqlAuthority, /CASE WHEN reservation\."buyerId" = p_user_id THEN reservation\."stripeSessionId"::text END/);
    assert.match(sqlAuthority, /'listingId', item\.value->>'listingId', 'quantity', \(item\.value->>'quantity'\)::integer/);
    assert.doesNotMatch(sqlAuthority, /'sellerId', item\.value->>'sellerId'/);
    assert.match(payload, /checkoutStockReservations: unknown\[\]/);
    assert.match(payload, /checkoutStockReservations: data\.checkoutStockReservations/);
  });

  it("exports seller ship-from address fields used for label purchases", () => {
    const schema = source("prisma/schema.prisma");
    const route = source("src/app/api/account/export/route.ts");
    const sellerSelectStart = route.indexOf("const sellerProfile = await prisma.sellerProfile.findUnique");
    const sellerSelectEnd = route.indexOf("const [", sellerSelectStart);
    const sellerSelect = route.slice(sellerSelectStart, sellerSelectEnd);

    for (const field of [
      "shipFromName",
      "shipFromLine1",
      "shipFromLine2",
      "shipFromCity",
      "shipFromState",
      "shipFromPostal",
      "shipFromCountry",
    ]) {
      assert.match(schema, new RegExp(`${field}\\s+String\\?`), `schema must retain ${field}`);
      assert.match(sellerSelect, new RegExp(`${field}: true`), `account export must select ${field}`);
    }
  });

  it("exports current user-configured seller profile and listing fields", () => {
    const schema = source("prisma/schema.prisma");
    const route = source("src/app/api/account/export/route.ts");
    const sellerSelectStart = route.indexOf("const sellerProfile = await prisma.sellerProfile.findUnique");
    const sellerSelectEnd = route.indexOf("const [", sellerSelectStart);
    const sellerSelect = route.slice(sellerSelectStart, sellerSelectEnd);
    const listingSelectStart = route.indexOf("sellerProfile\n      ? prisma.listing.findMany");
    const listingSelectEnd = route.indexOf("photos: { orderBy", listingSelectStart);
    const listingSelect = route.slice(listingSelectStart, listingSelectEnd);

    for (const field of [
      "defaultPkgWeightGrams",
      "defaultPkgLengthCm",
      "defaultPkgWidthCm",
      "defaultPkgHeightCm",
      "storyTitle",
      "storyBody",
      "instagramUrl",
      "facebookUrl",
      "pinterestUrl",
      "tiktokUrl",
      "websiteUrl",
      "yearsInBusiness",
      "acceptsCustomOrders",
      "acceptingNewOrders",
      "customOrderTurnaroundDays",
      "offersGiftWrapping",
      "giftWrappingPriceCents",
      "returnPolicy",
      "customOrderPolicy",
      "shippingPolicy",
      "featuredListingIds",
      "galleryImageUrls",
      "galleryAltTexts",
      "isVerifiedMaker",
      "verifiedAt",
      "guildLevel",
      "guildMemberApprovedAt",
      "guildMasterApprovedAt",
      "guildMasterAppliedAt",
      "guildMasterReviewNotes",
      "consecutiveMetricFailures",
      "lastMetricCheckAt",
      "metricWarningSentAt",
      "listingsBelowThresholdSince",
      "onboardingStep",
      "onboardingComplete",
      "vacationReturnDate",
      "isFoundingMaker",
      "foundingMakerNumber",
      "foundingMakerAt",
    ]) {
      assert.match(schema, new RegExp(`\\b${field}\\b`), `schema must retain ${field}`);
      assert.match(sellerSelect, new RegExp(`${field}: true`), `account export must select ${field}`);
    }

    for (const field of [
      "priceVersion",
      "videoUrl",
      "processingTimeMinDays",
      "processingTimeMaxDays",
      "shipsWithinDays",
      "packagedWeightGrams",
      "packagedLengthCm",
      "packagedWidthCm",
      "packagedHeightCm",
      "reservedForUserId",
      "customOrderConversationId",
      "metaDescription",
      "materials",
      "productLengthIn",
      "productWidthIn",
      "productHeightIn",
    ]) {
      assert.match(schema, new RegExp(`\\b${field}\\b`), `schema must retain ${field}`);
      assert.match(listingSelect, new RegExp(`${field}: true`), `account export must select ${field}`);
    }
  });

  it("exports support and data-request records by stable account link with email fallback", () => {
    const schema = source("prisma/schema.prisma");
    const route = source("src/app/api/account/export/route.ts");
    const supportStart = route.indexOf("prisma.supportRequest.findMany");
    const supportEnd = route.indexOf("prisma.emailSuppression.findMany", supportStart);
    const supportBlock = route.slice(supportStart, supportEnd);

    assert.match(schema, /supportRequests\s+SupportRequest\[\]/);
    assert.match(schema, /userId\s+String\?/);
    assert.match(schema, /user\s+User\?\s+@relation\(fields: \[userId\], references: \[id\], onDelete: SetNull\)/);
    assert.match(schema, /@@index\(\[userId, createdAt\]\)/);
    assert.ok(supportStart >= 0, "account export must query supportRequest");
    assert.match(supportBlock, /supportRequestAccountExportWhere\(user\.id, accountEmails\)/);
    assert.match(supportBlock, /orderId: true/);
    assert.match(supportBlock, /listingId: true/);
    assert.match(supportBlock, /emailLastError: true/);
    assert.match(supportBlock, /closureEvidence: true/);
    assert.match(supportBlock, /closureEvidenceAt: true/);
    assert.doesNotMatch(supportBlock, /closureEvidenceById: true/);
    assert.doesNotMatch(supportBlock, /where:\s*\{\s*email:\s*accountEmail\s*\}/);
  });

  it("exports email suppressions by the same exact and canonical keys used for delivery checks", () => {
    const route = source("src/app/api/account/export/route.ts");
    const suppressionStart = route.indexOf("prisma.emailSuppression.findMany");
    const suppressionBlock = route.slice(suppressionStart, route.indexOf("prisma.stockNotification.findMany", suppressionStart));

    assert.match(route, /accountEmailFallbackEmailsForUser/);
    assert.match(route, /accountEmailSuppressionKeysForEmails/);
    assert.match(route, /userAccountEmailAddressState/);
    assert.match(route, /const accountEmailState = await userAccountEmailAddressState\(prisma, \{/);
    assert.match(route, /const accountEmails = await accountEmailFallbackEmailsForUser\(prisma, \{/);
    assert.match(route, /emails: accountEmailState\.emails/);
    assert.match(route, /const accountEmailSuppressionKeys = accountEmailSuppressionKeysForEmails\(accountEmails\)/);
    assert.match(suppressionBlock, /where: \{ email: \{ in: accountEmailSuppressionKeys \} \}/);
    assert.match(suppressionBlock, /id: true/);
    assert.match(suppressionBlock, /eventId: true/);
    assert.doesNotMatch(suppressionBlock, /where: \{ email: accountEmail \}/);
  });

  it("exports local email outbox and transient failure records by account id or delivery email keys", () => {
    const route = source("src/app/api/account/export/route.ts");
    const notificationAccess = source("src/lib/notificationOwnerAccess.ts");
    const payload = source("src/lib/accountExportPayload.ts");

    const notificationStart = route.indexOf("ownerNotificationExportRows(user.id)");
    const outboxStart = route.indexOf("prisma.emailOutbox.findMany");
    const failureStart = route.indexOf("prisma.emailFailureCount.findMany");
    const outboxBlock = route.slice(outboxStart, failureStart);
    const failureBlock = route.slice(failureStart, route.indexOf("prisma.stockNotification.findMany", failureStart));
    const notificationSelectStart = notificationAccess.indexOf("export const NOTIFICATION_EXPORT_SELECT");
    const notificationSelectBlock = notificationAccess.slice(
      notificationSelectStart,
      notificationAccess.indexOf("export async function countUnreadOwnerNotifications", notificationSelectStart),
    );

    assert.ok(notificationStart >= 0, "account export must query Notification");
    assert.match(notificationAccess, /ownerNotificationExportRows\(\s*userId: string,/);
    assert.match(notificationAccess, /public\.grainline_notification_export\(\$\{userId\}::text\)/);
    assert.doesNotMatch(notificationAccess, /prisma\.notification\./);
    assert.match(notificationSelectBlock, /sourceType: true/);
    assert.match(notificationSelectBlock, /sourceId: true/);

    assert.ok(outboxStart >= 0, "account export must query EmailOutbox");
    assert.match(outboxBlock, /OR: \[\{ userId: user\.id \}, \{ recipientEmail: \{ in: accountEmailSuppressionKeys \} \}\]/);
    assert.match(outboxBlock, /recipientEmail: true/);
    assert.match(outboxBlock, /templateName: true/);
    assert.match(outboxBlock, /sourceType: true/);
    assert.match(outboxBlock, /sourceId: true/);
    assert.match(outboxBlock, /subject: true/);
    assert.match(outboxBlock, /lastError: true/);
    assert.doesNotMatch(outboxBlock, /html: true/);

    assert.ok(failureStart >= 0, "account export must query EmailFailureCount");
    assert.match(failureBlock, /where: \{ email: \{ in: accountEmailSuppressionKeys \} \}/);
    assert.match(failureBlock, /count: true/);
    assert.match(failureBlock, /lastEventId: true/);

    assert.match(payload, /emailOutboxRows: data\.emailOutboxRows/);
    assert.match(payload, /emailFailureCounts: data\.emailFailureCounts/);
  });

  it("exports historical account email rows and newsletter records by account email keys", () => {
    const route = source("src/app/api/account/export/route.ts");
    const payload = source("src/lib/accountExportPayload.ts");

    const historyStart = route.indexOf("const accountEmailState = await userAccountEmailAddressState");
    const sellerProfileStart = route.indexOf("const sellerProfile = await prisma.sellerProfile.findUnique");
    const historyBlock = route.slice(historyStart, sellerProfileStart);
    const newsletterStart = route.indexOf("prisma.newsletterSubscriber.findMany");
    const newsletterEnd = route.indexOf("sellerProfile\n      ? prisma.sellerBroadcast.findMany", newsletterStart);
    const newsletterBlock = route.slice(newsletterStart, newsletterEnd);

    assert.match(historyBlock, /userId: user\.id/);
    assert.match(historyBlock, /currentEmail: accountEmail/);
    assert.match(source("src/lib/userEmailAddresses.ts"), /currentSinceAt: true/);
    assert.match(historyBlock, /accountEmailFallbackEmailsForUser\(prisma/);
    assert.match(historyBlock, /emails: accountEmailState\.emails/);
    assert.match(route, /const accountEmailAddresses = accountEmailState\.rows/);
    assert.match(route, /accountEmailAddresses,/);
    assert.match(payload, /accountEmailAddresses: unknown\[\]/);
    assert.match(payload, /accountEmailAddresses: data\.accountEmailAddresses/);
    assert.match(newsletterBlock, /where: \{ email: \{ in: accountEmailSuppressionKeys \} \}/);
    assert.doesNotMatch(newsletterBlock, /where: \{ email: accountEmail \}/);
  });

  it("exports seller payout event ledger rows for the seller profile", () => {
    const schema = source("prisma/schema.prisma");
    const route = source("src/app/api/account/export/route.ts");
    const payload = source("src/lib/accountExportPayload.ts");
    const payoutAuthority = source("src/lib/sellerPayoutEventAuthority.ts");

    assert.match(schema, /model SellerPayoutEvent \{/);
    assert.match(schema, /sellerProfile\s+SellerProfile\s+@relation\(fields: \[sellerProfileId\], references: \[id\], onDelete: Restrict\)/);
    assert.match(route, /sellerProfile \? exportSellerPayoutEvents\(user\.id\) : \[\]/);
    assert.doesNotMatch(route, /prisma\.sellerPayoutEvent/);
    assert.match(payoutAuthority, /grainline_seller_payout_export_page/);
    assert.match(payoutAuthority, /const pageLimit = 500/);
    for (const field of [
      "seller_profile_id",
      "stripe_payout_id",
      "status",
      "amount_cents",
      "currency",
      "failure_code",
      "failure_message",
      "stripe_event_id",
      "event_created_seconds",
      "created_at",
      "updated_at",
    ]) {
      assert.match(payoutAuthority, new RegExp(`\\b${field}\\b`), `account export must select ${field}`);
    }
    assert.match(route, /sellerPayoutEvents,/);
    assert.match(payload, /sellerPayoutEvents: unknown\[\]/);
    assert.match(payload, /sellerPayoutEvents: data\.sellerPayoutEvents/);
  });

  it("exports direct upload lifecycle rows owned by the account", () => {
    const schema = source("prisma/schema.prisma");
    const route = source("src/app/api/account/export/route.ts");
    const lifecycle = source("src/lib/directUploadLifecycle.ts");
    const payload = source("src/lib/accountExportPayload.ts");
    const uploadStart = lifecycle.indexOf("export async function exportOwnedDirectUploads");
    const uploadEnd = lifecycle.indexOf("export async function accountDirectUploadPublicUrls", uploadStart);
    const uploadBlock = lifecycle.slice(uploadStart, uploadEnd);

    assert.match(schema, /model DirectUpload \{/);
    assert.ok(uploadStart >= 0, "account export must query DirectUpload");
    assert.match(route, /exportOwnedDirectUploads\(user\.id\)/);
    assert.match(uploadBlock, /grainline_direct_upload_export\(\$\{userId\}\)/);
    for (const field of [
      "id",
      "endpoint",
      "storageClass",
      "contentType",
      "expectedSize",
      "status",
      "cleanupAfter",
      "verifiedAt",
      "claimedAt",
      "deletedAt",
      "attempts",
      "createdAt",
      "updatedAt",
    ]) {
      assert.match(lifecycle, new RegExp(`${field}:`), `account export type must include ${field}`);
    }
    for (const forbidden of [
      "key",
      "publicUrl",
      "claimedByType",
      "claimedById",
      "lastError",
    ]) {
      assert.doesNotMatch(uploadBlock, new RegExp(`\\b${forbidden}\\b`));
    }
    assert.match(route, /directUploads,/);
    assert.match(payload, /directUploads: unknown\[\]/);
    assert.match(payload, /directUploads: data\.directUploads/);
  });

  it("keeps account export behind POST, same-origin, and fresh session checks", () => {
    const route = source("src/app/api/account/export/route.ts");
    const settingsPage = source("src/app/account/settings/page.tsx");
    const exportButton = source("src/components/AccountExportButton.tsx");

    assert.match(route, /import \{ auth, reverificationErrorResponse \} from "@clerk\/nextjs\/server"/);
    assert.match(route, /getExplicitCrossOriginPostRejection\(req\)/);
    assert.match(route, /hasFreshAccountExportSession\(session\.factorVerificationAge\)/);
    assert.match(route, /reverificationErrorResponse\(ACCOUNT_EXPORT_REVERIFICATION\)/);
    assert.match(route, /export async function GET\(\) \{[\s\S]*status: HTTP_STATUS\.METHOD_NOT_ALLOWED[\s\S]*Allow: "POST"/);
    assert.match(route, /export async function POST\(req: Request\)/);
    assert.doesNotMatch(route, /handleExport\("GET"\)/);

    const guardIndex = route.indexOf("getExplicitCrossOriginPostRejection(req)");
    const authIndex = route.indexOf("await auth()");
    const freshnessIndex = route.indexOf("hasFreshAccountExportSession(session.factorVerificationAge)");
    const buildIndex = route.indexOf("await buildExport(user)");
    const auditIndex = route.indexOf("await logUserAuditAction");
    const downloadIndex = route.indexOf("return jsonDownload(payload, user.id)");

    assert.ok(guardIndex > -1);
    assert.ok(authIndex > guardIndex);
    assert.ok(freshnessIndex > authIndex);
    assert.ok(buildIndex > freshnessIndex);
    assert.ok(auditIndex > buildIndex);
    assert.ok(downloadIndex > auditIndex);

    assert.match(settingsPage, /<AccountExportButton \/>/);
    assert.doesNotMatch(settingsPage, /href="\/api\/account\/export"/);
    assert.match(exportButton, /useReverification\(fetchAccountExport\)/);
    assert.match(exportButton, /method: "POST"/);
    assert.match(exportButton, /response\.json\(\)\.catch/);
    assert.doesNotMatch(exportButton, /content-type/);
    assert.doesNotMatch(exportButton, /window\.location\.href\s*=\s*"\/api\/account\/export"/);
  });
});
