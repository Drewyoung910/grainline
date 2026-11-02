#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RELEASE_ID_PATTERN = /^[a-z][a-z0-9_]{2,63}$/u;
const PREPARATION_MIGRATION_PATH_ENV_BY_RELEASE = Object.freeze({
  seller_analytics_daily_v1: "SELLER_ANALYTICS_DAILY_PREPARATION_MIGRATION_PATH",
});

export const PRIVATE_TABLE_PREPARATION_CONFIRMATION =
  "apply-reviewed-private-table-preparation";

export const PRIVATE_TABLE_PREPARATIONS = Object.freeze({
  support_request_v1: Object.freeze({
    migration: "20261023010000_prepare_support_request_authorities",
    migrationSha256: "c65e259df2bd476e2d265c8973fabbcf018b5f989b4b01a2ca923bb1013dc384",
    table: "SupportRequest",
    expectedPredecessorPosture: Object.freeze({
      rlsEnabled: false,
      rlsForced: false,
      policyCount: 0,
      runtimeSelect: true,
      runtimeInsert: true,
      runtimeUpdate: true,
      runtimeDelete: true,
      staffSelect: false,
      publicSelect: false,
    }),
    addedColumns: Object.freeze([
      Object.freeze({ name: "emailDeliveryToken", type: "uuid", nullable: true }),
    ]),
    sourceTests: Object.freeze([
      "tests/support-request-state.test.mjs",
      "tests/support-request.test.mjs",
    ]),
    functions: Object.freeze([
      Object.freeze({
        name: "grainline_support_request_submit",
        arguments: "text, text, text, text, text, text, text",
      }),
      Object.freeze({
        name: "grainline_support_request_delivery_record",
        arguments: "text, uuid, boolean, text",
      }),
      Object.freeze({ name: "grainline_support_request_owner_export", arguments: "" }),
      Object.freeze({
        name: "grainline_support_request_staff_state",
        arguments: "integer, integer, integer",
      }),
      Object.freeze({
        name: "grainline_support_request_staff_transition",
        arguments: "text, text, text",
      }),
      Object.freeze({
        name: "grainline_support_request_account_deletion_redact_batch",
        arguments: "text[], text[]",
      }),
      Object.freeze({
        name: "grainline_support_request_provider_deletion_upsert",
        arguments: "text",
      }),
      Object.freeze({ name: "grainline_support_request_overdue_count", arguments: "" }),
      Object.freeze({
        name: "grainline_support_request_retention_delete_batch",
        arguments: "integer",
      }),
    ]),
  }),
  stock_notification_v1: Object.freeze({
    migration: "20261026010000_prepare_stock_notification_authorities",
    migrationSha256: "3c77aed31571f7e4adb942bea15611ee97d75e8183f76899cc634749ab2955ce",
    table: "StockNotification",
    expectedPredecessorPosture: Object.freeze({
      rlsEnabled: false,
      rlsForced: false,
      policyCount: 0,
      runtimeSelect: true,
      runtimeInsert: true,
      runtimeUpdate: true,
      runtimeDelete: true,
      staffSelect: false,
      publicSelect: false,
    }),
    addedColumns: Object.freeze([]),
    sourceTests: Object.freeze([
      "tests/stock-notification-route.test.mjs",
      "tests/stock-notification-state.test.mjs",
    ]),
    functions: Object.freeze([
      Object.freeze({
        name: "grainline_stock_notification_owner_subscribe",
        arguments: "text, text",
      }),
      Object.freeze({
        name: "grainline_stock_notification_seller_counts",
        arguments: "text[]",
      }),
      Object.freeze({
        name: "grainline_stock_notification_seller_range_count",
        arguments: "timestamp without time zone, timestamp without time zone, boolean",
      }),
      Object.freeze({
        name: "grainline_stock_notification_restock_candidates",
        arguments: "text, integer",
      }),
      Object.freeze({
        name: "grainline_stock_notification_seller_listing_cleanup",
        arguments: "text",
      }),
      Object.freeze({
        name: "grainline_stock_notification_admin_listing_cleanup",
        arguments: "text",
      }),
      Object.freeze({
        name: "grainline_stock_notification_block_cleanup",
        arguments: "text",
      }),
      Object.freeze({
        name: "grainline_stock_notification_owner_export",
        arguments: "",
      }),
      Object.freeze({
        name: "grainline_notification_claim_back_in_stock",
        arguments: "text, text, text",
        predecessorSourceSha256:
          "0447a37282d0d86c3b5caba3d8817d33eacec877ca745ab045bf1be18ca83a8f",
      }),
    ]),
  }),
  favorite_v1: Object.freeze({
    migration: "20261028010000_prepare_favorite_authorities",
    migrationSha256: "b3b55a349b2bcdfb0059c5a661926714f7314e92b2d39ea5de94f3c07d385a27",
    table: "Favorite",
    expectedPredecessorPosture: Object.freeze({
      rlsEnabled: false,
      rlsForced: false,
      policyCount: 0,
      runtimeSelect: true,
      runtimeInsert: true,
      runtimeUpdate: true,
      runtimeDelete: true,
      staffSelect: false,
      publicSelect: false,
    }),
    // Listing.favoriteCount is sealed and verified by the migration itself;
    // this table-scoped catalog intentionally records only Favorite additions.
    addedColumns: Object.freeze([]),
    sourceTests: Object.freeze([
      "tests/seller-profile-favorite-target-route.test.mjs",
      "tests/public-visibility-followups.test.mjs",
    ]),
    functions: Object.freeze([
      Object.freeze({
        name: "grainline_favorite_owner_listing_ids",
        arguments: "text[]",
      }),
      Object.freeze({
        name: "grainline_favorite_owner_add",
        arguments: "text",
      }),
      Object.freeze({
        name: "grainline_favorite_owner_remove",
        arguments: "text",
      }),
      Object.freeze({
        name: "grainline_favorite_owner_delete_all",
        arguments: "text",
      }),
      Object.freeze({
        name: "grainline_favorite_owner_export",
        arguments: "",
      }),
      Object.freeze({
        name: "grainline_favorite_seller_range_count",
        arguments: "timestamp without time zone, timestamp without time zone, boolean",
      }),
      Object.freeze({
        name: "grainline_favorite_seller_listing_cleanup",
        arguments: "text",
      }),
      Object.freeze({
        name: "grainline_favorite_admin_listing_cleanup",
        arguments: "text",
      }),
    ]),
  }),
  follow_v1: Object.freeze({
    migration: "20261028020000_prepare_follow_authorities",
    migrationSha256: "3404910d8445d521df668b670c5fa2c57929c1df79bc4046383136454fc0fcc2",
    table: "Follow",
    expectedPredecessorPosture: Object.freeze({
      rlsEnabled: false,
      rlsForced: false,
      policyCount: 0,
      runtimeSelect: true,
      runtimeInsert: true,
      runtimeUpdate: true,
      runtimeDelete: true,
      staffSelect: false,
      publicSelect: false,
    }),
    addedColumns: Object.freeze([]),
    sourceTests: Object.freeze([
      "tests/seller-profile-follow-authority-conversion.test.mjs",
      "tests/user-follower-authorities-source.test.mjs",
    ]),
    functions: Object.freeze([
      Object.freeze({
        name: "grainline_follow_public_state_batch",
        arguments: "text[]",
      }),
      Object.freeze({
        name: "grainline_follow_source_notification_page",
        arguments: "text, text, text, integer",
      }),
      Object.freeze({
        name: "grainline_follow_owner_target_ids",
        arguments: "integer",
      }),
      Object.freeze({
        name: "grainline_follow_owner_outgoing_count",
        arguments: "",
      }),
      Object.freeze({
        name: "grainline_follow_seller_owner_incoming_count",
        arguments: "",
      }),
      Object.freeze({
        name: "grainline_follow_account_deletion_cleanup",
        arguments: "text, text, bigint, uuid",
      }),
    ]),
  }),
  maker_verification_v1: Object.freeze({
    migration: "20261028040000_prepare_maker_verification_authorities",
    migrationSha256: "7ea3956395dfb57b51110d93332c71f5251aaf49cc5292c6282f6c013a892fab",
    table: "MakerVerification",
    expectedPredecessorPosture: Object.freeze({
      rlsEnabled: false,
      rlsForced: false,
      policyCount: 0,
      runtimeSelect: true,
      runtimeInsert: true,
      runtimeUpdate: true,
      runtimeDelete: true,
      staffSelect: false,
      publicSelect: false,
    }),
    addedColumns: Object.freeze([]),
    sourceTests: Object.freeze([
      "tests/maker-verification-preparation.test.mjs",
    ]),
    functions: Object.freeze([
      Object.freeze({
        name: "grainline_seller_guild_staff_transition",
        arguments: "text, text, text, text, text, boolean",
        executeRole: "staff",
        predecessorSourceSha256:
          "36592c7c9112c6e3dd6262aa41edf9fd19bb17bbf1d942a449fec8d306e80fd7",
      }),
      Object.freeze({
        name: "grainline_seller_guild_member_revoke",
        arguments: "text",
        executeRole: "runtime",
        predecessorSourceSha256:
          "5ed7441b6255800532810a6afaa7c16a1ec3f0483e4c1e7543d4a57751e0ea2a",
      }),
      Object.freeze({
        name: "grainline_seller_guild_metrics_apply",
        arguments: "text, timestamp without time zone",
        executeRole: "runtime",
        predecessorSourceSha256:
          "7299fca002e46e5451534095ac981621d0e56a1d5cdf97d2949072a1fb97d7ef",
      }),
      Object.freeze({
        name: "grainline_maker_verification_owner_member_apply",
        arguments: "text, integer, text, boolean",
        executeRole: "runtime",
      }),
      Object.freeze({
        name: "grainline_maker_verification_owner_master_apply",
        arguments: "text, text, boolean",
        executeRole: "runtime",
      }),
      Object.freeze({
        name: "grainline_maker_verification_owner_export",
        arguments: "",
        executeRole: "runtime",
      }),
      Object.freeze({
        name: "grainline_maker_verification_owner_delete_redact",
        arguments: "timestamp without time zone",
        executeRole: "runtime",
      }),
      Object.freeze({
        name: "grainline_maker_verification_staff_pending_count",
        arguments: "text",
        executeRole: "staff",
      }),
      Object.freeze({
        name: "grainline_maker_verification_staff_pending_page",
        arguments: "text, timestamp without time zone, text, integer",
        executeRole: "staff",
      }),
      Object.freeze({
        name: "grainline_seller_guild_staff_master_pending_count",
        arguments: "text",
        executeRole: "staff",
      }),
      Object.freeze({
        name: "grainline_seller_guild_staff_master_pending_page",
        arguments: "text, timestamp without time zone, text, integer",
        executeRole: "staff",
      }),
      Object.freeze({
        name: "grainline_seller_guild_staff_roster_count",
        arguments: "text, text",
        executeRole: "staff",
      }),
      Object.freeze({
        name: "grainline_seller_guild_staff_roster_page",
        arguments: "text, text, timestamp without time zone, text, integer",
        executeRole: "staff",
      }),
    ]),
  }),
  review_vote_v1: Object.freeze({
    migration: "20261028030000_prepare_review_vote_authorities",
    migrationSha256: "cf81df5bacf0f2ca8a87eaf043f4e0b5baf70ae39815b346b3402e17adf6557a",
    table: "ReviewVote",
    expectedPredecessorPosture: Object.freeze({
      rlsEnabled: false,
      rlsForced: false,
      policyCount: 0,
      runtimeSelect: true,
      runtimeInsert: true,
      runtimeUpdate: true,
      runtimeDelete: true,
      staffSelect: false,
      publicSelect: false,
    }),
    addedColumns: Object.freeze([]),
    sourceTests: Object.freeze([
      "tests/review-vote-access.test.mjs",
      "tests/review-vote-route.test.mjs",
      "tests/review-vote-visibility.test.mjs",
    ]),
    functions: Object.freeze([
      Object.freeze({
        name: "grainline_review_vote_owner_toggle",
        arguments: "text",
      }),
      Object.freeze({
        name: "grainline_review_vote_owner_export",
        arguments: "",
      }),
      Object.freeze({
        name: "grainline_review_vote_owner_delete_all",
        arguments: "",
      }),
    ]),
  }),
  commission_domain_v1: Object.freeze({
    migration: "20261101060000_prepare_commission_domain_authorities",
    migrationSha256:
      "5603b77cf28303e5f2b77b2f00b8128c587a3c4b05b705dde0c8a0b3d318aeec",
    table: "CommissionRequest",
    additionalTables: Object.freeze(["CommissionInterest"]),
    expectedPredecessorPosture: Object.freeze({
      rlsEnabled: false,
      rlsForced: false,
      policyCount: 0,
      runtimeSelect: true,
      runtimeInsert: true,
      runtimeUpdate: true,
      runtimeDelete: true,
      staffSelect: false,
      publicSelect: false,
    }),
    addedColumns: Object.freeze([]),
    sourceTests: Object.freeze([
      "tests/commission-interest-count.test.mjs",
      "tests/commission-observability-followups.test.mjs",
      "tests/user-public-review-commission-state-source.test.mjs",
    ]),
    functions: Object.freeze([
      Object.freeze({
        name: "grainline_commission_request_public_count",
        arguments: "text, text, text, double precision, double precision, integer",
      }),
      Object.freeze({
        name: "grainline_commission_request_public_page",
        arguments:
          "text, text, text, double precision, double precision, integer, integer, integer",
      }),
      Object.freeze({
        name: "grainline_commission_request_public_detail",
        arguments: "text",
      }),
      Object.freeze({
        name: "grainline_commission_request_public_sitemap_page",
        arguments: "integer, integer",
      }),
      Object.freeze({
        name: "grainline_commission_request_public_metro_ids",
        arguments: "",
      }),
      Object.freeze({
        name: "grainline_commission_request_actor_report_target",
        arguments: "text, text",
      }),
      Object.freeze({
        name: "grainline_commission_interest_actor_request_ids",
        arguments: "text[]",
      }),
      Object.freeze({
        name: "grainline_commission_interest_actor_create",
        arguments: "text, text, text, text",
      }),
      Object.freeze({
        name: "grainline_commission_request_owner_create",
        arguments:
          "text, text, text, text, integer, integer, text, text[], boolean, double precision, double precision, integer",
      }),
      Object.freeze({
        name: "grainline_commission_request_owner_assign_metros",
        arguments: "text, text, text",
      }),
      Object.freeze({
        name: "grainline_commission_request_owner_page",
        arguments: "integer",
      }),
      Object.freeze({
        name: "grainline_commission_request_owner_export",
        arguments: "",
      }),
      Object.freeze({
        name: "grainline_commission_request_owner_active_count",
        arguments: "",
      }),
      Object.freeze({
        name: "grainline_commission_request_owner_reference_image_urls",
        arguments: "",
      }),
      Object.freeze({
        name: "grainline_commission_interest_owner_export",
        arguments: "",
      }),
      Object.freeze({
        name: "grainline_commission_request_owner_transition",
        arguments: "text, text",
      }),
      Object.freeze({
        name: "grainline_commission_account_deletion_prepare",
        arguments: "",
      }),
      Object.freeze({
        name: "grainline_commission_account_deletion_redact",
        arguments: "",
      }),
      Object.freeze({
        name: "grainline_commission_request_staff_ban_close",
        arguments: "text, text",
      }),
      Object.freeze({
        name: "grainline_commission_request_staff_ban_restore",
        arguments: "text, text, text[], text[]",
      }),
      Object.freeze({
        name: "grainline_commission_request_service_expire_batch",
        arguments: "integer",
      }),
      Object.freeze({
        name: "grainline_commission_request_service_expired_count",
        arguments: "",
      }),
      Object.freeze({
        name: "grainline_seller_owner_commission_interest_summaries",
        arguments: "text[], integer",
        predecessorSourceSha256:
          "80cb199f7162cf26d7ca76217db9a007d218bde3b8a8c1389806c3800c4330c1",
      }),
    ]),
  }),
  seller_broadcast_v1: Object.freeze({
    migration: "20261101010000_prepare_seller_broadcast_authorities",
    migrationSha256: "2fd1b027f87e640b254d6be065a376777c5bf4eecb32fda6962d24126dbf7617",
    table: "SellerBroadcast",
    expectedPredecessorPosture: Object.freeze({
      rlsEnabled: false,
      rlsForced: false,
      policyCount: 0,
      runtimeSelect: true,
      runtimeInsert: true,
      runtimeUpdate: true,
      runtimeDelete: true,
      staffSelect: false,
      publicSelect: false,
    }),
    addedColumns: Object.freeze([]),
    sourceTests: Object.freeze([
      "tests/seller-broadcast-consumer-contracts.test.mjs",
    ]),
    functions: Object.freeze([
      Object.freeze({ name: "grainline_seller_broadcast_owner_cooldown", arguments: "" }),
      Object.freeze({
        name: "grainline_seller_broadcast_owner_create",
        arguments: "text, text, text, integer",
      }),
      Object.freeze({ name: "grainline_seller_broadcast_owner_count", arguments: "" }),
      Object.freeze({
        name: "grainline_seller_broadcast_owner_page",
        arguments: "integer, integer",
      }),
      Object.freeze({ name: "grainline_seller_broadcast_owner_export", arguments: "" }),
      Object.freeze({
        name: "grainline_seller_broadcast_public_latest",
        arguments: "text",
      }),
      Object.freeze({
        name: "grainline_seller_broadcast_actor_feed_page",
        arguments: "text[], timestamp without time zone, timestamp without time zone, text, text, integer",
      }),
      Object.freeze({
        name: "grainline_seller_broadcast_owner_delivery_source",
        arguments: "text",
      }),
      Object.freeze({
        name: "grainline_seller_broadcast_owner_record_delivery",
        arguments: "text, integer",
      }),
      Object.freeze({
        name: "grainline_seller_broadcast_staff_count",
        arguments: "text, text",
        executeRole: "staff",
      }),
      Object.freeze({
        name: "grainline_seller_broadcast_staff_page",
        arguments: "text, text, integer, integer",
        executeRole: "staff",
      }),
      Object.freeze({
        name: "grainline_seller_broadcast_staff_delete",
        arguments: "text, text",
        executeRole: "staff",
      }),
      Object.freeze({
        name: "grainline_seller_broadcast_account_deletion_ids",
        arguments: "text, text, bigint, uuid",
      }),
      Object.freeze({
        name: "grainline_seller_broadcast_account_deletion_cleanup",
        arguments: "text, text, bigint, uuid",
      }),
      Object.freeze({
        name: "grainline_email_outbox_begin_provider_attempt",
        arguments: "text, bigint, uuid",
        predecessorSourceSha256:
          "06c8df2412ad8809f2564a886074f95c5190e9238bb6224bbe22cab131aa8436",
      }),
    ]),
  }),
  email_service_v1: Object.freeze({
    migration: "20261101080000_prepare_email_service_least_privilege",
    migrationSha256: "1d231bf5df2652765a2f0c48509bc232d9976dc2a2a775a93900fe606616537a",
    // This preparation replaces direct callers across five related email
    // service tables. EmailOutbox is the representative predecessor table for
    // the generic preparation inspector; the migration itself verifies all
    // five tables, and the workflow's global grant audit verifies their full
    // predecessor ACL posture after the transaction.
    table: "EmailOutbox",
    expectedPredecessorPosture: Object.freeze({
      rlsEnabled: false,
      rlsForced: false,
      policyCount: 0,
      runtimeSelect: true,
      runtimeInsert: true,
      runtimeUpdate: true,
      runtimeDelete: true,
      staffSelect: false,
      publicSelect: false,
    }),
    addedColumns: Object.freeze([]),
    sourceTests: Object.freeze([
      "tests/account-export-privacy.test.mjs",
      "tests/account-state-residue-followups.test.mjs",
      "tests/clerk-webhook-receipt.test.mjs",
      "tests/email-outbox-worker.test.mjs",
      "tests/email-normalization-followups.test.mjs",
      "tests/newsletter-double-opt-in.test.mjs",
      "tests/retention-and-ops-followups.test.mjs",
      "tests/seller-broadcast-consumer-contracts.test.mjs",
      "tests/seller-broadcast-delivery-state.test.mjs",
    ]),
    functions: Object.freeze([
      Object.freeze({ name: "grainline_email_suppression_exists", arguments: "text, text" }),
      Object.freeze({ name: "grainline_email_one_click_suppression_clear", arguments: "text" }),
      Object.freeze({
        name: "grainline_newsletter_signup_reserve",
        arguments: "text, text, text, timestamp without time zone, timestamp without time zone, timestamp without time zone",
      }),
      Object.freeze({ name: "grainline_newsletter_signup_release", arguments: "text, text" }),
      Object.freeze({
        name: "grainline_newsletter_confirmation_valid",
        arguments: "text, timestamp without time zone",
      }),
      Object.freeze({
        name: "grainline_newsletter_confirm",
        arguments: "text, timestamp without time zone",
      }),
      Object.freeze({
        name: "grainline_newsletter_token_superseded",
        arguments: "text, timestamp without time zone",
      }),
      Object.freeze({ name: "grainline_email_unsubscribe_apply", arguments: "text, jsonb" }),
      Object.freeze({ name: "grainline_email_account_deletion_suppression_clear", arguments: "text" }),
      Object.freeze({ name: "grainline_email_service_owner_export", arguments: "" }),
      Object.freeze({ name: "grainline_email_service_account_deletion_apply", arguments: "" }),
      Object.freeze({
        name: "grainline_resend_webhook_event_reserve",
        arguments: "text, text, timestamp without time zone, timestamp without time zone, uuid",
      }),
      Object.freeze({
        name: "grainline_resend_webhook_event_complete",
        arguments: "text, bigint, uuid, timestamp without time zone",
      }),
      Object.freeze({
        name: "grainline_resend_webhook_event_fail",
        arguments: "text, bigint, uuid, text, timestamp without time zone",
      }),
      Object.freeze({
        name: "grainline_email_outbox_begin_provider_attempt",
        arguments: "text, bigint, uuid",
        predecessorSourceSha256:
          "ef145be432a0ffcbbf02e6dc9419d90d7b0ec3dec23a9d1eb0a83aff0a16393a",
      }),
      Object.freeze({
        name: "grainline_newsletter_expired_unconfirmed_delete_batch",
        arguments: "timestamp without time zone, integer",
      }),
      Object.freeze({
        name: "grainline_email_outbox_retention_delete_batch",
        arguments: "timestamp without time zone, timestamp without time zone, integer",
      }),
      Object.freeze({
        name: "grainline_resend_webhook_event_retention_delete_batch",
        arguments: "timestamp without time zone, integer",
      }),
      Object.freeze({
        name: "grainline_email_service_ops_health",
        arguments: "timestamp without time zone, timestamp without time zone",
      }),
      Object.freeze({ name: "grainline_email_outbox_cancel_seller_broadcast", arguments: "text" }),
      Object.freeze({ name: "grainline_email_outbox_redact_deleted_seller", arguments: "text" }),
    ]),
  }),
  seller_analytics_daily_v1: Object.freeze({
    migration: "20261101030000_prepare_seller_analytics_daily_authorities",
    migrationSha256: "f0f7c974d84e8132eb2271874f266db8ee94c9b80a7be421cba39ec70e95247d",
    table: "ListingViewDaily",
    additionalTables: Object.freeze(["SellerProfileViewDaily"]),
    expectedPredecessorPosture: Object.freeze({
      rlsEnabled: false,
      rlsForced: false,
      policyCount: 0,
      runtimeSelect: true,
      runtimeInsert: true,
      runtimeUpdate: true,
      runtimeDelete: true,
      staffSelect: false,
      publicSelect: false,
    }),
    addedColumns: Object.freeze([]),
    addedConstraints: Object.freeze([
      Object.freeze({
        table: "ListingViewDaily",
        name: "ListingViewDaily_counts_non_negative_chk",
      }),
      Object.freeze({
        table: "ListingViewDaily",
        name: "ListingViewDaily_date_midnight_utc_chk",
      }),
      Object.freeze({
        table: "SellerProfileViewDaily",
        name: "SellerProfileViewDaily_views_non_negative_chk",
      }),
      Object.freeze({
        table: "SellerProfileViewDaily",
        name: "SellerProfileViewDaily_date_midnight_utc_chk",
      }),
    ]),
    sourceTests: Object.freeze([
      "tests/listing-analytics-route.test.mjs",
      "tests/seller-analytics-daily-preparation.test.mjs",
    ]),
    functions: Object.freeze([
      Object.freeze({
        name: "grainline_listing_analytics_record",
        arguments: "text, text",
      }),
      Object.freeze({
        name: "grainline_seller_profile_view_record",
        arguments: "text, date",
        predecessorSourceSha256:
          "a079e68ab4ab0d4d6dc1351a3724f2751e626569b36652cdc6b6df69853487cf",
      }),
      Object.freeze({
        name: "grainline_seller_engagement_analytics",
        arguments: "bigint, bigint, boolean, text",
      }),
      Object.freeze({
        name: "grainline_seller_analytics_retention_prune",
        arguments: "integer",
      }),
      Object.freeze({
        name: "grainline_seller_profile_view_daily_account_deletion_clear",
        arguments: "text, bigint, uuid",
      }),
    ]),
  }),
  block_v1: Object.freeze({
    migration: "20261030010000_prepare_block_authorities",
    migrationSha256: "3bc49fc721e4bf8067f2222c9d47bc2e01c91d6ed93d7ed70fc25d5dd14251cb",
    table: "Block",
    expectedPredecessorPosture: Object.freeze({
      rlsEnabled: false,
      rlsForced: false,
      policyCount: 0,
      runtimeSelect: true,
      runtimeInsert: true,
      runtimeUpdate: true,
      runtimeDelete: true,
      staffSelect: false,
      publicSelect: false,
    }),
    addedColumns: Object.freeze([]),
    sourceTests: Object.freeze([
      "tests/block-authority-preparation.test.mjs",
      "tests/notification-block-race-guardrails.test.mjs",
      "tests/order-blocked-pair-checkout.test.mjs",
      "tests/seller-profile-block-follow-cleanup-conversion.test.mjs",
    ]),
    functions: Object.freeze([
      Object.freeze({
        name: "grainline_user_block_pair_is_blocked",
        arguments: "text",
      }),
      Object.freeze({
        name: "grainline_user_block_create",
        arguments: "text",
      }),
      Object.freeze({
        name: "grainline_user_block_remove",
        arguments: "text",
      }),
      Object.freeze({
        name: "grainline_user_block_export",
        arguments: "",
      }),
      Object.freeze({
        name: "grainline_user_block_delete_owned",
        arguments: "",
      }),
      Object.freeze({
        name: "grainline_conversation_inbox_owner",
        arguments: "boolean, text, timestamp without time zone, text, integer",
      }),
      Object.freeze({
        name: "grainline_message_unread_count_owner",
        arguments: "",
      }),
    ]),
  }),
  user_report_v1: Object.freeze({
    migration: "20261030020000_prepare_user_report_authorities",
    migrationSha256: "23a39d693ac959d3f1ca81dbb598752ee75d9f9adef90874082ec23693ca105a",
    table: "UserReport",
    expectedPredecessorPosture: Object.freeze({
      rlsEnabled: false,
      rlsForced: false,
      policyCount: 0,
      runtimeSelect: true,
      runtimeInsert: true,
      runtimeUpdate: true,
      runtimeDelete: true,
      staffSelect: false,
      publicSelect: false,
    }),
    addedColumns: Object.freeze([
      Object.freeze({
        name: "internalResolutionNote",
        type: "character varying(1000)",
        nullable: true,
      }),
    ]),
    sourceTests: Object.freeze([
      "tests/user-report-authority-preparation.test.mjs",
      "tests/user-report-target-access.test.mjs",
    ]),
    functions: Object.freeze([
      Object.freeze({
        name: "grainline_user_report_submit",
        arguments: "text, text, text, text, text, text",
      }),
      Object.freeze({
        name: "grainline_user_report_owner_submitted_export",
        arguments: "",
      }),
      Object.freeze({
        name: "grainline_user_report_owner_received_export",
        arguments: "",
      }),
      Object.freeze({
        name: "grainline_user_report_staff_open_count",
        arguments: "text",
        executeRole: "staff",
      }),
      Object.freeze({
        name: "grainline_user_report_staff_open_page",
        arguments: "text, timestamp without time zone, text, integer",
        executeRole: "staff",
      }),
      Object.freeze({
        name: "grainline_user_report_staff_top_reporters",
        arguments: "text, timestamp without time zone, integer",
        executeRole: "staff",
      }),
      Object.freeze({
        name: "grainline_user_report_staff_resolve",
        arguments: "text, text, text, text",
        executeRole: "staff",
      }),
      Object.freeze({
        name: "grainline_user_report_account_deletion_redact",
        arguments: "text, bigint, uuid",
      }),
    ]),
  }),
  seller_faq_v1: Object.freeze({
    migration: "20261030030000_prepare_seller_faq_authorities",
    migrationSha256: "45cf9935bd9c6492a26ebc167dab20962395e1834f2191d293f0776597803e99",
    table: "SellerFaq",
    expectedPredecessorPosture: Object.freeze({
      rlsEnabled: false,
      rlsForced: false,
      policyCount: 0,
      runtimeSelect: true,
      runtimeInsert: true,
      runtimeUpdate: true,
      runtimeDelete: true,
      staffSelect: false,
      publicSelect: false,
    }),
    addedColumns: Object.freeze([]),
    sourceTests: Object.freeze([
      "tests/seller-faq-authority-preparation.test.mjs",
    ]),
    functions: Object.freeze([
      Object.freeze({
        name: "grainline_seller_faq_owner_create",
        arguments: "text, text, text",
      }),
      Object.freeze({
        name: "grainline_seller_faq_owner_remove",
        arguments: "text",
      }),
      Object.freeze({
        name: "grainline_seller_faq_owner_export",
        arguments: "",
      }),
      Object.freeze({
        name: "grainline_seller_faq_account_deletion_cleanup",
        arguments: "text, text, bigint, uuid",
      }),
    ]),
  }),
  admin_audit_log_v1: Object.freeze({
    migration: "20261102010000_prepare_admin_audit_log_authorities",
    migrationSha256: "1895bb203781aabaf3c3efebc9419925415f6db639b5c9780d4865504b48ccc8",
    table: "AdminAuditLog",
    expectedPredecessorPosture: Object.freeze({
      rlsEnabled: false,
      rlsForced: false,
      policyCount: 0,
      runtimeSelect: true,
      runtimeInsert: true,
      runtimeUpdate: true,
      runtimeDelete: true,
      staffSelect: false,
      publicSelect: false,
    }),
    addedColumns: Object.freeze([]),
    addedIndexes: Object.freeze([
      Object.freeze({
        name: "AdminAuditLog_action_createdAt_id_idx",
        definition:
          'CREATE INDEX "AdminAuditLog_action_createdAt_id_idx" ON public."AdminAuditLog" USING btree (action, "createdAt" DESC, id DESC)',
      }),
      Object.freeze({
        name: "AdminAuditLog_createdAt_id_idx",
        definition:
          'CREATE INDEX "AdminAuditLog_createdAt_id_idx" ON public."AdminAuditLog" USING btree ("createdAt" DESC, id DESC)',
      }),
    ]),
    addedTriggers: Object.freeze([
      Object.freeze({
        name: "AdminAuditLog_insert_write_fence",
        function: "grainline_admin_audit_insert_write_fence",
        enabled: "O",
        type: 7,
      }),
    ]),
    sourceTests: Object.freeze([
      "tests/admin-audit-log-consumer-contracts.test.mjs",
      "tests/admin-audit-log-account-deletion-concurrency-proof.test.mjs",
      "tests/admin-audit-log-preparation-postgres.test.mjs",
      "tests/admin-audit-log-preparation-rollback.test.mjs",
      "tests/account-deletion-side-effects.test.mjs",
      "tests/account-deletion-timeout-fix.test.mjs",
      "tests/transaction-retry.test.mjs",
    ]),
    functions: Object.freeze([
      Object.freeze({
        name: "grainline_admin_audit_insert_write_fence",
        arguments: "",
        executeRoles: Object.freeze([]),
      }),
      Object.freeze({
        name: "grainline_admin_audit_append",
        arguments: "text, text, text, text, text, jsonb",
      }),
      Object.freeze({
        name: "grainline_admin_audit_staff_count",
        arguments: "text, text",
        executeRole: "staff",
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_admin_audit_staff_page",
        arguments: "text, text, integer, integer",
        executeRole: "staff",
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_admin_audit_staff_undo_source",
        arguments: "text, text",
        executeRole: "staff",
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_admin_audit_undo_claim",
        arguments: "text, text, text, text, text, text, text, jsonb",
      }),
      Object.freeze({
        name: "grainline_admin_audit_account_deletion_write_fence",
        arguments: "text, bigint, uuid",
      }),
      Object.freeze({
        name: "grainline_admin_audit_account_deletion_candidates",
        arguments: "text, bigint, uuid, text[], text[], text, integer",
      }),
      Object.freeze({
        name: "grainline_admin_audit_account_deletion_redaction_plans_enqueue",
        arguments: "text, bigint, uuid, text[], text[], jsonb",
      }),
      Object.freeze({
        name: "grainline_admin_audit_account_deletion_redaction_apply",
        arguments: "text, bigint, uuid, text",
        executeRole: "account_deletion",
      }),
      Object.freeze({
        name: "grainline_admin_audit_account_deletion_legacy_redaction_apply",
        arguments: "text, bigint, uuid, text",
        executeRole: "account_deletion",
      }),
      Object.freeze({
        name: "grainline_admin_audit_staff_ban_rows",
        arguments: "text, text, boolean, integer",
        executeRole: "staff",
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_admin_audit_ban_repair_candidates",
        arguments: "integer",
        executeRole: "staff",
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_admin_audit_ban_repair_state",
        arguments: "text, text",
        executeRole: "staff",
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_admin_audit_ban_repair_append",
        arguments: "text, text, text, jsonb",
        executeRole: "staff",
      }),
    ]),
    retainedFunctions: Object.freeze([
      Object.freeze({ name: "grainline_case_escalate", arguments: "text, text", sourceSha256: "ef94e857db8c48cffc38d2ba0a5f0d17e5cceb228e9e4268cef6dd48b4dc36fb" }),
      Object.freeze({ name: "grainline_case_mark_resolved", arguments: "text, text", sourceSha256: "c680b8d71d3b5373a93a9b7032b9e181ff79bc6f33ab653ec9360ec724f15ba5" }),
      Object.freeze({ name: "grainline_case_open", arguments: "text, text, text, text", sourceSha256: "601c16ca75b6da9d251b88d81c83e69df0568d0f56ffea870122e1c5be0f4e31" }),
      Object.freeze({ name: "grainline_case_staff_resolution_finalize", arguments: "text, text", sourceSha256: "824f2752ea9c7f260a1eb63de6c9756a4b4086a1d9cb7d72c39d5f0c843e24c9" }),
      Object.freeze({ name: "grainline_case_staff_resolution_prepare", arguments: 'text, text, "CaseResolution", integer, jsonb', sourceSha256: "f70e758f6b40f8e65fbacd046d4259587c0a5d26232281b46110a9f0658df59e" }),
      Object.freeze({ name: "grainline_case_staff_resolution_provider_recover", arguments: "text, text, text, bigint, text", sourceSha256: "7ce6bef8ca6bfad7c50918c2905e8bd54aa7b9d872c20015b78cbbfb350b5634" }),
      Object.freeze({ name: "grainline_case_staff_resolution_provider_recovery_load", arguments: 'text, text, "CaseResolution", integer', sourceSha256: "7b993cc8527ffed03901a36d70ba6883ecf9200ed2b98a86dd5af588498b7cfe" }),
      Object.freeze({ name: "grainline_case_staff_resolution_provider_recovery_record", arguments: "text, text, text, text, text[], text[], text, integer, boolean, boolean", sourceSha256: "57c98610c90e8fddfed5316a43a1421efc793eb2f4f1e491e0fc27dc64a2f442" }),
      Object.freeze({ name: "grainline_case_staff_resolution_reconcile", arguments: "text, text, text, text", sourceSha256: "85f4c1d30b6f2007c68aa97fe79cb89b418cfab94bd710f0f1cffb7c74ac7dc0" }),
      Object.freeze({ name: "grainline_case_staff_resolution_recovery_finalize", arguments: "text, text", sourceSha256: "02509c7304e27a7e0a7cfa11a9a5a05dd65aff4aa37d8670666fb95de773b460" }),
      Object.freeze({ name: "grainline_notification_create_core", arguments: 'text, text, "NotificationType", text, text, text', executeRoles: Object.freeze([]), sourceSha256: "271848aa27a144a0cca81616eac7398f7d2a4e342a867cb7e6f65155dd0ae5e5" }),
      Object.freeze({ name: "grainline_order_refund_reconcile", arguments: "text, text, bigint, text, text, bigint, text, text", sourceSha256: "f3fafba64791a6f97da01799b2e5af648a8d5b6e25e6957b74f13eae081136f3" }),
      Object.freeze({ name: "grainline_order_staff_append_note", arguments: "text, text, text", executeRole: "staff", sourceSha256: "ece7ef62aa415edd83501d31fd3027f3dc439d5e548facb5596794fde20a593b" }),
      Object.freeze({ name: "grainline_order_staff_mark_reviewed", arguments: "text, text", executeRole: "staff", sourceSha256: "84195010343f715d2568edcff1c0ccf2ff40a98de0991088089df2269510eda1" }),
      Object.freeze({ name: "grainline_order_staff_record_label_voided", arguments: "text, text", executeRole: "staff", sourceSha256: "e66b431743798c39917a372ea52355088357bf8560fcb3cf063bd3b0ada8d873" }),
      Object.freeze({ name: "grainline_seller_broadcast_staff_delete", arguments: "text, text", executeRole: "staff", sourceSha256: "b8b8e1f878e3f3a5d55e1e979f96620ede4df026d5fb0603c6c55ddd00ac5aab" }),
      Object.freeze({ name: "grainline_seller_guild_staff_transition", arguments: "text, text, text, text, text, boolean", executeRole: "staff", sourceSha256: "947296a6a8d6d26a96534d78439b51f4dd9854ce21499160ae236c5243789ec8" }),
      Object.freeze({ name: "grainline_seller_guild_staff_transition_prepared_impl", arguments: "text, text, text, text, text, boolean", executeRoles: Object.freeze([]), sourceSha256: "36592c7c9112c6e3dd6262aa41edf9fd19bb17bbf1d942a449fec8d306e80fd7" }),
      Object.freeze({ name: "grainline_seller_staff_feature_transition", arguments: "text, text, text", executeRole: "staff", sourceSha256: "72886c6606662c212874f23ebb15f21f34706286b36458cd1652aeedbeae753e" }),
      Object.freeze({ name: "grainline_seller_staff_listing_review_transition", arguments: "text, text, text, text", executeRole: "staff", sourceSha256: "40857ec66b66cf3dd82af07d0747d422e3db0314d9b372daa56d912b0f18f490" }),
      Object.freeze({ name: "grainline_support_request_staff_transition", arguments: "text, text, text", sourceSha256: "1939ad2160ab916f39523a4d9ce20be13450dc0570b469316e341ab6e7b62d7a" }),
      Object.freeze({ name: "grainline_user_ban_repair_target", arguments: "text, text", executeRole: "staff", volatility: "s", sourceSha256: "a89d77d890930a59960fbd9bea5aa775f1bef54c531075aae8dec1348215c51c" }),
      Object.freeze({ name: "grainline_user_report_staff_resolve", arguments: "text, text, text, text", executeRole: "staff", sourceSha256: "36289e5aa85cf9a86f73dc5943e542188d1d3c85a6928b78a289c6147e76ca93" }),
    ]),
  }),
});

export const PRIVATE_TABLE_PREPARATION_BATCHES = Object.freeze({
  owner_social_verification_v1: Object.freeze([
    "favorite_v1",
    "follow_v1",
    "review_vote_v1",
    "maker_verification_v1",
  ]),
  block_report_seller_faq_v1: Object.freeze([
    "block_v1",
    "user_report_v1",
    "seller_faq_v1",
  ]),
});

function stopped(message) {
  return new Error(`private-table preparation stopped: ${message}`);
}

export function privateTablePreparation(releaseId) {
  if (typeof releaseId !== "string" || !RELEASE_ID_PATTERN.test(releaseId)) {
    throw stopped("release id is invalid");
  }
  const release = PRIVATE_TABLE_PREPARATIONS[releaseId];
  if (!release) throw stopped("release id is not reviewed");
  return release;
}

export function privateTablePreparationTables(release) {
  const tables = [release.table, ...(release.additionalTables ?? [])];
  if (
    tables.some((table) => (
      typeof table !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(table)
    ))
    || new Set(tables).size !== tables.length
  ) {
    throw stopped("preparation table catalog is invalid");
  }
  return Object.freeze(tables);
}

export function privateTablePreparationReleaseIds(selectionId) {
  if (typeof selectionId !== "string" || !RELEASE_ID_PATTERN.test(selectionId)) {
    throw stopped("release id is invalid");
  }
  if (PRIVATE_TABLE_PREPARATIONS[selectionId]) {
    return Object.freeze([selectionId]);
  }
  const batch = PRIVATE_TABLE_PREPARATION_BATCHES[selectionId];
  if (!batch) throw stopped("release id is not reviewed");
  for (const releaseId of batch) privateTablePreparation(releaseId);
  const migrations = batch.map((releaseId) => (
    PRIVATE_TABLE_PREPARATIONS[releaseId].migration
  ));
  if (new Set(batch).size !== batch.length || new Set(migrations).size !== migrations.length) {
    throw stopped("batch contains duplicate releases");
  }
  const sortedMigrations = [...migrations].sort((left, right) => left.localeCompare(right));
  if (migrations.join("|") !== sortedMigrations.join("|")) {
    throw stopped("batch migrations are not ordered");
  }
  return batch;
}

export function privateTablePreparationMigrationPath(release) {
  return `prisma/migrations/${release.migration}/migration.sql`;
}

export function privateTableFunctionExecuteRoles(entry) {
  const roles = entry.executeRoles ?? [entry.executeRole ?? "runtime"];
  return Object.freeze([...roles]);
}

export function functionSourceFromMigration(sql, name) {
  const delimiter = `$${name}$`;
  const marker = `AS ${delimiter}`;
  const start = sql.indexOf(marker);
  if (start < 0) throw stopped(`function source is absent for ${name}`);
  const bodyStart = start + marker.length;
  const end = sql.indexOf(`${delimiter};`, bodyStart);
  if (end < 0 || end === bodyStart) {
    throw stopped(`function source delimiter is invalid for ${name}`);
  }
  return sql.slice(bodyStart, end);
}

export function verifyPrivateTablePreparationSource(
  releaseId,
  rootDir = process.cwd(),
  migrationPathOverride,
) {
  const release = privateTablePreparation(releaseId);
  privateTablePreparationTables(release);
  const releasePathEnvironment = PREPARATION_MIGRATION_PATH_ENV_BY_RELEASE[releaseId];
  const configuredMigrationPath = migrationPathOverride
    || (releasePathEnvironment
      ? process.env[releasePathEnvironment]?.trim()
      : undefined)
    || process.env.PRIVATE_TABLE_PREPARATION_MIGRATION_PATH?.trim();
  const migrationPath = configuredMigrationPath
    ? path.resolve(rootDir, configuredMigrationPath)
    : path.join(rootDir, privateTablePreparationMigrationPath(release));
  const bytes = readFileSync(migrationPath);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== release.migrationSha256) {
    throw stopped("migration digest drifted");
  }
  const sql = bytes.toString("utf8");
  if (
    /ENABLE\s+ROW\s+LEVEL\s+SECURITY/iu.test(sql)
    || /FORCE\s+ROW\s+LEVEL\s+SECURITY/iu.test(sql)
    || /REVOKE[\s\S]{0,500}\bON\s+TABLE/iu.test(sql)
    || /DROP\s+COLUMN/iu.test(sql)
  ) {
    throw stopped("compatible preparation contains activation or destructive SQL");
  }
  if (
    !Array.isArray(release.sourceTests)
    || release.sourceTests.length < 1
    || new Set(release.sourceTests).size !== release.sourceTests.length
    || release.sourceTests.some((testPath) => (
      typeof testPath !== "string"
      || !/^tests\/[A-Za-z0-9._-]+\.test\.mjs$/u.test(testPath)
    ))
  ) {
    throw stopped("source-test catalog is invalid");
  }
  if (release.functions.some((entry) => (
    entry.predecessorSourceSha256 !== undefined
    && !/^[0-9a-f]{64}$/u.test(entry.predecessorSourceSha256)
  ))) {
    throw stopped("predecessor function digest is invalid");
  }
  const allFunctions = [...release.functions, ...(release.retainedFunctions ?? [])];
  const allowedExecuteRoles = new Set(["runtime", "staff", "account_deletion"]);
  if (allFunctions.some((entry) => {
    const roles = privateTableFunctionExecuteRoles(entry);
    return new Set(roles).size !== roles.length
      || roles.some((role) => !allowedExecuteRoles.has(role));
  })) {
    throw stopped("function execution role is invalid");
  }
  if (allFunctions.some((entry) => (
    entry.volatility !== undefined && !["i", "s", "v"].includes(entry.volatility)
  ))) {
    throw stopped("function volatility is invalid");
  }
  const functionIdentities = allFunctions.map((entry) => `${entry.name}(${entry.arguments})`);
  if (new Set(functionIdentities).size !== functionIdentities.length) {
    throw stopped("function identity catalog is duplicated");
  }
  if ((release.retainedFunctions ?? []).some((entry) => (
    !/^[0-9a-f]{64}$/u.test(entry.sourceSha256 ?? "")
  ))) {
    throw stopped("retained function digest is invalid");
  }
  const tableNames = [release.table, ...(release.additionalTables ?? [])];
  if (
    new Set(tableNames).size !== tableNames.length
    || tableNames.some((tableName) => (
      typeof tableName !== "string"
      || !/^[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(tableName)
    ))
  ) {
    throw stopped("preparation table catalog is invalid");
  }
  if ((release.addedConstraints ?? []).some((entry) => (
    !tableNames.includes(entry.table)
    || typeof entry.name !== "string"
    || !/^[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(entry.name)
  ))) {
    throw stopped("constraint catalog is invalid");
  }
  if ((release.addedIndexes ?? []).some((entry) => (
    typeof entry.name !== "string"
    || !/^[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(entry.name)
    || typeof entry.definition !== "string"
    || !entry.definition.startsWith("CREATE INDEX ")
  ))) {
    throw stopped("index catalog is invalid");
  }
  if ((release.addedTriggers ?? []).some((entry) => (
    typeof entry.name !== "string"
    || !/^[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(entry.name)
    || typeof entry.function !== "string"
    || !/^[a-z][a-z0-9_]{2,62}$/u.test(entry.function)
    || !["O", "D", "R", "A"].includes(entry.enabled)
    || !Number.isSafeInteger(entry.type)
  ))) {
    throw stopped("trigger catalog is invalid");
  }
  const functionSources = new Map(release.functions.map((entry) => [
    entry.name,
    functionSourceFromMigration(sql, entry.name),
  ]));
  return Object.freeze({ releaseId, release, migrationPath, digest, functionSources });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const selectionId = process.env.PRIVATE_TABLE_PREPARATION_RELEASE_ID ?? "";
    const releaseIds = privateTablePreparationReleaseIds(selectionId);
    const verified = releaseIds.map((releaseId) => (
      verifyPrivateTablePreparationSource(releaseId)
    ));
    if (process.argv[2] === "--tests") {
      const tests = [...new Set(verified.flatMap((entry) => entry.release.sourceTests))];
      process.stdout.write(`${tests.join("\n")}\n`);
    } else if (process.argv[2] === "--release-ids") {
      process.stdout.write(`${releaseIds.join("\n")}\n`);
    } else if (process.argv[2] === "--migrations") {
      process.stdout.write(`${verified.map((entry) => entry.release.migration).join("\n")}\n`);
    } else {
      if (verified.length !== 1) throw stopped("batch output requires an explicit mode");
      process.stdout.write(`${verified[0].release.migration}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
