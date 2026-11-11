#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RELEASE_ID_PATTERN = /^[a-z][a-z0-9_]{2,63}$/u;

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
      Object.freeze({
        name: "grainline_support_request_owner_export",
        arguments: "",
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_support_request_staff_state",
        arguments: "integer, integer, integer",
        volatility: "s",
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
      Object.freeze({
        name: "grainline_support_request_overdue_count",
        arguments: "",
        volatility: "s",
      }),
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
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_stock_notification_seller_range_count",
        arguments: "timestamp without time zone, timestamp without time zone, boolean",
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_stock_notification_restock_candidates",
        arguments: "text, integer",
        volatility: "s",
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
        volatility: "s",
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
        volatility: "s",
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
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_favorite_seller_range_count",
        arguments: "timestamp without time zone, timestamp without time zone, boolean",
        volatility: "s",
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
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_follow_source_notification_page",
        arguments: "text, text, text, integer",
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_follow_owner_target_ids",
        arguments: "integer",
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_follow_owner_outgoing_count",
        arguments: "",
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_follow_seller_owner_incoming_count",
        arguments: "",
        volatility: "s",
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
        volatility: "s",
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
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_maker_verification_staff_pending_page",
        arguments: "text, timestamp without time zone, text, integer",
        executeRole: "staff",
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_seller_guild_staff_master_pending_count",
        arguments: "text",
        executeRole: "staff",
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_seller_guild_staff_master_pending_page",
        arguments: "text, timestamp without time zone, text, integer",
        executeRole: "staff",
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_seller_guild_staff_roster_count",
        arguments: "text, text",
        executeRole: "staff",
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_seller_guild_staff_roster_page",
        arguments: "text, text, timestamp without time zone, text, integer",
        executeRole: "staff",
        volatility: "s",
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
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_review_vote_owner_delete_all",
        arguments: "",
      }),
    ]),
  }),
  seller_broadcast_v1: Object.freeze({
    migration: "20261101100000_prepare_seller_broadcast_authorities",
    migrationSha256: "a2a6a600727ce0c68613e3df50e3bdd3fffe7a36aa54fe3a701b35243ec6e57d",
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
      Object.freeze({
        name: "grainline_seller_broadcast_owner_cooldown",
        arguments: "",
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_seller_broadcast_owner_create",
        arguments: "text, text, text, integer",
      }),
      Object.freeze({
        name: "grainline_seller_broadcast_owner_count",
        arguments: "",
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_seller_broadcast_owner_page",
        arguments: "integer, integer",
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_seller_broadcast_owner_export",
        arguments: "",
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_seller_broadcast_public_latest",
        arguments: "text",
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_seller_broadcast_actor_feed_page",
        arguments: "text[], timestamp without time zone, timestamp without time zone, text, text, integer",
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_seller_broadcast_owner_delivery_source",
        arguments: "text",
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_seller_broadcast_owner_record_delivery",
        arguments: "text, integer",
      }),
      Object.freeze({
        name: "grainline_seller_broadcast_staff_count",
        arguments: "text, text",
        executeRole: "staff",
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_seller_broadcast_staff_page",
        arguments: "text, text, integer, integer",
        executeRole: "staff",
        volatility: "s",
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
          "acb3d41117e8b8a88fbe3fd055cdc1824b8a32eaebf4f40fb687c8ef7516289e",
      }),
    ]),
  }),
  email_service_v1: Object.freeze({
    migration: "20261101080000_prepare_email_service_least_privilege",
    migrationSha256: "a00d71f078a8e2cb38d376292592011861904b77a9ba282e186669a8d142e803",
    // The preparation installs one fixed-purpose boundary across five related
    // service tables. EmailOutbox is the representative predecessor table for
    // the generic inspector; the migration itself verifies all five tables.
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
      "tests/seller-broadcast-delivery-state.test.mjs",
    ]),
    functions: Object.freeze([
      Object.freeze({
        name: "grainline_email_suppression_exists",
        arguments: "text, text",
        volatility: "s",
      }),
      Object.freeze({ name: "grainline_email_one_click_suppression_clear", arguments: "text" }),
      Object.freeze({
        name: "grainline_newsletter_signup_reserve",
        arguments: "text, text, text, timestamp without time zone, timestamp without time zone, timestamp without time zone",
      }),
      Object.freeze({ name: "grainline_newsletter_signup_release", arguments: "text, text" }),
      Object.freeze({
        name: "grainline_newsletter_confirmation_valid",
        arguments: "text, timestamp without time zone",
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_newsletter_confirm",
        arguments: "text, timestamp without time zone",
      }),
      Object.freeze({
        name: "grainline_newsletter_token_superseded",
        arguments: "text, timestamp without time zone",
        volatility: "s",
      }),
      Object.freeze({ name: "grainline_email_unsubscribe_apply", arguments: "text, jsonb" }),
      Object.freeze({ name: "grainline_email_account_deletion_suppression_clear", arguments: "text" }),
      Object.freeze({
        name: "grainline_email_service_owner_export",
        arguments: "",
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_email_service_account_deletion_apply",
        arguments: "text, bigint, uuid",
      }),
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
          "06c8df2412ad8809f2564a886074f95c5190e9238bb6224bbe22cab131aa8436",
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
        volatility: "s",
      }),
      Object.freeze({ name: "grainline_email_outbox_cancel_seller_broadcast", arguments: "text" }),
      Object.freeze({ name: "grainline_email_outbox_redact_deleted_seller", arguments: "text" }),
    ]),
  }),
  block_v1: Object.freeze({
    migration: "20261030010000_prepare_block_authorities",
    migrationSha256: "f62bcebf43fa9fccd220aa3cdd3bab41544730f77e72c12ec6884937e0d3cddd",
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
        volatility: "s",
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
        volatility: "s",
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
    migrationSha256: "f194866b13fd85848e9f15c43b85ca5ac05a00dfe70ec4efddbdb0b4f01e4944",
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
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_user_report_owner_received_export",
        arguments: "",
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_user_report_staff_open_count",
        arguments: "text",
        executeRole: "staff",
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_user_report_staff_open_page",
        arguments: "text, timestamp without time zone, text, integer",
        executeRole: "staff",
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_user_report_staff_top_reporters",
        arguments: "text, timestamp without time zone, integer",
        executeRole: "staff",
        volatility: "s",
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
        volatility: "s",
      }),
      Object.freeze({
        name: "grainline_seller_faq_account_deletion_cleanup",
        arguments: "text, text, bigint, uuid",
      }),
    ]),
  }),
  seller_metrics_v1: Object.freeze({
    migration: "20261102030000_prepare_seller_metrics_authorities",
    migrationSha256: "e94503581bd391c88f7c072e2ae1237026339ee1769c89952fdf6c5d98299801",
    table: "SellerMetrics",
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
      "period_months",
      "average_rating",
      "review_count",
      "on_time_shipping_rate",
      "response_rate",
      "total_sales_cents",
      "completed_order_count",
      "active_case_count",
      "account_age_days",
    ].map((suffix) => Object.freeze({
      table: "SellerMetrics",
      name: `SellerMetrics_${suffix}_chk`,
    }))),
    sourceTests: Object.freeze([
      "tests/seller-metrics-preparation.test.mjs",
      "tests/seller-metrics-preparation-postgres.test.mjs",
    ]),
    functions: Object.freeze([
      Object.freeze({
        name: "grainline_seller_metrics_refresh_prepared_impl",
        arguments: "text, integer, boolean, text",
        executeRoles: Object.freeze([]),
      }),
      Object.freeze({
        name: "grainline_seller_metrics_owner_state",
        arguments: "integer, boolean",
      }),
      Object.freeze({
        name: "grainline_seller_metrics_account_deletion_clear",
        arguments: "text, bigint, uuid",
      }),
      Object.freeze({
        name: "grainline_seller_metrics_inactive_owner_cleanup",
        arguments: "",
        executeRoles: Object.freeze([]),
      }),
    ]),
    addedTriggers: Object.freeze([
      Object.freeze({
        name: "grainline_seller_metrics_inactive_owner_cleanup",
        function: "grainline_seller_metrics_inactive_owner_cleanup",
        table: "SellerProfile",
        enabled: "O",
        type: 17,
      }),
    ]),
    retainedFunctions: Object.freeze([
      Object.freeze({
        name: "grainline_seller_guild_metrics_apply",
        arguments: "text, timestamp without time zone",
        sourceSha256: "6c8fe8238aa8b4af01f4c5fa05ce3b0239fa05ced973879f6dc512875d06d7a8",
      }),
      Object.freeze({
        name: "grainline_seller_guild_metrics_apply_prepared_impl",
        arguments: "text, timestamp without time zone",
        executeRoles: Object.freeze([]),
        sourceSha256: "7299fca002e46e5451534095ac981621d0e56a1d5cdf97d2949072a1fb97d7ef",
      }),
      Object.freeze({
        name: "grainline_seller_guild_staff_master_pending",
        arguments: "text",
        executeRole: "staff",
        volatility: "s",
        sourceSha256: "bb265ad425fb0f4b60a73cd0aefc2ca920f492825e69d45ec0d2eb800fa62b8d",
      }),
      Object.freeze({
        name: "grainline_seller_guild_staff_master_pending_page",
        arguments: "text, timestamp without time zone, text, integer",
        executeRole: "staff",
        volatility: "s",
        sourceSha256: "e801b2643f5c04dad78b50fbe62f70e9b669eedfee4e649604b198ffa66f9377",
      }),
      Object.freeze({
        name: "grainline_seller_staff_verification_target",
        arguments: "text, text",
        executeRole: "staff",
        volatility: "s",
        sourceSha256: "31c74535ca8685e4d490b73fd7e0d3704f0bde2aaebf8b4a1aad5bf9a5b482f0",
      }),
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
  return Object.freeze([...(entry.executeRoles ?? [entry.executeRole ?? "runtime"])]);
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

function functionVolatilityFromMigration(sql, name) {
  const marker = `AS $${name}$`;
  const markerIndex = sql.indexOf(marker);
  const functionIndex = Math.max(
    sql.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}`, markerIndex),
    sql.lastIndexOf(`CREATE FUNCTION public.${name}`, markerIndex),
  );
  if (markerIndex < 0 || functionIndex < 0) {
    throw stopped(`function declaration is absent for ${name}`);
  }
  const declaration = sql.slice(functionIndex, markerIndex);
  if (/\bIMMUTABLE\b/iu.test(declaration)) return "i";
  if (/\bSTABLE\b/iu.test(declaration)) return "s";
  return "v";
}

export function verifyPrivateTablePreparationSource(
  releaseId,
  rootDir = process.cwd(),
  migrationPathOverride =
    process.env.PRIVATE_TABLE_PREPARATION_MIGRATION_PATH?.trim() || undefined,
) {
  const release = privateTablePreparation(releaseId);
  const tableNames = privateTablePreparationTables(release);
  const migrationPath = migrationPathOverride
    ? path.resolve(rootDir, migrationPathOverride)
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
    || (entry.table !== undefined && (
      typeof entry.table !== "string"
      || !/^[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(entry.table)
    ))
    || !["O", "D", "R", "A"].includes(entry.enabled)
    || !Number.isSafeInteger(entry.type)
  ))) {
    throw stopped("trigger catalog is invalid");
  }
  for (const entry of release.functions) {
    const actualVolatility = functionVolatilityFromMigration(sql, entry.name);
    if (actualVolatility !== (entry.volatility ?? "v")) {
      throw stopped(`${entry.name} volatility catalog drifted`);
    }
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
