import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";

const { Client } = pg;

const databaseUrl = process.env.NOTIFICATION_RLS_PROOF_DATABASE_URL;
const runtimeRole = "grainline_app_runtime";
const fixture = Object.freeze({
  sellerUserId: "notification-proof-seller-user",
  actorUserId: "notification-proof-actor-user",
  foreignUserId: "notification-proof-foreign-user",
  staffUserId: "notification-proof-staff-user",
  sellerProfileId: "notification-proof-seller-profile",
  followId: "notification-proof-follow",
  listingId: "notification-proof-listing",
  conversationId: "notification-proof-conversation",
  messageId: "notification-proof-message",
  orderId: "notification-proof-order",
  orderItemId: "notification-proof-order-item",
  caseId: "notification-proof-case",
  caseMessageId: "notification-proof-case-message",
  caseResolutionAuditId: "notification-proof-case-resolution-audit",
  caseSystemAuditId: "notification-proof-case-system-audit",
  commissionRequestId: "notification-proof-commission-request",
  commissionInterestId: "notification-proof-commission-interest",
  commissionClosedRequestId: "notification-proof-commission-closed-request",
  commissionClosedInterestId: "notification-proof-commission-closed-interest",
  blogPostId: "notification-proof-blog-post",
  blogParentCommentId: "notification-proof-blog-parent-comment",
  blogTopCommentId: "notification-proof-blog-top-comment",
  blogReplyCommentId: "notification-proof-blog-reply-comment",
  sellerBroadcastId: "notification-proof-seller-broadcast",
  reviewId: "notification-proof-review",
  customRequestMessageId: "notification-proof-custom-request-message",
  customListingId: "notification-proof-custom-listing",
  customLinkMessageId: "notification-proof-custom-link-message",
  manualLowStockAuditId: "notification-proof-manual-low-stock-audit",
  checkoutReservationId: "notification-proof-checkout-reservation",
  makerVerificationId: "notification-proof-maker-verification",
  guildAdminAuditId: "notification-proof-guild-admin-audit",
  guildSystemUserId: "notification-proof-guild-system-user",
  guildSystemProfileId: "notification-proof-guild-system-profile",
  guildSystemVerificationId: "notification-proof-guild-system-verification",
  guildSystemAuditId: "notification-proof-guild-system-audit",
  listingReportId: "notification-proof-listing-report",
  listingReviewAuditId: "notification-proof-listing-review-audit",
  accountWarningAuditId: "notification-proof-account-warning-audit",
  bannedSellerUserId: "notification-proof-banned-seller-user",
  bannedSellerProfileId: "notification-proof-banned-seller-profile",
  bannedListingId: "notification-proof-banned-listing",
  bannedOrderId: "notification-proof-banned-order",
  bannedOrderItemId: "notification-proof-banned-order-item",
  banAuditId: "notification-proof-ban-audit",
  orderCheckoutAuditId: "notification-proof-order-checkout-audit",
  orderFulfillmentAuditId: "notification-proof-order-fulfillment-audit",
  orderPaymentEventId: "notification-proof-order-payment-event",
  orderDisputeAuditId: "notification-proof-order-dispute-audit",
  payoutEventId: "notification-proof-payout-event",
  stockNotificationId: "notification-proof-stock-notification",
  restockAuditId: "notification-proof-restock-audit",
  ownUnreadId: "notification-proof-own-unread",
  ownReadId: "notification-proof-own-read",
  foreignUnreadId: "notification-proof-foreign-unread",
});

const recipientFunctions = new Set([
  "grainline_notification_unread_count",
  "grainline_notification_bell",
  "grainline_notification_page",
  "grainline_notification_mark_one_read",
  "grainline_notification_mark_many_read",
  "grainline_notification_mark_conversation_read",
  "grainline_notification_export",
  "grainline_notification_recent_low_stock",
]);

const serviceFunctions = new Set([
  "grainline_notification_create_core",
  "grainline_notification_create_source_fanout",
  "grainline_notification_create_social_event",
  "grainline_notification_create_message_event",
  "grainline_notification_create_case_event",
  "grainline_notification_create_commission_event",
  "grainline_notification_create_inventory_event",
  "grainline_notification_create_verification_event",
  "grainline_notification_create_moderation_event",
  "grainline_notification_create_account_warning",
  "grainline_notification_create_order_event",
  "grainline_notification_claim_back_in_stock",
  "grainline_notification_delete_for_account",
  "grainline_notification_delete_blog_comment",
  "grainline_notification_delete_seller_broadcast",
  "grainline_notification_prune_read_batch",
  "grainline_notification_prune_unread_batch",
]);

const runtimeServiceFunctions = new Set(
  [...serviceFunctions].filter((name) => name !== "grainline_notification_create_core"),
);

const completedChecks = [];

function record(check) {
  completedChecks.push(check);
}

function validateTarget(rawUrl) {
  assert.ok(rawUrl, "NOTIFICATION_RLS_PROOF_DATABASE_URL is required");
  const parsed = new URL(rawUrl);
  assert.ok(
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1",
    "ephemeral proof refuses a non-loopback database",
  );
  assert.equal(parsed.pathname, "/grainline_ci", "ephemeral proof requires the grainline_ci database");
}

function newClient(applicationName) {
  return new Client({ connectionString: databaseUrl, application_name: applicationName });
}

async function expectPgError(operation, expectedCodes, label) {
  try {
    await operation();
  } catch (error) {
    assert.ok(
      expectedCodes.includes(error?.code),
      `${label} failed with unexpected PostgreSQL code ${error?.code ?? "unknown"}`,
    );
    return;
  }
  assert.fail(`${label} unexpectedly succeeded`);
}

async function setRuntimeRole(client) {
  await client.query(`SET ROLE ${runtimeRole}`);
  const role = await client.query("SELECT current_user, session_user");
  assert.equal(role.rows[0].current_user, runtimeRole);
  assert.equal(role.rows[0].session_user, "ci");
}

async function cleanFixtures(owner) {
  const userIds = [
    fixture.sellerUserId,
    fixture.actorUserId,
    fixture.foreignUserId,
    fixture.staffUserId,
    fixture.guildSystemUserId,
    fixture.bannedSellerUserId,
  ];
  await owner.query('DELETE FROM public."Block" WHERE "blockerId" = ANY($1::text[]) OR "blockedId" = ANY($1::text[])', [userIds]);
  await owner.query('DELETE FROM public."Notification" WHERE "userId" = ANY($1::text[]) OR "relatedUserId" = ANY($1::text[])', [userIds]);
  await owner.query('DELETE FROM public."StockNotification" WHERE id = $1', [fixture.stockNotificationId]);
  await owner.query('DELETE FROM public."CheckoutStockReservation" WHERE id = $1', [fixture.checkoutReservationId]);
  await owner.query('DELETE FROM public."UserReport" WHERE id = $1', [fixture.listingReportId]);
  await owner.query('DELETE FROM public."Review" WHERE id = $1', [fixture.reviewId]);
  await owner.query(
    'DELETE FROM public."Favorite" WHERE "userId" = $1 AND "listingId" = $2',
    [fixture.actorUserId, fixture.listingId],
  );
  await owner.query('DELETE FROM public."BlogComment" WHERE id = ANY($1::text[])', [[
    fixture.blogTopCommentId,
    fixture.blogReplyCommentId,
    fixture.blogParentCommentId,
  ]]);
  await owner.query('DELETE FROM public."BlogPost" WHERE id = $1', [fixture.blogPostId]);
  await owner.query('DELETE FROM public."SellerBroadcast" WHERE id = $1', [fixture.sellerBroadcastId]);
  await owner.query('DELETE FROM public."AdminAuditLog" WHERE id = ANY($1::text[])', [[
    fixture.guildAdminAuditId,
    fixture.accountWarningAuditId,
    fixture.caseResolutionAuditId,
    fixture.listingReviewAuditId,
    fixture.banAuditId,
  ]]);
  await owner.query('DELETE FROM public."MakerVerification" WHERE id = ANY($1::text[])', [[
    fixture.makerVerificationId,
    fixture.guildSystemVerificationId,
  ]]);
  await owner.query('DELETE FROM public."SellerPayoutEvent" WHERE id = $1', [fixture.payoutEventId]);
  await owner.query('DELETE FROM public."SystemAuditLog" WHERE id = ANY($1::text[])', [[
    fixture.manualLowStockAuditId,
    fixture.restockAuditId,
    fixture.caseSystemAuditId,
    fixture.guildSystemAuditId,
    fixture.orderCheckoutAuditId,
    fixture.orderFulfillmentAuditId,
    fixture.orderDisputeAuditId,
  ]]);
  await owner.query('DELETE FROM public."CaseMessage" WHERE id = $1', [fixture.caseMessageId]);
  await owner.query('DELETE FROM public."Case" WHERE id = $1', [fixture.caseId]);
  await owner.query('DELETE FROM public."OrderPaymentEvent" WHERE id = $1', [fixture.orderPaymentEventId]);
  await owner.query('DELETE FROM public."OrderItem" WHERE id = $1', [fixture.orderItemId]);
  await owner.query('DELETE FROM public."Order" WHERE id = $1', [fixture.orderId]);
  await owner.query('DELETE FROM public."OrderItem" WHERE id = $1', [fixture.bannedOrderItemId]);
  await owner.query('DELETE FROM public."Order" WHERE id = $1', [fixture.bannedOrderId]);
  await owner.query('DELETE FROM public."CommissionInterest" WHERE id = ANY($1::text[])', [[
    fixture.commissionInterestId,
    fixture.commissionClosedInterestId,
  ]]);
  await owner.query('DELETE FROM public."CommissionRequest" WHERE id = ANY($1::text[])', [[
    fixture.commissionRequestId,
    fixture.commissionClosedRequestId,
  ]]);
  await owner.query('DELETE FROM public."Message" WHERE id = ANY($1::text[])', [[
    fixture.messageId,
    fixture.customRequestMessageId,
    fixture.customLinkMessageId,
  ]]);
  await owner.query('DELETE FROM public."Listing" WHERE id = $1', [fixture.customListingId]);
  await owner.query('DELETE FROM public."Conversation" WHERE id = $1', [fixture.conversationId]);
  await owner.query('DELETE FROM public."Follow" WHERE id = $1', [fixture.followId]);
  await owner.query('DELETE FROM public."Listing" WHERE id = $1', [fixture.bannedListingId]);
  await owner.query('DELETE FROM public."Listing" WHERE id = $1', [fixture.listingId]);
  await owner.query('DELETE FROM public."SellerProfile" WHERE id = ANY($1::text[])', [[
    fixture.sellerProfileId,
    fixture.guildSystemProfileId,
    fixture.bannedSellerProfileId,
  ]]);
  await owner.query('DELETE FROM public."User" WHERE id = ANY($1::text[])', [userIds]);
}

async function seedFixtures(owner) {
  await cleanFixtures(owner);
  await owner.query(
    `INSERT INTO public."User" (id, "clerkId", email, name, "updatedAt")
     VALUES
       ($1, 'clerk_notification_proof_seller', 'notification-proof-seller@example.invalid', 'Proof Seller', pg_catalog.clock_timestamp()),
       ($2, 'clerk_notification_proof_actor', 'notification-proof-actor@example.invalid', 'Proof Actor', pg_catalog.clock_timestamp()),
       ($3, 'clerk_notification_proof_foreign', 'notification-proof-foreign@example.invalid', 'Proof Foreign', pg_catalog.clock_timestamp()),
       ($4, 'clerk_notification_proof_staff', 'notification-proof-staff@example.invalid', 'Proof Staff', pg_catalog.clock_timestamp()),
       ($5, 'clerk_notification_proof_guild_system', 'notification-proof-guild-system@example.invalid', 'Proof Guild System', pg_catalog.clock_timestamp()),
       ($6, 'clerk_notification_proof_banned_seller', 'notification-proof-banned-seller@example.invalid', 'Proof Banned Seller', pg_catalog.clock_timestamp())`,
    [
      fixture.sellerUserId,
      fixture.actorUserId,
      fixture.foreignUserId,
      fixture.staffUserId,
      fixture.guildSystemUserId,
      fixture.bannedSellerUserId,
    ],
  );
  await owner.query('UPDATE public."User" SET role = \'ADMIN\' WHERE id = $1', [fixture.staffUserId]);
  await owner.query(
    `UPDATE public."User"
        SET banned = true, "bannedAt" = pg_catalog.clock_timestamp(),
            "banReason" = 'Notification proof ban', "bannedBy" = $2
      WHERE id = $1`,
    [fixture.bannedSellerUserId, fixture.staffUserId],
  );
  await owner.query(
    `INSERT INTO public."SellerProfile" (
       id, "userId", "displayName", "displayNameNormalized", "chargesEnabled",
       "guildLevel", "guildMemberApprovedAt", "updatedAt"
     ) VALUES (
       $1, $2, 'Proof Seller', 'proof seller', true,
       'GUILD_MEMBER', pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
     )`,
    [fixture.sellerProfileId, fixture.sellerUserId],
  );
  await owner.query(
    `INSERT INTO public."SellerProfile" (
       id, "userId", "displayName", "displayNameNormalized", "guildLevel",
       "consecutiveMetricFailures", "metricWarningSentAt", "updatedAt"
     ) VALUES (
       $1, $2, 'Proof Guild Master', 'proof guild master', 'GUILD_MASTER',
       1, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
     )`,
    [fixture.guildSystemProfileId, fixture.guildSystemUserId],
  );
  await owner.query(
    `INSERT INTO public."SellerProfile" (
       id, "userId", "displayName", "displayNameNormalized", "updatedAt"
     ) VALUES ($1, $2, 'Proof Banned Seller', 'proof banned seller', pg_catalog.clock_timestamp())`,
    [fixture.bannedSellerProfileId, fixture.bannedSellerUserId],
  );
  await owner.query(
    `INSERT INTO public."Listing" (
       id, "sellerId", title, description, "priceCents", status,
       "listingType", "stockQuantity", "updatedAt"
     ) VALUES (
       $1, $2, 'Proof Listing', 'Notification authority proof listing', 12500,
       'ACTIVE', 'IN_STOCK', 2, pg_catalog.clock_timestamp()
     )`,
    [fixture.listingId, fixture.sellerProfileId],
  );
  await owner.query(
    `INSERT INTO public."Listing" (
       id, "sellerId", title, description, "priceCents", status, "updatedAt"
     ) VALUES (
       $1, $2, 'Proof Banned Listing', 'Notification proof banned listing',
       5000, 'ACTIVE', pg_catalog.clock_timestamp()
     )`,
    [fixture.bannedListingId, fixture.bannedSellerProfileId],
  );
  await owner.query(
    `INSERT INTO public."Follow" (id, "followerId", "sellerProfileId") VALUES ($1, $2, $3)`,
    [fixture.followId, fixture.actorUserId, fixture.sellerProfileId],
  );
  await owner.query(
    `INSERT INTO public."Favorite" ("userId", "listingId") VALUES ($1, $2)`,
    [fixture.actorUserId, fixture.listingId],
  );
  await owner.query(
    `INSERT INTO public."Review" (
       id, "listingId", "reviewerId", "ratingX2", comment, "updatedAt"
     ) VALUES ($1, $2, $3, 9, 'Proof review', pg_catalog.clock_timestamp())`,
    [fixture.reviewId, fixture.listingId, fixture.actorUserId],
  );
  await owner.query(
    `INSERT INTO public."BlogPost" (
       id, slug, title, body, "authorId", "authorType", "sellerProfileId",
       status, "publishedAt", "updatedAt"
     ) VALUES (
       $1, 'notification-proof-post', 'Proof post', 'Proof post body', $2,
       'MAKER', $3, 'PUBLISHED', pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
     )`,
    [fixture.blogPostId, fixture.sellerUserId, fixture.sellerProfileId],
  );
  await owner.query(
    `INSERT INTO public."BlogComment" (
       id, "postId", "authorId", body, approved, "parentId"
     ) VALUES
       ($1, $4, $5, 'Seller parent comment', true, NULL),
       ($2, $4, $6, 'Actor top-level comment', true, NULL),
       ($3, $4, $6, 'Actor reply comment', true, $1)`,
    [
      fixture.blogParentCommentId,
      fixture.blogTopCommentId,
      fixture.blogReplyCommentId,
      fixture.blogPostId,
      fixture.sellerUserId,
      fixture.actorUserId,
    ],
  );
  await owner.query(
    `INSERT INTO public."SellerBroadcast" (id, "sellerProfileId", message, "recipientCount")
     VALUES ($1, $2, 'Proof seller broadcast', 1)`,
    [fixture.sellerBroadcastId, fixture.sellerProfileId],
  );
  await owner.query(
    `INSERT INTO public."Conversation" (id, "userAId", "userBId", "updatedAt")
     VALUES ($1, $2, $3, pg_catalog.clock_timestamp())`,
    [fixture.conversationId, fixture.actorUserId, fixture.sellerUserId],
  );
  await owner.query(
    `INSERT INTO public."Message" (
       id, "conversationId", "senderId", "recipientId", body
     ) VALUES ($1, $2, $3, $4, 'Proof message body')`,
    [fixture.messageId, fixture.conversationId, fixture.actorUserId, fixture.sellerUserId],
  );
  await owner.query(
    `INSERT INTO public."Message" (
       id, "conversationId", "senderId", "recipientId", body, kind
     ) VALUES ($1, $2, $3, $4, $5, 'custom_order_request')`,
    [
      fixture.customRequestMessageId,
      fixture.conversationId,
      fixture.actorUserId,
      fixture.sellerUserId,
      JSON.stringify({ description: "Proof custom request" }),
    ],
  );
  await owner.query(
    `INSERT INTO public."Listing" (
       id, "sellerId", title, description, "priceCents", status,
       "reservedForUserId", "customOrderConversationId", "updatedAt"
     ) VALUES (
       $1, $2, 'Proof Custom Listing', 'Proof custom listing', 25000, 'ACTIVE',
       $3, $4, pg_catalog.clock_timestamp()
     )`,
    [
      fixture.customListingId,
      fixture.sellerProfileId,
      fixture.actorUserId,
      fixture.conversationId,
    ],
  );
  await owner.query(
    `INSERT INTO public."Message" (
       id, "conversationId", "senderId", "recipientId", body, kind
     ) VALUES ($1, $2, $3, $4, $5, 'custom_order_link')`,
    [
      fixture.customLinkMessageId,
      fixture.conversationId,
      fixture.sellerUserId,
      fixture.actorUserId,
      JSON.stringify({ listingId: fixture.customListingId }),
    ],
  );
  await owner.query(
    `INSERT INTO public."Order" (
       id, "buyerId", "paidAt", "stripeSessionId"
     ) VALUES ($1, $2, pg_catalog.clock_timestamp(), 'cs_notification_proof')`,
    [fixture.orderId, fixture.actorUserId],
  );
  await owner.query(
    `INSERT INTO public."OrderItem" (
       id, "orderId", "listingId", quantity, "priceCents"
     ) VALUES ($1, $2, $3, 1, 12500)`,
    [fixture.orderItemId, fixture.orderId, fixture.listingId],
  );
  await owner.query(
    `INSERT INTO public."CheckoutStockReservation" (
       id, "checkoutLockKey", "payloadHash", "buyerId", "sellerId",
       "stripeSessionId", status, "reservedItems", "expiresAt", "updatedAt"
     ) VALUES (
       $1, 'notification-proof-checkout-lock',
       'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
       $2, $3, 'cs_notification_proof', 'COMPLETED',
       pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('listingId', $4::text)),
       pg_catalog.clock_timestamp() + interval '1 hour', pg_catalog.clock_timestamp()
     )`,
    [
      fixture.checkoutReservationId,
      fixture.actorUserId,
      fixture.sellerUserId,
      fixture.listingId,
    ],
  );
  await owner.query(
    `INSERT INTO public."Order" (
       id, "buyerId", "paidAt", "stripeSessionId", "reviewNeeded"
     ) VALUES ($1, $2, pg_catalog.clock_timestamp(), 'cs_notification_proof_banned', true)`,
    [fixture.bannedOrderId, fixture.actorUserId],
  );
  await owner.query(
    `INSERT INTO public."OrderItem" (
       id, "orderId", "listingId", quantity, "priceCents"
     ) VALUES ($1, $2, $3, 1, 5000)`,
    [fixture.bannedOrderItemId, fixture.bannedOrderId, fixture.bannedListingId],
  );
  await owner.query(
    `INSERT INTO public."Case" (
       id, "orderId", "buyerId", "sellerId", reason, description, "sellerRespondBy", "updatedAt"
     ) VALUES (
       $1, $2, $3, $4, 'OTHER', 'Proof case description',
       pg_catalog.clock_timestamp() + interval '2 days', pg_catalog.clock_timestamp()
     )`,
    [fixture.caseId, fixture.orderId, fixture.actorUserId, fixture.sellerUserId],
  );
  await owner.query(
    `INSERT INTO public."CaseMessage" (id, "caseId", "authorId", body)
     VALUES ($1, $2, $3, 'Proof buyer case message')`,
    [fixture.caseMessageId, fixture.caseId, fixture.actorUserId],
  );
  await owner.query(
    `INSERT INTO public."AdminAuditLog" (
       id, "adminId", action, "targetType", "targetId", metadata
     ) VALUES (
       $1, $2, 'MARK_CASE_RESOLVED', 'CASE', $3,
       pg_catalog.jsonb_build_object(
         'actorKind', 'user',
         'orderId', $4::text,
         'status', 'PENDING_CLOSE'
       )
     )`,
    [fixture.caseResolutionAuditId, fixture.actorUserId, fixture.caseId, fixture.orderId],
  );
  await owner.query(
    `INSERT INTO public."SystemAuditLog" (
       id, "actorType", "actorId", action, "targetType", "targetId", metadata
     ) VALUES (
       $1, 'cron', 'case-auto-close', 'AUTO_ESCALATE_CASE', 'CASE', $2,
       pg_catalog.jsonb_build_object(
         'orderId', $3::text,
         'previousStatus', 'OPEN',
         'newStatus', 'UNDER_REVIEW'
       )
     )`,
    [fixture.caseSystemAuditId, fixture.caseId, fixture.orderId],
  );
  await owner.query(
    `INSERT INTO public."SystemAuditLog" (
       id, "actorType", "actorId", action, "targetType", "targetId", metadata
     ) VALUES
       ($1, 'webhook', 'evt_notification_proof_checkout',
        'STRIPE_CHECKOUT_ORDER_CREATED', 'ORDER', $4,
        pg_catalog.jsonb_build_object('stripeSessionId', 'cs_notification_proof')),
       ($2, 'user', $5, 'ORDER_FULFILLMENT_TRANSITION', 'ORDER', $4,
        pg_catalog.jsonb_build_object(
          'action', 'shipped',
          'newStatus', 'SHIPPED',
          'trackingCarrier', 'Proof Carrier'
        )),
       ($3, 'webhook', 'evt_notification_proof_dispute',
        'STRIPE_DISPUTE_RECORDED', 'ORDER', $4,
        pg_catalog.jsonb_build_object('disputeSideEffectsApplied', true))`,
    [
      fixture.orderCheckoutAuditId,
      fixture.orderFulfillmentAuditId,
      fixture.orderDisputeAuditId,
      fixture.orderId,
      fixture.sellerUserId,
    ],
  );
  await owner.query(
    `INSERT INTO public."OrderPaymentEvent" (
       id, "orderId", "stripeEventId", "eventType", metadata, "updatedAt"
     ) VALUES (
       $1, $2, 'evt_notification_proof_dispute', 'DISPUTE',
       pg_catalog.jsonb_build_object('stripeEventType', 'charge.dispute.created'),
       pg_catalog.clock_timestamp()
     )`,
    [fixture.orderPaymentEventId, fixture.orderId],
  );
  await owner.query(
    `INSERT INTO public."CommissionRequest" (
       id, "buyerId", title, description, "updatedAt"
     ) VALUES ($1, $2, 'Proof commission', 'Proof commission description', pg_catalog.clock_timestamp())`,
    [fixture.commissionRequestId, fixture.actorUserId],
  );
  await owner.query(
    `INSERT INTO public."CommissionInterest" (
       id, "commissionRequestId", "sellerProfileId", "conversationId"
     ) VALUES ($1, $2, $3, $4)`,
    [
      fixture.commissionInterestId,
      fixture.commissionRequestId,
      fixture.sellerProfileId,
      fixture.conversationId,
    ],
  );
  await owner.query(
    `INSERT INTO public."CommissionRequest" (
       id, "buyerId", title, description, status, "updatedAt"
     ) VALUES (
       $1, $2, 'Closed proof commission', 'Closed proof commission description',
       'CLOSED', pg_catalog.clock_timestamp()
     )`,
    [fixture.commissionClosedRequestId, fixture.actorUserId],
  );
  await owner.query(
    `INSERT INTO public."CommissionInterest" (
       id, "commissionRequestId", "sellerProfileId", "conversationId"
     ) VALUES ($1, $2, $3, $4)`,
    [
      fixture.commissionClosedInterestId,
      fixture.commissionClosedRequestId,
      fixture.sellerProfileId,
      fixture.conversationId,
    ],
  );
  await owner.query(
    `INSERT INTO public."SystemAuditLog" (
       id, "actorType", "actorId", action, "targetType", "targetId", metadata
     ) VALUES (
       $1, 'user', $2, 'MANUAL_LISTING_STOCK_LOW', 'LISTING', $3::text,
       pg_catalog.jsonb_build_object(
         'listingId', $3::text,
         'listingTitle', 'Proof Listing',
         'newQuantity', '2',
         'mutationKind', 'absolute'
       )
     )`,
    [fixture.manualLowStockAuditId, fixture.sellerUserId, fixture.listingId],
  );
  await owner.query(
    `INSERT INTO public."MakerVerification" (
       id, "sellerProfileId", "craftDescription", "yearsExperience", status,
       "reviewedById", "reviewedAt", "updatedAt"
     ) VALUES (
       $1, $2, 'Proof craft', 10, 'APPROVED', $3,
       pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
     )`,
    [fixture.makerVerificationId, fixture.sellerProfileId, fixture.staffUserId],
  );
  await owner.query(
    `INSERT INTO public."MakerVerification" (
       id, "sellerProfileId", "craftDescription", "yearsExperience", status, "updatedAt"
     ) VALUES (
       $1, $2, 'Proof Guild Master craft', 15, 'GUILD_MASTER_APPROVED',
       pg_catalog.clock_timestamp()
     )`,
    [fixture.guildSystemVerificationId, fixture.guildSystemProfileId],
  );
  await owner.query(
    `INSERT INTO public."AdminAuditLog" (
       id, "adminId", action, "targetType", "targetId", reason, metadata
     ) VALUES
       ($1, $3, 'APPROVE_GUILD_MEMBER', 'SELLER_PROFILE', $4, 'Approved for proof', '{}'::jsonb),
       ($2, $3, 'SEND_EMAIL', 'USER', $5, 'Account notice',
        pg_catalog.jsonb_build_object('notificationBody', 'Proof account warning body'))`,
    [
      fixture.guildAdminAuditId,
      fixture.accountWarningAuditId,
      fixture.staffUserId,
      fixture.sellerProfileId,
      fixture.actorUserId,
    ],
  );
  await owner.query(
    `INSERT INTO public."AdminAuditLog" (
       id, "adminId", action, "targetType", "targetId", reason, metadata
     ) VALUES
       ($1, $3, 'APPROVE_LISTING', 'LISTING', $4, NULL,
        pg_catalog.jsonb_build_object('finalStatus', 'ACTIVE')),
       ($2, $3, 'BAN_USER', 'USER', $5, 'Notification proof ban',
        pg_catalog.jsonb_build_object(
          'flaggedOpenOrders',
          pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('id', $6::text, 'buyerId', $7::text)
          )
        ))`,
    [
      fixture.listingReviewAuditId,
      fixture.banAuditId,
      fixture.staffUserId,
      fixture.listingId,
      fixture.bannedSellerUserId,
      fixture.bannedOrderId,
      fixture.actorUserId,
    ],
  );
  await owner.query(
    `UPDATE public."Listing"
        SET "reviewedByAdmin" = true, "reviewedAt" = pg_catalog.clock_timestamp()
      WHERE id = $1`,
    [fixture.listingId],
  );
  await owner.query(
    `INSERT INTO public."SystemAuditLog" (
       id, "actorType", "actorId", action, "targetType", "targetId", metadata
     ) VALUES (
       $1, 'cron', 'guild-metrics', 'WARN_GUILD_MASTER_METRICS',
       'SELLER_PROFILE', $2,
       pg_catalog.jsonb_build_object(
         'jobName', 'guild-metrics',
         'sellerUserId', $3::text
       )
     )`,
    [fixture.guildSystemAuditId, fixture.guildSystemProfileId, fixture.guildSystemUserId],
  );
  await owner.query(
    `INSERT INTO public."UserReport" (
       id, "reporterId", "reportedId", reason, "targetType", "targetId"
     ) VALUES ($1, $2, $3, 'OTHER', 'LISTING', $4)`,
    [fixture.listingReportId, fixture.actorUserId, fixture.sellerUserId, fixture.listingId],
  );
  await owner.query(
    `INSERT INTO public."SellerPayoutEvent" (
       id, "sellerProfileId", "stripePayoutId", status, "failureMessage",
       "stripeEventId", "updatedAt"
     ) VALUES (
       $1, $2, 'po_notification_proof', 'failed', 'Proof payout failure',
       'evt_notification_proof_payout', pg_catalog.clock_timestamp()
     )`,
    [fixture.payoutEventId, fixture.sellerProfileId],
  );
  await owner.query(
    `INSERT INTO public."StockNotification" (id, "listingId", "userId", "createdAt")
     VALUES ($1, $2, $3, pg_catalog.clock_timestamp() - interval '1 day')`,
    [fixture.stockNotificationId, fixture.listingId, fixture.actorUserId],
  );
  await owner.query(
    `INSERT INTO public."SystemAuditLog" (
       id, "actorType", "actorId", action, "targetType", "targetId", metadata
     ) VALUES (
       $1, 'user', $2, 'MANUAL_LISTING_RESTOCKED', 'LISTING', $3::text,
       pg_catalog.jsonb_build_object(
         'listingId', $3::text,
         'listingTitle', 'Proof Listing',
         'previousStatus', 'SOLD_OUT',
         'newStatus', 'ACTIVE',
         'newQuantity', '2',
         'mutationKind', 'absolute'
       )
     )`,
    [fixture.restockAuditId, fixture.sellerUserId, fixture.listingId],
  );
  await owner.query(
    `INSERT INTO public."Notification" (
       id, "userId", type, title, body, link, "sourceType", "sourceId", "dedupKey", read
     ) VALUES
       ($1, $4, 'NEW_MESSAGE', 'Own unread', 'Own unread body', '/messages/proof', 'message', 'proof-message-own', 'proof-own-unread', false),
       ($2, $4, 'LOW_STOCK', 'Own read', 'Own read body', '/listing/proof', 'manual_low_stock', 'proof-stock-own', 'proof-own-read', true),
       ($3, $5, 'NEW_MESSAGE', 'Foreign unread', 'Foreign unread body', '/messages/foreign', 'message', 'proof-message-foreign', 'proof-foreign-unread', false)`,
    [fixture.ownUnreadId, fixture.ownReadId, fixture.foreignUnreadId, fixture.sellerUserId, fixture.foreignUserId],
  );
}

async function proveCatalog(owner) {
  const target = await owner.query(
    `SELECT current_database() AS database_name, current_user,
            runtime.rolsuper, runtime.rolcreatedb, runtime.rolcreaterole,
            runtime.rolreplication, runtime.rolbypassrls, runtime.rolinherit
       FROM pg_catalog.pg_roles AS runtime
      WHERE runtime.rolname = $1`,
    [runtimeRole],
  );
  assert.equal(target.rows.length, 1);
  assert.deepEqual(target.rows[0], {
    database_name: "grainline_ci",
    current_user: "ci",
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolreplication: false,
    rolbypassrls: false,
    rolinherit: false,
  });

  const table = await owner.query(
    `SELECT cls.relrowsecurity, cls.relforcerowsecurity,
            pg_catalog.pg_get_userbyid(cls.relowner) AS owner_name
       FROM pg_catalog.pg_class AS cls
       JOIN pg_catalog.pg_namespace AS ns ON ns.oid = cls.relnamespace
      WHERE ns.nspname = 'public' AND cls.relname = 'Notification'`,
  );
  assert.deepEqual(table.rows[0], {
    relrowsecurity: true,
    relforcerowsecurity: false,
    owner_name: "ci",
  });

  const policies = await owner.query(
    `SELECT policyname, cmd, roles::text[] AS roles, qual, with_check
       FROM pg_catalog.pg_policies
      WHERE schemaname = 'public' AND tablename = 'Notification'
      ORDER BY policyname`,
  );
  assert.deepEqual(
    policies.rows.map(({ policyname, cmd, roles }) => ({ policyname, cmd, roles })),
    [
      { policyname: "grainline_notification_recipient_select", cmd: "SELECT", roles: [runtimeRole] },
      { policyname: "grainline_notification_recipient_update", cmd: "UPDATE", roles: [runtimeRole] },
    ],
  );
  for (const policy of policies.rows) {
    assert.match(policy.qual, /current_setting\('app\.user_id'::text, true\)/);
    if (policy.cmd === "UPDATE") {
      assert.match(policy.with_check, /current_setting\('app\.user_id'::text, true\)/);
    }
  }

  const grants = await owner.query(
    `SELECT
       pg_catalog.has_table_privilege($1, 'public."Notification"', 'SELECT') AS can_select,
       pg_catalog.has_table_privilege($1, 'public."Notification"', 'INSERT') AS can_insert,
       pg_catalog.has_table_privilege($1, 'public."Notification"', 'UPDATE') AS can_update_table,
       pg_catalog.has_table_privilege($1, 'public."Notification"', 'DELETE') AS can_delete,
       pg_catalog.has_table_privilege($1, 'public."Notification"', 'TRUNCATE') AS can_truncate,
       pg_catalog.has_column_privilege($1, 'public."Notification"', 'read', 'UPDATE') AS can_update_read,
       pg_catalog.has_column_privilege($1, 'public."Notification"', 'title', 'UPDATE') AS can_update_title,
       pg_catalog.has_column_privilege($1, 'public."Notification"', 'userId', 'UPDATE') AS can_update_user_id`,
    [runtimeRole],
  );
  assert.deepEqual(grants.rows[0], {
    can_select: true,
    can_insert: false,
    can_update_table: false,
    can_delete: false,
    can_truncate: false,
    can_update_read: true,
    can_update_title: false,
    can_update_user_id: false,
  });

  const expectedFunctions = new Set([...recipientFunctions, ...serviceFunctions]);
  const functions = await owner.query(
    `SELECT proc.proname, proc.prosecdef, proc.proconfig,
            pg_catalog.has_function_privilege($1, proc.oid, 'EXECUTE') AS runtime_execute,
            EXISTS (
              SELECT 1
                FROM pg_catalog.aclexplode(
                  COALESCE(proc.proacl, pg_catalog.acldefault('f', proc.proowner))
                ) AS acl
               WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
            ) AS public_execute
      FROM pg_catalog.pg_proc AS proc
      JOIN pg_catalog.pg_namespace AS ns ON ns.oid = proc.pronamespace
      WHERE ns.nspname = 'public'
        AND proc.proname = ANY($2::text[])
      ORDER BY proc.proname`,
    [runtimeRole, [...expectedFunctions]],
  );
  assert.equal(functions.rows.length, expectedFunctions.size, "Notification proof function overload drifted");
  assert.deepEqual(new Set(functions.rows.map((row) => row.proname)), expectedFunctions);
  for (const fn of functions.rows) {
    assert.deepEqual(fn.proconfig, ["search_path=pg_catalog"], `${fn.proname} must pin search_path`);
    assert.equal(fn.public_execute, false, `${fn.proname} must revoke PUBLIC EXECUTE`);
    assert.equal(fn.prosecdef, serviceFunctions.has(fn.proname), `${fn.proname} security mode drifted`);
    assert.equal(
      fn.runtime_execute,
      recipientFunctions.has(fn.proname) || runtimeServiceFunctions.has(fn.proname),
      `${fn.proname} runtime EXECUTE drifted`,
    );
  }
  record("catalog_roles_rls_policies_grants_and_function_acl");
}

async function proveRecipientIsolation(owner) {
  const runtime = newClient("notification-proof-recipient");
  await runtime.connect();
  try {
    await setRuntimeRole(runtime);
    const noContext = await runtime.query('SELECT pg_catalog.count(*)::integer AS count FROM public."Notification"');
    assert.equal(noContext.rows[0].count, 0);

    await runtime.query("BEGIN");
    await runtime.query("SELECT pg_catalog.set_config('app.user_id', $1, true)", [fixture.sellerUserId]);
    const ownRows = await runtime.query('SELECT id, "userId" FROM public."Notification" ORDER BY id');
    assert.equal(ownRows.rows.length, 2);
    assert.ok(ownRows.rows.every((row) => row.userId === fixture.sellerUserId));
    const updated = await runtime.query(
      'UPDATE public."Notification" SET read = false WHERE id = $1 RETURNING id',
      [fixture.ownReadId],
    );
    assert.equal(updated.rowCount, 1);
    await expectPgError(
      () => runtime.query('UPDATE public."Notification" SET title = $1 WHERE id = $2', ["forbidden", fixture.ownUnreadId]),
      ["42501"],
      "direct title update",
    );
    await runtime.query("ROLLBACK");

    const afterRollback = await runtime.query("SELECT pg_catalog.current_setting('app.user_id', true) AS user_id");
    assert.ok(afterRollback.rows[0].user_id == null || afterRollback.rows[0].user_id === "");

    await expectPgError(
      () => runtime.query(
        `INSERT INTO public."Notification" (id, "userId", type, title, body, "dedupKey")
         VALUES ('forbidden-insert', $1, 'NEW_MESSAGE', 'x', 'x', 'forbidden-insert')`,
        [fixture.sellerUserId],
      ),
      ["42501"],
      "direct notification insert",
    );
    await expectPgError(
      () => runtime.query('DELETE FROM public."Notification" WHERE id = $1', [fixture.ownUnreadId]),
      ["42501"],
      "direct notification delete",
    );

    const bell = await runtime.query(
      "SELECT id, \"unreadCount\" FROM public.grainline_notification_bell($1, 20)",
      [fixture.sellerUserId],
    );
    assert.equal(bell.rows.length, 2);
    assert.ok(bell.rows.every((row) => row.id !== fixture.foreignUnreadId));
    assert.equal(Number(bell.rows[0].unreadCount), 1);

    const deniedForeignMark = await runtime.query(
      "SELECT public.grainline_notification_mark_one_read($1, $2) AS count",
      [fixture.sellerUserId, fixture.foreignUnreadId],
    );
    assert.equal(Number(deniedForeignMark.rows[0].count), 0);

    const foreignViaAssertedRecipient = await runtime.query(
      "SELECT public.grainline_notification_unread_count($1) AS count",
      [fixture.foreignUserId],
    );
    assert.equal(Number(foreignViaAssertedRecipient.rows[0].count), 1);
    const afterRpc = await runtime.query("SELECT pg_catalog.current_setting('app.user_id', true) AS user_id");
    assert.ok(afterRpc.rows[0].user_id == null || afterRpc.rows[0].user_id === "");

    record("runtime_direct_no_context_denial");
    record("recipient_own_rows_and_column_only_mark_read");
    record("recipient_rpc_statement_local_context_reset");
    record("recipient_rpc_server_asserted_user_id_residual_recorded");
  } finally {
    await runtime.end();
  }
}

async function invokeFollowNotification(client, notificationId) {
  return client.query(
    `SELECT public.grainline_notification_create_social_event(
       $1, $2, 'NEW_FOLLOWER', 'follow', $3, $4
     ) AS notification_id`,
    [notificationId, fixture.sellerUserId, fixture.sellerProfileId, fixture.actorUserId],
  );
}

async function proveServiceAuthority(owner) {
  const runtime = newClient("notification-proof-service");
  await runtime.connect();
  try {
    await setRuntimeRole(runtime);
    await expectPgError(
      () => runtime.query(
        `SELECT public.grainline_notification_create_core(
           $1, $2, 'NEW_FOLLOWER', 'follow', $3, $4
         )`,
        [crypto.randomUUID(), fixture.sellerUserId, fixture.sellerProfileId, fixture.actorUserId],
      ),
      ["42501"],
      "private notification core",
    );
    await expectPgError(
      () => runtime.query(
        `SELECT public.grainline_notification_create_social_event(
           $1, $2, 'NEW_MESSAGE', 'message', 'forbidden-message', $3
         )`,
        [crypto.randomUUID(), fixture.sellerUserId, fixture.actorUserId],
      ),
      ["22023"],
      "wrong source family",
    );
    record("service_core_private_and_family_source_validation");
  } finally {
    await runtime.end();
  }
}

async function configureResolvedCase(owner, resolution, refundAmountCents = null) {
  await owner.query(
    `UPDATE public."Case"
        SET status = 'RESOLVED',
            resolution = $2::public."CaseResolution",
            "refundAmountCents" = $3,
            "resolvedById" = $4,
            "resolvedAt" = pg_catalog.clock_timestamp(),
            "updatedAt" = pg_catalog.clock_timestamp()
      WHERE id = $1`,
    [fixture.caseId, resolution, refundAmountCents, fixture.staffUserId],
  );
}

async function configureCaseMessageAuthor(owner, authorId, body) {
  await owner.query(
    `UPDATE public."CaseMessage"
        SET "authorId" = $2, body = $3
      WHERE id = $1`,
    [fixture.caseMessageId, authorId, body],
  );
}

async function configureCaseResolutionAudit(owner, actorId, status) {
  await owner.query(
    `UPDATE public."AdminAuditLog"
        SET "adminId" = $2,
            metadata = pg_catalog.jsonb_build_object(
              'actorKind', 'user',
              'orderId', $3::text,
              'status', $4::text
            )
      WHERE id = $1`,
    [fixture.caseResolutionAuditId, actorId, fixture.orderId, status],
  );
}

async function configureCaseSystemAudit(owner, action, previousStatus, newStatus) {
  await owner.query(
    `UPDATE public."SystemAuditLog"
        SET action = $2,
            metadata = pg_catalog.jsonb_build_object(
              'orderId', $3::text,
              'previousStatus', $4::text,
              'newStatus', $5::text
            )
      WHERE id = $1`,
    [fixture.caseSystemAuditId, action, fixture.orderId, previousStatus, newStatus],
  );
}

async function configureCommissionRequestStatus(owner, status) {
  await owner.query(
    `UPDATE public."CommissionRequest"
        SET status = $2::public."CommissionStatus", "updatedAt" = pg_catalog.clock_timestamp()
      WHERE id = $1`,
    [fixture.commissionClosedRequestId, status],
  );
}

async function configureFulfillmentAudit(owner, action, newStatus, trackingCarrier = null) {
  await owner.query(
    `UPDATE public."SystemAuditLog"
        SET metadata = pg_catalog.jsonb_strip_nulls(
          pg_catalog.jsonb_build_object(
            'action', $2::text,
            'newStatus', $3::text,
            'trackingCarrier', $4::text
          )
        )
      WHERE id = $1`,
    [fixture.orderFulfillmentAuditId, action, newStatus, trackingCarrier],
  );
}

async function configureOrderPaymentEvent(owner, stripeEventId, localAction, notificationBody = null) {
  await owner.query(
    `UPDATE public."OrderPaymentEvent"
        SET "stripeEventId" = $2,
            "eventType" = 'REFUND',
            metadata = pg_catalog.jsonb_strip_nulls(
              pg_catalog.jsonb_build_object(
                'localAction', $3::text,
                'notificationBody', $4::text
              )
            ),
            "updatedAt" = pg_catalog.clock_timestamp()
      WHERE id = $1`,
    [fixture.orderPaymentEventId, stripeEventId, localAction, notificationBody],
  );
}

const creationFamilyCases = Object.freeze([
  {
    label: "source_fanout",
    functionName: "grainline_notification_create_source_fanout",
    userId: fixture.actorUserId,
    type: "FOLLOWED_MAKER_NEW_LISTING",
    sourceType: "followed_maker_new_listing",
    sourceId: fixture.listingId,
    relatedUserId: fixture.sellerUserId,
    expectedLink: `/listing/${fixture.listingId}`,
  },
  {
    label: "followed_maker_new_blog",
    functionName: "grainline_notification_create_source_fanout",
    userId: fixture.actorUserId,
    type: "FOLLOWED_MAKER_NEW_BLOG",
    sourceType: "followed_maker_new_blog",
    sourceId: fixture.blogPostId,
    relatedUserId: fixture.sellerUserId,
    expectedLink: "/blog/notification-proof-post",
  },
  {
    label: "blog_comment_top_level",
    functionName: "grainline_notification_create_source_fanout",
    userId: fixture.sellerUserId,
    type: "NEW_BLOG_COMMENT",
    sourceType: "blog_comment",
    sourceId: fixture.blogTopCommentId,
    relatedUserId: fixture.actorUserId,
    expectedLink: `/blog/notification-proof-post#comment-${fixture.blogTopCommentId}`,
  },
  {
    label: "blog_comment_reply",
    functionName: "grainline_notification_create_source_fanout",
    userId: fixture.sellerUserId,
    type: "BLOG_COMMENT_REPLY",
    sourceType: "blog_comment",
    sourceId: fixture.blogReplyCommentId,
    relatedUserId: fixture.actorUserId,
    expectedLink: `/blog/notification-proof-post#comment-${fixture.blogReplyCommentId}`,
  },
  {
    label: "seller_broadcast",
    functionName: "grainline_notification_create_source_fanout",
    userId: fixture.actorUserId,
    type: "SELLER_BROADCAST",
    sourceType: "seller_broadcast",
    sourceId: fixture.sellerBroadcastId,
    relatedUserId: fixture.sellerUserId,
    expectedLink: `/account/feed?broadcast=${fixture.sellerBroadcastId}`,
  },
  {
    label: "social",
    functionName: "grainline_notification_create_social_event",
    userId: fixture.sellerUserId,
    type: "NEW_FOLLOWER",
    sourceType: "follow",
    sourceId: fixture.sellerProfileId,
    relatedUserId: fixture.actorUserId,
    expectedLink: "/dashboard/analytics",
  },
  {
    label: "favorite",
    functionName: "grainline_notification_create_social_event",
    userId: fixture.sellerUserId,
    type: "NEW_FAVORITE",
    sourceType: "favorite",
    sourceId: fixture.listingId,
    relatedUserId: fixture.actorUserId,
    expectedLink: `/listing/${fixture.listingId}`,
  },
  {
    label: "review",
    functionName: "grainline_notification_create_social_event",
    userId: fixture.sellerUserId,
    type: "NEW_REVIEW",
    sourceType: "review",
    sourceId: fixture.reviewId,
    relatedUserId: fixture.actorUserId,
    expectedLink: `/listing/${fixture.listingId}#reviews`,
  },
  {
    label: "message",
    functionName: "grainline_notification_create_message_event",
    userId: fixture.sellerUserId,
    type: "NEW_MESSAGE",
    sourceType: "message",
    sourceId: fixture.messageId,
    relatedUserId: fixture.actorUserId,
    expectedLink: `/messages/${fixture.conversationId}`,
  },
  {
    label: "custom_order_request",
    functionName: "grainline_notification_create_message_event",
    userId: fixture.sellerUserId,
    type: "CUSTOM_ORDER_REQUEST",
    sourceType: "message",
    sourceId: fixture.customRequestMessageId,
    relatedUserId: fixture.actorUserId,
    expectedLink: `/messages/${fixture.conversationId}`,
  },
  {
    label: "custom_order_link",
    functionName: "grainline_notification_create_message_event",
    userId: fixture.actorUserId,
    type: "CUSTOM_ORDER_LINK",
    sourceType: "message",
    sourceId: fixture.customLinkMessageId,
    relatedUserId: fixture.sellerUserId,
    expectedLink: `/listing/${fixture.customListingId}`,
  },
  {
    label: "case",
    functionName: "grainline_notification_create_case_event",
    userId: fixture.sellerUserId,
    type: "CASE_OPENED",
    sourceType: "case",
    sourceId: fixture.caseId,
    relatedUserId: fixture.actorUserId,
    expectedLink: `/dashboard/sales/${fixture.orderId}`,
  },
  {
    label: "case_message",
    functionName: "grainline_notification_create_case_event",
    userId: fixture.sellerUserId,
    type: "CASE_MESSAGE",
    sourceType: "case_message",
    sourceId: fixture.caseMessageId,
    relatedUserId: fixture.actorUserId,
    expectedLink: `/dashboard/sales/${fixture.orderId}`,
  },
  {
    label: "case_resolution_mark",
    functionName: "grainline_notification_create_case_event",
    userId: fixture.sellerUserId,
    type: "CASE_MESSAGE",
    sourceType: "case_resolution_mark",
    sourceId: fixture.caseResolutionAuditId,
    relatedUserId: fixture.actorUserId,
    expectedLink: `/dashboard/sales/${fixture.orderId}`,
  },
  {
    label: "case_system_action",
    functionName: "grainline_notification_create_case_event",
    userId: fixture.actorUserId,
    type: "CASE_MESSAGE",
    sourceType: "case_system_action",
    sourceId: fixture.caseSystemAuditId,
    relatedUserId: null,
    expectedLink: `/dashboard/orders/${fixture.orderId}`,
  },
  {
    label: "commission",
    functionName: "grainline_notification_create_commission_event",
    userId: fixture.actorUserId,
    type: "COMMISSION_INTEREST",
    sourceType: "commission_interest",
    sourceId: fixture.commissionInterestId,
    relatedUserId: fixture.sellerUserId,
    expectedLink: `/messages/${fixture.conversationId}`,
  },
  {
    label: "commission_request_closed",
    functionName: "grainline_notification_create_commission_event",
    userId: fixture.sellerUserId,
    type: "COMMISSION_INTEREST",
    sourceType: "commission_request",
    sourceId: fixture.commissionClosedRequestId,
    relatedUserId: fixture.actorUserId,
    expectedLink: "/commission",
  },
  {
    label: "inventory",
    functionName: "grainline_notification_create_inventory_event",
    userId: fixture.sellerUserId,
    type: "LOW_STOCK",
    sourceType: "manual_low_stock",
    sourceId: fixture.manualLowStockAuditId,
    relatedUserId: null,
    expectedLink: `/dashboard/listings/${fixture.listingId}/edit`,
  },
  {
    label: "checkout_low_stock",
    functionName: "grainline_notification_create_inventory_event",
    userId: fixture.sellerUserId,
    type: "LOW_STOCK",
    sourceType: "checkout_low_stock",
    sourceId: fixture.orderItemId,
    relatedUserId: null,
    expectedLink: "/dashboard/inventory",
  },
  {
    label: "verification",
    functionName: "grainline_notification_create_verification_event",
    userId: fixture.sellerUserId,
    type: "VERIFICATION_APPROVED",
    sourceType: "guild_admin_action",
    sourceId: fixture.guildAdminAuditId,
    relatedUserId: null,
    expectedLink: `/seller/${fixture.sellerProfileId}`,
  },
  {
    label: "guild_system_action",
    functionName: "grainline_notification_create_verification_event",
    userId: fixture.guildSystemUserId,
    type: "VERIFICATION_REJECTED",
    sourceType: "guild_system_action",
    sourceId: fixture.guildSystemAuditId,
    relatedUserId: null,
    expectedLink: "/dashboard/verification",
  },
  {
    label: "listing_admin_review",
    functionName: "grainline_notification_create_moderation_event",
    userId: fixture.sellerUserId,
    type: "LISTING_APPROVED",
    sourceType: "listing_admin_review",
    sourceId: fixture.listingReviewAuditId,
    relatedUserId: null,
    expectedLink: `/listing/${fixture.listingId}`,
  },
  {
    label: "moderation",
    functionName: "grainline_notification_create_moderation_event",
    userId: fixture.sellerUserId,
    type: "LISTING_FLAGGED_BY_USER",
    sourceType: "listing_user_report",
    sourceId: fixture.listingReportId,
    relatedUserId: fixture.actorUserId,
    expectedLink: `/dashboard/listings/${fixture.listingId}/edit`,
  },
  {
    label: "account_warning",
    functionName: "grainline_notification_create_account_warning",
    userId: fixture.actorUserId,
    type: "ACCOUNT_WARNING",
    sourceType: "admin_account_message",
    sourceId: fixture.accountWarningAuditId,
    relatedUserId: null,
    expectedLink: "/account",
  },
  {
    label: "banned_seller_order",
    functionName: "grainline_notification_create_account_warning",
    userId: fixture.actorUserId,
    type: "ACCOUNT_WARNING",
    sourceType: "banned_seller_order",
    sourceId: `${fixture.banAuditId}:${fixture.bannedOrderId}`,
    relatedUserId: fixture.bannedSellerUserId,
    expectedLink: `/dashboard/orders/${fixture.bannedOrderId}`,
  },
  {
    label: "order",
    functionName: "grainline_notification_create_order_event",
    userId: fixture.sellerUserId,
    type: "PAYOUT_FAILED",
    sourceType: "stripe_payout_failure",
    sourceId: fixture.payoutEventId,
    relatedUserId: null,
    expectedLink: "/dashboard/seller",
  },
  {
    label: "order_checkout",
    functionName: "grainline_notification_create_order_event",
    userId: fixture.actorUserId,
    type: "NEW_ORDER",
    sourceType: "order_checkout",
    sourceId: fixture.orderId,
    relatedUserId: fixture.sellerUserId,
    expectedLink: `/dashboard/orders/${fixture.orderId}`,
  },
  {
    label: "order_fulfillment",
    functionName: "grainline_notification_create_order_event",
    userId: fixture.actorUserId,
    type: "ORDER_SHIPPED",
    sourceType: "order_fulfillment",
    sourceId: fixture.orderFulfillmentAuditId,
    relatedUserId: fixture.sellerUserId,
    expectedLink: `/dashboard/orders/${fixture.orderId}`,
  },
  {
    label: "order_payment",
    functionName: "grainline_notification_create_order_event",
    userId: fixture.sellerUserId,
    type: "PAYMENT_DISPUTE",
    sourceType: "order_payment",
    sourceId: "evt_notification_proof_dispute",
    relatedUserId: fixture.actorUserId,
    expectedLink: `/dashboard/sales/${fixture.orderId}`,
  },
  // Meaningful action and recipient-direction variants within the source
  // types above. Mutated durable fixtures are reset before each invocation;
  // the runtime still receives only source ids and relationship dimensions.
  {
    label: "case_resolved_dismissed",
    functionName: "grainline_notification_create_case_event",
    userId: fixture.actorUserId,
    type: "CASE_RESOLVED",
    sourceType: "case",
    sourceId: fixture.caseId,
    relatedUserId: fixture.staffUserId,
    expectedLink: `/dashboard/orders/${fixture.orderId}`,
    expectedTitle: "Case dismissed",
    expectedBodyIncludes: "reviewed and dismissed",
    setup: (owner) => configureResolvedCase(owner, "DISMISSED"),
  },
  {
    label: "case_refund_full",
    functionName: "grainline_notification_create_case_event",
    userId: fixture.actorUserId,
    type: "REFUND_ISSUED",
    sourceType: "case",
    sourceId: fixture.caseId,
    relatedUserId: fixture.staffUserId,
    expectedLink: `/dashboard/orders/${fixture.orderId}`,
    expectedTitle: "Full refund issued",
    expectedBodyIncludes: "full refund",
    setup: (owner) => configureResolvedCase(owner, "REFUND_FULL"),
  },
  {
    label: "case_refund_partial",
    functionName: "grainline_notification_create_case_event",
    userId: fixture.actorUserId,
    type: "REFUND_ISSUED",
    sourceType: "case",
    sourceId: fixture.caseId,
    relatedUserId: fixture.staffUserId,
    expectedLink: `/dashboard/orders/${fixture.orderId}`,
    expectedTitle: "Partial refund issued",
    expectedBodyIncludes: "$43.21",
    resetSourceNotification: true,
    setup: (owner) => configureResolvedCase(owner, "REFUND_PARTIAL", 4321),
  },
  {
    label: "case_message_seller_to_buyer",
    functionName: "grainline_notification_create_case_event",
    userId: fixture.actorUserId,
    type: "CASE_MESSAGE",
    sourceType: "case_message",
    sourceId: fixture.caseMessageId,
    relatedUserId: fixture.sellerUserId,
    expectedLink: `/dashboard/orders/${fixture.orderId}`,
    expectedBodyIncludes: "Proof seller case message",
    setup: (owner) => configureCaseMessageAuthor(owner, fixture.sellerUserId, "Proof seller case message"),
  },
  {
    label: "case_message_staff_to_buyer",
    functionName: "grainline_notification_create_case_event",
    userId: fixture.actorUserId,
    type: "CASE_MESSAGE",
    sourceType: "case_message",
    sourceId: fixture.caseMessageId,
    relatedUserId: fixture.staffUserId,
    expectedLink: `/dashboard/orders/${fixture.orderId}`,
    expectedTitle: "Grainline Staff sent a message in your case",
    setup: (owner) => configureCaseMessageAuthor(owner, fixture.staffUserId, "Proof staff case message"),
  },
  {
    label: "case_message_staff_to_seller",
    functionName: "grainline_notification_create_case_event",
    userId: fixture.sellerUserId,
    type: "CASE_MESSAGE",
    sourceType: "case_message",
    sourceId: fixture.caseMessageId,
    relatedUserId: fixture.staffUserId,
    expectedLink: `/dashboard/sales/${fixture.orderId}`,
    expectedTitle: "Grainline Staff sent a message in your case",
  },
  {
    label: "case_resolution_mark_resolved_seller_to_buyer",
    functionName: "grainline_notification_create_case_event",
    userId: fixture.actorUserId,
    type: "CASE_RESOLVED",
    sourceType: "case_resolution_mark",
    sourceId: fixture.caseResolutionAuditId,
    relatedUserId: fixture.sellerUserId,
    expectedLink: `/dashboard/orders/${fixture.orderId}`,
    expectedTitle: "Case resolved",
    setup: (owner) => configureCaseResolutionAudit(owner, fixture.sellerUserId, "RESOLVED"),
  },
  {
    label: "case_system_open_seller",
    functionName: "grainline_notification_create_case_event",
    userId: fixture.sellerUserId,
    type: "CASE_MESSAGE",
    sourceType: "case_system_action",
    sourceId: fixture.caseSystemAuditId,
    relatedUserId: null,
    expectedLink: `/dashboard/sales/${fixture.orderId}`,
    expectedTitle: "Case escalated",
    setup: (owner) => configureCaseSystemAudit(owner, "AUTO_ESCALATE_CASE", "OPEN", "UNDER_REVIEW"),
  },
  {
    label: "case_system_discussion_buyer",
    functionName: "grainline_notification_create_case_event",
    userId: fixture.actorUserId,
    type: "CASE_MESSAGE",
    sourceType: "case_system_action",
    sourceId: fixture.caseSystemAuditId,
    relatedUserId: null,
    expectedLink: `/dashboard/orders/${fixture.orderId}`,
    expectedTitle: "Case under review",
    expectedBodyIncludes: "inactive",
    resetSourceNotification: true,
    setup: (owner) => configureCaseSystemAudit(owner, "AUTO_ESCALATE_CASE", "IN_DISCUSSION", "UNDER_REVIEW"),
  },
  {
    label: "case_system_discussion_seller",
    functionName: "grainline_notification_create_case_event",
    userId: fixture.sellerUserId,
    type: "CASE_MESSAGE",
    sourceType: "case_system_action",
    sourceId: fixture.caseSystemAuditId,
    relatedUserId: null,
    expectedLink: `/dashboard/sales/${fixture.orderId}`,
    expectedTitle: "Case escalated",
    expectedBodyIncludes: "discussion stalled",
    resetSourceNotification: true,
    setup: (owner) => configureCaseSystemAudit(owner, "AUTO_ESCALATE_CASE", "IN_DISCUSSION", "UNDER_REVIEW"),
  },
  {
    label: "case_system_close_buyer",
    functionName: "grainline_notification_create_case_event",
    userId: fixture.actorUserId,
    type: "CASE_RESOLVED",
    sourceType: "case_system_action",
    sourceId: fixture.caseSystemAuditId,
    relatedUserId: null,
    expectedLink: `/dashboard/orders/${fixture.orderId}`,
    expectedTitle: "Case closed",
    setup: (owner) => configureCaseSystemAudit(owner, "AUTO_CLOSE_CASE", "PENDING_CLOSE", "RESOLVED"),
  },
  {
    label: "case_system_close_seller",
    functionName: "grainline_notification_create_case_event",
    userId: fixture.sellerUserId,
    type: "CASE_RESOLVED",
    sourceType: "case_system_action",
    sourceId: fixture.caseSystemAuditId,
    relatedUserId: null,
    expectedLink: `/dashboard/sales/${fixture.orderId}`,
    expectedTitle: "Case closed",
  },
  {
    label: "commission_request_fulfilled_seller",
    functionName: "grainline_notification_create_commission_event",
    userId: fixture.sellerUserId,
    type: "COMMISSION_INTEREST",
    sourceType: "commission_request",
    sourceId: fixture.commissionClosedRequestId,
    relatedUserId: fixture.actorUserId,
    expectedLink: `/commission/${fixture.commissionClosedRequestId}`,
    expectedTitle: "Commission request fulfilled",
    resetSourceNotification: true,
    setup: (owner) => configureCommissionRequestStatus(owner, "FULFILLED"),
  },
  {
    label: "commission_request_expired_seller",
    functionName: "grainline_notification_create_commission_event",
    userId: fixture.sellerUserId,
    type: "COMMISSION_INTEREST",
    sourceType: "commission_request",
    sourceId: fixture.commissionClosedRequestId,
    relatedUserId: fixture.actorUserId,
    expectedLink: `/commission/${fixture.commissionClosedRequestId}`,
    expectedTitle: "Commission request expired",
    resetSourceNotification: true,
    setup: (owner) => configureCommissionRequestStatus(owner, "EXPIRED"),
  },
  {
    label: "commission_request_expired_buyer",
    functionName: "grainline_notification_create_commission_event",
    userId: fixture.actorUserId,
    type: "COMMISSION_INTEREST",
    sourceType: "commission_request",
    sourceId: fixture.commissionClosedRequestId,
    relatedUserId: null,
    expectedLink: `/commission/${fixture.commissionClosedRequestId}`,
    expectedTitle: "Commission request expired",
  },
  {
    label: "order_checkout_seller",
    functionName: "grainline_notification_create_order_event",
    userId: fixture.sellerUserId,
    type: "NEW_ORDER",
    sourceType: "order_checkout",
    sourceId: fixture.orderId,
    relatedUserId: fixture.actorUserId,
    expectedLink: `/dashboard/sales/${fixture.orderId}`,
    expectedTitle: "New sale! Congrats!",
  },
  {
    label: "order_fulfillment_picked_up",
    functionName: "grainline_notification_create_order_event",
    userId: fixture.actorUserId,
    type: "ORDER_DELIVERED",
    sourceType: "order_fulfillment",
    sourceId: fixture.orderFulfillmentAuditId,
    relatedUserId: fixture.sellerUserId,
    expectedLink: `/dashboard/orders/${fixture.orderId}`,
    expectedTitle: "Order picked up!",
    setup: (owner) => configureFulfillmentAudit(owner, "picked_up", "PICKED_UP"),
  },
  {
    label: "order_fulfillment_ready_for_pickup",
    functionName: "grainline_notification_create_order_event",
    userId: fixture.actorUserId,
    type: "ORDER_SHIPPED",
    sourceType: "order_fulfillment",
    sourceId: fixture.orderFulfillmentAuditId,
    relatedUserId: fixture.sellerUserId,
    expectedLink: `/dashboard/orders/${fixture.orderId}`,
    expectedTitle: "Ready for pickup!",
    resetSourceNotification: true,
    setup: (owner) => configureFulfillmentAudit(owner, "ready_for_pickup", "READY_FOR_PICKUP"),
  },
  {
    label: "order_payment_seller_refund",
    functionName: "grainline_notification_create_order_event",
    userId: fixture.actorUserId,
    type: "REFUND_ISSUED",
    sourceType: "order_payment",
    sourceId: "evt_notification_proof_seller_refund",
    relatedUserId: fixture.sellerUserId,
    expectedLink: `/dashboard/orders/${fixture.orderId}`,
    expectedTitle: "Refund from maker",
    expectedBodyIncludes: "Proof seller refund body",
    setup: (owner) => configureOrderPaymentEvent(
      owner,
      "evt_notification_proof_seller_refund",
      "SELLER_REFUND_RECORDED",
      "Proof seller refund body",
    ),
  },
  {
    label: "order_payment_blocked_checkout_refund",
    functionName: "grainline_notification_create_order_event",
    userId: fixture.actorUserId,
    type: "NEW_ORDER",
    sourceType: "order_payment",
    sourceId: "evt_notification_proof_blocked_refund",
    relatedUserId: null,
    expectedLink: `/dashboard/orders/${fixture.orderId}`,
    expectedTitle: "Payment refunded",
    expectedBodyIncludes: "no longer eligible",
    setup: (owner) => configureOrderPaymentEvent(
      owner,
      "evt_notification_proof_blocked_refund",
      "BLOCKED_CHECKOUT_REFUND_RECORDED",
    ),
  },
]);

async function invokeCreationFamily(client, family, userId, notificationId = crypto.randomUUID()) {
  assert.match(family.functionName, /^grainline_notification_create_[a-z_]+$/);
  return client.query(
    `SELECT public.${family.functionName}(
       $1, $2, $3::public."NotificationType", $4, $5, $6
     ) AS notification_id`,
    [
      notificationId,
      userId,
      family.type,
      family.sourceType,
      family.sourceId,
      family.relatedUserId,
    ],
  );
}

async function proveCreationFamilyMatrix(owner) {
  const runtime = newClient("notification-proof-family-matrix");
  await runtime.connect();
  try {
    await setRuntimeRole(runtime);
    for (const family of creationFamilyCases) {
      if (family.setup) {
        await family.setup(owner);
      }
      if (family.resetSourceNotification) {
        await owner.query(
          `DELETE FROM public."Notification"
            WHERE "userId" = $1
              AND type = $2::public."NotificationType"
              AND "sourceType" = $3
              AND "sourceId" = $4`,
          [family.userId, family.type, family.sourceType, family.sourceId],
        );
      }
      const first = await invokeCreationFamily(runtime, family, family.userId);
      const firstId = first.rows[0].notification_id;
      assert.ok(firstId, `${family.label} valid source did not create a notification`);

      const replay = await invokeCreationFamily(runtime, family, family.userId);
      assert.equal(
        replay.rows[0].notification_id,
        firstId,
        `${family.label} replay did not resolve the stable source-derived row`,
      );

      const stored = await owner.query(
        `SELECT id, "userId", type::text, title, body, link, "sourceType", "sourceId",
                "dedupKey", "relatedUserId"
           FROM public."Notification"
          WHERE id = $1`,
        [firstId],
      );
      assert.equal(stored.rows.length, 1, `${family.label} stored row cardinality drifted`);
      assert.deepEqual(
        {
          userId: stored.rows[0].userId,
          type: stored.rows[0].type,
          link: stored.rows[0].link,
          sourceType: stored.rows[0].sourceType,
          sourceId: stored.rows[0].sourceId,
          relatedUserId: stored.rows[0].relatedUserId,
        },
        {
          userId: family.userId,
          type: family.type,
          link: family.expectedLink,
          sourceType: family.sourceType,
          sourceId: family.sourceId,
          relatedUserId: family.relatedUserId,
        },
        `${family.label} stored authority fields drifted`,
      );
      assert.ok(stored.rows[0].title, `${family.label} title was not database-derived`);
      assert.notEqual(stored.rows[0].body, null, `${family.label} body was not database-derived`);
      assert.equal(stored.rows[0].dedupKey.length, 64, `${family.label} replay key drifted`);
      if (family.expectedTitle) {
        assert.equal(stored.rows[0].title, family.expectedTitle, `${family.label} title branch drifted`);
      }
      if (family.expectedBodyIncludes) {
        assert.ok(
          stored.rows[0].body.includes(family.expectedBodyIncludes),
          `${family.label} body branch drifted`,
        );
      }

      const forged = await invokeCreationFamily(runtime, family, fixture.foreignUserId);
      assert.equal(
        forged.rows[0].notification_id,
        null,
        `${family.label} accepted a caller-forged recipient`,
      );
      record(`service_family_${family.label}_valid_replay_and_forged_recipient_rejected`);
    }
  } finally {
    await runtime.end();
  }
}

async function invokeBackInStockClaim(client, restockAuditId, notificationId = crypto.randomUUID()) {
  return client.query(
    `SELECT claimed, user_id, notification_id
       FROM public.grainline_notification_claim_back_in_stock($1, $2, $3)`,
    [notificationId, restockAuditId, fixture.stockNotificationId],
  );
}

async function proveBackInStockClaim(owner) {
  const runtime = newClient("notification-proof-back-in-stock");
  await runtime.connect();
  try {
    await setRuntimeRole(runtime);

    const mismatched = await invokeBackInStockClaim(runtime, fixture.manualLowStockAuditId);
    assert.deepEqual(mismatched.rows, [{ claimed: false, user_id: null, notification_id: null }]);
    const retained = await owner.query(
      'SELECT pg_catalog.count(*)::integer AS count FROM public."StockNotification" WHERE id = $1',
      [fixture.stockNotificationId],
    );
    assert.equal(retained.rows[0].count, 1, "mismatched restock evidence consumed the subscription");

    const first = await invokeBackInStockClaim(runtime, fixture.restockAuditId);
    assert.equal(first.rows.length, 1);
    assert.equal(first.rows[0].claimed, true);
    assert.equal(first.rows[0].user_id, fixture.actorUserId);
    assert.ok(first.rows[0].notification_id);

    const stored = await owner.query(
      `SELECT "userId", "relatedUserId", type::text, link, "sourceType", "sourceId", "dedupKey"
         FROM public."Notification"
        WHERE id = $1`,
      [first.rows[0].notification_id],
    );
    assert.deepEqual(
      {
        userId: stored.rows[0].userId,
        relatedUserId: stored.rows[0].relatedUserId,
        type: stored.rows[0].type,
        link: stored.rows[0].link,
        sourceType: stored.rows[0].sourceType,
        sourceId: stored.rows[0].sourceId,
        dedupKeyLength: stored.rows[0].dedupKey.length,
      },
      {
        userId: fixture.actorUserId,
        relatedUserId: fixture.sellerUserId,
        type: "BACK_IN_STOCK",
        link: `/listing/${fixture.listingId}`,
        sourceType: "manual_restock",
        sourceId: fixture.restockAuditId,
        dedupKeyLength: 64,
      },
    );

    const replay = await invokeBackInStockClaim(runtime, fixture.restockAuditId);
    assert.deepEqual(replay.rows, [{ claimed: false, user_id: null, notification_id: null }]);
    const consumed = await owner.query(
      'SELECT pg_catalog.count(*)::integer AS count FROM public."StockNotification" WHERE id = $1',
      [fixture.stockNotificationId],
    );
    assert.equal(consumed.rows[0].count, 0);
    record("service_back_in_stock_claim_derives_identity_consumes_once_and_rejects_bad_evidence");
  } finally {
    await runtime.end();
  }
}

async function waitForLock(owner, applicationName) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const waiting = await owner.query(
      `SELECT wait_event_type
         FROM pg_catalog.pg_stat_activity
        WHERE datname = pg_catalog.current_database()
          AND application_name = $1
          AND state = 'active'`,
      [applicationName],
    );
    if (waiting.rows.some((row) => row.wait_event_type === "Lock")) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`${applicationName} did not enter a PostgreSQL lock wait`);
}

async function clearFollowRaceState(owner) {
  await owner.query(
    `DELETE FROM public."Block"
      WHERE ("blockerId" = $1 AND "blockedId" = $2)
         OR ("blockerId" = $2 AND "blockedId" = $1)`,
    [fixture.sellerUserId, fixture.actorUserId],
  );
  await owner.query(
    `DELETE FROM public."Notification"
      WHERE "sourceType" = 'follow' AND "sourceId" = $1`,
    [fixture.sellerProfileId],
  );
}

async function lockUserPairForBlock(client) {
  return client.query(
    `SELECT id FROM public."User"
      WHERE id = ANY($1::text[])
      ORDER BY id
      FOR UPDATE`,
    [[fixture.sellerUserId, fixture.actorUserId]],
  );
}

async function insertBlock(client) {
  return client.query(
    `INSERT INTO public."Block" (id, "blockerId", "blockedId")
     VALUES ($1, $2, $3)`,
    [crypto.randomUUID(), fixture.sellerUserId, fixture.actorUserId],
  );
}

async function proveBlockRaces(owner) {
  await clearFollowRaceState(owner);
  const createFirst = newClient("notification-proof-create-first");
  const blockSecond = newClient("notification-proof-block-second");
  await Promise.all([createFirst.connect(), blockSecond.connect()]);
  try {
    await Promise.all([setRuntimeRole(createFirst), setRuntimeRole(blockSecond)]);
    await createFirst.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    const created = await invokeFollowNotification(createFirst, crypto.randomUUID());
    assert.ok(created.rows[0].notification_id);

    await blockSecond.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    const blockLock = lockUserPairForBlock(blockSecond);
    await waitForLock(owner, "notification-proof-block-second");
    await createFirst.query("COMMIT");
    await blockLock;
    await insertBlock(blockSecond);
    await blockSecond.query("COMMIT");

    const firstOrdering = await owner.query(
      `SELECT
         (SELECT pg_catalog.count(*)::integer FROM public."Notification" WHERE "sourceType" = 'follow' AND "sourceId" = $1) AS notifications,
         (SELECT pg_catalog.count(*)::integer FROM public."Block" WHERE "blockerId" = $2 AND "blockedId" = $3) AS blocks`,
      [fixture.sellerProfileId, fixture.sellerUserId, fixture.actorUserId],
    );
    assert.deepEqual(firstOrdering.rows[0], { notifications: 1, blocks: 1 });
  } finally {
    await Promise.allSettled([createFirst.query("ROLLBACK"), blockSecond.query("ROLLBACK")]);
    await Promise.all([createFirst.end(), blockSecond.end()]);
  }

  await clearFollowRaceState(owner);
  const blockFirst = newClient("notification-proof-block-first");
  const createSecond = newClient("notification-proof-create-second");
  await Promise.all([blockFirst.connect(), createSecond.connect()]);
  try {
    await Promise.all([setRuntimeRole(blockFirst), setRuntimeRole(createSecond)]);
    await blockFirst.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await lockUserPairForBlock(blockFirst);
    await insertBlock(blockFirst);

    await createSecond.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    const createAttempt = invokeFollowNotification(createSecond, crypto.randomUUID());
    await waitForLock(owner, "notification-proof-create-second");
    await blockFirst.query("COMMIT");
    const blocked = await createAttempt;
    assert.equal(blocked.rows[0].notification_id, null);
    await createSecond.query("COMMIT");

    const secondOrdering = await owner.query(
      `SELECT pg_catalog.count(*)::integer AS notifications
         FROM public."Notification"
        WHERE "sourceType" = 'follow' AND "sourceId" = $1`,
      [fixture.sellerProfileId],
    );
    assert.equal(secondOrdering.rows[0].notifications, 0);
  } finally {
    await Promise.allSettled([blockFirst.query("ROLLBACK"), createSecond.query("ROLLBACK")]);
    await Promise.all([blockFirst.end(), createSecond.end()]);
  }
  record("block_race_create_then_block_linearizes_before_block");
  record("block_race_block_then_create_waits_and_suppresses_notification");
}

async function main() {
  validateTarget(databaseUrl);
  const owner = newClient("notification-proof-owner");
  await owner.connect();
  try {
    await proveCatalog(owner);
    await seedFixtures(owner);
    await proveRecipientIsolation(owner);
    await proveServiceAuthority(owner);
    await proveCreationFamilyMatrix(owner);
    await proveBackInStockClaim(owner);
    await proveBlockRaces(owner);
    await cleanFixtures(owner);
  } finally {
    await owner.end();
  }

  process.stdout.write(`${JSON.stringify({
    generatedAt: new Date().toISOString(),
    proofMode: "ephemeral-loopback-ci-set-role",
    productionChanged: false,
    persistentStagingChanged: false,
    status: "passed",
    checkCount: completedChecks.length,
    checks: completedChecks,
    residualBoundary: "recipient RPC p_user_id must come from server-resolved identity; this proof does not claim resistance to a compromised runtime role",
  }, null, 2)}\n`);
}

main().catch((error) => {
  const safe = {
    name: error?.name ?? "Error",
    code: error?.code ?? null,
    message: error?.message ?? "notification RLS ephemeral proof failed",
    detail: error?.detail ?? null,
  };
  process.stderr.write(`${JSON.stringify(safe)}\n`);
  process.exitCode = 1;
});
