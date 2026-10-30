import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import pg from "pg";
import { USER_AUTHORITY_FUNCTIONS, USER_AUTHORITY_GROUPS } from "../scripts/user-authority-catalog.mjs";
import {
  CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS,
  CONVERSATION_MESSAGE_PRIVATE_FUNCTION_NAMES,
} from "../scripts/conversation-message-authority-catalog.mjs";
import {
  DIRECT_UPLOAD_AUTHORITY_FUNCTIONS,
} from "../scripts/direct-upload-authority-catalog.mjs";
import {
  CASE_INVARIANT_FUNCTIONS,
  CASE_INVARIANT_PRIVATE_FUNCTION_NAMES,
} from "../scripts/case-invariant-catalog.mjs";
import {
  CHECKOUT_STOCK_RESERVATION_ACTIVATED_PRIVATE_FUNCTION_NAMES,
  CHECKOUT_STOCK_RESERVATION_CANDIDATE_FUNCTIONS,
  CHECKOUT_STOCK_RESERVATION_POST_CUTOVER_PRIVATE_FUNCTION_NAMES,
  CHECKOUT_STOCK_RESERVATION_SOURCE_CUTOVER_MIGRATION,
  CHECKOUT_STOCK_RESERVATION_SOURCE_CUTOVER_MIGRATION_SHA256,
} from "../scripts/checkout-stock-reservation-authority-catalog.mjs";
import {
  ORDER_REFUND_RECORD_PRIVATE_FUNCTION_NAMES,
} from "../scripts/order-refund-record-authority-catalog.mjs";
import {
  ORDER_REFUND_RECONCILIATION_PRIVATE_FUNCTION_NAMES,
  ORDER_REFUND_RECONCILIATION_RUNTIME_FUNCTION_NAMES,
} from "../scripts/order-refund-reconciliation-authority-catalog.mjs";
import {
  ORDER_PAYMENT_EVENT_INVARIANT_FUNCTIONS,
} from "../scripts/order-payment-event-invariants-catalog.mjs";
import {
  ORDER_PAYMENT_EVENT_READ_AUTHORITY_FUNCTIONS,
} from "../scripts/order-payment-event-read-authority-catalog.mjs";
import {
  ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_FUNCTIONS,
} from "../scripts/order-payment-event-aggregate-authority-catalog.mjs";
import {
  ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_FUNCTIONS,
} from "../scripts/order-payment-event-transition-authority-catalog.mjs";
import {
  ORDER_ELIGIBILITY_AUTHORITY_FUNCTIONS,
  ORDER_PARTICIPANT_DETAIL_AUTHORITY_FUNCTIONS,
  ORDER_PARTICIPANT_DETAIL_PROJECTION_FUNCTIONS,
  ORDER_PARTICIPANT_SNAPSHOT_CORRECTION_FUNCTIONS,
  ORDER_CHECKOUT_RECEIPT_AUTHORITY_FUNCTIONS,
  ORDER_PARTICIPANT_CURSOR_AUTHORITY_FUNCTIONS,
  ORDER_PARTICIPANT_EXPORT_AUTHORITY_FUNCTIONS,
  ORDER_PARTICIPANT_LIST_AUTHORITY_FUNCTIONS,
  ORDER_PARTICIPANT_RUNTIME_PRIVATE_FUNCTION_NAMES,
  ORDER_PARTICIPANT_SUMMARY_AUTHORITY_FUNCTIONS,
  ORDER_PUBLIC_AGGREGATE_AUTHORITY_FUNCTIONS,
  ORDER_SELLER_ANALYTICS_AUTHORITY_FUNCTIONS,
  ORDER_SELLER_METRICS_AUTHORITY_FUNCTIONS,
  ORDER_STAFF_READ_AUTHORITY_FUNCTIONS,
} from "../scripts/order-participant-list-authority-catalog.mjs";
import {
  ORDER_FULFILLMENT_AUTHORITY_FUNCTIONS,
} from "../scripts/order-fulfillment-authority-catalog.mjs";
import {
  ORDER_DEAUTHORIZED_CASE_ACCESS_RUNTIME_FUNCTIONS,
} from "../scripts/build-order-deauthorized-case-access-correction.mjs";
import {
  ORDER_LABEL_AUTHORITY_FUNCTIONS,
  ORDER_LABEL_PRIVATE_FUNCTIONS,
  ORDER_LABEL_PRIVATE_FUNCTION_NAMES,
} from "../scripts/order-label-authority-catalog.mjs";
import {
  ORDER_STAFF_READ_CHARGED_TOTAL_CORRECTION_FUNCTION_NAMES,
} from "../scripts/verify-order-staff-read-charged-total-correction.mjs";
import {
  SELLER_PROFILE_CONVERTED_AUTHORITY_FUNCTIONS,
  SELLER_PROFILE_CONVERTED_STAFF_AUTHORITY_FUNCTIONS,
} from "../scripts/seller-profile-public-catalog-disposition.mjs";
import {
  ORDER_ACCOUNT_DELETION_AUTHORITY_FUNCTION_NAMES,
} from "../scripts/verify-order-account-deletion-authority.mjs";
import {
  ORDER_ZERO_DIRECT_COMPATIBLE_NEW_FUNCTION_NAMES,
  ORDER_ZERO_DIRECT_COMPATIBLE_PUBLIC_REVOKE_COUNT,
} from "../scripts/stage-order-zero-direct-compatible-prefix.mjs";
import { postgresChannelBindingClientOptions } from "../scripts/postgres-url-safety.mjs";

const SELLER_PAYOUT_EVENT_CANDIDATE_FUNCTION_NAMES = [
  "grainline_seller_payout_event_apply",
  "grainline_seller_payout_export_page",
  "grainline_seller_payout_latest_failure",
];
const SELLER_PROFILE_PRIVATE_PREPARATION_FUNCTION_NAMES = [
  "grainline_seller_profile_private_mirror",
  "grainline_seller_profile_supported_snapshot",
];
const SELLER_PROFILE_PRIVATE_RETIREMENT_FUNCTION_NAMES = [
  "grainline_seller_profile_private_initialize",
];
const SELLER_PROFILE_PRIVATE_INVARIANT_FUNCTION_NAMES = [
  "grainline_seller_profile_private_supported_snapshot_sync",
  "grainline_seller_profile_supported_snapshot_guard",
];
const SELLER_PROFILE_PRIVATE_APP_AUTHORITY_GROUPS = [
  {
    migration: "20261014120000_prepare_seller_profile_private_stripe_app_authorities",
    functions: [
      "grainline_seller_stripe_owner_state",
      "grainline_seller_stripe_account_bind",
      "grainline_seller_stripe_reconciliation_page",
      "grainline_seller_stripe_mirror_state",
      "grainline_seller_stripe_charges_update",
    ],
  },
  {
    migration: "20261014130000_prepare_seller_profile_private_shipping_quote_authority",
    functions: ["grainline_seller_shipping_quote_state"],
  },
  {
    migration: "20261014140000_prepare_seller_profile_private_checkout_app_authority",
    functions: ["grainline_seller_checkout_private_state"],
  },
  {
    migration: "20261014150000_prepare_seller_profile_private_owner_app_authorities",
    functions: [
      "grainline_seller_owner_private_state",
      "grainline_seller_owner_onboarding_step_update",
      "grainline_seller_owner_onboarding_complete",
      "grainline_seller_owner_shop_settings_update",
    ],
  },
  {
    migration: "20261014160000_prepare_seller_profile_private_account_deletion_app_authorities",
    functions: [
      "grainline_seller_account_deletion_pause",
      "grainline_seller_account_deletion_anonymize",
    ],
  },
  {
    migration: "20261014170000_prepare_seller_profile_private_guild_listing_threshold_authority",
    functions: ["grainline_seller_guild_listing_threshold_sync"],
  },
  {
    migration: "20261014180000_prepare_seller_profile_private_guild_cron_batch_authorities",
    functions: [
      "grainline_seller_guild_member_cron_batch",
      "grainline_seller_guild_metrics_cron_batch",
    ],
  },
  {
    migration: "20261014190000_prepare_seller_profile_private_guild_metrics_authority",
    functions: ["grainline_seller_guild_metrics_apply"],
  },
  {
    migration: "20261014200000_prepare_seller_profile_private_guild_member_revocation_authority",
    functions: ["grainline_seller_guild_member_revoke"],
  },
  {
    migration: "20261014230000_prepare_seller_profile_private_remaining_app_authorities",
    functions: [
      "grainline_seller_profile_view_record",
      "grainline_seller_account_deletion_reconciliation_clear",
      "grainline_seller_owner_guild_master_application_record",
    ],
  },
];
const SELLER_PROFILE_PRIVATE_STAFF_READ_AUTHORITY_GROUPS = [
  {
    migration: "20261014210000_prepare_seller_profile_private_guild_staff_read_authorities",
    functions: [
      "grainline_seller_guild_staff_roster",
      "grainline_seller_guild_staff_master_pending",
    ],
  },
  {
    migration: "20261014220000_prepare_seller_profile_private_guild_staff_transition_authority",
    functions: ["grainline_seller_guild_staff_transition"],
  },
  {
    migration: "20261014230000_prepare_seller_profile_private_remaining_app_authorities",
    functions: ["grainline_seller_staff_orderability_state"],
  },
];
const ORDER_REFUND_CLAIM_FUNCTION_NAMES = [
  "grainline_blocked_checkout_refund_claim",
  "grainline_blocked_checkout_refund_claim_resume",
  "grainline_blocked_checkout_refund_record",
  "grainline_seller_refund_claim",
  "grainline_seller_refund_record",
];
const ORDER_PAYMENT_SIGNED_AUTHORITY_FUNCTION_NAMES = [
  "grainline_order_payment_signed_refund_apply",
  "grainline_order_payment_signed_dispute_apply",
];
const BLOCKED_CHECKOUT_TRANSFER_BINDING_FUNCTION_NAMES = [
  "grainline_blocked_checkout_transfer_bind",
];
const SELLER_PROFILE_PUBLIC_CANDIDATE_FUNCTION_NAMES = [
  ...SELLER_PROFILE_CONVERTED_AUTHORITY_FUNCTIONS,
  ...SELLER_PROFILE_CONVERTED_STAFF_AUTHORITY_FUNCTIONS,
  "grainline_seller_exact_map_consent_event_immutable()",
  "grainline_seller_exact_map_consent_revoke()",
].map((identity) => identity.slice(0, identity.indexOf("(")));
const SELLER_PROFILE_PUBLIC_CANDIDATE_FIRST_MIGRATION =
  "prisma/migrations/20261019010000_prepare_seller_profile_public_map_authority/migration.sql";
const SELLER_PROFILE_PUBLIC_VISIBILITY_MIRROR_MIGRATION =
  "prisma/migrations/20261020235989_prepare_seller_profile_public_visibility_mirrors/migration.sql";
const SELLER_PROFILE_PUBLIC_VISIBILITY_MIRROR_PRIVATE_FUNCTION_NAMES = [
  "grainline_listing_seller_public_state_bind",
  "grainline_seller_rating_listing_state_sync",
];
const CART_CART_ITEM_RLS_MIGRATION =
  "prisma/migrations/20261023080000_activate_cart_cart_item_rls/migration.sql";
const CART_CART_ITEM_RUNTIME_FUNCTION_NAMES = [
  "grainline_cart_item_admin_listing_cleanup",
  "grainline_cart_item_seller_listing_cleanup",
];
const STOCK_NOTIFICATION_PREPARATION_MIGRATION =
  "prisma/migrations/20261026010000_prepare_stock_notification_authorities/migration.sql";
const STOCK_NOTIFICATION_RLS_MIGRATION =
  "prisma/migrations/20261027040000_activate_stock_notification_rls/migration.sql";
const STOCK_NOTIFICATION_PREPARATION_FUNCTION_NAMES = [
  "grainline_stock_notification_owner_subscribe",
  "grainline_stock_notification_seller_counts",
  "grainline_stock_notification_seller_range_count",
  "grainline_stock_notification_restock_candidates",
  "grainline_stock_notification_seller_listing_cleanup",
  "grainline_stock_notification_admin_listing_cleanup",
  "grainline_stock_notification_block_cleanup",
  "grainline_stock_notification_owner_export",
];
const FAVORITE_PREPARATION_MIGRATION =
  "prisma/migrations/20261028010000_prepare_favorite_authorities/migration.sql";
const FAVORITE_PREPARATION_RUNTIME_FUNCTION_NAMES = [
  "grainline_favorite_owner_listing_ids",
  "grainline_favorite_owner_add",
  "grainline_favorite_owner_remove",
  "grainline_favorite_owner_delete_all",
  "grainline_favorite_owner_export",
  "grainline_favorite_seller_range_count",
  "grainline_favorite_seller_listing_cleanup",
  "grainline_favorite_admin_listing_cleanup",
];
const FAVORITE_PREPARATION_PRIVATE_FUNCTION_NAMES = [
  "grainline_favorite_count_maintain",
  "grainline_favorite_update_forbidden",
  "grainline_listing_favorite_count_guard",
];
const FAVORITE_PREPARATION_FUNCTION_NAMES = [
  ...FAVORITE_PREPARATION_RUNTIME_FUNCTION_NAMES,
  ...FAVORITE_PREPARATION_PRIVATE_FUNCTION_NAMES,
];
const FOLLOW_PREPARATION_MIGRATION =
  "prisma/migrations/20261028020000_prepare_follow_authorities/migration.sql";
const FOLLOW_PREPARATION_FUNCTION_NAMES = [
  "grainline_follow_public_state_batch",
  "grainline_follow_owner_target_ids",
  "grainline_follow_owner_outgoing_count",
  "grainline_follow_seller_owner_incoming_count",
  "grainline_follow_account_deletion_cleanup",
];
const EMAIL_DELIVERY_LEDGER_MIGRATION =
  "prisma/migrations/20261025010000_prepare_email_delivery_ledger/migration.sql";
const EMAIL_DELIVERY_LEDGER_PRIVATE_FUNCTION_NAMES = [
  "grainline_email_delivery_is_hard_suppressed",
  "grainline_email_outbox_claim_core",
  "grainline_email_outbox_effective_lane",
  "grainline_email_outbox_recipient_state",
  "grainline_email_outbox_safe_error",
];
const EMAIL_DELIVERY_LEDGER_RUNTIME_FUNCTION_NAMES = [
  "grainline_email_outbox_begin_provider_attempt",
  "grainline_email_outbox_claim_batch",
  "grainline_email_outbox_claim_one",
  "grainline_email_outbox_complete",
  "grainline_email_outbox_defer",
  "grainline_email_outbox_fail",
  "grainline_email_outbox_skip",
];
const EMAIL_DELIVERY_LEDGER_FUNCTION_NAMES = [
  ...EMAIL_DELIVERY_LEDGER_PRIVATE_FUNCTION_NAMES,
  ...EMAIL_DELIVERY_LEDGER_RUNTIME_FUNCTION_NAMES,
];
const EMAIL_PROVIDER_DELETION_FENCE_MIGRATION_PATH =
  "prisma/migrations/20261025020000_fence_email_provider_and_account_deletion/migration.sql";
const EMAIL_PROVIDER_DELETION_FENCE_SOURCE_NEW_FUNCTION_NAMES = [
  "grainline_email_outbox_account_deletion_fence",
  "grainline_email_outbox_enqueue_legacy",
  "grainline_email_outbox_lock_keys",
  "grainline_email_outbox_source_owner",
];
const EMAIL_PROVIDER_DELETION_FENCE_FUNCTION_NAMES = [
  ...EMAIL_PROVIDER_DELETION_FENCE_SOURCE_NEW_FUNCTION_NAMES,
  "grainline_email_outbox_begin_provider_attempt",
  "grainline_email_outbox_fail",
];
const EMAIL_PROVIDER_ELIGIBILITY_FENCE_MIGRATION_PATH =
  "prisma/migrations/20261025030000_fence_email_provider_and_eligibility_changes/migration.sql";
const EMAIL_PROVIDER_ELIGIBILITY_FENCE_SOURCE_NEW_FUNCTION_NAMES = [
  "grainline_email_hard_suppression_apply",
];

const {
  ALLOW_LOOPBACK_CI_FLAG,
  ORDER_ZERO_DIRECT_PRIVATE_STAFF_READ_STAGE,
  ORDER_USER_COMBINED_STAFF_READ_STAGE,
  REQUIRED_FUNCTION_PRIVILEGES,
  REQUIRE_DIRECT_URL_FLAG,
  REQUIRED_SEQUENCE_PRIVILEGES,
  REQUIRED_TABLE_PRIVILEGES,
  REQUIRED_TYPE_PRIVILEGES,
  CONVERSATION_MESSAGE_ACTIVATION_TABLE_PRIVILEGES,
  CASE_ACTIVATION_TABLES,
  NOTIFICATION_ACTIVATION_COLUMN_PRIVILEGES,
  NOTIFICATION_ACTIVATION_TABLE_PRIVILEGES,
  NOTIFICATION_RECIPIENT_RPC_FUNCTIONS,
  NOTIFICATION_SERVICE_RPC_FUNCTIONS,
  POLICYLESS_SERVICE_RLS_TABLES,
  RUNTIME_PRIVATE_FUNCTIONS,
  RUNTIME_PRIVATE_TABLES,
  SAVED_SEARCH_PHASE_A_TABLE_PRIVILEGES,
  SAVED_SEARCH_CATALOG_EVIDENCE_PREFIX,
  STAFF_READ_FUNCTION_IDENTITIES,
  MIGRATION_STAFF_READ_FUNCTION_IDENTITIES,
  MIGRATION_ORDER_STAFF_READ_FUNCTION_IDENTITIES,
  STAFF_READ_BOOTSTRAP_MARKER_PATTERN,
  STAFF_READ_STAGE_FLAG_PREFIX,
  CHECKOUT_STOCK_RESERVATION_TABLE,
  ACCOUNT_DELETION_SIDE_EFFECT_TABLE,
  ACCOUNT_DELETION_CLAIM_FENCE_PREPARATION_MIGRATION,
  ACCOUNT_DELETION_CLAIM_FENCE_PREPARATION_MIGRATION_SHA256,
  ACCOUNT_DELETION_MEDIA_KEY_PREPARATION_MIGRATION,
  ACCOUNT_DELETION_MEDIA_KEY_PREPARATION_MIGRATION_SHA256,
  ACCOUNT_DELETION_SIDE_EFFECT_ACTIVATION_MIGRATION,
  ACCOUNT_DELETION_SIDE_EFFECT_ACTIVATION_MIGRATION_SHA256,
  ACCOUNT_DELETION_SIDE_EFFECT_FORCE_MIGRATION,
  ACCOUNT_DELETION_SIDE_EFFECT_FORCE_MIGRATION_SHA256,
  CLERK_WEBHOOK_EVENT_TABLE,
  CLERK_WEBHOOK_EVENT_ACTIVATION_MIGRATION,
  CLERK_WEBHOOK_EVENT_ACTIVATION_MIGRATION_SHA256,
  CLERK_WEBHOOK_EVENT_FORCE_MIGRATION,
  CLERK_WEBHOOK_EVENT_FORCE_MIGRATION_SHA256,
  CORE_ORDER_TABLE,
  ORDER_ITEM_TABLE,
  ORDER_QUOTE_TABLE,
  ORDER_PAYMENT_EVENT_TABLE,
  SELLER_PROFILE_DEAUTHORIZE_COMPAT_MIGRATION,
  SELLER_PROFILE_DEAUTHORIZE_COMPAT_MIGRATION_SHA256,
  SELLER_PROFILE_RECONCILIATION_COMPAT_MIGRATION,
  SELLER_PROFILE_RECONCILIATION_COMPAT_MIGRATION_SHA256,
  SELLER_PROFILE_PRIVATE_PREPARATION_MIGRATION,
  SELLER_PROFILE_PRIVATE_PREPARATION_MIGRATION_SHA256,
  SELLER_PROFILE_PRIVATE_PREDECESSOR_RETIREMENT_MIGRATION,
  SELLER_PROFILE_PRIVATE_PREDECESSOR_RETIREMENT_MIGRATION_SHA256,
  SELLER_PROFILE_POST_RETIREMENT_REPAIR_MIGRATION,
  SELLER_PROFILE_POST_RETIREMENT_REPAIR_MIGRATION_SHA256,
  SELLER_PROFILE_PRIVATE_INVARIANTS_MIGRATION,
  SELLER_PROFILE_PRIVATE_INVARIANTS_MIGRATION_SHA256,
  SELLER_PROFILE_PUBLIC_PREPARATION_MIGRATION,
  SELLER_PROFILE_PUBLIC_PREPARATION_MIGRATION_SHA256,
  SELLER_PROFILE_PUBLIC_ENABLE_MIGRATION,
  SELLER_PROFILE_PUBLIC_ENABLE_MIGRATION_SHA256,
  SELLER_PROFILE_PUBLIC_FORCE_MIGRATION,
  SELLER_PROFILE_PUBLIC_FORCE_MIGRATION_SHA256,
  EMAIL_DELIVERY_LEDGER_PREPARATION_MIGRATION,
  EMAIL_DELIVERY_LEDGER_PREPARATION_MIGRATION_SHA256,
  EMAIL_PROVIDER_DELETION_FENCE_MIGRATION,
  EMAIL_PROVIDER_DELETION_FENCE_MIGRATION_SHA256,
  EMAIL_PROVIDER_ELIGIBILITY_FENCE_MIGRATION,
  EMAIL_PROVIDER_ELIGIBILITY_FENCE_MIGRATION_SHA256,
  EMAIL_DELIVERY_LEDGER_PREPARATION_FUNCTION_NAMES,
  EMAIL_PROVIDER_DELETION_FENCE_NEW_FUNCTION_NAMES,
  EMAIL_PROVIDER_ELIGIBILITY_FENCE_NEW_FUNCTION_NAMES,
  EMAIL_DELIVERY_PRIVATE_FUNCTION_NAMES,
  SELLER_PROFILE_TABLE,
  STRIPE_WEBHOOK_EVENT_TABLE,
  USER_TABLE,
  USER_EMAIL_ADDRESS_TABLE,
  SUPPORT_REQUEST_TABLE,
  FOLLOW_TABLE,
  SAVED_BLOG_POST_TABLE,
  SAVED_BLOG_POST_OWNER_TABLE_PRIVILEGES,
  CART_CART_ITEM_OWNER_TABLE_PRIVILEGES,
  CART_OWNER_COLUMN_PRIVILEGES,
  CART_ITEM_OWNER_COLUMN_PRIVILEGES,
  STOCK_NOTIFICATION_TABLE,
  STOCK_NOTIFICATION_OWNER_TABLE_PRIVILEGES,
  assertGrantAuditConnectionMatches,
  auditLiveDatabase,
  collectConversationMessageFunctionIssues,
  collectConversationPolicyIssues,
  collectMessagePolicyIssues,
  collectNotificationFunctionIssues,
  collectNotificationPolicyIssues,
  collectPolicylessServiceRlsIssues,
  collectPublicFunctionExecuteIssues,
  collectRestrictedRoleEffectiveFunctionIssues,
  collectStaffReadRoleMarkerIssues,
  collectRuntimeFunctionGrantOptionIssues,
  collectTablePrivilegeAllowlistIssues,
  caseRlsActivationExpected,
  caseRlsForceExpected,
  accountDeletionSideEffectRlsActivationExpected,
  accountDeletionSideEffectRlsForceExpected,
  accountDeletionClaimFencePreparationExpected,
  accountDeletionMediaKeyPreparationExpected,
  accountDeletionRuntimeExecuteExpected,
  collectAccountDeletionMigrationOrderIssues,
  collectAccountDeletionWorkerBoundaryIssues,
  collectClerkWebhookEventMigrationOrderIssues,
  collectEmailDeliveryMigrationOrderIssues,
  collectSellerProfilePrivateMigrationOrderIssues,
  collectSellerProfilePublicMigrationOrderIssues,
  clerkWebhookEventRlsActivationExpected,
  clerkWebhookEventRlsForceExpected,
  checkoutStockReservationRlsActivationExpected,
  checkoutStockReservationRlsForceExpected,
  coreOrderRlsActivationExpected,
  coreOrderRlsForceExpected,
  orderItemRlsActivationExpected,
  orderItemRlsForceExpected,
  orderQuoteRlsActivationExpected,
  orderQuoteRlsForceExpected,
  userEmailAddressRlsActivationExpected,
  userEmailAddressRlsForceExpected,
  userRlsActivationExpected,
  userRlsForceExpected,
  supportRequestRlsActivationExpected,
  supportRequestRlsForceExpected,
  followRlsActivationExpected,
  followRlsForceExpected,
  defaultPrivilegeRequirements,
  directUploadRlsActivationExpected,
  deriveGrantInventory,
  policylessServiceRlsTableNames,
  requiredRuntimeColumnPrivileges,
  requiredRuntimeTablePrivileges,
  runtimePrivateFunctionNames,
  staffReadFunctionIdentitiesForInventory,
  orderPaymentEventRlsActivationExpected,
  orderPaymentEventRlsForceExpected,
  sellerPayoutEventRlsActivationExpected,
  sellerProfileRlsActivationExpected,
  sellerProfileRlsForceExpected,
  stripeWebhookEventRlsActivationExpected,
  stripeWebhookEventRlsForceExpected,
  formatSavedSearchCatalogEvidence,
  normalizeSavedSearchCatalogState,
  parseGrantAuditDatabaseIdentity,
  readCheckoutStockReservationSourceCutoverState,
  readAccountDeletionClaimFencePreparationState,
  readAccountDeletionMediaKeyPreparationState,
  readAccountDeletionSideEffectActivationState,
  readAccountDeletionSideEffectForceState,
  readClerkWebhookEventActivationState,
  readClerkWebhookEventForceState,
  readEmailDeliveryLedgerPreparationState,
  readEmailProviderDeletionFenceState,
  readEmailProviderEligibilityFenceState,
  readSellerProfileDeauthorizeCompatState,
  readSellerProfilePrivatePreparationState,
  readSellerProfilePrivatePredecessorRetirementState,
  readSellerProfilePostRetirementRepairState,
  readSellerProfilePrivateInvariantsState,
  readSellerProfileReconciliationCompatState,
  readSellerProfilePublicPreparationState,
  readSellerProfilePublicEnableState,
  readSellerProfilePublicForceState,
  readSavedSearchCatalogState,
  resolveGrantAuditConnection,
  resolveStaffReadAuditStage,
  resolveTemporarilyAbsentCiTables,
  withAppliedAccountDeletionAuthority,
  withAppliedEmailDeliveryAuthority,
  withAppliedSellerProfileCallerAuthority,
  withAppliedSellerProfilePrivateInvariants,
  withAppliedSellerProfilePredecessorRetirement,
} = await import("../scripts/audit-runtime-db-grants.mjs");

describe("temporary SellerProfile CI isolation", () => {
  it("is absent by default and accepted only for exact loopback GitHub CI", () => {
    const sellerProfilePublicIsolationSupported = source(
      "scripts/audit-runtime-db-grants.mjs",
    ).includes("SELLER_PROFILE_PUBLIC_CANDIDATE_ISOLATED");
    assert.deepEqual(resolveTemporarilyAbsentCiTables({}), []);
    assert.deepEqual(resolveTemporarilyAbsentCiTables({
      SELLER_PROFILE_PRIVATE_BOUNDARY_MIGRATION_ISOLATED: "",
    }), []);
    assert.deepEqual(
      resolveTemporarilyAbsentCiTables({
        GITHUB_ACTIONS: "true",
        SELLER_PROFILE_PRIVATE_BOUNDARY_MIGRATION_ISOLATED: "true",
      }, {allowLoopbackCi: true}),
      ["SellerProfilePrivate"],
    );
    assert.deepEqual(
      resolveTemporarilyAbsentCiTables({
        GITHUB_ACTIONS: "true",
        SELLER_PROFILE_PRIVATE_BOUNDARY_MIGRATION_ISOLATED: "true",
        SELLER_PROFILE_PUBLIC_CANDIDATE_ISOLATED: "true",
      }, {allowLoopbackCi: true}),
      [
        "SellerProfilePrivate",
        ...(sellerProfilePublicIsolationSupported
          ? ["SellerExactMapConsentEvent"]
          : []),
      ],
    );
    const invalidIsolationInputs = [
      [{GITHUB_ACTIONS: "true", SELLER_PROFILE_PRIVATE_BOUNDARY_MIGRATION_ISOLATED: "yes"}, {allowLoopbackCi: true}],
      [{GITHUB_ACTIONS: "true", SELLER_PROFILE_PRIVATE_BOUNDARY_MIGRATION_ISOLATED: "true"}, {allowLoopbackCi: false}],
      [{SELLER_PROFILE_PRIVATE_BOUNDARY_MIGRATION_ISOLATED: "true"}, {allowLoopbackCi: true}],
      ...(sellerProfilePublicIsolationSupported
        ? [
            [{GITHUB_ACTIONS: "true", SELLER_PROFILE_PUBLIC_CANDIDATE_ISOLATED: "yes"}, {allowLoopbackCi: true}],
            [{GITHUB_ACTIONS: "true", SELLER_PROFILE_PUBLIC_CANDIDATE_ISOLATED: "true"}, {allowLoopbackCi: false}],
            [{SELLER_PROFILE_PUBLIC_CANDIDATE_ISOLATED: "true"}, {allowLoopbackCi: true}],
          ]
        : []),
    ];
    for (const [env, options] of invalidIsolationInputs) {
      assert.throws(() => resolveTemporarilyAbsentCiTables(env, options));
    }
  });
});

const { Client } = pg;

function source(path) {
  return readFileSync(path, "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function provisionedObjects(provision, objectKind) {
  const match = provision.match(new RegExp(`GRANT[\\s\\S]*?ON ${objectKind}\\s+([\\s\\S]*?)\\nTO :"runtime_role";`));
  assert.ok(match, `missing ${objectKind} grant block`);
  return [...match[1].matchAll(/public\."([^"]+)"/g)]
    .map((objectMatch) => objectMatch[1])
    .sort((a, b) => a.localeCompare(b));
}

function auditIntegrationSkipReason() {
  if (process.env.GITHUB_ACTIONS !== "true") return "requires the GitHub Actions Postgres service";
  if (!process.env.DATABASE_URL) return "requires DATABASE_URL";
  return false;
}

function assertSafeIdentifier(value) {
  assert.match(value, /^[A-Za-z_][A-Za-z0-9_]*$/);
  return `"${value}"`;
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function databaseUrl(databaseName, role, password) {
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${databaseName}`;
  if (role) url.username = role;
  if (password) url.password = password;
  return url.toString();
}

async function withClient(connectionString, fn) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function withAuditFixture(options, fn) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const databaseName = `grainline_audit_${suffix}`;
  const migrationRole = `grainline_mig_${suffix}`;
  const runtimeRole = `grainline_run_${suffix}`;
  const parentRole = `grainline_parent_${suffix}`;
  const tableName = options.tableName ?? `grant_audit_table_${suffix}`;
  const policyName = `grant_audit_policy_${suffix}`;
  const untrackedTableName = `grant_audit_untracked_${suffix}`;
  const enumName = `grant_audit_enum_${suffix}`;
  const functionName = `grainline_audit_fn_${suffix}`;
  const nonPublicSchemaName = `grant_audit_schema_${suffix}`;
  const migrationPassword = `mig_${suffix}_pw`;
  const runtimePassword = `run_${suffix}_pw`;
  const adminUrl = process.env.DATABASE_URL;

  async function cleanup() {
    await withClient(adminUrl, async (admin) => {
      await admin.query(`REVOKE ${assertSafeIdentifier(parentRole)} FROM ${assertSafeIdentifier(runtimeRole)}`)
        .catch(() => {});
      await admin.query(`DROP DATABASE IF EXISTS ${assertSafeIdentifier(databaseName)} WITH (FORCE)`);
      for (const role of [parentRole, runtimeRole, migrationRole]) {
        await admin.query(`DROP ROLE IF EXISTS ${assertSafeIdentifier(role)}`).catch(() => {});
      }
    });
  }

  await cleanup();

  await withClient(adminUrl, async (admin) => {
    await admin.query(`CREATE ROLE ${assertSafeIdentifier(migrationRole)} LOGIN PASSWORD ${sqlLiteral(migrationPassword)}`);
    const runtimeRoleAttributes = options.runtimeRoleAttributes ?? "LOGIN NOINHERIT";
    await admin.query(`CREATE ROLE ${assertSafeIdentifier(runtimeRole)} ${runtimeRoleAttributes} PASSWORD ${sqlLiteral(runtimePassword)}`);
    if (options.createParentRole) {
      await admin.query(`CREATE ROLE ${assertSafeIdentifier(parentRole)} NOLOGIN`);
      await admin.query(`GRANT ${assertSafeIdentifier(parentRole)} TO ${assertSafeIdentifier(runtimeRole)}`);
    }
    await admin.query(`CREATE DATABASE ${assertSafeIdentifier(databaseName)} OWNER ${assertSafeIdentifier(migrationRole)}`);
  });

  const migrationUrl = databaseUrl(databaseName, migrationRole, migrationPassword);
  const adminDatabaseUrl = databaseUrl(databaseName);
  const inventory = {
    tables: [tableName],
    enums: [enumName],
    functions: [functionName],
    extensions: options.createPgTrgmExtension || options.createPgTrgmExtensionAsAdmin || options.requirePgTrgmExtension
      ? ["pg_trgm"]
      : [],
    fixedIntSingletonIds: [],
    autoincrementFields: [],
    sequenceSqlReferences: [],
    publicRevokes: [],
    publicDefaultPrivilegeRevokes: [],
    rlsPolicyTables:
      options.createRlsPolicy && options.trackRlsPolicy !== false ? [tableName] : [],
    rlsEnableTables: options.enableRls ? [tableName] : [],
    rlsForceTables:
      options.createRlsPolicy && options.expectForce !== false ? [tableName] : [],
  };

  try {
    if (options.createPgTrgmExtensionAsAdmin) {
      await withClient(adminDatabaseUrl, async (adminDb) => {
        await adminDb.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
        if (options.revokeAdminPgTrgmPublicExecute) {
          await adminDb.query("REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC");
        }
      });
    }

    await withClient(migrationUrl, async (migrationClient) => {
      await migrationClient.query(`CREATE TYPE ${assertSafeIdentifier(enumName)} AS ENUM ('active')`);
      await migrationClient.query(
        `CREATE TABLE ${assertSafeIdentifier(tableName)} (id text PRIMARY KEY, status ${assertSafeIdentifier(enumName)} NOT NULL)`,
      );
      await migrationClient.query(
        `CREATE OR REPLACE FUNCTION ${assertSafeIdentifier(functionName)}() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$`,
      );
      if (!options.grantPublicFunctionExecute) {
        await migrationClient.query(
          `REVOKE EXECUTE ON FUNCTION ${assertSafeIdentifier(functionName)}() FROM PUBLIC`,
        );
      }
      if (options.createRlsPolicy) {
        await migrationClient.query(
          `CREATE POLICY ${assertSafeIdentifier(policyName)}
             ON ${assertSafeIdentifier(tableName)}
            FOR SELECT
          USING (id = current_setting('app.user_id', true))`,
        );
      }
      if (options.enableRls) {
        await migrationClient.query(`ALTER TABLE ${assertSafeIdentifier(tableName)} ENABLE ROW LEVEL SECURITY`);
      }
      if (options.forceRls) {
        await migrationClient.query(`ALTER TABLE ${assertSafeIdentifier(tableName)} FORCE ROW LEVEL SECURITY`);
      }
      await migrationClient.query(`GRANT USAGE ON SCHEMA public TO ${assertSafeIdentifier(runtimeRole)}`);
      if (options.grantTablePrivileges !== false) {
        await migrationClient.query(
          `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${assertSafeIdentifier(tableName)} TO ${assertSafeIdentifier(runtimeRole)}`,
        );
      }
      if (options.grantPublicTablePrivileges) {
        await migrationClient.query(
          `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${assertSafeIdentifier(tableName)} TO PUBLIC`,
        );
      }
      if (options.grantUnexpectedTablePrivileges) {
        await migrationClient.query(
          `GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE ${assertSafeIdentifier(tableName)} TO ${assertSafeIdentifier(runtimeRole)}`,
        );
      }
      if (options.grantTableGrantOption) {
        await migrationClient.query(
          `GRANT SELECT ON TABLE ${assertSafeIdentifier(tableName)} TO ${assertSafeIdentifier(runtimeRole)} WITH GRANT OPTION`,
        );
      }
      if (options.grantColumnPrivilege) {
        await migrationClient.query(
          `GRANT REFERENCES (id) ON TABLE ${assertSafeIdentifier(tableName)} TO ${assertSafeIdentifier(runtimeRole)}`,
        );
      }
      if (options.grantPublicColumnPrivilege) {
        await migrationClient.query(
          `GRANT REFERENCES (id) ON TABLE ${assertSafeIdentifier(tableName)} TO PUBLIC`,
        );
      }
      await migrationClient.query(`GRANT USAGE ON TYPE ${assertSafeIdentifier(enumName)} TO ${assertSafeIdentifier(runtimeRole)}`);
      await migrationClient.query(`GRANT EXECUTE ON FUNCTION ${assertSafeIdentifier(functionName)}() TO ${assertSafeIdentifier(runtimeRole)}`);
      if (options.createPgTrgmExtension) {
        await migrationClient.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
      }
      if (options.grantUntrackedTableSelect) {
        await migrationClient.query(`CREATE TABLE ${assertSafeIdentifier(untrackedTableName)} (id text PRIMARY KEY)`);
        await migrationClient.query(`GRANT SELECT ON TABLE ${assertSafeIdentifier(untrackedTableName)} TO ${assertSafeIdentifier(runtimeRole)}`);
      }
      if (options.defaultPrivileges !== false) {
        await migrationClient.query(
          `ALTER DEFAULT PRIVILEGES FOR ROLE ${assertSafeIdentifier(migrationRole)} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${assertSafeIdentifier(runtimeRole)}`,
        );
        await migrationClient.query(
          `ALTER DEFAULT PRIVILEGES FOR ROLE ${assertSafeIdentifier(migrationRole)} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${assertSafeIdentifier(runtimeRole)}`,
        );
      }
      if (options.grantUnexpectedDefaultTablePrivileges) {
        await migrationClient.query(
          `ALTER DEFAULT PRIVILEGES FOR ROLE ${assertSafeIdentifier(migrationRole)} IN SCHEMA public GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLES TO ${assertSafeIdentifier(runtimeRole)}`,
        );
      }
      if (options.grantDefaultTableGrantOption) {
        await migrationClient.query(
          `ALTER DEFAULT PRIVILEGES FOR ROLE ${assertSafeIdentifier(migrationRole)} IN SCHEMA public GRANT SELECT ON TABLES TO ${assertSafeIdentifier(runtimeRole)} WITH GRANT OPTION`,
        );
      }
      if (options.grantPublicDefaultTablePrivilege) {
        await migrationClient.query(
          `ALTER DEFAULT PRIVILEGES FOR ROLE ${assertSafeIdentifier(migrationRole)} IN SCHEMA public GRANT SELECT ON TABLES TO PUBLIC`,
        );
      }
      if (options.grantGlobalDefaultTablePrivilege) {
        await migrationClient.query(
          `ALTER DEFAULT PRIVILEGES FOR ROLE ${assertSafeIdentifier(migrationRole)} GRANT SELECT ON TABLES TO ${assertSafeIdentifier(runtimeRole)}`,
        );
      }
      if (options.grantDatabaseCreate) {
        await migrationClient.query(`GRANT CREATE ON DATABASE ${assertSafeIdentifier(databaseName)} TO ${assertSafeIdentifier(runtimeRole)}`);
      }
      if (options.grantNonPublicSchemaCreate) {
        await migrationClient.query(`CREATE SCHEMA ${assertSafeIdentifier(nonPublicSchemaName)}`);
        await migrationClient.query(`GRANT CREATE ON SCHEMA ${assertSafeIdentifier(nonPublicSchemaName)} TO ${assertSafeIdentifier(runtimeRole)}`);
      }
    });

    if (options.runtimeOwnsTable) {
      await withClient(adminDatabaseUrl, async (adminDb) => {
        await adminDb.query(`ALTER TABLE ${assertSafeIdentifier(tableName)} OWNER TO ${assertSafeIdentifier(runtimeRole)}`);
      });
    }

    await withClient(options.auditAsAdmin ? adminDatabaseUrl : migrationUrl, async (auditClient) => {
      await fn({
        auditClient,
        databaseName,
        inventory,
        migrationRole,
        nonPublicSchemaName,
        policyName,
        runtimeRole,
        tableName,
        untrackedTableName,
      });
    });
  } finally {
    await cleanup();
  }
}

describe("database grant inventory guardrails", () => {
  it("rejects every table privilege outside non-grantable CRUD", () => {
    assert.match(
      collectTablePrivilegeAllowlistIssues({}, "table SavedSearch").join("\n"),
      /exact runtime-role table privilege state could not be read/,
    );
    assert.deepEqual(
      collectTablePrivilegeAllowlistIssues(
        {
          public_column_grant_option_privileges: [],
          public_column_privileges: [],
          public_grant_option_privileges: [],
          public_privileges: [],
          runtime_column_grant_option_privileges: [],
          runtime_column_privileges: [],
          runtime_grant_option_privileges: [],
          runtime_privileges: ["SELECT", "INSERT", "UPDATE", "DELETE"],
        },
        "table SavedSearch",
      ),
      [],
    );
    assert.deepEqual(
      collectTablePrivilegeAllowlistIssues(
        {
          public_column_grant_option_privileges: ["id:REFERENCES"],
          public_column_privileges: ["id:REFERENCES"],
          public_grant_option_privileges: ["SELECT"],
          public_privileges: ["SELECT"],
          runtime_column_grant_option_privileges: ["id:REFERENCES"],
          runtime_column_privileges: ["id:REFERENCES"],
          runtime_grant_option_privileges: ["SELECT"],
          runtime_privileges: ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "MAINTAIN"],
        },
        "table SavedSearch",
      ),
      [
        "table SavedSearch runtime role has unexpected table privileges: MAINTAIN, TRUNCATE",
        "table SavedSearch runtime role has grant options: SELECT",
        "table SavedSearch grants table privileges to PUBLIC: SELECT",
        "table SavedSearch grants table privileges with grant option to PUBLIC: SELECT",
        "table SavedSearch runtime role has unexpected column privileges: id:REFERENCES",
        "table SavedSearch runtime role has column grant options: id:REFERENCES",
        "table SavedSearch PUBLIC has column privileges: id:REFERENCES",
        "table SavedSearch PUBLIC has column grant options: id:REFERENCES",
      ],
    );
    assert.deepEqual(
      collectTablePrivilegeAllowlistIssues(
        {
          public_column_grant_option_privileges: [],
          public_column_privileges: [],
          public_grant_option_privileges: [],
          public_privileges: ["SELECT", "INSERT", "UPDATE", "DELETE"],
          runtime_column_grant_option_privileges: [],
          runtime_column_privileges: [],
          runtime_grant_option_privileges: [],
          runtime_privileges: [],
        },
        "table SavedSearch",
      ),
      [
        "table SavedSearch runtime role is missing direct table privileges: SELECT, INSERT, UPDATE, DELETE",
        "table SavedSearch grants table privileges to PUBLIC: DELETE, INSERT, SELECT, UPDATE",
      ],
      "PUBLIC CRUD must not satisfy the runtime role's exact direct-grant contract",
    );
    assert.deepEqual(
      collectTablePrivilegeAllowlistIssues(
        {
          public_grant_option_privileges: [],
          public_privileges: [],
          runtime_grant_option_privileges: [],
          runtime_privileges: ["SELECT", "INSERT", "UPDATE", "DELETE"],
        },
        "default table privileges",
        { checkColumnPrivileges: false },
      ),
      [],
    );
  });

  it("derives exact activated table and column grants by RLS state", () => {
    const releaseZeroInventory = { rlsPolicyTables: [] };
    const phaseAInventory = { rlsPolicyTables: ["SavedSearch"] };
    const notificationInventory = { rlsPolicyTables: ["SavedSearch", "Notification"] };
    const conversationMessageInventory = {
      rlsPolicyTables: ["SavedSearch", "Notification", "Conversation", "Message"],
    };
    const directUploadActivationInventory = {
      rlsForceTables: ["DirectUpload", "DirectUploadReference"],
      rlsPolicyTables: [],
    };
    const caseActivationInventory = {
      rlsEnableTables: ["Case", "CaseMessage", "CaseMessageAttachment"],
      rlsForceTables: ["DirectUpload", "DirectUploadReference"],
      rlsPolicyTables: [],
    };
    const orderPaymentEventActivationInventory = {
      tables: [ORDER_PAYMENT_EVENT_TABLE],
      rlsEnableTables: [ORDER_PAYMENT_EVENT_TABLE],
      rlsForceTables: [],
      rlsPolicyTables: [],
    };
    const sellerProfilePredecessorInventory = {
      tables: [SELLER_PROFILE_TABLE],
      rlsEnableTables: [SELLER_PROFILE_TABLE],
      rlsForceTables: [],
      rlsPolicyTables: [],
      sellerProfileRlsActivationApplied: false,
    };
    const sellerProfileEnabledInventory = {
      ...sellerProfilePredecessorInventory,
      sellerProfileRlsActivationApplied: true,
    };
    const sellerProfileForcedInventory = {
      ...sellerProfileEnabledInventory,
      sellerProfileRlsForceApplied: true,
    };
    const supportRequestPredecessorInventory = {
      tables: ["SupportRequest"],
      rlsEnableTables: [],
      rlsForceTables: [],
      rlsPolicyTables: [],
    };
    const supportRequestEnabledInventory = {
      ...supportRequestPredecessorInventory,
      rlsEnableTables: ["SupportRequest"],
    };
    const followPredecessorInventory = {
      tables: [FOLLOW_TABLE],
      rlsEnableTables: [],
      rlsForceTables: [],
      rlsPolicyTables: [],
    };
    const followActivatedInventory = {
      ...followPredecessorInventory,
      rlsEnableTables: [FOLLOW_TABLE],
      rlsForceTables: [FOLLOW_TABLE],
    };
    const savedBlogPostPredecessorInventory = {
      rlsPolicyTables: [],
      savedBlogPostOwnerPrivilegesProvisioned: false,
    };
    const savedBlogPostProvisionedInventory = {
      ...savedBlogPostPredecessorInventory,
      savedBlogPostOwnerPrivilegesProvisioned: true,
    };
    const savedBlogPostActivatedInventory = {
      ...savedBlogPostPredecessorInventory,
      rlsPolicyTables: [SAVED_BLOG_POST_TABLE],
    };
    const cartCartItemRlsActivationPresent = existsSync(
      CART_CART_ITEM_RLS_MIGRATION,
    );
    const cartPredecessorInventory = {
      rlsPolicyTables: [],
    };
    const cartActivatedInventory = {
      rlsPolicyTables: ["Cart", "CartItem"],
    };
    const stockNotificationPredecessorInventory = {
      rlsPolicyTables: [],
    };
    const stockNotificationActivatedInventory = {
      rlsPolicyTables: [STOCK_NOTIFICATION_TABLE],
    };
    const stockNotificationRlsActivationPresent = existsSync(
      STOCK_NOTIFICATION_RLS_MIGRATION,
    );
    assert.deepEqual(
      requiredRuntimeTablePrivileges("SavedSearch", releaseZeroInventory),
      REQUIRED_TABLE_PRIVILEGES,
    );
    assert.deepEqual(
      requiredRuntimeTablePrivileges("SavedSearch", phaseAInventory),
      SAVED_SEARCH_PHASE_A_TABLE_PRIVILEGES,
    );
    assert.deepEqual(
      requiredRuntimeTablePrivileges("User", phaseAInventory),
      REQUIRED_TABLE_PRIVILEGES,
    );
    if (
      SAVED_BLOG_POST_TABLE === "SavedBlogPost"
      && Array.isArray(SAVED_BLOG_POST_OWNER_TABLE_PRIVILEGES)
    ) {
      assert.deepEqual(
        requiredRuntimeTablePrivileges(
          SAVED_BLOG_POST_TABLE,
          savedBlogPostPredecessorInventory,
        ),
        REQUIRED_TABLE_PRIVILEGES,
      );
      assert.deepEqual(
        requiredRuntimeTablePrivileges(
          SAVED_BLOG_POST_TABLE,
          savedBlogPostProvisionedInventory,
        ),
        SAVED_BLOG_POST_OWNER_TABLE_PRIVILEGES,
      );
      assert.deepEqual(
        requiredRuntimeTablePrivileges(
          SAVED_BLOG_POST_TABLE,
          savedBlogPostActivatedInventory,
        ),
        SAVED_BLOG_POST_OWNER_TABLE_PRIVILEGES,
      );
    }
    assert.deepEqual(
      requiredRuntimeTablePrivileges("DirectUploadReference", phaseAInventory),
      [],
    );
    const sellerExactMapConsentEventAudited = source(
      "scripts/audit-runtime-db-grants.mjs",
    ).includes('"SellerExactMapConsentEvent"');
    assert.deepEqual(RUNTIME_PRIVATE_TABLES, [
      "CaseResolutionClaim",
      "CaseStripeDisputeApplication",
      "CaseSellerRefundApplication",
      "CaseOpenApplication",
      "DirectUploadReference",
      "OrderDisputeRecovery",
      "OrderRefundReconciliation",
      "OrderStaffCapability",
      "SellerDeauthorizationApplication",
      ...(sellerExactMapConsentEventAudited
        ? ["SellerExactMapConsentEvent"]
        : []),
      "SellerProfilePrivate",
    ]);
    assert.deepEqual(POLICYLESS_SERVICE_RLS_TABLES, [
      "CaseResolutionClaim",
      "CaseStripeDisputeApplication",
      "CaseSellerRefundApplication",
      "CaseOpenApplication",
      "DirectUploadReference",
      "OrderDisputeRecovery",
      "OrderRefundReconciliation",
      "OrderStaffCapability",
      "SellerDeauthorizationApplication",
    ]);
    if (typeof sellerProfileRlsActivationExpected === "function") {
      assert.equal(
        sellerProfileRlsActivationExpected(sellerProfilePredecessorInventory),
        false,
      );
      assert.deepEqual(
        requiredRuntimeTablePrivileges(
          SELLER_PROFILE_TABLE,
          sellerProfilePredecessorInventory,
        ),
        REQUIRED_TABLE_PRIVILEGES,
      );
      assert.equal(
        policylessServiceRlsTableNames(
          sellerProfilePredecessorInventory,
        ).includes(SELLER_PROFILE_TABLE),
        false,
      );
      assert.equal(
        sellerProfileRlsActivationExpected(sellerProfileEnabledInventory),
        true,
      );
      assert.equal(
        sellerProfileRlsForceExpected(sellerProfileEnabledInventory),
        false,
      );
      assert.equal(
        sellerProfileRlsForceExpected(sellerProfileForcedInventory),
        true,
      );
      assert.deepEqual(
        requiredRuntimeTablePrivileges(
          SELLER_PROFILE_TABLE,
          sellerProfileEnabledInventory,
        ),
        [],
      );
      assert.equal(
        policylessServiceRlsTableNames(
          sellerProfileEnabledInventory,
        ).includes(SELLER_PROFILE_TABLE),
        true,
      );
    } else {
      assert.equal(sellerProfileRlsActivationExpected, undefined);
      assert.equal(sellerProfileRlsForceExpected, undefined);
    }
    if (typeof supportRequestRlsActivationExpected === "function") {
      assert.equal(
        supportRequestRlsActivationExpected(
          supportRequestPredecessorInventory,
        ),
        false,
      );
      assert.deepEqual(
        requiredRuntimeTablePrivileges(
          "SupportRequest",
          supportRequestPredecessorInventory,
        ),
        REQUIRED_TABLE_PRIVILEGES,
      );
      assert.equal(
        supportRequestRlsActivationExpected(supportRequestEnabledInventory),
        true,
      );
      assert.equal(
        supportRequestRlsForceExpected(supportRequestEnabledInventory),
        false,
      );
      assert.deepEqual(
        requiredRuntimeTablePrivileges(
          "SupportRequest",
          supportRequestEnabledInventory,
        ),
        [],
      );
      assert.deepEqual(collectPolicylessServiceRlsIssues([{
        table_name: "SupportRequest",
        rls_enabled: true,
        rls_forced: false,
        policy_count: 0,
      }], supportRequestEnabledInventory), []);
    } else {
      assert.equal(supportRequestRlsForceExpected, undefined);
    }
    if (typeof followRlsActivationExpected === "function") {
      assert.equal(followRlsActivationExpected(followPredecessorInventory), false);
      assert.equal(followRlsForceExpected(followPredecessorInventory), false);
      assert.deepEqual(
        requiredRuntimeTablePrivileges(FOLLOW_TABLE, followPredecessorInventory),
        REQUIRED_TABLE_PRIVILEGES,
      );
      assert.equal(followRlsActivationExpected(followActivatedInventory), true);
      assert.equal(followRlsForceExpected(followActivatedInventory), true);
      assert.deepEqual(
        requiredRuntimeTablePrivileges(FOLLOW_TABLE, followActivatedInventory),
        [],
      );
      assert.equal(
        policylessServiceRlsTableNames(followActivatedInventory).includes(
          FOLLOW_TABLE,
        ),
        true,
      );
      assert.deepEqual(collectPolicylessServiceRlsIssues([{
        table_name: FOLLOW_TABLE,
        rls_enabled: true,
        rls_forced: true,
        policy_count: 0,
      }], followActivatedInventory), []);
      assert.deepEqual(collectPolicylessServiceRlsIssues([{
        table_name: FOLLOW_TABLE,
        rls_enabled: true,
        rls_forced: false,
        policy_count: 0,
      }], followActivatedInventory), [
        "service-only table Follow must have FORCE ROW LEVEL SECURITY enabled",
      ]);
    } else {
      assert.equal(followRlsForceExpected, undefined);
    }
    assert.deepEqual(collectPolicylessServiceRlsIssues([{
      table_name: SELLER_PROFILE_TABLE,
      rls_enabled: true,
      rls_forced: false,
      policy_count: 0,
    }], sellerProfileEnabledInventory), []);
    assert.equal(
      directUploadRlsActivationExpected(directUploadActivationInventory),
      true,
    );
    assert.deepEqual(CASE_ACTIVATION_TABLES, [
      "Case",
      "CaseMessage",
      "CaseMessageAttachment",
    ]);
    assert.equal(caseRlsActivationExpected(caseActivationInventory), true);
    assert.equal(
      orderPaymentEventRlsActivationExpected(
        orderPaymentEventActivationInventory,
      ),
      true,
    );
    assert.equal(
      orderPaymentEventRlsForceExpected(
        orderPaymentEventActivationInventory,
      ),
      false,
    );
    const orderPaymentEventForceInventory = {
      ...orderPaymentEventActivationInventory,
      rlsForceTables: [ORDER_PAYMENT_EVENT_TABLE],
    };
    assert.equal(
      orderPaymentEventRlsForceExpected(orderPaymentEventForceInventory),
      true,
    );
    assert.equal(
      orderPaymentEventRlsForceExpected({
        rlsEnableTables: [],
        rlsForceTables: [ORDER_PAYMENT_EVENT_TABLE],
        rlsPolicyTables: [],
      }),
      false,
    );
    assert.deepEqual(
      collectPolicylessServiceRlsIssues(
        [{
          table_name: ORDER_PAYMENT_EVENT_TABLE,
          rls_enabled: true,
          rls_forced: true,
          policy_count: 0,
        }],
        orderPaymentEventForceInventory,
      ),
      [],
    );
    assert.deepEqual(
      collectPolicylessServiceRlsIssues(
        [{
          table_name: ORDER_PAYMENT_EVENT_TABLE,
          rls_enabled: true,
          rls_forced: false,
          policy_count: 0,
        }],
        orderPaymentEventForceInventory,
      ),
      [
        "service-only table OrderPaymentEvent must have FORCE ROW LEVEL SECURITY enabled",
      ],
    );
    assert.deepEqual(
      collectPolicylessServiceRlsIssues(
        [{
          table_name: ORDER_PAYMENT_EVENT_TABLE,
          rls_enabled: true,
          rls_forced: true,
          policy_count: 0,
        }],
        orderPaymentEventActivationInventory,
      ),
      [
        "service-only table OrderPaymentEvent must keep FORCE ROW LEVEL SECURITY disabled for this release",
      ],
    );
    assert.deepEqual(
      requiredRuntimeTablePrivileges(
        ORDER_PAYMENT_EVENT_TABLE,
        orderPaymentEventActivationInventory,
      ),
      [],
    );
    const orderPaymentEventPrivateFunctions = runtimePrivateFunctionNames(
      orderPaymentEventActivationInventory,
    );
    assert.equal(
      orderPaymentEventPrivateFunctions.includes(
        "grainline_blocked_checkout_refund_claim",
      ),
      true,
    );
    assert.equal(
      orderPaymentEventPrivateFunctions.includes(
        "grainline_case_seller_refund_apply",
      ),
      true,
    );
    assert.equal(caseRlsForceExpected(caseActivationInventory), false);
    const caseForceInventory = {
      ...caseActivationInventory,
      rlsForceTables: [
        "Case",
        "CaseMessage",
        "CaseMessageAttachment",
        "DirectUpload",
        "DirectUploadReference",
      ],
    };
    assert.equal(caseRlsActivationExpected(caseForceInventory), true);
    assert.equal(caseRlsForceExpected(caseForceInventory), true);
    assert.equal(
      caseRlsActivationExpected({
        ...caseActivationInventory,
        rlsForceTables: [
          "Case",
          "DirectUpload",
          "DirectUploadReference",
        ],
      }),
      false,
    );
    assert.deepEqual(
      policylessServiceRlsTableNames(directUploadActivationInventory),
      [
        "CaseResolutionClaim",
        "CaseStripeDisputeApplication",
        "CaseSellerRefundApplication",
        "CaseOpenApplication",
      "DirectUploadReference",
      "OrderDisputeRecovery",
      "OrderRefundReconciliation",
      "OrderStaffCapability",
      "SellerDeauthorizationApplication",
      "DirectUpload",
      ],
    );
    assert.deepEqual(
      policylessServiceRlsTableNames(caseActivationInventory),
      [
        "CaseResolutionClaim",
        "CaseStripeDisputeApplication",
        "CaseSellerRefundApplication",
        "CaseOpenApplication",
      "DirectUploadReference",
      "OrderDisputeRecovery",
      "OrderRefundReconciliation",
      "OrderStaffCapability",
      "SellerDeauthorizationApplication",
      "DirectUpload",
        "Case",
        "CaseMessage",
        "CaseMessageAttachment",
      ],
    );
    const activatedPrivateFunctions = runtimePrivateFunctionNames(
      directUploadActivationInventory,
    );
    assert.equal(
      activatedPrivateFunctions.includes(
        "grainline_direct_upload_record_private_message",
      ),
      true,
    );
    for (const cleanupFunction of [
      "grainline_direct_upload_cleanup_lease",
      "grainline_direct_upload_cleanup_complete",
      "grainline_direct_upload_cleanup_fail",
    ]) {
      assert.equal(activatedPrivateFunctions.includes(cleanupFunction), true);
    }
    assert.deepEqual(
      runtimePrivateFunctionNames({
        rlsForceTables: ["DirectUploadReference"],
        rlsPolicyTables: [],
      }),
      [...RUNTIME_PRIVATE_FUNCTIONS],
    );
    for (const functionName of CASE_INVARIANT_PRIVATE_FUNCTION_NAMES) {
      assert.equal(
        RUNTIME_PRIVATE_FUNCTIONS.includes(functionName),
        true,
        `${functionName} must remain classified as runtime-private`,
      );
    }
    for (const functionName of [
      "grainline_order_item_seller_key_bind",
      "grainline_order_item_seller_key_complete",
      "grainline_order_seller_key_assert",
      "grainline_order_seller_key_complete",
      "grainline_seller_owner_public_state_bind",
      "grainline_user_public_seller_state_sync",
      ...ORDER_PAYMENT_EVENT_INVARIANT_FUNCTIONS,
      ...ORDER_PARTICIPANT_RUNTIME_PRIVATE_FUNCTION_NAMES,
      ...ORDER_LABEL_PRIVATE_FUNCTION_NAMES,
      "grainline_checkout_reservation_listing_snapshot_witness",
      "grainline_order_refund_blocks_fulfillment",
      "grainline_seller_deauthorization_application_immutable",
      ...(Object.prototype.hasOwnProperty.call(
        deriveGrantInventory(),
        "savedBlogPostOwnerPrivilegesProvisioned",
      ) ? ["grainline_saved_blog_post_insert_guard"] : []),
      "grainline_order_staff_detail_v2",
      "grainline_order_staff_page_v2",
    ]) {
      assert.equal(
        RUNTIME_PRIVATE_FUNCTIONS.includes(functionName),
        true,
        `${functionName} must remain classified as runtime-private`,
      );
    }
    assert.deepEqual(
      requiredRuntimeTablePrivileges(
        "DirectUpload",
        directUploadActivationInventory,
      ),
      [],
    );
    assert.deepEqual(
      requiredRuntimeTablePrivileges(
        "DirectUpload",
        { rlsForceTables: ["DirectUploadReference"], rlsPolicyTables: [] },
      ),
      REQUIRED_TABLE_PRIVILEGES,
    );
    for (const tableName of CASE_ACTIVATION_TABLES) {
      assert.deepEqual(
        requiredRuntimeTablePrivileges(tableName, caseActivationInventory),
        [],
      );
      assert.deepEqual(
        requiredRuntimeTablePrivileges(tableName, directUploadActivationInventory),
        REQUIRED_TABLE_PRIVILEGES,
      );
    }
    assert.deepEqual(
      requiredRuntimeTablePrivileges("Notification", releaseZeroInventory),
      REQUIRED_TABLE_PRIVILEGES,
    );
    assert.deepEqual(
      requiredRuntimeTablePrivileges("Notification", notificationInventory),
      NOTIFICATION_ACTIVATION_TABLE_PRIVILEGES,
    );
    assert.deepEqual(
      requiredRuntimeColumnPrivileges("Notification", releaseZeroInventory),
      [],
    );
    assert.deepEqual(
      requiredRuntimeColumnPrivileges("Notification", notificationInventory),
      NOTIFICATION_ACTIVATION_COLUMN_PRIVILEGES,
    );
    if (cartCartItemRlsActivationPresent) {
      assert.deepEqual(
        CART_CART_ITEM_OWNER_TABLE_PRIVILEGES,
        ["SELECT", "INSERT", "DELETE"],
      );
      assert.deepEqual(
        CART_OWNER_COLUMN_PRIVILEGES,
        ['"updatedAt":UPDATE'],
      );
      assert.deepEqual(
        CART_ITEM_OWNER_COLUMN_PRIVILEGES,
        [
          '"priceCents":UPDATE',
          '"priceVersion":UPDATE',
          '"selectedVariantOptionIds":UPDATE',
          "quantity:UPDATE",
        ],
      );
      for (const tableName of ["Cart", "CartItem"]) {
        assert.deepEqual(
          requiredRuntimeTablePrivileges(tableName, cartPredecessorInventory),
          REQUIRED_TABLE_PRIVILEGES,
        );
        assert.deepEqual(
          requiredRuntimeTablePrivileges(tableName, cartActivatedInventory),
          CART_CART_ITEM_OWNER_TABLE_PRIVILEGES,
        );
      }
      assert.deepEqual(
        requiredRuntimeColumnPrivileges("Cart", cartPredecessorInventory),
        [],
      );
      assert.deepEqual(
        requiredRuntimeColumnPrivileges("Cart", cartActivatedInventory),
        CART_OWNER_COLUMN_PRIVILEGES,
      );
      assert.deepEqual(
        requiredRuntimeColumnPrivileges("CartItem", cartActivatedInventory),
        CART_ITEM_OWNER_COLUMN_PRIVILEGES,
      );
    }
    if (stockNotificationRlsActivationPresent) {
      assert.deepEqual(
        STOCK_NOTIFICATION_OWNER_TABLE_PRIVILEGES,
        ["SELECT", "DELETE"],
      );
      assert.deepEqual(
        requiredRuntimeTablePrivileges(
          STOCK_NOTIFICATION_TABLE,
          stockNotificationPredecessorInventory,
        ),
        REQUIRED_TABLE_PRIVILEGES,
      );
      assert.deepEqual(
        requiredRuntimeTablePrivileges(
          STOCK_NOTIFICATION_TABLE,
          stockNotificationActivatedInventory,
        ),
        STOCK_NOTIFICATION_OWNER_TABLE_PRIVILEGES,
      );
    }
    assert.deepEqual(
      requiredRuntimeTablePrivileges(
        "Conversation",
        conversationMessageInventory,
      ),
      CONVERSATION_MESSAGE_ACTIVATION_TABLE_PRIVILEGES,
    );
    assert.deepEqual(
      requiredRuntimeTablePrivileges("Message", conversationMessageInventory),
      CONVERSATION_MESSAGE_ACTIVATION_TABLE_PRIVILEGES,
    );
    assert.deepEqual(
      requiredRuntimeColumnPrivileges(
        "Conversation",
        conversationMessageInventory,
      ),
      [],
    );

    const exactPhaseARow = {
      public_column_grant_option_privileges: [],
      public_column_privileges: [],
      public_grant_option_privileges: [],
      public_privileges: [],
      runtime_column_grant_option_privileges: [],
      runtime_column_privileges: [],
      runtime_grant_option_privileges: [],
      runtime_privileges: ["DELETE", "INSERT", "SELECT"],
    };
    assert.deepEqual(
      collectTablePrivilegeAllowlistIssues(exactPhaseARow, "table SavedSearch", {
        requiredPrivileges: SAVED_SEARCH_PHASE_A_TABLE_PRIVILEGES,
      }),
      [],
    );
    assert.match(
      collectTablePrivilegeAllowlistIssues(
        {
          ...exactPhaseARow,
          runtime_privileges: ["DELETE", "INSERT", "SELECT", "UPDATE"],
        },
        "table SavedSearch",
        { requiredPrivileges: SAVED_SEARCH_PHASE_A_TABLE_PRIVILEGES },
      ).join("\n"),
      /unexpected table privileges: UPDATE/,
    );

    const exactNotificationRow = {
      ...exactPhaseARow,
      runtime_privileges: ["SELECT"],
      runtime_column_privileges: ["read:UPDATE"],
    };
    assert.deepEqual(
      collectTablePrivilegeAllowlistIssues(exactNotificationRow, "table Notification", {
        requiredPrivileges: NOTIFICATION_ACTIVATION_TABLE_PRIVILEGES,
        requiredColumnPrivileges: NOTIFICATION_ACTIVATION_COLUMN_PRIVILEGES,
      }),
      [],
    );
    assert.deepEqual(
      collectTablePrivilegeAllowlistIssues(
        {
          ...exactNotificationRow,
          runtime_privileges: ["SELECT", "INSERT"],
          runtime_column_privileges: ["title:UPDATE"],
        },
        "table Notification",
        {
          requiredPrivileges: NOTIFICATION_ACTIVATION_TABLE_PRIVILEGES,
          requiredColumnPrivileges: NOTIFICATION_ACTIVATION_COLUMN_PRIVILEGES,
        },
      ),
      [
        "table Notification runtime role has unexpected table privileges: INSERT",
        "table Notification runtime role is missing column privileges: read:UPDATE",
        "table Notification runtime role has unexpected column privileges: title:UPDATE",
      ],
    );

    if (cartCartItemRlsActivationPresent) {
      const exactCartRow = {
        ...exactPhaseARow,
        runtime_column_privileges: CART_OWNER_COLUMN_PRIVILEGES,
      };
      assert.deepEqual(
        collectTablePrivilegeAllowlistIssues(exactCartRow, "table Cart", {
          requiredPrivileges: CART_CART_ITEM_OWNER_TABLE_PRIVILEGES,
          requiredColumnPrivileges: CART_OWNER_COLUMN_PRIVILEGES,
        }),
        [],
      );
      const exactCartItemRow = {
        ...exactPhaseARow,
        runtime_column_privileges: CART_ITEM_OWNER_COLUMN_PRIVILEGES,
      };
      assert.deepEqual(
        collectTablePrivilegeAllowlistIssues(exactCartItemRow, "table CartItem", {
          requiredPrivileges: CART_CART_ITEM_OWNER_TABLE_PRIVILEGES,
          requiredColumnPrivileges: CART_ITEM_OWNER_COLUMN_PRIVILEGES,
        }),
        [],
      );
      assert.deepEqual(
        collectTablePrivilegeAllowlistIssues(
          {
            ...exactCartItemRow,
            runtime_privileges: [...exactCartItemRow.runtime_privileges, "UPDATE"],
            runtime_column_privileges: [
              ...CART_ITEM_OWNER_COLUMN_PRIVILEGES,
              "listingId:UPDATE",
            ],
          },
          "table CartItem",
          {
            requiredPrivileges: CART_CART_ITEM_OWNER_TABLE_PRIVILEGES,
            requiredColumnPrivileges: CART_ITEM_OWNER_COLUMN_PRIVILEGES,
          },
        ),
        [
          "table CartItem runtime role has unexpected table privileges: UPDATE",
          "table CartItem runtime role has unexpected column privileges: listingId:UPDATE",
        ],
      );
    }
    if (stockNotificationRlsActivationPresent) {
      const exactStockNotificationRow = {
        ...exactPhaseARow,
        runtime_privileges: STOCK_NOTIFICATION_OWNER_TABLE_PRIVILEGES,
      };
      assert.deepEqual(
        collectTablePrivilegeAllowlistIssues(
          exactStockNotificationRow,
          "table StockNotification",
          { requiredPrivileges: STOCK_NOTIFICATION_OWNER_TABLE_PRIVILEGES },
        ),
        [],
      );
      assert.deepEqual(
        collectTablePrivilegeAllowlistIssues(
          {
            ...exactStockNotificationRow,
            runtime_privileges: ["DELETE", "INSERT", "SELECT"],
          },
          "table StockNotification",
          { requiredPrivileges: STOCK_NOTIFICATION_OWNER_TABLE_PRIVILEGES },
        ),
        ["table StockNotification runtime role has unexpected table privileges: INSERT"],
      );
    }
  });

  it("keeps Core Order predecessor grants until policyless ENABLE and then audits FORCE separately", () => {
    const predecessor = {
      tables: [CORE_ORDER_TABLE],
      rlsEnableTables: [],
      rlsForceTables: [],
      rlsPolicyTables: [],
    };
    const enabled = { ...predecessor, rlsEnableTables: [CORE_ORDER_TABLE] };
    const forced = { ...enabled, rlsForceTables: [CORE_ORDER_TABLE] };
    assert.equal(coreOrderRlsActivationExpected(predecessor), false);
    assert.equal(coreOrderRlsActivationExpected(enabled), true);
    assert.equal(coreOrderRlsForceExpected(enabled), false);
    assert.equal(coreOrderRlsForceExpected(forced), true);
    assert.deepEqual(requiredRuntimeTablePrivileges(CORE_ORDER_TABLE, predecessor),
      REQUIRED_TABLE_PRIVILEGES);
    assert.deepEqual(requiredRuntimeTablePrivileges(CORE_ORDER_TABLE, enabled), []);
    assert.equal(policylessServiceRlsTableNames(predecessor).includes(CORE_ORDER_TABLE), false);
    assert.equal(policylessServiceRlsTableNames(enabled).includes(CORE_ORDER_TABLE), true);
    assert.deepEqual(collectPolicylessServiceRlsIssues([{ table_name: CORE_ORDER_TABLE,
      rls_enabled: true, rls_forced: false, policy_count: 0 }], enabled), []);
    assert.deepEqual(collectPolicylessServiceRlsIssues([{ table_name: CORE_ORDER_TABLE,
      rls_enabled: true, rls_forced: false, policy_count: 0 }], forced),
    ["service-only table Order must have FORCE ROW LEVEL SECURITY enabled"]);
    assert.equal(coreOrderRlsActivationExpected({ ...enabled,
      rlsPolicyTables: [CORE_ORDER_TABLE] }), false);
  });

  it("removes ordinary runtime table privileges after dedicated account-deletion RLS activation", () => {
    const predecessor = {
      tables: [ACCOUNT_DELETION_SIDE_EFFECT_TABLE],
      rlsEnableTables: [],
      rlsPolicyTables: [],
    };
    const enabled = {
      ...predecessor,
      rlsEnableTables: [ACCOUNT_DELETION_SIDE_EFFECT_TABLE],
      rlsPolicyTables: [ACCOUNT_DELETION_SIDE_EFFECT_TABLE],
    };

    assert.equal(accountDeletionSideEffectRlsActivationExpected(predecessor), false);
    assert.equal(accountDeletionSideEffectRlsActivationExpected(enabled), true);
    assert.equal(accountDeletionSideEffectRlsActivationExpected({
      ...enabled,
      rlsPolicyTables: [],
    }), false);
    assert.deepEqual(
      requiredRuntimeTablePrivileges(ACCOUNT_DELETION_SIDE_EFFECT_TABLE, predecessor),
      REQUIRED_TABLE_PRIVILEGES,
    );
    assert.deepEqual(
      requiredRuntimeTablePrivileges(ACCOUNT_DELETION_SIDE_EFFECT_TABLE, enabled),
      [],
    );
  });

  it("derives account-deletion function expectations from exact applied preparation state", () => {
    const sourceInventory = {
      functions: [
        "grainline_existing_function",
        "grainline_account_deletion_claim_user",
        "grainline_account_deletion_media_enqueue_claimed",
        "grainline_account_deletion_media_key_enqueue_claimed",
        "grainline_account_deletion_side_effect_claim",
        "grainline_account_deletion_side_effect_complete",
        "grainline_account_deletion_side_effect_fail",
        "grainline_message_redact_for_account_deletion",
      ],
    };
    const predecessor = withAppliedAccountDeletionAuthority(sourceInventory, {
      claimFenceApplied: false,
      mediaKeyApplied: false,
    });
    assert.deepEqual(predecessor.functions, [
      "grainline_existing_function",
      "grainline_message_redact_for_account_deletion",
    ]);
    assert.equal(accountDeletionClaimFencePreparationExpected(predecessor), false);
    assert.equal(accountDeletionMediaKeyPreparationExpected(predecessor), false);

    const claimFenceOnly = withAppliedAccountDeletionAuthority(sourceInventory, {
      claimFenceApplied: true,
      mediaKeyApplied: false,
    });
    assert.equal(accountDeletionClaimFencePreparationExpected(claimFenceOnly), true);
    assert.equal(accountDeletionMediaKeyPreparationExpected(claimFenceOnly), false);
    assert.equal(
      claimFenceOnly.functions.includes(
        "grainline_account_deletion_media_key_enqueue_claimed",
      ),
      false,
    );

    const fullyPrepared = withAppliedAccountDeletionAuthority(sourceInventory, {
      claimFenceApplied: true,
      mediaKeyApplied: true,
    });
    assert.deepEqual(fullyPrepared.functions, sourceInventory.functions);
    assert.equal(accountDeletionMediaKeyPreparationExpected(fullyPrepared), true);
  });

  it("derives email authority expectations from the exact live migration stage", (context) => {
    // The accumulated-User CI proof intentionally replays this test against an
    // older grant-audit script after isolating the later email migrations. Keep
    // that historical replay valid, while requiring the current source package
    // to export the successor-only function inventory whenever its migration is
    // present.
    if (existsSync(EMAIL_PROVIDER_ELIGIBILITY_FENCE_MIGRATION_PATH)) {
      assert.deepEqual(EMAIL_PROVIDER_ELIGIBILITY_FENCE_NEW_FUNCTION_NAMES, [
        "grainline_email_hard_suppression_apply",
      ]);
    }
    if (
      typeof withAppliedEmailDeliveryAuthority !== "function"
      || !Array.isArray(EMAIL_DELIVERY_LEDGER_PREPARATION_FUNCTION_NAMES)
      || !Array.isArray(EMAIL_PROVIDER_DELETION_FENCE_NEW_FUNCTION_NAMES)
      || !Array.isArray(EMAIL_PROVIDER_ELIGIBILITY_FENCE_NEW_FUNCTION_NAMES)
      || !Array.isArray(EMAIL_DELIVERY_PRIVATE_FUNCTION_NAMES)
    ) {
      context.skip("requires the staged email grant-audit generation");
      return;
    }
    const sourceInventory = {
      functions: [
        "grainline_existing_function",
        ...EMAIL_DELIVERY_LEDGER_PREPARATION_FUNCTION_NAMES,
        ...EMAIL_PROVIDER_DELETION_FENCE_NEW_FUNCTION_NAMES,
        ...EMAIL_PROVIDER_ELIGIBILITY_FENCE_NEW_FUNCTION_NAMES,
      ],
    };
    const predecessor = withAppliedEmailDeliveryAuthority(sourceInventory, {
      preparationApplied: false,
      fenceApplied: false,
      eligibilityFenceApplied: false,
    });
    assert.deepEqual(predecessor.functions, ["grainline_existing_function"]);

    const prepared = withAppliedEmailDeliveryAuthority(sourceInventory, {
      preparationApplied: true,
      fenceApplied: false,
      eligibilityFenceApplied: false,
    });
    assert.deepEqual(prepared.functions, [
      "grainline_existing_function",
      ...EMAIL_DELIVERY_LEDGER_PREPARATION_FUNCTION_NAMES,
    ].sort((left, right) => left.localeCompare(right)));
    for (const functionName of EMAIL_PROVIDER_DELETION_FENCE_NEW_FUNCTION_NAMES) {
      assert.equal(prepared.functions.includes(functionName), false);
    }
    for (const functionName of EMAIL_DELIVERY_PRIVATE_FUNCTION_NAMES) {
      assert.equal(
        runtimePrivateFunctionNames(prepared).includes(functionName),
        true,
      );
    }

    const fenced = withAppliedEmailDeliveryAuthority(sourceInventory, {
      preparationApplied: true,
      fenceApplied: true,
      eligibilityFenceApplied: false,
    });
    assert.equal(
      fenced.functions.includes("grainline_email_hard_suppression_apply"),
      false,
    );
    const eligibilityFenced = withAppliedEmailDeliveryAuthority(sourceInventory, {
      preparationApplied: true,
      fenceApplied: true,
      eligibilityFenceApplied: true,
    });
    assert.deepEqual(
      eligibilityFenced.functions,
      [...new Set(sourceInventory.functions)].sort((left, right) =>
        left.localeCompare(right)),
    );
    assert.deepEqual(collectEmailDeliveryMigrationOrderIssues({
      preparationApplied: true,
      fenceApplied: false,
      eligibilityFenceApplied: false,
    }), []);
    assert.deepEqual(collectEmailDeliveryMigrationOrderIssues({
      preparationApplied: false,
      fenceApplied: true,
      eligibilityFenceApplied: false,
    }), [
      "email provider/account-deletion fence is applied without its exact delivery-ledger prerequisite",
    ]);
    assert.deepEqual(collectEmailDeliveryMigrationOrderIssues({
      preparationApplied: true,
      fenceApplied: false,
      eligibilityFenceApplied: true,
    }), [
      "email provider/eligibility fence is applied without its exact account-deletion-fence prerequisite",
    ]);
  });

  it("reads exact email migration ledger states including manual resolution rows", async (context) => {
    if (
      typeof readEmailDeliveryLedgerPreparationState !== "function"
      || typeof readEmailProviderDeletionFenceState !== "function"
      || typeof readEmailProviderEligibilityFenceState !== "function"
    ) {
      context.skip("requires the staged email migration-ledger readers");
      return;
    }
    const exactClient = (expectedMigration, expectedChecksum) => ({
      queryCount: 0,
      async query(sql, parameters) {
        this.queryCount += 1;
        if (this.queryCount === 1) {
          return { rows: [{ migration_table: "_prisma_migrations" }] };
        }
        assert.match(sql, /FROM public\._prisma_migrations/u);
        assert.deepEqual(parameters, [expectedMigration]);
        return {
          rows: [{
            migration_name: expectedMigration,
            checksum: expectedChecksum,
            finished_at: new Date("2026-10-26T00:00:00Z"),
            rolled_back_at: null,
            applied_steps_count: "0",
          }],
        };
      },
    });
    assert.deepEqual(
      await readEmailDeliveryLedgerPreparationState(exactClient(
        EMAIL_DELIVERY_LEDGER_PREPARATION_MIGRATION,
        EMAIL_DELIVERY_LEDGER_PREPARATION_MIGRATION_SHA256,
      )),
      { applied: true, issues: [] },
    );
    assert.deepEqual(
      await readEmailProviderDeletionFenceState(exactClient(
        EMAIL_PROVIDER_DELETION_FENCE_MIGRATION,
        EMAIL_PROVIDER_DELETION_FENCE_MIGRATION_SHA256,
      )),
      { applied: true, issues: [] },
    );
    assert.deepEqual(
      await readEmailProviderEligibilityFenceState(exactClient(
        EMAIL_PROVIDER_ELIGIBILITY_FENCE_MIGRATION,
        EMAIL_PROVIDER_ELIGIBILITY_FENCE_MIGRATION_SHA256,
      )),
      { applied: true, issues: [] },
    );
  });

  it("fails closed when account-deletion migration ledger order is impossible", () => {
    assert.deepEqual(collectAccountDeletionMigrationOrderIssues({
      claimFenceApplied: false,
      mediaKeyApplied: false,
      activationApplied: false,
    }), []);
    assert.deepEqual(collectAccountDeletionMigrationOrderIssues({
      claimFenceApplied: true,
      mediaKeyApplied: true,
      activationApplied: true,
      forceApplied: true,
    }), []);
    assert.deepEqual(collectAccountDeletionMigrationOrderIssues({
      claimFenceApplied: false,
      mediaKeyApplied: true,
      activationApplied: false,
    }), [
      "AccountDeletionSideEffect media-key preparation is applied without its claim-fence prerequisite",
    ]);
    assert.deepEqual(collectAccountDeletionMigrationOrderIssues({
      claimFenceApplied: true,
      mediaKeyApplied: false,
      activationApplied: true,
    }), [
      "AccountDeletionSideEffect activation is applied without both exact preparation migrations",
    ]);
    assert.deepEqual(collectAccountDeletionMigrationOrderIssues({
      claimFenceApplied: true,
      mediaKeyApplied: true,
      activationApplied: false,
      forceApplied: true,
    }), [
      "AccountDeletionSideEffect FORCE is applied without its exact activation prerequisite",
    ]);
  });

  it("fails closed when ClerkWebhookEvent FORCE precedes activation", () => {
    assert.deepEqual(collectClerkWebhookEventMigrationOrderIssues({
      activationApplied: false,
      forceApplied: false,
    }), []);
    assert.deepEqual(collectClerkWebhookEventMigrationOrderIssues({
      activationApplied: true,
      forceApplied: true,
    }), []);
    assert.deepEqual(collectClerkWebhookEventMigrationOrderIssues({
      activationApplied: false,
      forceApplied: true,
    }), [
      "ClerkWebhookEvent FORCE is applied without its exact activation prerequisite",
    ]);
  });

  it("audits mixed account-deletion overload ACLs by exact identity", () => {
    const prepared = {
      functions: ["grainline_account_deletion_claim_user"],
      rlsEnableTables: [],
      rlsPolicyTables: [],
    };
    const active = {
      ...prepared,
      rlsEnableTables: [ACCOUNT_DELETION_SIDE_EFFECT_TABLE],
      rlsPolicyTables: [ACCOUNT_DELETION_SIDE_EFFECT_TABLE],
    };
    const expectation = (functionName, argumentTypes, inventory = prepared) =>
      accountDeletionRuntimeExecuteExpected({
        function_name: functionName,
        argument_types: argumentTypes,
      }, inventory);

    assert.equal(expectation("grainline_user_account_deletion_preflight", "text"), true);
    assert.equal(
      expectation("grainline_user_account_deletion_preflight", "text", active),
      false,
    );
    assert.equal(
      expectation("grainline_user_account_deletion_preflight", "text, bigint, uuid"),
      null,
    );
    assert.equal(expectation("grainline_account_deletion_claim_user", "text,bigint,uuid"), false);
    assert.equal(expectation("grainline_account_deletion_side_effect_claim", "text"), true);
    assert.equal(
      expectation("grainline_account_deletion_side_effect_claim", "text", active),
      false,
    );
    assert.equal(expectation("grainline_account_deletion_media_enqueue_claimed", "text,bigint,uuid,text[]"), true);
    assert.equal(
      expectation("grainline_account_deletion_media_enqueue_claimed", "text,bigint,uuid,text[]", active),
      false,
    );
    assert.equal(expectation("grainline_account_deletion_media_key_enqueue_claimed", "text,bigint,uuid,text[]"), true);
    assert.equal(
      expectation("grainline_account_deletion_media_key_enqueue_claimed", "text,bigint,uuid,text[]", active),
      true,
    );
    assert.equal(
      accountDeletionRuntimeExecuteExpected({
        function_name: "grainline_user_account_deletion_preflight",
        argument_types: "text",
      }, { functions: [] }),
      null,
    );
  });

  it("audits the exact account-deletion worker boundary before and after activation", () => {
    const preparedInventory = {
      functions: ["grainline_account_deletion_claim_user"],
      rlsEnableTables: [],
      rlsPolicyTables: [],
    };
    const preparedState = {
      role_exists: true,
      role_super: false,
      role_inherit: false,
      role_canlogin: true,
      role_createdb: false,
      role_createrole: false,
      role_replication: false,
      role_bypassrls: false,
      membership_count: 0,
      database_create: false,
      schema_usage: true,
      schema_create: false,
      owned_public_object_count: 0,
      rls_enabled: false,
      rls_forced: false,
      policy_count: 0,
      exact_policy_count: 0,
      table_privileges: ["DELETE", "INSERT", "SELECT", "UPDATE"],
      column_acl_count: 0,
      table_grant_option_count: 0,
      unexpected_table_privileges: [],
      unexpected_type_privileges: [],
      function_identities: [
        "grainline_account_deletion_side_effect_claim(text)",
        "grainline_account_deletion_side_effect_complete(text,bigint,uuid)",
        "grainline_account_deletion_side_effect_fail(text,bigint,uuid,text)",
      ],
      effective_function_identities: [
        "grainline_account_deletion_side_effect_claim(text)",
        "grainline_account_deletion_side_effect_complete(text,bigint,uuid)",
        "grainline_account_deletion_side_effect_fail(text,bigint,uuid,text)",
      ],
      function_grant_option_count: 0,
      public_account_deletion_execute_count: 0,
    };
    assert.deepEqual(
      collectAccountDeletionWorkerBoundaryIssues(preparedState, preparedInventory),
      [],
    );

    const activeInventory = {
      ...preparedInventory,
      rlsEnableTables: [ACCOUNT_DELETION_SIDE_EFFECT_TABLE],
      rlsPolicyTables: [ACCOUNT_DELETION_SIDE_EFFECT_TABLE],
    };
    assert.deepEqual(
      collectAccountDeletionWorkerBoundaryIssues({
        ...preparedState,
        rls_enabled: true,
        policy_count: 1,
        exact_policy_count: 1,
      }, activeInventory),
      [],
    );

    const forcedInventory = {
      ...activeInventory,
      rlsForceTables: [ACCOUNT_DELETION_SIDE_EFFECT_TABLE],
    };
    assert.equal(accountDeletionSideEffectRlsForceExpected(activeInventory), false);
    assert.equal(accountDeletionSideEffectRlsForceExpected(forcedInventory), true);
    assert.deepEqual(
      collectAccountDeletionWorkerBoundaryIssues({
        ...preparedState,
        rls_enabled: true,
        rls_forced: true,
        policy_count: 1,
        exact_policy_count: 1,
      }, forcedInventory),
      [],
    );

    const issues = collectAccountDeletionWorkerBoundaryIssues({
      ...preparedState,
      role_bypassrls: true,
      membership_count: 1,
      table_privileges: ["SELECT"],
      unexpected_table_privileges: ["public.User:SELECT"],
      unexpected_type_privileges: ["public.UserRole:USAGE"],
      function_identities: [
        ...preparedState.function_identities,
        "grainline_user_account_deletion_preflight(text,bigint,uuid)",
      ],
      effective_function_identities: [
        ...preparedState.effective_function_identities,
        "grainline_user_account_deletion_preflight(text,bigint,uuid)",
      ],
    }, preparedInventory).join("\n");
    assert.match(issues, /role_bypassrls/);
    assert.match(issues, /unreviewed role membership/);
    assert.match(issues, /table privileges drifted/);
    assert.match(issues, /unrelated table authority/);
    assert.match(issues, /unrelated type authority/);
    assert.match(issues, /function authority drifted/);
    assert.match(issues, /effective function authority drifted/);
  });

  it("accepts OrderItem policyless ENABLE and audits its later FORCE separately", () => {
    const predecessor = {
      tables: [ORDER_ITEM_TABLE],
      rlsEnableTables: [],
      rlsForceTables: [],
      rlsPolicyTables: [],
      orderItemQuoteRuntimeLockApplied: true,
    };
    const enabled = { ...predecessor, rlsEnableTables: [ORDER_ITEM_TABLE] };
    const forced = { ...enabled, rlsForceTables: [ORDER_ITEM_TABLE] };
    assert.equal(orderItemRlsActivationExpected(predecessor), false);
    assert.equal(orderItemRlsActivationExpected(enabled), true);
    assert.equal(orderItemRlsForceExpected(enabled), false);
    assert.equal(orderItemRlsForceExpected(forced), true);
    assert.deepEqual(requiredRuntimeTablePrivileges(ORDER_ITEM_TABLE, predecessor), []);
    assert.deepEqual(requiredRuntimeTablePrivileges(ORDER_ITEM_TABLE, enabled), []);
    assert.equal(
      policylessServiceRlsTableNames(predecessor).includes(ORDER_ITEM_TABLE),
      false,
    );
    assert.equal(
      policylessServiceRlsTableNames(enabled).includes(ORDER_ITEM_TABLE),
      true,
    );
    assert.deepEqual(
      collectPolicylessServiceRlsIssues([{
        table_name: ORDER_ITEM_TABLE,
        rls_enabled: true,
        rls_forced: false,
        policy_count: 0,
      }], enabled),
      [],
    );
    assert.deepEqual(
      collectPolicylessServiceRlsIssues([{
        table_name: ORDER_ITEM_TABLE,
        rls_enabled: true,
        rls_forced: false,
        policy_count: 0,
      }], forced),
      ["service-only table OrderItem must have FORCE ROW LEVEL SECURITY enabled"],
    );
    assert.equal(orderItemRlsActivationExpected({
      ...enabled,
      rlsPolicyTables: [ORDER_ITEM_TABLE],
    }), false);
  });

  it("accepts quote policyless ENABLE and audits its later FORCE separately", () => {
    const predecessor = {
      tables: [ORDER_QUOTE_TABLE],
      rlsEnableTables: [],
      rlsForceTables: [],
      rlsPolicyTables: [],
      orderItemQuoteRuntimeLockApplied: true,
    };
    const enabled = { ...predecessor, rlsEnableTables: [ORDER_QUOTE_TABLE] };
    const forced = { ...enabled, rlsForceTables: [ORDER_QUOTE_TABLE] };
    assert.equal(orderQuoteRlsActivationExpected(predecessor), false);
    assert.equal(orderQuoteRlsActivationExpected(enabled), true);
    assert.equal(orderQuoteRlsForceExpected(enabled), false);
    assert.equal(orderQuoteRlsForceExpected(forced), true);
    assert.deepEqual(requiredRuntimeTablePrivileges(ORDER_QUOTE_TABLE, predecessor), []);
    assert.deepEqual(requiredRuntimeTablePrivileges(ORDER_QUOTE_TABLE, enabled), []);
    assert.equal(
      policylessServiceRlsTableNames(predecessor).includes(ORDER_QUOTE_TABLE),
      false,
    );
    assert.equal(
      policylessServiceRlsTableNames(enabled).includes(ORDER_QUOTE_TABLE),
      true,
    );
    assert.deepEqual(
      collectPolicylessServiceRlsIssues([{
        table_name: ORDER_QUOTE_TABLE,
        rls_enabled: true,
        rls_forced: false,
        policy_count: 0,
      }], enabled),
      [],
    );
    assert.deepEqual(
      collectPolicylessServiceRlsIssues([{
        table_name: ORDER_QUOTE_TABLE,
        rls_enabled: true,
        rls_forced: false,
        policy_count: 0,
      }], forced),
      [
        "service-only table OrderShippingRateQuote must have FORCE ROW LEVEL SECURITY enabled",
      ],
    );
    assert.equal(orderQuoteRlsActivationExpected({
      ...enabled,
      rlsPolicyTables: [ORDER_QUOTE_TABLE],
    }), false);
  });

  it("accepts UserEmailAddress policyless ENABLE and audits FORCE separately", () => {
    const predecessor = {
      tables: [USER_EMAIL_ADDRESS_TABLE],
      rlsEnableTables: [],
      rlsForceTables: [],
      rlsPolicyTables: [],
    };
    const enabled = {
      ...predecessor,
      rlsEnableTables: [USER_EMAIL_ADDRESS_TABLE],
    };
    const forced = {
      ...enabled,
      rlsForceTables: [USER_EMAIL_ADDRESS_TABLE],
    };
    assert.equal(userEmailAddressRlsActivationExpected(predecessor), false);
    assert.equal(userEmailAddressRlsActivationExpected(enabled), true);
    assert.equal(userEmailAddressRlsForceExpected(enabled), false);
    assert.equal(userEmailAddressRlsForceExpected(forced), true);
    assert.deepEqual(
      requiredRuntimeTablePrivileges(USER_EMAIL_ADDRESS_TABLE, predecessor),
      REQUIRED_TABLE_PRIVILEGES,
    );
    assert.deepEqual(
      requiredRuntimeTablePrivileges(USER_EMAIL_ADDRESS_TABLE, enabled),
      [],
    );
    assert.equal(
      policylessServiceRlsTableNames(predecessor).includes(
        USER_EMAIL_ADDRESS_TABLE,
      ),
      false,
    );
    assert.equal(
      policylessServiceRlsTableNames(enabled).includes(
        USER_EMAIL_ADDRESS_TABLE,
      ),
      true,
    );
    assert.deepEqual(
      collectPolicylessServiceRlsIssues(
        [
          {
            table_name: USER_EMAIL_ADDRESS_TABLE,
            rls_enabled: true,
            rls_forced: false,
            policy_count: 0,
          },
        ],
        enabled,
      ),
      [],
    );
    assert.deepEqual(
      collectPolicylessServiceRlsIssues(
        [
          {
            table_name: USER_EMAIL_ADDRESS_TABLE,
            rls_enabled: true,
            rls_forced: false,
            policy_count: 0,
          },
        ],
        forced,
      ),
      [
        "service-only table UserEmailAddress must have FORCE ROW LEVEL SECURITY enabled",
      ],
    );
  });

  it("accepts User policyless ENABLE and audits FORCE separately", () => {
    const predecessor = {
      tables: [USER_TABLE],
      rlsEnableTables: [],
      rlsForceTables: [],
      rlsPolicyTables: [],
    };
    const enabled = { ...predecessor, rlsEnableTables: [USER_TABLE] };
    const forced = { ...enabled, rlsForceTables: [USER_TABLE] };
    assert.equal(userRlsActivationExpected(predecessor), false);
    assert.equal(userRlsActivationExpected(enabled), true);
    assert.equal(userRlsForceExpected(enabled), false);
    assert.equal(userRlsForceExpected(forced), true);
    assert.deepEqual(
      requiredRuntimeTablePrivileges(USER_TABLE, predecessor),
      REQUIRED_TABLE_PRIVILEGES,
    );
    assert.deepEqual(requiredRuntimeTablePrivileges(USER_TABLE, enabled), []);
    assert.equal(policylessServiceRlsTableNames(predecessor).includes(USER_TABLE), false);
    assert.equal(policylessServiceRlsTableNames(enabled).includes(USER_TABLE), true);
    assert.deepEqual(
      collectPolicylessServiceRlsIssues([{
        table_name: USER_TABLE,
        rls_enabled: true,
        rls_forced: false,
        policy_count: 0,
      }], enabled),
      [],
    );
    assert.deepEqual(
      collectPolicylessServiceRlsIssues([{
        table_name: USER_TABLE,
        rls_enabled: true,
        rls_forced: false,
        policy_count: 0,
      }], forced),
      ["service-only table User must have FORCE ROW LEVEL SECURITY enabled"],
    );
  });

  it("pins policyless service ledgers to ENABLE plus FORCE", () => {
    const inventory = {
      tables: [
        "CaseResolutionClaim",
        "CaseStripeDisputeApplication",
        "CaseOpenApplication",
        "DirectUpload",
        "DirectUploadReference",
      ],
    };
    const exact = [
      {
        table_name: "CaseResolutionClaim",
        rls_enabled: true,
        rls_forced: true,
        policy_count: 0,
      },
      {
        table_name: "CaseStripeDisputeApplication",
        rls_enabled: true,
        rls_forced: true,
        policy_count: 0,
      },
      {
        table_name: "CaseOpenApplication",
        rls_enabled: true,
        rls_forced: true,
        policy_count: 0,
      },
      {
        table_name: "DirectUploadReference",
        rls_enabled: true,
        rls_forced: true,
        policy_count: 0,
      },
    ];
    assert.deepEqual(collectPolicylessServiceRlsIssues(exact, inventory), []);
    assert.deepEqual(
      collectPolicylessServiceRlsIssues([], inventory),
      [
        "service-only table CaseResolutionClaim must have ENABLE and FORCE ROW LEVEL SECURITY with zero policies",
        "service-only table CaseStripeDisputeApplication must have ENABLE and FORCE ROW LEVEL SECURITY with zero policies",
        "service-only table CaseOpenApplication must have ENABLE and FORCE ROW LEVEL SECURITY with zero policies",
        "service-only table DirectUploadReference must have ENABLE and FORCE ROW LEVEL SECURITY with zero policies",
      ],
    );
    assert.deepEqual(
      collectPolicylessServiceRlsIssues(
        [
          exact[0],
          exact[1],
          exact[2],
          {
            table_name: "DirectUploadReference",
            rls_enabled: false,
            rls_forced: false,
            policy_count: 1,
          },
        ],
        inventory,
      ),
      [
        "service-only table DirectUploadReference must have ROW LEVEL SECURITY enabled",
        "service-only table DirectUploadReference must have FORCE ROW LEVEL SECURITY enabled",
        "service-only table DirectUploadReference must retain zero policies",
      ],
    );
    const activatedInventory = {
      ...inventory,
      rlsForceTables: ["DirectUpload", "DirectUploadReference"],
      rlsPolicyTables: [],
    };
    assert.deepEqual(
      collectPolicylessServiceRlsIssues(
        [
          ...exact,
          {
            table_name: "DirectUpload",
            rls_enabled: true,
            rls_forced: true,
            policy_count: 0,
          },
        ],
        activatedInventory,
      ),
      [],
    );
    assert.deepEqual(
      collectPolicylessServiceRlsIssues(exact, activatedInventory),
      [
        "service-only table DirectUpload must have ENABLE and FORCE ROW LEVEL SECURITY with zero policies",
      ],
    );
    const caseActivatedInventory = {
      ...activatedInventory,
      tables: [...inventory.tables, ...CASE_ACTIVATION_TABLES],
      rlsEnableTables: [...CASE_ACTIVATION_TABLES],
    };
    const caseRows = CASE_ACTIVATION_TABLES.map((tableName) => ({
      table_name: tableName,
      rls_enabled: true,
      rls_forced: false,
      policy_count: 0,
    }));
    assert.deepEqual(
      collectPolicylessServiceRlsIssues(
        [
          ...exact,
          {
            table_name: "DirectUpload",
            rls_enabled: true,
            rls_forced: true,
            policy_count: 0,
          },
          ...caseRows,
        ],
        caseActivatedInventory,
      ),
      [],
    );
    assert.deepEqual(
      collectPolicylessServiceRlsIssues(
        [
          ...exact,
          {
            table_name: "DirectUpload",
            rls_enabled: true,
            rls_forced: true,
            policy_count: 0,
          },
          ...caseRows.slice(1),
        ],
        caseActivatedInventory,
      ),
      [
        "service-only table Case must have ENABLE ROW LEVEL SECURITY, NO FORCE and zero policies",
      ],
    );
    assert.deepEqual(
      collectPolicylessServiceRlsIssues(
        [
          ...exact,
          {
            table_name: "DirectUpload",
            rls_enabled: true,
            rls_forced: true,
            policy_count: 0,
          },
          {
            ...caseRows[0],
            rls_forced: true,
          },
          ...caseRows.slice(1),
        ],
        caseActivatedInventory,
      ),
      [
        "service-only table Case must keep FORCE ROW LEVEL SECURITY disabled for this release",
      ],
    );
    const caseForcedInventory = {
      ...caseActivatedInventory,
      rlsForceTables: [
        "Case",
        "CaseMessage",
        "CaseMessageAttachment",
        "DirectUpload",
        "DirectUploadReference",
      ],
    };
    assert.deepEqual(
      collectPolicylessServiceRlsIssues(
        [
          ...exact,
          {
            table_name: "DirectUpload",
            rls_enabled: true,
            rls_forced: true,
            policy_count: 0,
          },
          ...caseRows.map((row) => ({ ...row, rls_forced: true })),
        ],
        caseForcedInventory,
      ),
      [],
    );

    const stripeActivatedInventory = {
      ...caseForcedInventory,
      tables: [...caseForcedInventory.tables, STRIPE_WEBHOOK_EVENT_TABLE],
      rlsEnableTables: [
        ...caseForcedInventory.rlsEnableTables,
        STRIPE_WEBHOOK_EVENT_TABLE,
      ],
    };
    assert.equal(
      stripeWebhookEventRlsActivationExpected(stripeActivatedInventory),
      true,
    );
    assert.equal(
      stripeWebhookEventRlsForceExpected(stripeActivatedInventory),
      false,
    );
    assert.deepEqual(
      requiredRuntimeTablePrivileges(
        STRIPE_WEBHOOK_EVENT_TABLE,
        stripeActivatedInventory,
      ),
      [],
    );
    assert.deepEqual(
      collectPolicylessServiceRlsIssues(
        [
          ...exact,
          {
            table_name: "DirectUpload",
            rls_enabled: true,
            rls_forced: true,
            policy_count: 0,
          },
          ...caseRows.map((row) => ({ ...row, rls_forced: true })),
          {
            table_name: STRIPE_WEBHOOK_EVENT_TABLE,
            rls_enabled: true,
            rls_forced: false,
            policy_count: 0,
          },
        ],
        stripeActivatedInventory,
      ),
      [],
    );
    const stripeForcedInventory = {
      ...stripeActivatedInventory,
      rlsForceTables: [
        ...stripeActivatedInventory.rlsForceTables,
        STRIPE_WEBHOOK_EVENT_TABLE,
      ],
    };
    assert.equal(
      stripeWebhookEventRlsForceExpected(stripeForcedInventory),
      true,
    );

    const clerkActivatedInventory = {
      ...stripeForcedInventory,
      tables: [...stripeForcedInventory.tables, CLERK_WEBHOOK_EVENT_TABLE],
      rlsEnableTables: [
        ...stripeForcedInventory.rlsEnableTables,
        CLERK_WEBHOOK_EVENT_TABLE,
      ],
    };
    assert.equal(
      clerkWebhookEventRlsActivationExpected(clerkActivatedInventory),
      true,
    );
    assert.equal(
      clerkWebhookEventRlsForceExpected(clerkActivatedInventory),
      false,
    );
    assert.deepEqual(
      requiredRuntimeTablePrivileges(
        CLERK_WEBHOOK_EVENT_TABLE,
        clerkActivatedInventory,
      ),
      [],
    );

    const reservationActivatedInventory = {
      ...stripeForcedInventory,
      tables: [
        ...stripeForcedInventory.tables,
        CHECKOUT_STOCK_RESERVATION_TABLE,
      ],
      rlsEnableTables: [
        ...stripeForcedInventory.rlsEnableTables,
        CHECKOUT_STOCK_RESERVATION_TABLE,
      ],
    };
    assert.equal(
      checkoutStockReservationRlsActivationExpected(
        reservationActivatedInventory,
      ),
      true,
    );
    assert.equal(
      checkoutStockReservationRlsForceExpected(reservationActivatedInventory),
      false,
    );
    assert.deepEqual(
      requiredRuntimeTablePrivileges(
        CHECKOUT_STOCK_RESERVATION_TABLE,
        reservationActivatedInventory,
      ),
      [],
    );
    for (const functionName of
      CHECKOUT_STOCK_RESERVATION_ACTIVATED_PRIVATE_FUNCTION_NAMES) {
      assert.equal(
        runtimePrivateFunctionNames(reservationActivatedInventory).includes(
          functionName,
        ),
        true,
        `${functionName} must be runtime-private after reservation activation`,
      );
    }
    assert.equal(
      CHECKOUT_STOCK_RESERVATION_ACTIVATED_PRIVATE_FUNCTION_NAMES.length,
      9,
    );
    assert.equal(
      CHECKOUT_STOCK_RESERVATION_POST_CUTOVER_PRIVATE_FUNCTION_NAMES.length,
      11,
    );
    const postCutoverPrivateFunctions = runtimePrivateFunctionNames({
      ...reservationActivatedInventory,
      checkoutStockReservationSourceCutoverApplied: true,
    });
    for (const functionName of
      CHECKOUT_STOCK_RESERVATION_POST_CUTOVER_PRIVATE_FUNCTION_NAMES) {
      assert.equal(
        postCutoverPrivateFunctions.includes(functionName),
        true,
        `${functionName} must be runtime-private after source cutover`,
      );
    }
    assert.equal(
      postCutoverPrivateFunctions.includes(
        "grainline_checkout_reservation_create_cart_consistent",
      ),
      true,
    );
    assert.equal(
      postCutoverPrivateFunctions.includes(
        "grainline_checkout_reservation_create_single_consistent",
      ),
      true,
    );
    assert.deepEqual(
      policylessServiceRlsTableNames(reservationActivatedInventory).slice(-2),
      [STRIPE_WEBHOOK_EVENT_TABLE, CHECKOUT_STOCK_RESERVATION_TABLE],
    );
    assert.deepEqual(
      collectPolicylessServiceRlsIssues(
        [
          ...exact,
          {
            table_name: "DirectUpload",
            rls_enabled: true,
            rls_forced: true,
            policy_count: 0,
          },
          ...caseRows.map((row) => ({ ...row, rls_forced: true })),
          {
            table_name: STRIPE_WEBHOOK_EVENT_TABLE,
            rls_enabled: true,
            rls_forced: true,
            policy_count: 0,
          },
          {
            table_name: CHECKOUT_STOCK_RESERVATION_TABLE,
            rls_enabled: true,
            rls_forced: false,
            policy_count: 0,
          },
        ],
        reservationActivatedInventory,
      ),
      [],
    );
    const reservationForcedInventory = {
      tables: [CHECKOUT_STOCK_RESERVATION_TABLE],
      rlsEnableTables: [CHECKOUT_STOCK_RESERVATION_TABLE],
      rlsForceTables: [CHECKOUT_STOCK_RESERVATION_TABLE],
      rlsPolicyTables: [],
    };
    assert.equal(
      checkoutStockReservationRlsForceExpected(reservationForcedInventory),
      true,
    );
    assert.deepEqual(
      collectPolicylessServiceRlsIssues(
        [
          ...exact,
          {
            table_name: CHECKOUT_STOCK_RESERVATION_TABLE,
            rls_enabled: true,
            rls_forced: false,
            policy_count: 0,
          },
        ],
        reservationForcedInventory,
      ),
      [
        "service-only table CheckoutStockReservation must have FORCE ROW LEVEL SECURITY enabled",
      ],
    );
  });

  it("pins the exact initial Notification recipient policy contract without FORCE", () => {
    const runtimeRole = "grainline_app_runtime";
    const exactRows = [
      {
        rls_enabled: true,
        rls_forced: false,
        policy_name: "grainline_notification_recipient_select",
        policy_command: "r",
        policy_permissive: true,
        policy_roles: [runtimeRole],
        using_expression: `("userId" = NULLIF(current_setting('app.user_id'::text, true), ''::text))`,
        check_expression: null,
      },
      {
        rls_enabled: true,
        rls_forced: false,
        policy_name: "grainline_notification_recipient_update",
        policy_command: "w",
        policy_permissive: true,
        policy_roles: [runtimeRole],
        using_expression: `("userId" = NULLIF(current_setting('app.user_id'::text, true), ''::text))`,
        check_expression: `("userId" = NULLIF(current_setting('app.user_id'::text, true), ''::text))`,
      },
    ];

    assert.deepEqual(collectNotificationPolicyIssues(exactRows, runtimeRole), []);
    assert.match(
      collectNotificationPolicyIssues(
        exactRows.map((row, index) => index === 1
          ? { ...row, check_expression: null }
          : row),
        runtimeRole,
      ).join("\n"),
      /recipient_update has an unexpected WITH CHECK expression/,
    );
    assert.match(
      collectNotificationPolicyIssues(
        exactRows.map((row) => ({ ...row, rls_forced: true })),
        runtimeRole,
      ).join("\n"),
      /must keep FORCE ROW LEVEL SECURITY disabled/,
    );
  });

  it("pins exact initial Conversation and Message SELECT policies without FORCE", () => {
    const runtimeRole = "grainline_app_runtime";
    const common = {
      rls_enabled: true,
      rls_forced: false,
      policy_command: "r",
      policy_permissive: true,
      policy_roles: [runtimeRole],
      check_expression: null,
    };
    const conversationRows = [{
      ...common,
      policy_name: "grainline_conversation_participant_or_reported_select",
      using_expression:
        `(((NULLIF(current_setting('app.user_id'::text, true), ''::text) = "userAId") OR (NULLIF(current_setting('app.user_id'::text, true), ''::text) = "userBId")) OR grainline_conversation_staff_report_visible(id))`,
    }];
    const messageRows = [{
      ...common,
      policy_name: "grainline_message_participant_or_reported_select",
      using_expression:
        `(((NULLIF(current_setting('app.user_id'::text, true), ''::text) = "senderId") OR (NULLIF(current_setting('app.user_id'::text, true), ''::text) = "recipientId")) OR grainline_conversation_staff_report_visible("conversationId"))`,
    }];

    assert.deepEqual(
      collectConversationPolicyIssues(conversationRows, runtimeRole),
      [],
    );
    assert.deepEqual(collectMessagePolicyIssues(messageRows, runtimeRole), []);
    assert.match(
      collectConversationPolicyIssues(
        conversationRows.map((row) => ({
          ...row,
          using_expression:
            `(NULLIF(current_setting('app.user_id'::text, true), ''::text) = ANY (ARRAY["userAId", "userBId"])) OR grainline_conversation_staff_report_visible(id)`,
        })),
        runtimeRole,
      ).join("\n"),
      /unexpected USING expression: actual=.*ANY.*expected=.*userAId/,
    );
    assert.match(
      collectMessagePolicyIssues(
        messageRows.map((row) => ({
          ...row,
          policy_roles: ["PUBLIC"],
        })),
        runtimeRole,
      ).join("\n"),
      /expected only grainline_app_runtime/,
    );
    assert.match(
      collectConversationPolicyIssues(
        conversationRows.map((row) => ({ ...row, rls_forced: true })),
        runtimeRole,
      ).join("\n"),
      /must keep FORCE ROW LEVEL SECURITY disabled/,
    );
  });

  it("pins Notification RPC mode, ACL, owner, and overload contracts", () => {
    const runtimeRole = "grainline_app_runtime";
    const migrationRole = "grainline_migration_owner";
    const recipientNames = new Set(NOTIFICATION_RECIPIENT_RPC_FUNCTIONS);
    const privateNames = new Set(["grainline_notification_create_core"]);
    const exactRows = [
      ...NOTIFICATION_RECIPIENT_RPC_FUNCTIONS,
      ...NOTIFICATION_SERVICE_RPC_FUNCTIONS,
    ].map((functionName) => ({
      function_name: functionName,
      args: functionName.endsWith("prune_read_batch") ? "" : "p_user_id text",
      owner_name: migrationRole,
      security_definer: !recipientNames.has(functionName),
      leakproof: false,
      volatility: "v",
      parallel_safety: "u",
      function_kind: "f",
      language_name: "plpgsql",
      function_config: ["search_path=pg_catalog"],
      public_execute: false,
      runtime_direct_execute: !privateNames.has(functionName),
      runtime_execute_grantable: false,
      other_role_execute: [],
    }));

    assert.deepEqual(
      collectNotificationFunctionIssues(exactRows, runtimeRole, migrationRole),
      [],
    );
    const drifted = exactRows.map((row) => row.function_name === "grainline_notification_create_core"
      ? { ...row, public_execute: true, runtime_direct_execute: true }
      : row);
    const issues = collectNotificationFunctionIssues(
      [
        ...drifted,
        { ...exactRows[0] },
        {
          ...exactRows[0],
          function_name: "grainline_notification_unreviewed",
        },
      ],
      runtimeRole,
      migrationRole,
    ).join("\n");
    assert.match(issues, /grainline_notification_create_core.*must revoke EXECUTE from PUBLIC/);
    assert.match(issues, /grainline_notification_create_core.*must remain runtime-ungranted/);
    assert.match(issues, /grainline_notification_unread_count must have exactly one overload/);
    assert.match(issues, /unexpected Notification RPC grainline_notification_unreviewed/);
  });

  it("pins Conversation/Message authority signatures, modes, owners, and ACLs", () => {
    const runtimeRole = "grainline_app_runtime";
    const migrationRole = "grainline_migration_owner";
    const functionRow = (entry, overrides = {}) => ({
      function_name: entry.name,
      args: entry.signature,
      argument_types: entry.signature,
      owner_name: migrationRole,
      security_definer: entry.securityDefiner,
      leakproof: false,
      volatility: entry.volatility,
      parallel_safety: entry.parallelSafety,
      function_kind: "f",
      language_name: entry.language,
      function_config: ["search_path=pg_catalog"],
      execute_priv: entry.runtimeExecute,
      public_execute: false,
      runtime_direct_execute: entry.runtimeExecute,
      runtime_execute_grantable: false,
      other_role_execute: [],
      ...overrides,
    });
    const exactRows = CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS.map(
      (entry) => functionRow(entry),
    );
    const redactionEntry = CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS.find(
      (entry) => entry.name === "grainline_message_redact_for_account_deletion",
    );
    assert.ok(redactionEntry);
    const claimedRedactionRow = functionRow(redactionEntry, {
      args: "text, text, bigint, uuid",
      argument_types: "text, text, bigint, uuid",
    });
    const preparedInventory = {
      functions: ["grainline_account_deletion_claim_user"],
      rlsEnableTables: [],
      rlsPolicyTables: [],
    };
    const activeInventory = {
      ...preparedInventory,
      rlsEnableTables: [ACCOUNT_DELETION_SIDE_EFFECT_TABLE],
      rlsPolicyTables: [ACCOUNT_DELETION_SIDE_EFFECT_TABLE],
    };
    const livePredecessorInventory = {
      ...preparedInventory,
      accountDeletionClaimFencePreparationApplied: false,
      accountDeletionMediaKeyPreparationApplied: false,
      accountDeletionSideEffectRlsActivationApplied: false,
    };

    assert.deepEqual(
      collectConversationMessageFunctionIssues(
        exactRows,
        runtimeRole,
        migrationRole,
      ),
      [],
    );
    assert.deepEqual(
      collectConversationMessageFunctionIssues(
        exactRows,
        runtimeRole,
        migrationRole,
        livePredecessorInventory,
      ),
      [],
      "source-only preparation files must not change live predecessor expectations",
    );
    assert.deepEqual(
      collectConversationMessageFunctionIssues(
        [...exactRows, claimedRedactionRow],
        runtimeRole,
        migrationRole,
        preparedInventory,
      ),
      [],
    );
    assert.deepEqual(
      collectConversationMessageFunctionIssues(
        [
          ...exactRows.map((row) => (
            row.function_name === "grainline_message_redact_for_account_deletion"
              ? { ...row, execute_priv: false, runtime_direct_execute: false }
              : row
          )),
          claimedRedactionRow,
        ],
        runtimeRole,
        migrationRole,
        activeInventory,
      ),
      [],
    );
    assert.match(
      collectConversationMessageFunctionIssues(
        exactRows,
        runtimeRole,
        migrationRole,
        preparedInventory,
      ).join("\n"),
      /missing expected Conversation\/Message RPC grainline_message_redact_for_account_deletion\(text,text,bigint,uuid\)/,
    );
    const drifted = exactRows.map((row) => (
      row.function_name === "grainline_conversation_lock_pair_core"
        ? {
            ...row,
            public_execute: true,
            runtime_direct_execute: true,
            execute_priv: true,
          }
        : row
    ));
    const issues = collectConversationMessageFunctionIssues(
      [
        ...drifted,
        { ...exactRows[0] },
        {
          ...exactRows[0],
          function_name: "grainline_conversation_unreviewed",
        },
      ],
      runtimeRole,
      migrationRole,
    ).join("\n");
    assert.match(
      issues,
      /grainline_conversation_lock_pair_core.*must revoke EXECUTE from PUBLIC/,
    );
    assert.match(
      issues,
      /grainline_conversation_lock_pair_core.*must remain runtime-ungranted/,
    );
    assert.match(
      issues,
      /grainline_conversation_staff_report_visible\(text\) must have exactly one definition/,
    );
    assert.match(
      issues,
      /unexpected Conversation\/Message RPC grainline_conversation_unreviewed/,
    );
    const unexpectedOverloadIssues = collectConversationMessageFunctionIssues(
      [
        ...exactRows,
        claimedRedactionRow,
        { ...claimedRedactionRow, args: "text, text", argument_types: "text, text" },
      ],
      runtimeRole,
      migrationRole,
      preparedInventory,
    ).join("\n");
    assert.match(
      unexpectedOverloadIssues,
      /unexpected Conversation\/Message RPC grainline_message_redact_for_account_deletion\(text, text\)/,
    );
  });

  it("rejects grantable runtime EXECUTE for every Grainline function", () => {
    assert.deepEqual(
      collectRuntimeFunctionGrantOptionIssues([
        {
          function_name: "grainline_stripe_webhook_begin",
          args: "p_event_id text, p_event_type text",
          runtime_execute_grantable: false,
        },
      ]),
      [],
    );
    assert.deepEqual(
      collectRuntimeFunctionGrantOptionIssues([
        {
          function_name: "grainline_stripe_webhook_begin",
          args: "p_event_id text, p_event_type text",
          runtime_execute_grantable: true,
        },
      ]),
      [
        "grainline_stripe_webhook_begin(p_event_id text, p_event_type text) runtime EXECUTE must not be grantable",
      ],
    );
  });

  it("rejects PUBLIC execution on Grainline functions except the reviewed pure validator", () => {
    const issues = collectPublicFunctionExecuteIssues([
      {
        function_name: "grainline_sensitive_definer",
        argument_types: "text, bigint",
        public_execute: true,
      },
      {
        function_name: "grainline_notification_preferences_valid",
        argument_types: "jsonb",
        public_execute: true,
      },
      {
        function_name: "grainline_private_helper",
        argument_types: "text",
        public_execute: false,
      },
    ]);
    assert.deepEqual(issues, [
      "grainline_sensitive_definer(text,bigint) must revoke EXECUTE from PUBLIC",
    ]);
  });

  it("rejects effective restricted-role function authority not backed by a direct grant", () => {
    assert.deepEqual(
      collectRestrictedRoleEffectiveFunctionIssues([
        {
          role_name: "grainline_staff_read_runtime",
          role_exists: true,
          direct_function_identities: [],
          effective_function_identities: [],
        },
      ]),
      [],
    );
    assert.deepEqual(
      collectRestrictedRoleEffectiveFunctionIssues([
        {
          role_name: "grainline_staff_read_runtime",
          role_exists: true,
          direct_function_identities: ["grainline_staff_page(text)"],
          effective_function_identities: [
            "grainline_notification_preferences_valid(jsonb)",
            "grainline_staff_page(text)",
          ],
        },
      ]),
      [],
    );
    const issues = collectRestrictedRoleEffectiveFunctionIssues([
      {
        role_name: "grainline_staff_read_runtime",
        role_exists: true,
        direct_function_identities: ["grainline_staff_page(text)"],
        effective_function_identities: [
          "grainline_staff_page(text)",
          "grainline_unreviewed_definer(text)",
        ],
      },
      {
        role_name: "grainline_missing_runtime",
        role_exists: false,
        direct_function_identities: [],
        effective_function_identities: [],
      },
    ]).join("\n");
    assert.match(issues, /grainline_staff_read_runtime.*grainline_unreviewed_definer/);
    assert.match(issues, /restricted role grainline_missing_runtime does not exist/);
  });

  it("pins staff-read direct and effective authority to the reviewed function catalog", () => {
    const expectedByRole = {
      grainline_staff_read_runtime: STAFF_READ_FUNCTION_IDENTITIES,
    };
    const postgresIdentities = STAFF_READ_FUNCTION_IDENTITIES
      .map((identity) => identity.replaceAll(",", ", "));
    assert.deepEqual(
      collectRestrictedRoleEffectiveFunctionIssues(
        [
          {
            role_name: "grainline_staff_read_runtime",
            role_exists: true,
            direct_function_identities: [...postgresIdentities].reverse(),
            effective_function_identities: [
              "grainline_notification_preferences_valid(jsonb)",
              ...postgresIdentities,
            ],
          },
        ],
        expectedByRole,
      ),
      [],
    );

    const unexpected = collectRestrictedRoleEffectiveFunctionIssues(
      [
        {
          role_name: "grainline_staff_read_runtime",
          role_exists: true,
          direct_function_identities: [
            ...STAFF_READ_FUNCTION_IDENTITIES,
            "grainline_unreviewed_definer(text)",
          ],
          effective_function_identities: [
            ...STAFF_READ_FUNCTION_IDENTITIES,
            "grainline_unreviewed_definer(text)",
          ],
        },
      ],
      expectedByRole,
    ).join("\n");
    assert.match(unexpected, /direct function authority drifted/u);
    assert.match(unexpected, /effective function authority drifted/u);

    const missing = collectRestrictedRoleEffectiveFunctionIssues(
      [
        {
          role_name: "grainline_staff_read_runtime",
          role_exists: true,
          direct_function_identities: STAFF_READ_FUNCTION_IDENTITIES.slice(1),
          effective_function_identities: STAFF_READ_FUNCTION_IDENTITIES.slice(1),
        },
      ],
      expectedByRole,
    ).join("\n");
    assert.match(missing, /direct function authority drifted/u);
    assert.match(missing, /effective function authority drifted/u);
  });

  it("keeps the staff-read audit catalog aligned with role provisioning", () => {
    const provision = source("scripts/provision-order-staff-read-role.sql");
    const provisioned = [...provision.matchAll(/\('public\."([^"]+)"\(([^)]*)\)'\)/gu)]
      .map((match) => `${match[1]}(${match[2].replace(/,\s*/gu, ",").trim()})`);
    assert.deepEqual(
      [...new Set(provisioned)].sort((a, b) => a.localeCompare(b)),
      [...STAFF_READ_FUNCTION_IDENTITIES].sort((a, b) => a.localeCompare(b)),
    );
    const runtimePrivateNames = new Set(
      runtimePrivateFunctionNames(deriveGrantInventory()),
    );
    for (const identity of STAFF_READ_FUNCTION_IDENTITIES) {
      assert.ok(
        runtimePrivateNames.has(identity.slice(0, identity.indexOf("("))),
        `${identity} must remain unavailable to ordinary runtime`,
      );
    }
  });

  it("derives exact migration and provisioned staff-read catalogs", () => {
    const currentInventory = deriveGrantInventory();
    const availableMigrationStaffReadIdentities =
      MIGRATION_STAFF_READ_FUNCTION_IDENTITIES.filter((identity) =>
        currentInventory.functions.includes(identity.slice(0, identity.indexOf("("))));
    const availableStaffReadIdentities = STAFF_READ_FUNCTION_IDENTITIES.filter(
      (identity) =>
        currentInventory.functions.includes(identity.slice(0, identity.indexOf("("))),
    );
    const migrationIdentity = MIGRATION_STAFF_READ_FUNCTION_IDENTITIES[0];
    const migrationName = migrationIdentity.slice(0, migrationIdentity.indexOf("("));
    const orderIdentity = STAFF_READ_FUNCTION_IDENTITIES[0];
    const orderName = orderIdentity.slice(0, orderIdentity.indexOf("("));
    const marker = "grainline:staff-read-bootstrap:123e4567-e89b-42d3-a456-426614174000:66746f47e87a73a6efce2ee6833542be5a86cc57";
    assert.match(marker, STAFF_READ_BOOTSTRAP_MARKER_PATTERN);
    assert.deepEqual(
      staffReadFunctionIdentitiesForInventory({ functions: [] }),
      [],
    );
    assert.deepEqual(
      staffReadFunctionIdentitiesForInventory({ functions: [migrationName] }),
      [migrationIdentity],
    );
    assert.deepEqual(
      staffReadFunctionIdentitiesForInventory({ functions: [orderName] }),
      [orderIdentity],
    );
    const historicalOrderFunctions = STAFF_READ_FUNCTION_IDENTITIES.slice(0, 6);
    assert.deepEqual(
      historicalOrderFunctions,
      [...MIGRATION_ORDER_STAFF_READ_FUNCTION_IDENTITIES],
    );
    const historicalOrderInventory = {
      functions: historicalOrderFunctions.map((identity) =>
        identity.slice(0, identity.indexOf("("))),
    };
    assert.deepEqual(
      staffReadFunctionIdentitiesForInventory(historicalOrderInventory),
      historicalOrderFunctions,
    );
    const historicalUserInventory = {
      functions: MIGRATION_STAFF_READ_FUNCTION_IDENTITIES.map((identity) =>
        identity.slice(0, identity.indexOf("("))),
    };
    assert.deepEqual(
      staffReadFunctionIdentitiesForInventory(historicalUserInventory),
      [...MIGRATION_STAFF_READ_FUNCTION_IDENTITIES],
    );
    assert.deepEqual(
      staffReadFunctionIdentitiesForInventory(currentInventory),
      availableMigrationStaffReadIdentities,
    );
    assert.deepEqual(
      staffReadFunctionIdentitiesForInventory(currentInventory, marker),
      [...new Set([
        ...availableStaffReadIdentities,
        ...availableMigrationStaffReadIdentities,
      ])],
    );
    assert.deepEqual(
      staffReadFunctionIdentitiesForInventory(
        currentInventory,
        null,
        ORDER_USER_COMBINED_STAFF_READ_STAGE,
      ),
      [...new Set([
        ...availableStaffReadIdentities,
        ...availableMigrationStaffReadIdentities,
      ])],
    );
    assert.deepEqual(
      staffReadFunctionIdentitiesForInventory(
        {
          ...currentInventory,
          functions: currentInventory.functions.filter(
            (name) => name !== "grainline_user_staff_admin_labels",
          ),
        },
        null,
        ORDER_USER_COMBINED_STAFF_READ_STAGE,
      ),
      availableStaffReadIdentities.filter(
        (identity) => !identity.startsWith("grainline_user_staff_admin_labels("),
      ),
    );
    assert.deepEqual(
      staffReadFunctionIdentitiesForInventory(
        deriveGrantInventory(),
        null,
        ORDER_ZERO_DIRECT_PRIVATE_STAFF_READ_STAGE,
      ),
      [],
    );
    assert.throws(
      () => staffReadFunctionIdentitiesForInventory(
        deriveGrantInventory(),
        marker,
        ORDER_ZERO_DIRECT_PRIVATE_STAFF_READ_STAGE,
      ),
      /requires an unmarked role/u,
    );
    assert.throws(
      () => staffReadFunctionIdentitiesForInventory(
        deriveGrantInventory(),
        marker,
        ORDER_USER_COMBINED_STAFF_READ_STAGE,
      ),
      /requires an unmarked role/u,
    );
    assert.throws(
      () => staffReadFunctionIdentitiesForInventory(
        deriveGrantInventory(),
        null,
        "unknown",
      ),
      /unknown staff-read audit stage/u,
    );
    const unmarkedFunctions = staffReadFunctionIdentitiesForInventory(
      deriveGrantInventory(),
    );
    assert.deepEqual(collectRestrictedRoleEffectiveFunctionIssues([{
      role_name: "grainline_staff_read_runtime",
      role_exists: true,
      role_marker: null,
      direct_function_identities: unmarkedFunctions
        .map((identity) => identity.replaceAll(",", ", ")),
      effective_function_identities: unmarkedFunctions
        .map((identity) => identity.replaceAll(",", ", ")),
    }], {
      grainline_staff_read_runtime: unmarkedFunctions,
    }), []);
    assert.deepEqual(collectStaffReadRoleMarkerIssues([{
      role_name: "grainline_staff_read_runtime",
      role_exists: true,
      role_marker: null,
    }, {
      role_name: "grainline_staff_read_runtime",
      role_exists: true,
      role_marker: marker,
    }]), []);
    assert.deepEqual(collectStaffReadRoleMarkerIssues([{
      role_name: "grainline_staff_read_runtime",
      role_exists: true,
      role_marker: "grainline:staff-read-bootstrap:invalid",
    }]), [
      "restricted role grainline_staff_read_runtime bootstrap marker is invalid",
    ]);
  });

  it("derives the current runtime grant surface from schema and migrations", () => {
    const inventory = deriveGrantInventory();
    const supportRequestRlsEnabled =
      typeof supportRequestRlsActivationExpected === "function"
      && supportRequestRlsActivationExpected(inventory);
    const sellerProfilePublicCandidatePresent = existsSync(
      SELLER_PROFILE_PUBLIC_CANDIDATE_FIRST_MIGRATION,
    );
    const sellerProfilePublicVisibilityMirrorPresent = existsSync(
      SELLER_PROFILE_PUBLIC_VISIBILITY_MIRROR_MIGRATION,
    ) && SELLER_PROFILE_PUBLIC_VISIBILITY_MIRROR_PRIVATE_FUNCTION_NAMES.every(
      (functionName) => source(
        SELLER_PROFILE_PUBLIC_VISIBILITY_MIRROR_MIGRATION,
      ).includes(`FUNCTION public.${functionName}()`),
    );
    const sellerProfilePublicProvisioningPresent = source(
      "scripts/provision-runtime-db-role.sql",
    ).includes("SellerExactMapConsentEvent");
    const orderOpsHealthMigrationPath =
      "prisma/migrations/20260930033000_order_ops_health_summary/migration.sql";
    const orderOpsHealthMigrationPresent = existsSync(orderOpsHealthMigrationPath)
      && source(orderOpsHealthMigrationPath).includes(
        "CREATE FUNCTION public.grainline_order_ops_health_summary(",
      );
    const orderItemQuoteRuntimeLockMigrationPath =
      "prisma/migrations/20260929130000_revoke_order_item_shipping_quote_runtime_access/migration.sql";
    const orderItemQuoteRuntimeLockMigrationPresent = existsSync(
      orderItemQuoteRuntimeLockMigrationPath,
    ) && source(orderItemQuoteRuntimeLockMigrationPath).includes(
      'REVOKE ALL ON TABLE\n  public."OrderItem",\n  public."OrderShippingRateQuote"\nFROM PUBLIC, grainline_app_runtime;',
    );
    const sellerProfilePrivateForceMigrationPresent = existsSync(
      "prisma/migrations/20261015120000_force_seller_profile_private_rls/migration.sql",
    );
    const sellerProfilePublicForceMigrationPresent = existsSync(
      "prisma/migrations/20261020250000_force_seller_profile_rls/migration.sql",
    );
    const postForceCheckoutSuccessorRevokePresent = [
      "prisma/migrations/20260930031000_mark_paid_private_listing_sold/migration.sql",
      "prisma/migrations/20260930032000_block_checkout_user_pairs/migration.sql",
    ].some((migrationPath) => existsSync(migrationPath)
      && source(migrationPath).includes(
        "REVOKE ALL ON FUNCTION public.grainline_stripe_checkout_order_create(",
      ));
    const sellerBuyerEmailProjectionMigrationPath =
      "prisma/migrations/20260928213000_remove_seller_buyer_email_projection/migration.sql";
    const sellerBuyerEmailProjectionMigration = existsSync(
      sellerBuyerEmailProjectionMigrationPath,
    )
      ? source(sellerBuyerEmailProjectionMigrationPath)
      : "";
    const sellerBuyerEmailProjectionMigrationPresent =
      sellerBuyerEmailProjectionMigration.includes(
        "CREATE FUNCTION public.grainline_order_seller_detail_v5(",
      )
      && sellerBuyerEmailProjectionMigration.includes(
        "CREATE FUNCTION public.grainline_order_seller_recent_sales_v2(",
      );
    const disputeRecoveryMigrationPath =
      "prisma/migrations/20260930040000_prepare_order_dispute_recovery/migration.sql";
    const disputeRecoveryMigration = existsSync(disputeRecoveryMigrationPath)
      ? source(disputeRecoveryMigrationPath)
      : "";
    const disputeRecoveryMigrationPresent = disputeRecoveryMigration.includes(
      'CREATE TABLE public."OrderDisputeRecovery"',
    ) && disputeRecoveryMigration.includes(
      'CREATE TYPE public."OrderDisputeRecoveryStatus" AS ENUM',
    );
    const disputeRecoveryFunctionNames = [
      "grainline_order_dispute_recovery_claim_batch",
      "grainline_order_dispute_recovery_event_claim",
      "grainline_order_dispute_recovery_finalize",
      "grainline_order_dispute_recovery_health_summary",
    ];
    const caseRefundProviderRecoveryMigrationPath =
      "prisma/migrations/20261001070000_prepare_case_refund_provider_recovery/migration.sql";
    const caseRefundProviderRecoveryMigrationPresent = existsSync(
      caseRefundProviderRecoveryMigrationPath,
    ) && source(caseRefundProviderRecoveryMigrationPath).includes(
      "CREATE OR REPLACE FUNCTION\n  public.grainline_case_staff_resolution_provider_recover(",
    );
    const caseRefundProviderRecoveryFunctionNames = [
      "grainline_case_staff_resolution_provider_clock",
      "grainline_case_staff_resolution_provider_recover",
      "grainline_case_staff_resolution_provider_recovery_load",
      "grainline_case_staff_resolution_provider_recovery_record",
      "grainline_case_staff_resolution_recovery_finalize",
    ];
    const partialRefundFulfillmentMigrationPath =
      "prisma/migrations/20261002010000_allow_partial_refund_fulfillment/migration.sql";
    const partialRefundFulfillmentMigrationPresent = existsSync(
      partialRefundFulfillmentMigrationPath,
    ) && source(partialRefundFulfillmentMigrationPath).includes(
      "CREATE FUNCTION public.grainline_order_refund_blocks_fulfillment(",
    );
    const blockedCheckoutRefundWitnessMigrationPath =
      "prisma/migrations/20261015030000_preserve_blocked_checkout_refund_witness/migration.sql";
    const blockedCheckoutRefundWitnessFunctionNames = [
      "grainline_order_blocked_checkout_refund_witness_immutable",
    ];
    const blockedCheckoutRefundWitnessMigrationPresent = existsSync(
      blockedCheckoutRefundWitnessMigrationPath,
    ) && blockedCheckoutRefundWitnessFunctionNames.every((functionName) =>
      source(blockedCheckoutRefundWitnessMigrationPath).includes(
        `CREATE FUNCTION public.${functionName}(`,
      ));
    const blockedPairCheckoutCompletionMigrationPath =
      "prisma/migrations/20261016000000_correct_blocked_pair_paid_checkout_completion/migration.sql";
    const blockedPairCheckoutCompletionMigrationPresent = existsSync(
      blockedPairCheckoutCompletionMigrationPath,
    ) && source(blockedPairCheckoutCompletionMigrationPath).includes(
      "CREATE OR REPLACE FUNCTION public.grainline_checkout_reservation_complete(",
    );
    const clerkWebhookAuthorityMigrationPath =
      "prisma/migrations/20261008120000_prepare_clerk_webhook_event_authority/migration.sql";
    const clerkWebhookAuthorityPrepared = existsSync(
      clerkWebhookAuthorityMigrationPath,
    ) && source(clerkWebhookAuthorityMigrationPath).includes(
      "CREATE FUNCTION public.grainline_clerk_webhook_begin(",
    );
    const clerkWebhookAuthorityFunctionNames = [
      "grainline_clerk_webhook_begin",
      "grainline_clerk_webhook_complete",
      "grainline_clerk_webhook_fail",
      "grainline_clerk_webhook_health_summary",
      "grainline_clerk_webhook_prune_batch",
    ];
    const accountDeletionClaimFenceMigrationPath =
      "prisma/migrations/20261011170000_prepare_account_deletion_side_effect_claim_fence/migration.sql";
    const accountDeletionMediaKeyFenceMigrationPath =
      "prisma/migrations/20261011173000_prepare_account_deletion_media_key_fence/migration.sql";
    const accountDeletionClaimFenceFunctionNames = [
      "grainline_account_deletion_claim_user",
      "grainline_account_deletion_media_enqueue_claimed",
      "grainline_account_deletion_media_key_enqueue_claimed",
      "grainline_account_deletion_side_effect_claim",
      "grainline_account_deletion_side_effect_complete",
      "grainline_account_deletion_side_effect_fail",
    ];
    const accountDeletionClaimFencePrepared = existsSync(
      accountDeletionClaimFenceMigrationPath,
    ) && existsSync(accountDeletionMediaKeyFenceMigrationPath) &&
      accountDeletionClaimFenceFunctionNames.every((functionName) =>
        `${source(accountDeletionClaimFenceMigrationPath)}\n${source(accountDeletionMediaKeyFenceMigrationPath)}`.includes(
          `CREATE FUNCTION public.${functionName}(`,
        ));
    const listingHideDeleteMigrationPath =
      "prisma/migrations/20261013040000_add_listing_archived_at/migration.sql";
    const listingHideDeleteMigrationPresent = existsSync(
      listingHideDeleteMigrationPath,
    ) && source(listingHideDeleteMigrationPath).includes(
      "CREATE FUNCTION public.grainline_listing_delete_reference_state(",
    );
    const supportRequestAuthorityMigrationPath =
      "prisma/migrations/20261023010000_prepare_support_request_authorities/migration.sql";
    const supportRequestAuthorityFunctionNames = [
      "grainline_support_request_submit",
      "grainline_support_request_delivery_record",
      "grainline_support_request_owner_export",
      "grainline_support_request_staff_state",
      "grainline_support_request_staff_transition",
      "grainline_support_request_account_deletion_redact_batch",
      "grainline_support_request_provider_deletion_upsert",
      "grainline_support_request_overdue_count",
      "grainline_support_request_retention_delete_batch",
    ];
    const supportRequestAuthorityPrepared = existsSync(
      supportRequestAuthorityMigrationPath,
    ) && supportRequestAuthorityFunctionNames.every((functionName) =>
      source(supportRequestAuthorityMigrationPath).includes(
        `FUNCTION public.${functionName}(`,
      ));
    const supportRequestEnableMigrationPresent = existsSync(
      "prisma/migrations/20261023020000_enable_support_request_rls/migration.sql",
    );
    const supportRequestForceMigrationPresent = existsSync(
      "prisma/migrations/20261023060000_force_support_request_rls/migration.sql",
    );
    const savedBlogPostRlsActivationMigrationPresent = existsSync(
      "prisma/migrations/20261023070000_activate_saved_blog_post_rls/migration.sql",
    );
    const sellerProfilePrivatePreparationMigrationPath =
      "prisma/migrations/20261013120000_prepare_seller_profile_private_boundary/migration.sql";
    const sellerProfilePrivatePreparationMigrationPresent = existsSync(
      sellerProfilePrivatePreparationMigrationPath,
    ) && SELLER_PROFILE_PRIVATE_PREPARATION_FUNCTION_NAMES.every((functionName) =>
      source(sellerProfilePrivatePreparationMigrationPath).includes(
        `FUNCTION public.${functionName}()`,
      ));
    const sellerProfilePrivateRetirementMigrationPath =
      "prisma/migrations/20261015010000_retire_seller_profile_private_predecessor/migration.sql";
    const sellerProfilePrivateRetirementMigrationPresent = existsSync(
      sellerProfilePrivateRetirementMigrationPath,
    ) && SELLER_PROFILE_PRIVATE_RETIREMENT_FUNCTION_NAMES.every((functionName) =>
      source(sellerProfilePrivateRetirementMigrationPath).includes(
        `FUNCTION public.${functionName}()`,
      ));
    const sellerProfilePrivateInvariantsMigrationPath =
      "prisma/migrations/20261015080000_restore_seller_profile_private_invariants/migration.sql";
    const sellerProfilePrivateInvariantsMigrationPresent = existsSync(
      sellerProfilePrivateInvariantsMigrationPath,
    ) && SELLER_PROFILE_PRIVATE_INVARIANT_FUNCTION_NAMES.every((functionName) =>
      source(sellerProfilePrivateInvariantsMigrationPath).includes(
        `FUNCTION public.${functionName}()`,
      ));
    const sellerProfilePrivateEnableMigrationPresent = existsSync(
      "prisma/migrations/20261015100000_enable_seller_profile_private_rls/migration.sql",
    );
    const sellerProfilePrivateBoundaryFunctionNames =
      sellerProfilePrivateRetirementMigrationPresent
        ? SELLER_PROFILE_PRIVATE_RETIREMENT_FUNCTION_NAMES
        : sellerProfilePrivatePreparationMigrationPresent
          ? SELLER_PROFILE_PRIVATE_PREPARATION_FUNCTION_NAMES
          : [];
    const sellerProfilePrivateCallerTransitionFunctionNames = [
      "grainline_seller_profile_deauthorize_compat",
      "grainline_seller_profile_reconciliation_required_compat",
    ];
    const sellerProfilePrivateCallerTransitionsPresent = [
      "prisma/migrations/20261013180000_move_provider_identity_seller_private_sql_callers/migration.sql",
      "prisma/migrations/20261013190000_move_reconciliation_seller_private_sql_callers/migration.sql",
    ].every((migrationPath, index) => existsSync(migrationPath)
      && source(migrationPath).includes(
        `CREATE OR REPLACE FUNCTION public.${sellerProfilePrivateCallerTransitionFunctionNames[index]}(`,
      ));
    const sellerProfilePrivateAppAuthorityFunctionNames =
      SELLER_PROFILE_PRIVATE_APP_AUTHORITY_GROUPS.flatMap(({ migration, functions }) => {
        const migrationPath = `prisma/migrations/${migration}/migration.sql`;
        if (!existsSync(migrationPath)) return [];
        const migrationSource = source(migrationPath);
        return functions.every((functionName) => migrationSource.includes(
          `CREATE OR REPLACE FUNCTION public.${functionName}(`,
        )) ? functions : [];
      });
    const sellerProfilePrivateStaffReadFunctionNames =
      SELLER_PROFILE_PRIVATE_STAFF_READ_AUTHORITY_GROUPS.flatMap(({ migration, functions }) => {
        const migrationPath = `prisma/migrations/${migration}/migration.sql`;
        if (!existsSync(migrationPath)) return [];
        const migrationSource = source(migrationPath);
        return functions.every((functionName) => migrationSource.includes(
          `CREATE OR REPLACE FUNCTION public.${functionName}(`,
        )) ? functions : [];
      });
    const conversationMessageAuthorityPrepared =
      CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS.every(
        (entry) => inventory.functions.includes(entry.name),
      );
    const userEmailAddressAuthorityFunctionNames = [
      "grainline_user_email_address_delete_for_current_user",
      "grainline_user_email_address_newer_current_claim",
      "grainline_user_email_address_owner_rows",
      "grainline_user_email_address_sync",
    ];
    const userEmailAddressAuthorityPrepared =
      userEmailAddressAuthorityFunctionNames.every(
        (functionName) => inventory.functions.includes(functionName),
      );
    const userUnsubscribeOptionalPreferencesCorrectionPresent = existsSync(
      "prisma/migrations/20261023030000_correct_user_unsubscribe_optional_email_preferences/migration.sql",
    );
    const cartCartItemRlsActivationPresent = existsSync(
      CART_CART_ITEM_RLS_MIGRATION,
    ) && CART_CART_ITEM_RUNTIME_FUNCTION_NAMES.every((functionName) =>
      source(CART_CART_ITEM_RLS_MIGRATION).includes(
        `CREATE FUNCTION public.${functionName}(`,
      ));
    const stockNotificationAuthorityPrepared = existsSync(
      STOCK_NOTIFICATION_PREPARATION_MIGRATION,
    ) && STOCK_NOTIFICATION_PREPARATION_FUNCTION_NAMES.every((functionName) =>
      source(STOCK_NOTIFICATION_PREPARATION_MIGRATION).includes(
        `FUNCTION public.${functionName}(`,
      ));
    const stockNotificationRlsActivationPresent = existsSync(
      STOCK_NOTIFICATION_RLS_MIGRATION,
    );
    const favoriteAuthorityPrepared = existsSync(
      FAVORITE_PREPARATION_MIGRATION,
    ) && FAVORITE_PREPARATION_FUNCTION_NAMES.every((functionName) =>
      source(FAVORITE_PREPARATION_MIGRATION).includes(
        `FUNCTION public.${functionName}(`,
      ));
    const followAuthorityPrepared = existsSync(
      FOLLOW_PREPARATION_MIGRATION,
    ) && FOLLOW_PREPARATION_FUNCTION_NAMES.every((functionName) =>
      source(FOLLOW_PREPARATION_MIGRATION).includes(
        `FUNCTION public.${functionName}(`,
      ));
    const emailDeliveryLedgerPrepared = existsSync(
      EMAIL_DELIVERY_LEDGER_MIGRATION,
    ) && EMAIL_DELIVERY_LEDGER_FUNCTION_NAMES.every((functionName) =>
      source(EMAIL_DELIVERY_LEDGER_MIGRATION).includes(
        `FUNCTION public.${functionName}(`,
      ));
    const emailProviderDeletionFencePrepared = existsSync(
      EMAIL_PROVIDER_DELETION_FENCE_MIGRATION_PATH,
    ) && EMAIL_PROVIDER_DELETION_FENCE_FUNCTION_NAMES.every((functionName) =>
      source(EMAIL_PROVIDER_DELETION_FENCE_MIGRATION_PATH).includes(
        `FUNCTION public.${functionName}(`,
      ));
    const emailProviderEligibilityFencePrepared = existsSync(
      EMAIL_PROVIDER_ELIGIBILITY_FENCE_MIGRATION_PATH,
    ) && EMAIL_PROVIDER_ELIGIBILITY_FENCE_SOURCE_NEW_FUNCTION_NAMES.every((functionName) =>
      source(EMAIL_PROVIDER_ELIGIBILITY_FENCE_MIGRATION_PATH).includes(
        `FUNCTION public.${functionName}(`,
      ));
    const emailProviderEligibilitySubstitutesUnsubscribeRevoke =
      emailProviderEligibilityFencePrepared
      && !userUnsubscribeOptionalPreferencesCorrectionPresent;
    const availableUserAuthorityIdentities = new Set(USER_AUTHORITY_GROUPS
      .filter(({ migration }) => existsSync(`prisma/migrations/${migration}/migration.sql`))
      .flatMap(({ functions }) => functions.map(({ identity }) => identity)));
    const userAuthorityFunctions = USER_AUTHORITY_FUNCTIONS.filter(({ identity }) =>
      availableUserAuthorityIdentities.has(identity));
    const orderDeauthorizedCaseAccessPrepared =
      ORDER_DEAUTHORIZED_CASE_ACCESS_RUNTIME_FUNCTIONS.every(
        (identity) => inventory.functions.includes(
          identity.slice(0, identity.indexOf("(")),
        ),
      );

    assert.equal(inventory.tables.length, disputeRecoveryMigrationPresent ? 70 : 69);
    assert.equal(inventory.enums.length, disputeRecoveryMigrationPresent ? 23 : 22);
    assert.deepEqual(inventory.functions, [...new Set([
      ...(accountDeletionClaimFencePrepared
        ? accountDeletionClaimFenceFunctionNames
        : []),
      "grainline_case_resolution_claim_immutable",
      "grainline_case_resolution_claim_lease_valid",
      "grainline_case_account_deletion_blockers",
      "grainline_case_account_deletion_redact",
      ...CASE_INVARIANT_FUNCTIONS.map((entry) => entry.name),
      "grainline_case_cron_transition_batch",
      "grainline_case_escalate",
      "grainline_case_export_page",
      "grainline_case_get",
      "grainline_case_get_by_order",
      "grainline_case_guild_unresolved_guard",
      "grainline_case_message_page",
      "grainline_case_message_preflight",
      "grainline_case_open",
      "grainline_case_order_active_for_buyer",
      "grainline_case_order_active_for_seller",
      "grainline_case_reply",
      "grainline_case_mark_resolved",
      "grainline_case_seller_refund_apply",
      "grainline_case_seller_active_count",
      "grainline_case_seller_verification_eligibility",
      "grainline_case_staff_resolution_finalize",
      "grainline_case_staff_resolution_prepare",
      ...(caseRefundProviderRecoveryMigrationPresent
        ? caseRefundProviderRecoveryFunctionNames
        : []),
      "grainline_case_staff_resolution_provider_record",
      "grainline_case_staff_resolution_reconcile",
      "grainline_case_staff_active_count",
      "grainline_case_staff_queue",
      "grainline_case_stripe_dispute_apply",
      "grainline_order_buyer_pii_prune_batch",
      ...(disputeRecoveryMigrationPresent ? disputeRecoveryFunctionNames : []),
      "grainline_order_item_seller_key_bind",
      "grainline_order_item_seller_key_complete",
      ...(orderOpsHealthMigrationPresent
        ? ["grainline_order_ops_health_summary"]
        : []),
      ...(sellerBuyerEmailProjectionMigrationPresent
        ? ["grainline_order_seller_detail_v5"]
        : []),
      "grainline_order_seller_key_assert",
      "grainline_order_seller_key_complete",
      ...(sellerBuyerEmailProjectionMigrationPresent
        ? ["grainline_order_seller_recent_sales_v2"]
        : []),
      ...ORDER_REFUND_CLAIM_FUNCTION_NAMES,
      ...ORDER_REFUND_RECORD_PRIVATE_FUNCTION_NAMES,
      ...ORDER_PAYMENT_SIGNED_AUTHORITY_FUNCTION_NAMES,
      ...ORDER_REFUND_RECONCILIATION_RUNTIME_FUNCTION_NAMES,
      ...ORDER_REFUND_RECONCILIATION_PRIVATE_FUNCTION_NAMES,
      ...BLOCKED_CHECKOUT_TRANSFER_BINDING_FUNCTION_NAMES,
      ...ORDER_PAYMENT_EVENT_INVARIANT_FUNCTIONS,
      ...ORDER_PAYMENT_EVENT_READ_AUTHORITY_FUNCTIONS.map(
        (identity) => identity.slice(0, identity.indexOf("(")),
      ),
      ...ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_FUNCTIONS,
      ...ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_FUNCTIONS,
      ...ORDER_PARTICIPANT_LIST_AUTHORITY_FUNCTIONS.map(
        (identity) => identity.slice(0, identity.indexOf("(")),
      ),
      ...ORDER_PARTICIPANT_DETAIL_AUTHORITY_FUNCTIONS.map(
        (identity) => identity.slice(0, identity.indexOf("(")),
      ),
      ...ORDER_PARTICIPANT_DETAIL_PROJECTION_FUNCTIONS.map(
        (identity) => identity.slice(0, identity.indexOf("(")),
      ),
      ...ORDER_PARTICIPANT_SNAPSHOT_CORRECTION_FUNCTIONS.map(
        (identity) => identity.slice(0, identity.indexOf("(")),
      ),
      ...(orderDeauthorizedCaseAccessPrepared
        ? ORDER_DEAUTHORIZED_CASE_ACCESS_RUNTIME_FUNCTIONS.map(
          (identity) => identity.slice(0, identity.indexOf("(")),
        )
        : []),
      ...ORDER_CHECKOUT_RECEIPT_AUTHORITY_FUNCTIONS.map(
        (identity) => identity.slice(0, identity.indexOf("(")),
      ),
      ...ORDER_STAFF_READ_AUTHORITY_FUNCTIONS.map(
        (identity) => identity.slice(0, identity.indexOf("(")),
      ),
      ...ORDER_STAFF_READ_CHARGED_TOTAL_CORRECTION_FUNCTION_NAMES,
      ...ORDER_ACCOUNT_DELETION_AUTHORITY_FUNCTION_NAMES,
      ...ORDER_ZERO_DIRECT_COMPATIBLE_NEW_FUNCTION_NAMES,
      ...ORDER_PARTICIPANT_EXPORT_AUTHORITY_FUNCTIONS.map(
        (identity) => identity.slice(0, identity.indexOf("(")),
      ),
      ...ORDER_ELIGIBILITY_AUTHORITY_FUNCTIONS.map(
        (identity) => identity.slice(0, identity.indexOf("(")),
      ),
      ...ORDER_PUBLIC_AGGREGATE_AUTHORITY_FUNCTIONS.map(
        (identity) => identity.slice(0, identity.indexOf("(")),
      ),
      ...(partialRefundFulfillmentMigrationPresent
        ? ["grainline_order_refund_blocks_fulfillment"]
        : []),
      ...(blockedCheckoutRefundWitnessMigrationPresent
        ? blockedCheckoutRefundWitnessFunctionNames
        : []),
      ...ORDER_SELLER_ANALYTICS_AUTHORITY_FUNCTIONS.map(
        (identity) => identity.slice(0, identity.indexOf("(")),
      ),
      ...ORDER_SELLER_METRICS_AUTHORITY_FUNCTIONS.map(
        (identity) => identity.slice(0, identity.indexOf("(")),
      ),
      ...ORDER_PARTICIPANT_SUMMARY_AUTHORITY_FUNCTIONS.map(
        (identity) => identity.slice(0, identity.indexOf("(")),
      ),
      ...ORDER_PARTICIPANT_CURSOR_AUTHORITY_FUNCTIONS.map(
        (identity) => identity.slice(0, identity.indexOf("(")),
      ),
      ...ORDER_FULFILLMENT_AUTHORITY_FUNCTIONS.map(
        (identity) => identity.slice(0, identity.indexOf("(")),
      ),
      ...ORDER_LABEL_AUTHORITY_FUNCTIONS.map(
        (identity) => identity.slice(0, identity.indexOf("(")),
      ),
      ...ORDER_LABEL_PRIVATE_FUNCTIONS.map(
        (identity) => identity.slice(0, identity.indexOf("(")),
      ),
      ...SELLER_PAYOUT_EVENT_CANDIDATE_FUNCTION_NAMES,
      ...(sellerProfilePrivateCallerTransitionsPresent
        ? sellerProfilePrivateCallerTransitionFunctionNames
        : []),
      ...sellerProfilePrivateBoundaryFunctionNames,
      ...(sellerProfilePrivateInvariantsMigrationPresent
        ? SELLER_PROFILE_PRIVATE_INVARIANT_FUNCTION_NAMES
        : []),
      ...sellerProfilePrivateAppAuthorityFunctionNames,
      ...sellerProfilePrivateStaffReadFunctionNames,
      ...(listingHideDeleteMigrationPresent
        ? ["grainline_listing_delete_reference_state"]
        : []),
      ...(supportRequestAuthorityPrepared
        ? supportRequestAuthorityFunctionNames
        : []),
      ...(clerkWebhookAuthorityPrepared
        ? clerkWebhookAuthorityFunctionNames
        : []),
      "grainline_stripe_webhook_begin",
      "grainline_stripe_webhook_complete",
      "grainline_stripe_webhook_fail",
      "grainline_stripe_webhook_health_summary",
      "grainline_stripe_webhook_prune_batch",
      ...(userEmailAddressAuthorityPrepared
        ? userEmailAddressAuthorityFunctionNames
        : []),
      ...userAuthorityFunctions.map(({ name }) => name),
      "grainline_legacy_stock_restore_claim",
      "grainline_conversation_participants_immutable",
      "grainline_message_maintain_thread_state",
      "grainline_message_participants_match_conversation",
      "grainline_message_route_immutable",
      ...NOTIFICATION_RECIPIENT_RPC_FUNCTIONS,
      ...NOTIFICATION_SERVICE_RPC_FUNCTIONS,
      "grainline_notification_preferences_valid",
      ...(savedBlogPostRlsActivationMigrationPresent
        ? ["grainline_saved_blog_post_insert_guard"]
        : []),
      ...(cartCartItemRlsActivationPresent
        ? CART_CART_ITEM_RUNTIME_FUNCTION_NAMES
        : []),
      ...(stockNotificationAuthorityPrepared
        ? STOCK_NOTIFICATION_PREPARATION_FUNCTION_NAMES
        : []),
      ...(favoriteAuthorityPrepared
        ? FAVORITE_PREPARATION_FUNCTION_NAMES
        : []),
      ...(followAuthorityPrepared
        ? FOLLOW_PREPARATION_FUNCTION_NAMES
        : []),
      ...(emailDeliveryLedgerPrepared
        ? EMAIL_DELIVERY_LEDGER_FUNCTION_NAMES
        : []),
      ...(emailProviderDeletionFencePrepared
        ? EMAIL_PROVIDER_DELETION_FENCE_FUNCTION_NAMES
        : []),
      ...(emailProviderEligibilityFencePrepared
        ? EMAIL_PROVIDER_ELIGIBILITY_FENCE_SOURCE_NEW_FUNCTION_NAMES
        : []),
      "grainline_saved_search_delete_one",
      "grainline_saved_search_list",
      ...DIRECT_UPLOAD_AUTHORITY_FUNCTIONS.map((entry) => entry.name),
      ...CHECKOUT_STOCK_RESERVATION_CANDIDATE_FUNCTIONS.map(
        (entry) => entry.name,
      ).filter((name) => name !== "grainline_stripe_webhook_begin"),
      ...(conversationMessageAuthorityPrepared
        ? CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS.map((entry) => entry.name)
        : []),
      ...(sellerProfilePublicCandidatePresent
        ? SELLER_PROFILE_PUBLIC_CANDIDATE_FUNCTION_NAMES
        : []),
      ...(sellerProfilePublicVisibilityMirrorPresent
        ? SELLER_PROFILE_PUBLIC_VISIBILITY_MIRROR_PRIVATE_FUNCTION_NAMES
        : []),
    ])].sort((left, right) => left.localeCompare(right)));
    assert.deepEqual(inventory.extensions, ["pg_trgm"]);
    assert.deepEqual(inventory.sequenceSqlReferences, []);
    assert.deepEqual(inventory.autoincrementFields, []);
    assert.deepEqual(inventory.fixedIntSingletonIds, ["SiteConfig.id", "SiteMetricsSnapshot.id"]);
    assert.equal(
      inventory.publicRevokes.length,
      157 // historical-prefix baseline before the currently staged successors
        + (orderItemQuoteRuntimeLockMigrationPresent ? 1 : 0)
        + (postForceCheckoutSuccessorRevokePresent ? 1 : 0)
        + (sellerBuyerEmailProjectionMigrationPresent ? 2 : 0)
        + (orderOpsHealthMigrationPresent ? 1 : 0)
        + (disputeRecoveryMigrationPresent ? 5 : 0) // table plus four functions
        + (caseRefundProviderRecoveryMigrationPresent ? 5 : 0)
        + (partialRefundFulfillmentMigrationPresent ? 1 : 0)
        + (blockedCheckoutRefundWitnessMigrationPresent
          ? blockedCheckoutRefundWitnessFunctionNames.length
            + 3 // reasserted checkout create/existing/postpayment PUBLIC/runtime revokes
          : 0)
        + (blockedPairCheckoutCompletionMigrationPresent ? 1 : 0)
        + (clerkWebhookAuthorityPrepared
          ? clerkWebhookAuthorityFunctionNames.length
          : 0)
        + (accountDeletionClaimFencePrepared ? 13 : 0)
        + (accountDeletionSideEffectRlsActivationExpected(inventory) ? 6 : 0)
        + (listingHideDeleteMigrationPresent ? 1 : 0)
        + (supportRequestAuthorityPrepared
          ? supportRequestAuthorityFunctionNames.length
          : 0)
        + (supportRequestEnableMigrationPresent ? 1 : 0)
        + (savedBlogPostRlsActivationMigrationPresent
          ? 2 // table plus insert-guard function
          : 0)
        + (cartCartItemRlsActivationPresent
          ? 3 // table plus two cleanup functions
          : 0)
        + (stockNotificationAuthorityPrepared
          ? STOCK_NOTIFICATION_PREPARATION_FUNCTION_NAMES.length
          : 0)
        + (stockNotificationRlsActivationPresent ? 1 : 0)
        + (favoriteAuthorityPrepared
          ? FAVORITE_PREPARATION_FUNCTION_NAMES.length
          : 0)
        + (followAuthorityPrepared
          ? FOLLOW_PREPARATION_FUNCTION_NAMES.length
          : 0)
        + (typeof followRlsActivationExpected === "function"
          && followRlsActivationExpected(inventory) ? 1 : 0)
        + (emailDeliveryLedgerPrepared
          ? EMAIL_DELIVERY_LEDGER_FUNCTION_NAMES.length
          : 0)
        + (emailProviderDeletionFencePrepared
          ? EMAIL_PROVIDER_DELETION_FENCE_NEW_FUNCTION_NAMES.length
          : 0)
        + (emailProviderEligibilityFencePrepared
          ? EMAIL_PROVIDER_ELIGIBILITY_FENCE_SOURCE_NEW_FUNCTION_NAMES.length
          : 0)
        // CI proves the C-875 release before isolating this successor. While
        // C-875 is held aside, the successor's redefinition still contributes
        // the same unsubscribe-function PUBLIC revoke.
        + (emailProviderEligibilitySubstitutesUnsubscribeRevoke ? 1 : 0)
        + (orderItemRlsForceExpected(inventory) ? 1 : 0)
        + (orderQuoteRlsActivationExpected(inventory) ? 1 : 0)
        + (userRlsActivationExpected(inventory) ? 1 : 0)
        + (userEmailAddressRlsActivationExpected(inventory) ? 1 : 0)
        + (userEmailAddressAuthorityPrepared ? 4 : 0)
        + (userUnsubscribeOptionalPreferencesCorrectionPresent ? 1 : 0)
        + userAuthorityFunctions.length
        + (conversationMessageAuthorityPrepared ? 25 : 0)
        + (caseRlsActivationExpected(inventory) ? 3 : 0)
        + (stripeWebhookEventRlsActivationExpected(inventory) ? 1 : 0)
        + (clerkWebhookEventRlsActivationExpected(inventory) ? 1 : 0)
        + CHECKOUT_STOCK_RESERVATION_CANDIDATE_FUNCTIONS.length
        + SELLER_PAYOUT_EVENT_CANDIDATE_FUNCTION_NAMES.length
        + (sellerProfilePrivateCallerTransitionsPresent
          ? sellerProfilePrivateCallerTransitionFunctionNames.length
          : 0)
        + (sellerProfilePrivatePreparationMigrationPresent
          ? SELLER_PROFILE_PRIVATE_PREPARATION_FUNCTION_NAMES.length
            + 1 // SellerProfilePrivate table revoke from PUBLIC
          : 0)
        + (sellerProfilePrivateRetirementMigrationPresent
          ? 3 // initializer plus reasserted compat-helper revokes
          : 0)
        + (sellerProfilePrivateInvariantsMigrationPresent
          ? SELLER_PROFILE_PRIVATE_INVARIANT_FUNCTION_NAMES.length
          : 0)
        + (sellerProfilePrivateEnableMigrationPresent ? 1 : 0)
        + sellerProfilePrivateAppAuthorityFunctionNames.length
        + sellerProfilePrivateStaffReadFunctionNames.length
        + ORDER_REFUND_CLAIM_FUNCTION_NAMES.length
        + ORDER_REFUND_RECORD_PRIVATE_FUNCTION_NAMES.length
        + ORDER_PAYMENT_SIGNED_AUTHORITY_FUNCTION_NAMES.length
        + ORDER_REFUND_RECONCILIATION_RUNTIME_FUNCTION_NAMES.length
        + ORDER_REFUND_RECONCILIATION_PRIVATE_FUNCTION_NAMES.length
        + BLOCKED_CHECKOUT_TRANSFER_BINDING_FUNCTION_NAMES.length
        + ORDER_PAYMENT_EVENT_INVARIANT_FUNCTIONS.length
        + ORDER_PAYMENT_EVENT_READ_AUTHORITY_FUNCTIONS.length
        + ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_FUNCTIONS.length
        + ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_FUNCTIONS.length
        + ORDER_PARTICIPANT_LIST_AUTHORITY_FUNCTIONS.length
        + ORDER_PARTICIPANT_DETAIL_AUTHORITY_FUNCTIONS.length
        + ORDER_STAFF_READ_AUTHORITY_FUNCTIONS.length
        + ORDER_STAFF_READ_CHARGED_TOTAL_CORRECTION_FUNCTION_NAMES.length
        + ORDER_ACCOUNT_DELETION_AUTHORITY_FUNCTION_NAMES.length
        + ORDER_ZERO_DIRECT_COMPATIBLE_PUBLIC_REVOKE_COUNT
        + ORDER_PARTICIPANT_EXPORT_AUTHORITY_FUNCTIONS.length
        + ORDER_ELIGIBILITY_AUTHORITY_FUNCTIONS.length
        + ORDER_PUBLIC_AGGREGATE_AUTHORITY_FUNCTIONS.length
        + ORDER_SELLER_ANALYTICS_AUTHORITY_FUNCTIONS.length
        + ORDER_SELLER_METRICS_AUTHORITY_FUNCTIONS.length
        + ORDER_PARTICIPANT_SUMMARY_AUTHORITY_FUNCTIONS.length
        + ORDER_PARTICIPANT_CURSOR_AUTHORITY_FUNCTIONS.length
        + ORDER_PARTICIPANT_DETAIL_PROJECTION_FUNCTIONS.length
        + ORDER_PARTICIPANT_SNAPSHOT_CORRECTION_FUNCTIONS.length
        + (orderDeauthorizedCaseAccessPrepared
          ? ORDER_DEAUTHORIZED_CASE_ACCESS_RUNTIME_FUNCTIONS.length
          : 0)
        + ORDER_CHECKOUT_RECEIPT_AUTHORITY_FUNCTIONS.length
        + ORDER_FULFILLMENT_AUTHORITY_FUNCTIONS.length
        + ORDER_LABEL_AUTHORITY_FUNCTIONS.length
        + ORDER_LABEL_PRIVATE_FUNCTIONS.length
        + 1 // OrderRefundReconciliation table revoke from PUBLIC
        + 1 // inactive-seller successor converges seller-record PUBLIC/runtime EXECUTE before regrant
        + (sellerProfilePublicCandidatePresent
          ? 98 // public SellerProfile candidate surface before final visibility mirrors
            + Number(!sellerProfilePublicProvisioningPresent) // historical provisioning retains one distinct predecessor revoke
          : 0)
        + (sellerProfilePublicVisibilityMirrorPresent
          ? SELLER_PROFILE_PUBLIC_VISIBILITY_MIRROR_PRIVATE_FUNCTION_NAMES.length
            + 2 // reasserted blog binder and seller blog-state sync revokes
          : 0)
        + (checkoutStockReservationRlsActivationExpected(inventory) ? 2 : 0)
        + (sellerPayoutEventRlsActivationExpected(inventory) ? 1 : 0)
        + (orderPaymentEventRlsActivationExpected(inventory) ? 1 : 0),
    );
    assert.equal(
      inventory.publicRevokes.filter((statement) => statement.includes(
        "public.grainline_case_message_page(text, text, timestamp, text, integer)",
      )).length,
      1,
      "semantic duplicate revokes must collapse across SQL formatting changes",
    );
    assert.ok(inventory.publicRevokes.includes(
      "REVOKE ALL ON FUNCTION public.grainline_saved_search_delete_one(text, text) FROM PUBLIC",
    ));
    assert.ok(inventory.publicRevokes.includes(
      "REVOKE ALL ON FUNCTION public.grainline_saved_search_list(text, integer, text) FROM PUBLIC",
    ));
    for (const functionName of [
      ...(cartCartItemRlsActivationPresent
        ? CART_CART_ITEM_RUNTIME_FUNCTION_NAMES
        : []),
      ...(stockNotificationAuthorityPrepared
        ? STOCK_NOTIFICATION_PREPARATION_FUNCTION_NAMES
        : []),
      ...(favoriteAuthorityPrepared
        ? FAVORITE_PREPARATION_FUNCTION_NAMES
        : []),
      ...(followAuthorityPrepared
        ? FOLLOW_PREPARATION_FUNCTION_NAMES
        : []),
      ...(emailDeliveryLedgerPrepared
        ? EMAIL_DELIVERY_LEDGER_FUNCTION_NAMES
        : []),
      ...(emailProviderDeletionFencePrepared
        ? EMAIL_PROVIDER_DELETION_FENCE_NEW_FUNCTION_NAMES
        : []),
      ...(emailProviderEligibilityFencePrepared
        ? EMAIL_PROVIDER_ELIGIBILITY_FENCE_SOURCE_NEW_FUNCTION_NAMES
        : []),
      "grainline_case_account_deletion_blockers",
      "grainline_case_account_deletion_redact",
      ...CASE_INVARIANT_FUNCTIONS.map((entry) => entry.name),
      "grainline_case_cron_transition_batch",
      "grainline_case_escalate",
      "grainline_case_mark_resolved",
      "grainline_case_export_page",
      "grainline_case_get",
      "grainline_case_get_by_order",
      "grainline_case_guild_unresolved_guard",
      "grainline_case_message_page",
      "grainline_case_message_preflight",
      "grainline_case_open",
      "grainline_case_order_active_for_buyer",
      "grainline_case_order_active_for_seller",
      "grainline_case_reply",
      "grainline_case_seller_active_count",
      "grainline_case_seller_verification_eligibility",
      "grainline_case_staff_active_count",
      "grainline_case_staff_queue",
      "grainline_case_staff_resolution_prepare",
      "grainline_case_staff_resolution_provider_record",
      "grainline_case_staff_resolution_finalize",
      "grainline_case_staff_resolution_reconcile",
      ...(caseRefundProviderRecoveryMigrationPresent
        ? caseRefundProviderRecoveryFunctionNames
        : []),
      ...(partialRefundFulfillmentMigrationPresent
        ? ["grainline_order_refund_blocks_fulfillment"]
        : []),
      ...(blockedCheckoutRefundWitnessMigrationPresent
        ? blockedCheckoutRefundWitnessFunctionNames
        : []),
      ...(clerkWebhookAuthorityPrepared
        ? clerkWebhookAuthorityFunctionNames
        : []),
      "grainline_order_buyer_pii_prune_batch",
    ]) {
      assert.equal(
        inventory.publicRevokes.some((statement) => (
          statement.includes(`public.${functionName}(`)
        )),
        true,
        `${functionName} must revoke PUBLIC execution`,
      );
    }
    for (const functionName of [
      ...NOTIFICATION_RECIPIENT_RPC_FUNCTIONS,
      ...NOTIFICATION_SERVICE_RPC_FUNCTIONS,
    ]) {
      assert.equal(
        inventory.publicRevokes.some((statement) => (
          statement.includes(`public.${functionName}(`)
        )),
        true,
        `${functionName} must revoke PUBLIC execution in the preparation migration`,
      );
    }
    for (const { name: functionName } of DIRECT_UPLOAD_AUTHORITY_FUNCTIONS) {
      assert.equal(
        inventory.publicRevokes.some((statement) => (
          statement.includes(`public.${functionName}(`)
          && statement.includes("grainline_direct_upload_cleanup_v2")
        )),
        true,
        `${functionName} must revoke PUBLIC and both service roles during activation`,
      );
    }
    for (const {
      name: functionName,
    } of CHECKOUT_STOCK_RESERVATION_CANDIDATE_FUNCTIONS) {
      assert.equal(
        inventory.publicRevokes.some((statement) => (
          statement.includes(`public.${functionName}(`)
        )),
        true,
        `${functionName} must revoke PUBLIC execution in the authority migration`,
      );
    }
    for (const identity of ORDER_PAYMENT_EVENT_READ_AUTHORITY_FUNCTIONS) {
      const functionName = identity.slice(0, identity.indexOf("("));
      assert.equal(
        inventory.publicRevokes.some((statement) => (
          statement.includes(`public.${functionName}(`)
        )),
        true,
        `${functionName} must revoke PUBLIC execution in the read-authority migration`,
      );
    }
    for (const functionName of ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_FUNCTIONS) {
      assert.equal(
        inventory.publicRevokes.some((statement) => (
          statement.includes(`public.${functionName}(`)
        )),
        true,
        `${functionName} must revoke PUBLIC execution in the aggregate-authority migration`,
      );
    }
    for (const functionName of ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_FUNCTIONS) {
      assert.equal(
        inventory.publicRevokes.some((statement) => (
          statement.includes(`public.${functionName}(`)
        )),
        true,
        `${functionName} must revoke PUBLIC execution in the transition-authority migration`,
      );
    }
    for (const identity of ORDER_PARTICIPANT_LIST_AUTHORITY_FUNCTIONS) {
      const functionName = identity.slice(0, identity.indexOf("("));
      assert.equal(
        inventory.publicRevokes.some((statement) => (
          statement.includes(`public.${functionName}(`)
        )),
        true,
        `${functionName} must revoke PUBLIC execution in the participant list-authority migration`,
      );
    }
    for (const identity of ORDER_PARTICIPANT_DETAIL_AUTHORITY_FUNCTIONS) {
      const functionName = identity.slice(0, identity.indexOf("("));
      assert.equal(
        inventory.publicRevokes.some((statement) => (
          statement.includes(`public.${functionName}(`)
        )),
        true,
        `${functionName} must revoke PUBLIC execution in the participant detail-authority migration`,
      );
    }
    for (const identity of ORDER_STAFF_READ_AUTHORITY_FUNCTIONS) {
      const functionName = identity.slice(0, identity.indexOf("("));
      assert.equal(
        inventory.publicRevokes.some((statement) => (
          statement.includes(`public.${functionName}(`)
        )),
        true,
        `${functionName} must revoke PUBLIC execution in the staff read-authority migration`,
      );
    }
    for (const functionName of ORDER_STAFF_READ_CHARGED_TOTAL_CORRECTION_FUNCTION_NAMES) {
      assert.equal(
        inventory.publicRevokes.some((statement) => (
          statement.includes(`public.${functionName}(`)
        )),
        true,
        `${functionName} must revoke PUBLIC execution in the staff read correction`,
      );
    }
    for (const functionName of ORDER_ACCOUNT_DELETION_AUTHORITY_FUNCTION_NAMES) {
      assert.equal(
        inventory.publicRevokes.some((statement) => (
          statement.includes(`public.${functionName}(`)
        )),
        true,
        `${functionName} must revoke PUBLIC execution in the account-deletion authority migration`,
      );
    }
    for (const identity of ORDER_PARTICIPANT_EXPORT_AUTHORITY_FUNCTIONS) {
      const functionName = identity.slice(0, identity.indexOf("("));
      assert.equal(
        inventory.publicRevokes.some((statement) => (
          statement.includes(`public.${functionName}(`)
        )),
        true,
        `${functionName} must revoke PUBLIC execution in the participant export-authority migration`,
      );
    }
    for (const identity of ORDER_ELIGIBILITY_AUTHORITY_FUNCTIONS) {
      const functionName = identity.slice(0, identity.indexOf("("));
      assert.equal(
        inventory.publicRevokes.some((statement) => (
          statement.includes(`public.${functionName}(`)
        )),
        true,
        `${functionName} must revoke PUBLIC execution in the eligibility-authority migration`,
      );
    }
    for (const identity of ORDER_PUBLIC_AGGREGATE_AUTHORITY_FUNCTIONS) {
      const functionName = identity.slice(0, identity.indexOf("("));
      assert.equal(
        inventory.publicRevokes.some((statement) => (
          statement.includes(`public.${functionName}(`)
        )),
        true,
        `${functionName} must revoke PUBLIC execution in the public aggregate-authority migration`,
      );
    }
    for (const identity of ORDER_SELLER_ANALYTICS_AUTHORITY_FUNCTIONS) {
      const functionName = identity.slice(0, identity.indexOf("("));
      assert.equal(
        inventory.publicRevokes.some((statement) => (
          statement.includes(`public.${functionName}(`)
        )),
        true,
        `${functionName} must revoke PUBLIC execution in the seller analytics-authority migration`,
      );
    }
    for (const identity of ORDER_SELLER_METRICS_AUTHORITY_FUNCTIONS) {
      const functionName = identity.slice(0, identity.indexOf("("));
      assert.equal(
        inventory.publicRevokes.some((statement) => (
          statement.includes(`public.${functionName}(`)
        )),
        true,
        `${functionName} must revoke PUBLIC execution in the seller metrics-authority migration`,
      );
    }
    for (const identity of ORDER_PARTICIPANT_SUMMARY_AUTHORITY_FUNCTIONS) {
      const functionName = identity.slice(0, identity.indexOf("("));
      assert.equal(
        inventory.publicRevokes.some((statement) => (
          statement.includes(`public.${functionName}(`)
        )),
        true,
        `${functionName} must revoke PUBLIC execution in the participant summary-authority migration`,
      );
    }
    for (const identity of ORDER_PARTICIPANT_CURSOR_AUTHORITY_FUNCTIONS) {
      const functionName = identity.slice(0, identity.indexOf("("));
      assert.equal(
        inventory.publicRevokes.some((statement) => (
          statement.includes(`public.${functionName}(`)
        )),
        true,
        `${functionName} must revoke PUBLIC execution in the participant cursor-authority migration`,
      );
    }
    for (const identity of ORDER_PARTICIPANT_DETAIL_PROJECTION_FUNCTIONS) {
      const functionName = identity.slice(0, identity.indexOf("("));
      assert.equal(
        inventory.publicRevokes.some((statement) => (
          statement.includes(`public.${functionName}(`)
        )),
        true,
        `${functionName} must revoke PUBLIC execution in the participant detail-projection migration`,
      );
    }
    for (const identity of ORDER_PARTICIPANT_SNAPSHOT_CORRECTION_FUNCTIONS) {
      const functionName = identity.slice(0, identity.indexOf("("));
      assert.equal(
        inventory.publicRevokes.some((statement) => (
          statement.includes(`public.${functionName}(`)
        )),
        true,
        `${functionName} must revoke PUBLIC execution in the snapshot-correction migration`,
      );
    }
    if (orderDeauthorizedCaseAccessPrepared) {
      for (const identity of ORDER_DEAUTHORIZED_CASE_ACCESS_RUNTIME_FUNCTIONS) {
        const functionName = identity.slice(0, identity.indexOf("("));
        assert.equal(
          inventory.publicRevokes.some((statement) => (
            statement.includes(`public.${functionName}(`)
          )),
          true,
          `${functionName} must revoke PUBLIC execution in the deauthorized Case-access migration`,
        );
      }
    }
    for (const identity of ORDER_CHECKOUT_RECEIPT_AUTHORITY_FUNCTIONS) {
      const functionName = identity.slice(0, identity.indexOf("("));
      assert.equal(
        inventory.publicRevokes.some((statement) => (
          statement.includes(`public.${functionName}(`)
        )),
        true,
        `${functionName} must revoke PUBLIC execution in the checkout-receipt migration`,
      );
    }
    if (conversationMessageAuthorityPrepared) {
      for (const { name } of CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS) {
        assert.equal(
          inventory.publicRevokes.some((statement) => (
            statement.includes(`public.${name}(`)
          )),
          true,
          `${name} must revoke PUBLIC execution in the preparation migration`,
        );
      }
    }
    assert.deepEqual(inventory.publicDefaultPrivilegeRevokes, []);
    assert.deepEqual(
      inventory.rlsPolicyTables,
      [
        ...(accountDeletionSideEffectRlsActivationExpected(inventory)
          ? [ACCOUNT_DELETION_SIDE_EFFECT_TABLE]
          : []),
        ...(cartCartItemRlsActivationPresent ? ["Cart", "CartItem"] : []),
        "Conversation",
        "Message",
        "Notification",
        ...(savedBlogPostRlsActivationMigrationPresent
          ? ["SavedBlogPost"]
          : []),
        "SavedSearch",
        ...(stockNotificationRlsActivationPresent
          ? ["StockNotification"]
          : []),
      ],
    );
    assert.deepEqual(
      inventory.rlsEnableTables,
      [
        ...(accountDeletionSideEffectRlsActivationExpected(inventory)
          ? [ACCOUNT_DELETION_SIDE_EFFECT_TABLE]
          : []),
        ...(cartCartItemRlsActivationPresent ? ["Cart", "CartItem"] : []),
        "Case",
        "CaseMessage",
        "CaseMessageAttachment",
        "CaseOpenApplication",
        "CaseResolutionClaim",
        "CaseSellerRefundApplication",
        "CaseStripeDisputeApplication",
        "CheckoutStockReservation",
        ...(clerkWebhookEventRlsActivationExpected(inventory)
          ? [CLERK_WEBHOOK_EVENT_TABLE]
          : []),
        "Conversation",
        "DirectUpload",
        "DirectUploadReference",
        ...(typeof followRlsActivationExpected === "function"
          && followRlsActivationExpected(inventory) ? [FOLLOW_TABLE] : []),
        "Message",
        "Notification",
        ...(coreOrderRlsActivationExpected(inventory) ? ["Order"] : []),
        ...(disputeRecoveryMigrationPresent ? ["OrderDisputeRecovery"] : []),
        ...(orderItemRlsActivationExpected(inventory) ? ["OrderItem"] : []),
        "OrderPaymentEvent",
        "OrderRefundReconciliation",
        ...(orderQuoteRlsActivationExpected(inventory)
          ? ["OrderShippingRateQuote"]
          : []),
        "OrderStaffCapability",
        ...(savedBlogPostRlsActivationMigrationPresent
          ? ["SavedBlogPost"]
          : []),
        "SavedSearch",
        "SellerDeauthorizationApplication",
        "SellerPayoutEvent",
        ...(sellerProfilePublicCandidatePresent ? ["SellerProfile"] : []),
        ...(sellerProfilePrivateEnableMigrationPresent
          ? ["SellerProfilePrivate"]
          : []),
        ...(stockNotificationRlsActivationPresent
          ? ["StockNotification"]
          : []),
        "StripeWebhookEvent",
        ...(supportRequestRlsEnabled
          ? [SUPPORT_REQUEST_TABLE ?? "SupportRequest"]
          : []),
        ...(userRlsActivationExpected(inventory) ? [USER_TABLE] : []),
        ...(userEmailAddressRlsActivationExpected(inventory)
          ? ["UserEmailAddress"]
          : []),
      ],
    );
    assert.deepEqual(
      inventory.rlsForceTables,
      [
        ...(accountDeletionSideEffectRlsForceExpected(inventory)
          ? [ACCOUNT_DELETION_SIDE_EFFECT_TABLE]
          : []),
        ...(cartCartItemRlsActivationPresent ? ["Cart", "CartItem"] : []),
        "Case",
        "CaseMessage",
        "CaseMessageAttachment",
        "CaseOpenApplication",
        "CaseResolutionClaim",
        "CaseSellerRefundApplication",
        "CaseStripeDisputeApplication",
        "CheckoutStockReservation",
        ...(clerkWebhookEventRlsForceExpected(inventory)
          ? [CLERK_WEBHOOK_EVENT_TABLE]
          : []),
        "Conversation",
        "DirectUpload",
        "DirectUploadReference",
        ...(typeof followRlsForceExpected === "function"
          && followRlsForceExpected(inventory) ? [FOLLOW_TABLE] : []),
        "Message",
        "Notification",
        ...(coreOrderRlsForceExpected(inventory) ? ["Order"] : []),
        ...(disputeRecoveryMigrationPresent ? ["OrderDisputeRecovery"] : []),
        ...(orderItemRlsForceExpected(inventory) ? ["OrderItem"] : []),
        "OrderPaymentEvent",
        "OrderRefundReconciliation",
        ...(orderQuoteRlsForceExpected(inventory)
          ? ["OrderShippingRateQuote"]
          : []),
        "OrderStaffCapability",
        ...(savedBlogPostRlsActivationMigrationPresent
          ? ["SavedBlogPost"]
          : []),
        "SavedSearch",
        "SellerDeauthorizationApplication",
        "SellerPayoutEvent",
        ...(sellerProfilePublicForceMigrationPresent
          ? ["SellerProfile"]
          : []),
        ...(sellerProfilePrivateForceMigrationPresent
          ? ["SellerProfilePrivate"]
          : []),
        ...(stockNotificationRlsActivationPresent
          ? ["StockNotification"]
          : []),
        "StripeWebhookEvent",
        ...(supportRequestForceMigrationPresent
          ? [SUPPORT_REQUEST_TABLE ?? "SupportRequest"]
          : []),
        ...(userRlsForceExpected(inventory) ? [USER_TABLE] : []),
        ...(userEmailAddressRlsForceExpected(inventory)
          ? ["UserEmailAddress"]
          : []),
      ],
    );
  });

  it("keeps the manual grant audit focused on least-privilege role evidence", () => {
    const script = source("scripts/audit-runtime-db-grants.mjs");

    assert.match(script, /RUNTIME_DB_ROLE/);
    assert.match(script, /MIGRATION_DB_ROLE/);
    assert.match(script, /GRANT_AUDIT_DATABASE_URL/);
    assert.match(script, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
    assert.match(script, /readSavedSearchCatalogState/);
    assert.match(script, /formatSavedSearchCatalogEvidence/);
    assert.match(script, /export async function auditLiveDatabase/);
    assert.match(script, /rolbypassrls/);
    assert.match(script, /pg_auth_members/);
    assert.match(script, /member of role/);
    assert.match(script, /must differ from migration role/);
    assert.match(script, /current_user AS current_user_name/);
    assert.match(script, /session_user AS session_user_name/);
    assert.match(script, /expected migration role/);
    assert.match(script, /has_database_privilege\(\$1, current_database\(\), 'CREATE'\)/);
    assert.match(script, /has CREATE on non-public schema/);
    assert.match(script, /owned by \$\{row\.owner_name\}, expected \$\{migrationRole\}/);
    assert.match(script, /has_table_privilege/);
    assert.match(script, /has_sequence_privilege/);
    assert.match(script, /has_function_privilege/);
    assert.match(script, /has_type_privilege/);
    assert.match(script, /pg_policy/);
    assert.match(script, /relrowsecurity/);
    assert.match(script, /relforcerowsecurity/);
    assert.match(script, /ROW LEVEL SECURITY enabled but zero policies/);
    assert.match(script, /FORCE ROW LEVEL SECURITY enabled but zero policies/);
    assert.match(script, /string_agg\(p\.polname::text/);
    assert.match(script, /ROW LEVEL SECURITY is not enabled/);
    assert.match(script, /FORCE ROW LEVEL SECURITY is not enabled/);
    assert.match(script, /pg_extension/);
    assert.match(script, /runtime role owns extension/);
    assert.match(script, /extension .* owned by .* expected/);
    assert.match(script, /extension .* lacks EXECUTE/);
    assert.match(script, /EXECUTE WITH GRANT OPTION/);
    assert.match(script, /lacks EXECUTE and [\s\S]*not grantable by migration role/);
    assert.match(script, /REQUIRED_EXTENSION_RUNTIME_FUNCTIONS/);
    assert.match(script, /REQUIRED_EXTENSION_RUNTIME_OPERATORS/);
    assert.match(script, /runtime function .* lacks EXECUTE/);
    assert.match(script, /runtime operator .* backing function/);
    assert.match(script, /pg_default_acl/);
    assert.match(script, /untracked public table/);
    assert.match(script, /lightweight REVOKE detector/);
    assert.match(script, /connectionTimeoutMillis: AUDIT_CONNECTION_TIMEOUT_MS/);
    assert.match(script, /statement_timeout: AUDIT_STATEMENT_TIMEOUT_MS/);
    assert.match(script, /query_timeout: AUDIT_QUERY_TIMEOUT_MS/);
    assert.match(script, /postgresChannelBindingClientOptions\(new URL\(connectionString\)\)/);
    const beginIndex = script.lastIndexOf(
      'await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")',
    );
    const identityIndex = script.lastIndexOf(
      "await assertGrantAuditConnectionMatches(",
    );
    const auditIndex = script.lastIndexOf("await auditLiveDatabase(");
    const catalogIndex = script.lastIndexOf("await readSavedSearchCatalogState(client)");
    assert.ok(beginIndex < identityIndex);
    assert.ok(identityIndex < auditIndex);
    assert.ok(auditIndex < catalogIndex);
    assert.doesNotMatch(script, /console\.log\(.*connectionString/s);
    assert.doesNotMatch(script, /process\.env\.DATABASE_URL/);
  });

  it("runs the global grant audit at every reviewed email migration stage", (context) => {
    if (!existsSync(".github/workflows/ci.yml")) {
      context.skip("requires the current CI workflow source");
      return;
    }
    const workflow = source(".github/workflows/ci.yml");
    const start = workflow.indexOf(
      "- name: Apply complete public SellerProfile chain for final Production build",
    );
    const end = workflow.indexOf("- name: Production build", start);
    assert.ok(start >= 0 && end > start);
    const stagedProof = workflow.slice(start, end);
    const auditMatches = stagedProof.match(/npm run audit:db-grants/g) ?? [];
    assert.equal(auditMatches.length, 5);
    const combinedStaffStageMatches = stagedProof.match(
      /--staff-read-stage=order-user-combined/g,
    ) ?? [];
    assert.equal(combinedStaffStageMatches.length, 5);
    const preparationAudit = stagedProof.indexOf("npm run audit:db-grants");
    const runtimeConvergence = stagedProof.indexOf(
      "--file=scripts/provision-runtime-db-role.sql",
    );
    const staffConvergence = stagedProof.indexOf(
      "--file=scripts/provision-order-staff-read-role.sql",
    );
    const restoreDeletionFence = stagedProof.indexOf(
      '"$holding/migrations/$deletion_migration" \\\n            "prisma/migrations/$deletion_migration"',
    );
    const applyDeletionFence = stagedProof.indexOf(
      "npx prisma migrate deploy",
      restoreDeletionFence,
    );
    const deletionFenceAudit = stagedProof.indexOf(
      "npm run audit:db-grants",
      applyDeletionFence,
    );
    const restoreEligibilityFence = stagedProof.indexOf(
      '"$holding/migrations/$eligibility_migration" \\\n            "prisma/migrations/$eligibility_migration"',
    );
    const applyEligibilityFence = stagedProof.indexOf(
      "npx prisma migrate deploy",
      restoreEligibilityFence,
    );
    const eligibilityFenceAudit = stagedProof.indexOf(
      "npm run audit:db-grants",
      applyEligibilityFence,
    );
    const restoreCorrection = stagedProof.indexOf(
      '"$holding/migrations/$correction_migration" \\\n            "prisma/migrations/$correction_migration"',
    );
    const applyCorrection = stagedProof.indexOf(
      "npx prisma migrate deploy",
      restoreCorrection,
    );
    const finalAudit = stagedProof.lastIndexOf("npm run audit:db-grants");
    assert.ok(runtimeConvergence >= 0 && runtimeConvergence < preparationAudit);
    assert.ok(staffConvergence >= 0 && staffConvergence < preparationAudit);
    assert.ok(preparationAudit < restoreDeletionFence);
    assert.ok(
      restoreDeletionFence < applyDeletionFence
      && applyDeletionFence < deletionFenceAudit,
    );
    assert.ok(restoreEligibilityFence < deletionFenceAudit);
    assert.ok(
      deletionFenceAudit < applyEligibilityFence
      && applyEligibilityFence < eligibilityFenceAudit,
    );
    assert.ok(
      eligibilityFenceAudit < restoreCorrection
      && restoreCorrection < applyCorrection
      && applyCorrection < finalAudit,
    );
  });

  it("formats one sanitized parseable SavedSearch catalog evidence line", () => {
    const state = normalizeSavedSearchCatalogState({
      table_name: "SavedSearch",
      rls_enabled: false,
      rls_forced: false,
      policy_count: "0",
    });
    assert.deepEqual(state, {
      schema: "public",
      table: "SavedSearch",
      relrowsecurity: false,
      relforcerowsecurity: false,
      policy_count: 0,
    });

    const line = formatSavedSearchCatalogEvidence(state);
    assert.ok(line.startsWith(SAVED_SEARCH_CATALOG_EVIDENCE_PREFIX));
    assert.deepEqual(
      JSON.parse(line.slice(SAVED_SEARCH_CATALOG_EVIDENCE_PREFIX.length)),
      state,
    );
    assert.doesNotMatch(line, /postgres(?:ql)?:|password|connection/i);

    assert.throws(
      () => normalizeSavedSearchCatalogState({
        table_name: "SavedSearch",
        rls_enabled: "false",
        rls_forced: false,
        policy_count: 0,
      }),
      /catalog flags are invalid/,
    );
    assert.throws(
      () => normalizeSavedSearchCatalogState({
        table_name: "SavedSearch",
        rls_enabled: false,
        rls_forced: false,
        policy_count: -1,
      }),
      /policy count is invalid/,
    );
  });

  it("pins guarded post-migration audits to the exact DIRECT_URL without exposing it", () => {
    const directUrl = "postgresql://migration-owner:secret@direct.example.test:5432/grainline?sslmode=verify-full";
    assert.equal(
      resolveGrantAuditConnection(
        { DIRECT_URL: directUrl },
        [REQUIRE_DIRECT_URL_FLAG],
      ),
      directUrl,
    );
    assert.equal(
      resolveGrantAuditConnection(
        { DIRECT_URL: directUrl, GRANT_AUDIT_DATABASE_URL: directUrl },
        [REQUIRE_DIRECT_URL_FLAG],
      ),
      directUrl,
    );
    assert.throws(
      () => resolveGrantAuditConnection(
        {
          DIRECT_URL: directUrl,
          GRANT_AUDIT_DATABASE_URL: "postgresql://owner:other@elsewhere.example.test:5432/grainline?sslmode=verify-full",
        },
        [REQUIRE_DIRECT_URL_FLAG],
      ),
      (error) => {
        assert.match(error.message, /must be absent or exactly match DIRECT_URL/);
        assert.doesNotMatch(error.message, /secret|elsewhere|postgresql:/);
        return true;
      },
    );
    assert.throws(
      () => resolveGrantAuditConnection({}, [REQUIRE_DIRECT_URL_FLAG]),
      /DIRECT_URL is required/,
    );
    assert.equal(
      resolveGrantAuditConnection({ GRANT_AUDIT_DATABASE_URL: directUrl }),
      directUrl,
    );
    const loopbackUrl =
      "postgresql://ci:ci@localhost:5432/grainline_ci?sslmode=disable";
    assert.throws(
      () => resolveGrantAuditConnection({ GRANT_AUDIT_DATABASE_URL: loopbackUrl }),
      /sslmode=verify-full/,
    );
    assert.equal(
      resolveGrantAuditConnection(
        { GRANT_AUDIT_DATABASE_URL: loopbackUrl },
        [ALLOW_LOOPBACK_CI_FLAG],
      ),
      loopbackUrl,
    );
    assert.throws(
      () => resolveGrantAuditConnection(
        { GRANT_AUDIT_DATABASE_URL: directUrl },
        [ALLOW_LOOPBACK_CI_FLAG],
      ),
      /only with a loopback host/,
    );
    assert.throws(
      () => resolveGrantAuditConnection(
        { DIRECT_URL: directUrl },
        [REQUIRE_DIRECT_URL_FLAG, ALLOW_LOOPBACK_CI_FLAG],
      ),
      /cannot be combined/,
    );
    assert.throws(
      () => resolveGrantAuditConnection(
        { DIRECT_URL: directUrl },
        ["--typo"],
      ),
      /unknown command-line argument/,
    );
    const staffReadStageFlag =
      `${STAFF_READ_STAGE_FLAG_PREFIX}${ORDER_ZERO_DIRECT_PRIVATE_STAFF_READ_STAGE}`;
    const combinedStaffReadStageFlag =
      `${STAFF_READ_STAGE_FLAG_PREFIX}${ORDER_USER_COMBINED_STAFF_READ_STAGE}`;
    assert.equal(resolveStaffReadAuditStage([]), null);
    assert.equal(
      resolveStaffReadAuditStage([ALLOW_LOOPBACK_CI_FLAG, staffReadStageFlag]),
      ORDER_ZERO_DIRECT_PRIVATE_STAFF_READ_STAGE,
    );
    assert.equal(
      resolveStaffReadAuditStage([
        ALLOW_LOOPBACK_CI_FLAG,
        combinedStaffReadStageFlag,
      ]),
      ORDER_USER_COMBINED_STAFF_READ_STAGE,
    );
    assert.throws(
      () => resolveStaffReadAuditStage([staffReadStageFlag]),
      /only with loopback CI/u,
    );
    assert.throws(
      () => resolveStaffReadAuditStage([
        ALLOW_LOOPBACK_CI_FLAG,
        staffReadStageFlag,
        staffReadStageFlag,
      ]),
      /at most one/u,
    );
    assert.throws(
      () => resolveStaffReadAuditStage([
        ALLOW_LOOPBACK_CI_FLAG,
        `${STAFF_READ_STAGE_FLAG_PREFIX}unknown`,
      ]),
      /unknown staff-read audit stage/u,
    );
    for (const env of [
      { DIRECT_URL: directUrl, NODE_TLS_REJECT_UNAUTHORIZED: "0" },
      { DIRECT_URL: directUrl, PGOPTIONS: "-c role=other" },
    ]) {
      assert.throws(
        () => resolveGrantAuditConnection(env, [REQUIRE_DIRECT_URL_FLAG]),
        /must not/,
      );
    }
  });

  it("parses only reviewed remote grant-audit URLs while retaining the explicit loopback CI transport", () => {
    const reviewedUrl =
      "postgresql://owner:secret@ep-reviewed.example.test:5432/grainline?sslmode=verify-full&channel_binding=require";
    assert.deepEqual(
      parseGrantAuditDatabaseIdentity(reviewedUrl, "DIRECT_URL"),
      { databaseName: "grainline" },
    );
    const channelBindingClient = new Client({
      ...postgresChannelBindingClientOptions(new URL(reviewedUrl)),
      connectionString: reviewedUrl,
    });
    assert.equal(channelBindingClient.enableChannelBinding, true);
    assert.deepEqual(
      parseGrantAuditDatabaseIdentity(
        "postgresql://ci:ci@localhost:5432/grainline_ci?sslmode=disable",
        "GRANT_AUDIT_DATABASE_URL",
        { allowLoopbackCi: true },
      ),
      { databaseName: "grainline_ci" },
    );

    for (const invalidUrl of [
      "postgresql://owner:secret@ep-reviewed.example.test/grainline",
      "postgresql://owner@ep-reviewed.example.test:5432/grainline?sslmode=verify-full",
      "postgresql://owner:secret@ep-reviewed.example.test:5432/grainline?sslmode=require",
      "postgresql://owner:secret@ep-reviewed.example.test:5432/grainline?sslmode=VERIFY-FULL",
      "postgresql://owner:secret@ep-reviewed.example.test:5432/grainline?sslmode=verify-full&channel_binding=REQUIRE",
      "postgresql://owner:secret@ep-reviewed.example.test:5432/grainline?sslmode=verify-full&options=-c%20role%3Dother",
      "postgresql://owner:secret@ep-reviewed.example.test:5432/grainline?sslmode=verify-full&sslmode=verify-full",
      "postgresql://owner:secret@ep-reviewed.example.test:5432/grainline?SSLMODE=verify-full",
      "postgresql://owner:secret@ep-reviewed.example.test:5432/grainline?sslmode=verify-full#fragment",
      "postgresql://owner:secret@ep-reviewed.example.test:5432//grainline?sslmode=verify-full",
      "postgresql://owner:secret@ep-reviewed.example.test:5432/grainline/?sslmode=verify-full",
      "postgresql://owner:secret@ep-reviewed.example.test:5432/grainline//?sslmode=verify-full",
      "postgresql://owner:secret@ep-reviewed.example.test:5432/grainline/extra?sslmode=verify-full",
      "postgresql://owner:secret@ep-reviewed.example.test:5432/grainline%2Fother?sslmode=verify-full",
      "postgresql://owner:secret@ep-reviewed.example.test:5432/grainline%3Fother?sslmode=verify-full",
      " postgresql://owner:secret@ep-reviewed.example.test:5432/grainline?sslmode=verify-full",
    ]) {
      assert.throws(
        () => parseGrantAuditDatabaseIdentity(invalidUrl, "DIRECT_URL"),
        (error) => {
          assert.doesNotMatch(error.message, /secret|postgresql:/);
          return true;
        },
      );
    }

    assert.throws(
      () => parseGrantAuditDatabaseIdentity(
        "postgresql://ci:ci@localhost:5432/grainline_ci?sslmode=disable",
        "DIRECT_URL",
        { allowLoopbackCi: true, requireReviewedParameters: true },
      ),
      /sslmode=verify-full/,
    );
    assert.throws(
      () => parseGrantAuditDatabaseIdentity(
        "postgresql://ci:ci@localhost:5432/grainline_ci?sslmode=disable&options=-c%20role%3Dother",
        "GRANT_AUDIT_DATABASE_URL",
        { allowLoopbackCi: true },
      ),
      /loopback development transport must use only sslmode=disable/,
    );
  });

  it("proves the live database and session role before grant or catalog evidence is trusted", async () => {
    const queries = [];
    const matchingClient = {
      async query(sql) {
        queries.push(sql);
        return {
          rows: [{
            database_name: "grainline",
            current_user_name: "neondb_owner",
            session_user_name: "neondb_owner",
          }],
        };
      },
    };
    await assertGrantAuditConnectionMatches(
      matchingClient,
      "grainline",
      "neondb_owner",
    );
    assert.equal(queries.length, 1);
    assert.match(queries[0], /current_database\(\)/);
    assert.match(queries[0], /current_user/);
    assert.match(queries[0], /session_user/);

    await assert.rejects(
      assertGrantAuditConnectionMatches({
        async query() {
          return {
            rows: [{
              database_name: "wrong_database",
              current_user_name: "wrong_role",
              session_user_name: "wrong_role",
            }],
          };
        },
      }, "grainline", "neondb_owner"),
      (error) => {
        assert.match(error.message, /database or session role does not match/);
        assert.doesNotMatch(error.message, /wrong_database|wrong_role|grainline|neondb_owner/);
        return true;
      },
    );
  });

  it("derives the post-cutover function partition only from an exact live ledger", async () => {
    const absent = await readCheckoutStockReservationSourceCutoverState({
      async query() {
        return { rows: [{ migration_table: null }] };
      },
    });
    assert.deepEqual(absent, { applied: false, issues: [] });

    const exactQueries = [];
    const exact = await readCheckoutStockReservationSourceCutoverState({
      async query(sql, parameters) {
        exactQueries.push([sql, parameters]);
        if (exactQueries.length === 1) {
          return { rows: [{ migration_table: "_prisma_migrations" }] };
        }
        return {
          rows: [{
            checksum: CHECKOUT_STOCK_RESERVATION_SOURCE_CUTOVER_MIGRATION_SHA256,
            finished_at: new Date("2026-09-26T00:00:00Z"),
            rolled_back_at: null,
            applied_steps_count: "1",
          }],
        };
      },
    });
    assert.deepEqual(exact, { applied: true, issues: [] });
    assert.deepEqual(exactQueries[1][1], [
      CHECKOUT_STOCK_RESERVATION_SOURCE_CUTOVER_MIGRATION,
    ]);

    const drifted = await readCheckoutStockReservationSourceCutoverState({
      queryCount: 0,
      async query() {
        this.queryCount += 1;
        return this.queryCount === 1
          ? { rows: [{ migration_table: "_prisma_migrations" }] }
          : {
            rows: [{
              checksum: "0".repeat(64),
              finished_at: null,
              rolled_back_at: null,
              applied_steps_count: "0",
            }],
          };
      },
    });
    assert.deepEqual(drifted, {
      applied: false,
      issues: [
        "CheckoutStockReservation source-cutover migration ledger is partial or drifted",
      ],
    });
  });

  it("derives pending User service-ledger activation posture from exact live ledgers", async () => {
    const exactClient = (expectedMigration, expectedChecksum) => ({
      queryCount: 0,
      async query(sql, parameters) {
        this.queryCount += 1;
        if (this.queryCount === 1) {
          return { rows: [{ migration_table: "_prisma_migrations" }] };
        }
        assert.match(sql, /FROM public\._prisma_migrations/u);
        assert.deepEqual(parameters, [expectedMigration]);
        return {
          rows: [{
            checksum: expectedChecksum,
            finished_at: new Date("2026-10-12T00:00:00Z"),
            rolled_back_at: null,
            applied_steps_count: "1",
          }],
        };
      },
    });
    assert.deepEqual(
      await readClerkWebhookEventActivationState(exactClient(
        CLERK_WEBHOOK_EVENT_ACTIVATION_MIGRATION,
        CLERK_WEBHOOK_EVENT_ACTIVATION_MIGRATION_SHA256,
      )),
      { applied: true, issues: [] },
    );
    assert.deepEqual(
      await readClerkWebhookEventForceState(exactClient(
        CLERK_WEBHOOK_EVENT_FORCE_MIGRATION,
        CLERK_WEBHOOK_EVENT_FORCE_MIGRATION_SHA256,
      )),
      { applied: true, issues: [] },
    );
    assert.deepEqual(
      await readAccountDeletionClaimFencePreparationState(exactClient(
        ACCOUNT_DELETION_CLAIM_FENCE_PREPARATION_MIGRATION,
        ACCOUNT_DELETION_CLAIM_FENCE_PREPARATION_MIGRATION_SHA256,
      )),
      { applied: true, issues: [] },
    );
    assert.deepEqual(
      await readAccountDeletionMediaKeyPreparationState(exactClient(
        ACCOUNT_DELETION_MEDIA_KEY_PREPARATION_MIGRATION,
        ACCOUNT_DELETION_MEDIA_KEY_PREPARATION_MIGRATION_SHA256,
      )),
      { applied: true, issues: [] },
    );
    assert.deepEqual(
      await readAccountDeletionSideEffectActivationState(exactClient(
        ACCOUNT_DELETION_SIDE_EFFECT_ACTIVATION_MIGRATION,
        ACCOUNT_DELETION_SIDE_EFFECT_ACTIVATION_MIGRATION_SHA256,
      )),
      { applied: true, issues: [] },
    );
    assert.deepEqual(
      await readAccountDeletionSideEffectForceState(exactClient(
        ACCOUNT_DELETION_SIDE_EFFECT_FORCE_MIGRATION,
        ACCOUNT_DELETION_SIDE_EFFECT_FORCE_MIGRATION_SHA256,
      )),
      { applied: true, issues: [] },
    );
    assert.equal(clerkWebhookEventRlsActivationExpected({
      rlsEnableTables: [CLERK_WEBHOOK_EVENT_TABLE],
      clerkWebhookEventRlsActivationApplied: false,
    }), false);
    assert.equal(accountDeletionSideEffectRlsActivationExpected({
      rlsEnableTables: [ACCOUNT_DELETION_SIDE_EFFECT_TABLE],
      rlsPolicyTables: [ACCOUNT_DELETION_SIDE_EFFECT_TABLE],
      accountDeletionSideEffectRlsActivationApplied: false,
    }), false);
  });

  it("derives staged SellerProfile caller functions only from exact live ledgers", async () => {
    const exactClient = (expectedMigration, expectedChecksum) => ({
      queryCount: 0,
      async query(sql, parameters) {
        this.queryCount += 1;
        if (this.queryCount === 1) {
          return { rows: [{ migration_table: "_prisma_migrations" }] };
        }
        assert.match(sql, /FROM public\._prisma_migrations/u);
        assert.deepEqual(parameters, [expectedMigration]);
        return {
          rows: [{
            checksum: expectedChecksum,
            finished_at: new Date("2026-10-14T00:00:00Z"),
            rolled_back_at: null,
            applied_steps_count: "1",
          }],
        };
      },
    });
    assert.deepEqual(
      await readSellerProfileDeauthorizeCompatState(exactClient(
        SELLER_PROFILE_DEAUTHORIZE_COMPAT_MIGRATION,
        SELLER_PROFILE_DEAUTHORIZE_COMPAT_MIGRATION_SHA256,
      )),
      { applied: true, issues: [] },
    );
    assert.deepEqual(
      await readSellerProfileReconciliationCompatState(exactClient(
        SELLER_PROFILE_RECONCILIATION_COMPAT_MIGRATION,
        SELLER_PROFILE_RECONCILIATION_COMPAT_MIGRATION_SHA256,
      )),
      { applied: true, issues: [] },
    );

    const sourceInventory = {
      functions: [
        "grainline_seller_profile_private_mirror",
        "grainline_seller_profile_supported_snapshot",
        "grainline_seller_profile_deauthorize_compat",
        "grainline_seller_profile_reconciliation_required_compat",
      ],
    };
    assert.deepEqual(
      withAppliedSellerProfileCallerAuthority(sourceInventory, {
        deauthorizeCompatApplied: false,
        reconciliationCompatApplied: false,
      }).functions,
      [
        "grainline_seller_profile_private_mirror",
        "grainline_seller_profile_supported_snapshot",
      ],
    );
    assert.deepEqual(
      withAppliedSellerProfileCallerAuthority(sourceInventory, {
        deauthorizeCompatApplied: true,
        reconciliationCompatApplied: false,
      }).functions,
      [
        "grainline_seller_profile_private_mirror",
        "grainline_seller_profile_supported_snapshot",
        "grainline_seller_profile_deauthorize_compat",
      ],
    );
    assert.deepEqual(
      withAppliedSellerProfileCallerAuthority(sourceInventory, {
        deauthorizeCompatApplied: true,
        reconciliationCompatApplied: true,
      }).functions,
      sourceInventory.functions,
    );

    const drifted = await readSellerProfileDeauthorizeCompatState({
      queryCount: 0,
      async query() {
        this.queryCount += 1;
        return this.queryCount === 1
          ? { rows: [{ migration_table: "_prisma_migrations" }] }
          : {
            rows: [{
              checksum: "0".repeat(64),
              finished_at: new Date("2026-10-14T00:00:00Z"),
              rolled_back_at: null,
              applied_steps_count: "1",
            }],
          };
      },
    });
    assert.deepEqual(drifted, {
      applied: false,
      issues: [
        "SellerProfile deauthorization compatibility migration ledger is partial or drifted",
      ],
    });
  });

  it("derives the SellerProfile private trigger generation from exact live ledgers", {
    skip: typeof withAppliedSellerProfilePredecessorRetirement === "function"
      ? false
      : "requires the SellerProfile private trigger-generation audit",
  }, async () => {
    const exactClient = (expectedMigration, expectedChecksum) => ({
      queryCount: 0,
      async query(sql, parameters) {
        this.queryCount += 1;
        if (this.queryCount === 1) {
          return { rows: [{ migration_table: "_prisma_migrations" }] };
        }
        assert.match(sql, /FROM public\._prisma_migrations/u);
        assert.deepEqual(parameters, [expectedMigration]);
        return {
          rows: [{
            checksum: expectedChecksum,
            finished_at: new Date("2026-10-14T00:00:00Z"),
            rolled_back_at: null,
            applied_steps_count: "1",
          }],
        };
      },
    });
    assert.deepEqual(
      await readSellerProfilePrivatePreparationState(exactClient(
        SELLER_PROFILE_PRIVATE_PREPARATION_MIGRATION,
        SELLER_PROFILE_PRIVATE_PREPARATION_MIGRATION_SHA256,
      )),
      { applied: true, issues: [] },
    );
    assert.deepEqual(
      await readSellerProfilePrivatePredecessorRetirementState(exactClient(
        SELLER_PROFILE_PRIVATE_PREDECESSOR_RETIREMENT_MIGRATION,
        SELLER_PROFILE_PRIVATE_PREDECESSOR_RETIREMENT_MIGRATION_SHA256,
      )),
      { applied: true, issues: [] },
    );
    assert.deepEqual(
      await readSellerProfilePostRetirementRepairState(exactClient(
        SELLER_PROFILE_POST_RETIREMENT_REPAIR_MIGRATION,
        SELLER_PROFILE_POST_RETIREMENT_REPAIR_MIGRATION_SHA256,
      )),
      { applied: true, issues: [] },
    );
    assert.deepEqual(
      await readSellerProfilePrivateInvariantsState(exactClient(
        SELLER_PROFILE_PRIVATE_INVARIANTS_MIGRATION,
        SELLER_PROFILE_PRIVATE_INVARIANTS_MIGRATION_SHA256,
      )),
      { applied: true, issues: [] },
    );
    assert.deepEqual(
      await readSellerProfilePublicPreparationState(exactClient(
        SELLER_PROFILE_PUBLIC_PREPARATION_MIGRATION,
        SELLER_PROFILE_PUBLIC_PREPARATION_MIGRATION_SHA256,
      )),
      { applied: true, issues: [] },
    );
    assert.deepEqual(
      await readSellerProfilePublicEnableState(exactClient(
        SELLER_PROFILE_PUBLIC_ENABLE_MIGRATION,
        SELLER_PROFILE_PUBLIC_ENABLE_MIGRATION_SHA256,
      )),
      { applied: true, issues: [] },
    );
    assert.deepEqual(
      await readSellerProfilePublicForceState(exactClient(
        SELLER_PROFILE_PUBLIC_FORCE_MIGRATION,
        SELLER_PROFILE_PUBLIC_FORCE_MIGRATION_SHA256,
      )),
      { applied: true, issues: [] },
    );

    const sourceInventory = {
      functions: [
        "grainline_existing_function",
        "grainline_seller_profile_private_initialize",
      ],
    };
    const beforePreparation = withAppliedSellerProfilePredecessorRetirement(
      sourceInventory,
      { preparationApplied: false, retirementApplied: false },
    );
    assert.deepEqual(beforePreparation.functions, ["grainline_existing_function"]);

    const prepared = withAppliedSellerProfilePredecessorRetirement(
      sourceInventory,
      { preparationApplied: true, retirementApplied: false },
    );
    assert.deepEqual(prepared.functions, [
      "grainline_existing_function",
      "grainline_seller_profile_private_mirror",
      "grainline_seller_profile_supported_snapshot",
    ]);
    assert.equal(
      runtimePrivateFunctionNames(prepared).includes(
        "grainline_seller_profile_private_mirror",
      ),
      true,
    );
    assert.equal(
      runtimePrivateFunctionNames(prepared).includes(
        "grainline_seller_profile_supported_snapshot",
      ),
      true,
    );

    const retired = withAppliedSellerProfilePredecessorRetirement(
      sourceInventory,
      { preparationApplied: true, retirementApplied: true },
    );
    assert.deepEqual(retired.functions, sourceInventory.functions);
    const invariantSourceInventory = {
      functions: [
        ...retired.functions,
        ...SELLER_PROFILE_PRIVATE_INVARIANT_FUNCTION_NAMES,
      ],
    };
    assert.deepEqual(
      withAppliedSellerProfilePrivateInvariants(
        invariantSourceInventory,
        false,
      ).functions,
      retired.functions,
    );
    assert.deepEqual(
      withAppliedSellerProfilePrivateInvariants(
        invariantSourceInventory,
        true,
      ).functions,
      invariantSourceInventory.functions.slice().sort((left, right) =>
        left.localeCompare(right)),
    );
    assert.deepEqual(collectSellerProfilePrivateMigrationOrderIssues({
      preparationApplied: true,
      retirementApplied: true,
    }), []);
    assert.deepEqual(collectSellerProfilePrivateMigrationOrderIssues({
      preparationApplied: false,
      retirementApplied: true,
    }), [
      "SellerProfile private predecessor retirement is applied without its exact preparation prerequisite",
    ]);
    assert.deepEqual(collectSellerProfilePrivateMigrationOrderIssues({
      preparationApplied: true,
      retirementApplied: false,
      postRetirementRepairApplied: true,
    }), [
      "SellerProfile post-retirement repair is applied without exact predecessor retirement",
    ]);
    assert.deepEqual(collectSellerProfilePrivateMigrationOrderIssues({
      preparationApplied: true,
      retirementApplied: true,
      postRetirementRepairApplied: false,
      invariantsApplied: true,
    }), [
      "SellerProfile private invariants are applied without exact retirement and post-retirement repair prerequisites",
    ]);
    assert.deepEqual(collectSellerProfilePrivateMigrationOrderIssues({
      preparationApplied: true,
      retirementApplied: true,
      postRetirementRepairApplied: true,
      invariantsApplied: false,
      enableApplied: true,
    }), [
      "SellerProfilePrivate RLS ENABLE is applied without its exact invariant prerequisite",
    ]);
    assert.deepEqual(collectSellerProfilePrivateMigrationOrderIssues({
      preparationApplied: true,
      retirementApplied: true,
      postRetirementRepairApplied: true,
      invariantsApplied: true,
      enableApplied: false,
      forceApplied: true,
    }), [
      "SellerProfilePrivate RLS FORCE is applied without its exact ENABLE prerequisite",
    ]);
    assert.deepEqual(collectSellerProfilePublicMigrationOrderIssues({
      preparationApplied: true,
      privateForceApplied: true,
      enableApplied: true,
      forceApplied: true,
    }), []);
    assert.deepEqual(collectSellerProfilePublicMigrationOrderIssues({
      preparationApplied: false,
      privateForceApplied: true,
      enableApplied: true,
    }), [
      "SellerProfile public RLS ENABLE is applied without its exact final preparation prerequisite",
    ]);
    assert.deepEqual(collectSellerProfilePublicMigrationOrderIssues({
      preparationApplied: true,
      privateForceApplied: false,
      enableApplied: true,
    }), [
      "SellerProfile public RLS ENABLE is applied without accepted SellerProfilePrivate FORCE",
    ]);
    assert.deepEqual(collectSellerProfilePublicMigrationOrderIssues({
      preparationApplied: true,
      privateForceApplied: true,
      enableApplied: false,
      forceApplied: true,
    }), [
      "SellerProfile public RLS FORCE is applied without its exact ENABLE prerequisite",
    ]);
    assert.equal(
      policylessServiceRlsTableNames({
        sellerProfilePrivateRlsEnabled: true,
      }).includes("SellerProfilePrivate"),
      true,
    );
    const sellerPrivateForcedInventory = {
      tables: ["SellerProfilePrivate"],
      sellerProfilePrivateRlsEnabled: true,
      sellerProfilePrivateRlsForced: true,
    };
    assert.deepEqual(collectPolicylessServiceRlsIssues([{
      table_name: "SellerProfilePrivate",
      rls_enabled: true,
      rls_forced: true,
      policy_count: 0,
    }], sellerPrivateForcedInventory), []);
    assert.deepEqual(collectPolicylessServiceRlsIssues([{
      table_name: "SellerProfilePrivate",
      rls_enabled: true,
      rls_forced: false,
      policy_count: 0,
    }], sellerPrivateForcedInventory), [
      "service-only table SellerProfilePrivate must have FORCE ROW LEVEL SECURITY enabled",
    ]);
  });

  it("executes live grant-audit catalog checks against synthetic Postgres roles", { skip: auditIntegrationSkipReason() }, async () => {
    await withAuditFixture({ tableName: "SavedSearch" }, async ({ auditClient, databaseName, inventory, migrationRole, runtimeRole }) => {
      await assertGrantAuditConnectionMatches(auditClient, databaseName, migrationRole);
      assert.deepEqual(
        await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory }),
        [],
      );
      assert.deepEqual(await readSavedSearchCatalogState(auditClient), {
        schema: "public",
        table: "SavedSearch",
        relrowsecurity: false,
        relforcerowsecurity: false,
        policy_count: 0,
      });
    });

    await withAuditFixture({ auditAsAdmin: true }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      assert.match(
        (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n"),
        /audit connection uses current_user/,
      );
    });

    await withAuditFixture({ grantTablePrivileges: false }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      assert.match(
        (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n"),
        /lacks SELECT/,
      );
    });

    await withAuditFixture(
      { grantPublicTablePrivileges: true, grantTablePrivileges: false },
      async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
        const issues = (
          await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })
        ).join("\n");
        assert.match(issues, /runtime role is missing direct table privileges: SELECT, INSERT, UPDATE, DELETE/);
        assert.match(issues, /grants table privileges to PUBLIC: DELETE, INSERT, SELECT, UPDATE/);
      },
    );

    await withAuditFixture({ grantUnexpectedTablePrivileges: true }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      assert.match(
        (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n"),
        /has unexpected table privileges: REFERENCES, TRIGGER, TRUNCATE/,
      );
    });

    await withAuditFixture({ grantTableGrantOption: true }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      assert.match(
        (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n"),
        /has grant options: SELECT/,
      );
    });

    await withAuditFixture({ grantColumnPrivilege: true }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      assert.match(
        (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n"),
        /runtime role has unexpected column privileges: id:REFERENCES/,
      );
    });

    await withAuditFixture({ grantPublicColumnPrivilege: true }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      assert.match(
        (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n"),
        /PUBLIC has column privileges: id:REFERENCES/,
      );
    });

    await withAuditFixture({ defaultPrivileges: false }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      assert.match(
        (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n"),
        /default privileges/,
      );
    });

    await withAuditFixture({ grantUnexpectedDefaultTablePrivileges: true }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      assert.match(
        (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n"),
        /default table privileges .* has unexpected table privileges: REFERENCES, TRIGGER, TRUNCATE/,
      );
    });

    await withAuditFixture({ grantDefaultTableGrantOption: true }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      assert.match(
        (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n"),
        /default table privileges .* has grant options: SELECT/,
      );
    });

    await withAuditFixture({ grantPublicDefaultTablePrivilege: true }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      assert.match(
        (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n"),
        /default table privileges .* grant SELECT to PUBLIC/,
      );
    });

    await withAuditFixture({ grantGlobalDefaultTablePrivilege: true }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      const issues = (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n");
      assert.match(issues, /default table privileges .* must be scoped to schema public/);
      assert.doesNotMatch(issues, /default privileges .* do not grant SELECT on r objects/);
    });

    await withAuditFixture({ createParentRole: true }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      assert.match(
        (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n"),
        /is member of role/,
      );
    });

    await withAuditFixture({ runtimeRoleAttributes: "LOGIN NOINHERIT BYPASSRLS" }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      assert.match(
        (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n"),
        /rolbypassrls/,
      );
    });

    await withAuditFixture({ runtimeRoleAttributes: "NOLOGIN NOINHERIT" }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      assert.match(
        (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n"),
        /must have LOGIN/,
      );
    });

    await withAuditFixture({ runtimeRoleAttributes: "LOGIN INHERIT" }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      assert.match(
        (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n"),
        /must have NOINHERIT/,
      );
    });

    await withAuditFixture({ grantDatabaseCreate: true }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      assert.match(
        (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n"),
        /has CREATE on current database/,
      );
    });

    await withAuditFixture({ grantNonPublicSchemaCreate: true }, async ({ auditClient, inventory, migrationRole, nonPublicSchemaName, runtimeRole }) => {
      assert.ok(
        (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory }))
          .includes(`runtime role ${runtimeRole} has CREATE on non-public schema ${nonPublicSchemaName}`),
      );
    });

    await withAuditFixture({ grantUntrackedTableSelect: true }, async ({ auditClient, inventory, migrationRole, runtimeRole, untrackedTableName }) => {
      assert.ok(
        (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory }))
          .includes(`runtime role has SELECT on untracked public table ${untrackedTableName}`),
      );
    });

    await withAuditFixture({ runtimeOwnsTable: true }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      const issues = (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n");
      assert.match(issues, /runtime role owns table/);
      assert.match(issues, /expected/);
    });

    await withAuditFixture({ createRlsPolicy: true }, async ({ auditClient, inventory, migrationRole, policyName, runtimeRole, tableName }) => {
      const issues = (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n");
      assert.match(
        issues,
        new RegExp(`table ${tableName} has RLS policies \\(${policyName}\\) but ROW LEVEL SECURITY is not enabled`),
      );
      assert.match(
        issues,
        new RegExp(`table ${tableName} has RLS policies \\(${policyName}\\) but FORCE ROW LEVEL SECURITY is not enabled`),
      );
    });

    await withAuditFixture({ createRlsPolicy: true, enableRls: true }, async ({ auditClient, inventory, migrationRole, policyName, runtimeRole, tableName }) => {
      const issues = (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n");
      assert.doesNotMatch(issues, /but ROW LEVEL SECURITY is not enabled/);
      assert.match(
        issues,
        new RegExp(`table ${tableName} has RLS policies \\(${policyName}\\) but FORCE ROW LEVEL SECURITY is not enabled`),
      );
    });

    await withAuditFixture({ createRlsPolicy: true, enableRls: true, forceRls: true }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      assert.deepEqual(
        await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory }),
        [],
      );
    });

    await withAuditFixture({ enableRls: true }, async ({ auditClient, inventory, migrationRole, runtimeRole, tableName }) => {
      assert.ok(
        (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory }))
          .includes(`table ${tableName} has ROW LEVEL SECURITY enabled but zero policies`),
      );
    });

    await withAuditFixture({
      enableRls: true,
      grantTablePrivileges: false,
      tableName: USER_TABLE,
    }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      assert.deepEqual(
        await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory }),
        [],
      );
    });

    await withAuditFixture({ forceRls: true, tableName: "SavedSearch" }, async ({ auditClient, inventory, migrationRole, runtimeRole, tableName }) => {
      assert.ok(
        (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory }))
          .includes(`table ${tableName} has FORCE ROW LEVEL SECURITY enabled but zero policies`),
      );
      assert.deepEqual(await readSavedSearchCatalogState(auditClient), {
        schema: "public",
        table: "SavedSearch",
        relrowsecurity: false,
        relforcerowsecurity: true,
        policy_count: 0,
      });
    });

    await withAuditFixture({
      createRlsPolicy: true,
      enableRls: true,
      forceRls: true,
      trackRlsPolicy: false,
    }, async ({ auditClient, inventory, migrationRole, policyName, runtimeRole, tableName }) => {
      assert.match(
        (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n"),
        new RegExp(
          `table ${tableName} has live RLS policies \\(${policyName}\\) absent from the reviewed migration inventory`,
        ),
      );
    });

    await withAuditFixture({ createPgTrgmExtension: true }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      assert.deepEqual(
        await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory }),
        [],
      );
    });

    await withAuditFixture({ requirePgTrgmExtension: true }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      assert.match(
        (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n"),
        /missing expected extension pg_trgm/,
      );
    });

    await withAuditFixture({ createPgTrgmExtensionAsAdmin: true }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      const issues = (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n");
      assert.match(issues, /extension pg_trgm owned by .* expected/);
      assert.doesNotMatch(issues, /not grantable by migration role/);
    });

    await withAuditFixture({
      createPgTrgmExtensionAsAdmin: true,
      revokeAdminPgTrgmPublicExecute: true,
    }, async ({ auditClient, inventory, migrationRole, runtimeRole }) => {
      const issues = (await auditLiveDatabase({ client: auditClient, runtimeRole, migrationRole, inventory })).join("\n");
      assert.match(issues, /extension pg_trgm owned by .* expected/);
      assert.match(issues, /lacks EXECUTE and .*not grantable by migration role/);
    });
  });

  it("records the exact privilege classes required for the runtime role", () => {
    assert.deepEqual(REQUIRED_TABLE_PRIVILEGES, ["SELECT", "INSERT", "UPDATE", "DELETE"]);
    assert.deepEqual(SAVED_SEARCH_PHASE_A_TABLE_PRIVILEGES, ["SELECT", "INSERT", "DELETE"]);
    assert.deepEqual(REQUIRED_SEQUENCE_PRIVILEGES, ["USAGE", "SELECT"]);
    assert.deepEqual(REQUIRED_FUNCTION_PRIVILEGES, ["EXECUTE"]);
    assert.deepEqual(REQUIRED_TYPE_PRIVILEGES, ["USAGE"]);
  });

  it("does not require explicit future function/type defaults while PUBLIC defaults are intact", () => {
    const inventory = deriveGrantInventory();

    assert.deepEqual(
      defaultPrivilegeRequirements(inventory),
      [
        ["r", REQUIRED_TABLE_PRIVILEGES],
        ["S", REQUIRED_SEQUENCE_PRIVILEGES],
      ],
    );
    assert.deepEqual(
      defaultPrivilegeRequirements({ ...inventory, publicRevokes: ["REVOKE SELECT ON TABLES FROM PUBLIC"] }),
      [
        ["r", REQUIRED_TABLE_PRIVILEGES],
        ["S", REQUIRED_SEQUENCE_PRIVILEGES],
      ],
    );
    assert.deepEqual(
      defaultPrivilegeRequirements({ ...inventory, publicRevokes: ["REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC"] }),
      [
        ["r", REQUIRED_TABLE_PRIVILEGES],
        ["S", REQUIRED_SEQUENCE_PRIVILEGES],
      ],
    );
    assert.deepEqual(
      defaultPrivilegeRequirements({
        ...inventory,
        publicDefaultPrivilegeRevokes: ["ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC"],
      }),
      [
        ["r", REQUIRED_TABLE_PRIVILEGES],
        ["S", REQUIRED_SEQUENCE_PRIVILEGES],
        ["f", REQUIRED_FUNCTION_PRIVILEGES],
      ],
    );
    assert.deepEqual(
      defaultPrivilegeRequirements({ ...inventory, publicRevokes: ["REVOKE USAGE ON TYPES FROM PUBLIC"] }),
      [
        ["r", REQUIRED_TABLE_PRIVILEGES],
        ["S", REQUIRED_SEQUENCE_PRIVILEGES],
      ],
    );
    assert.deepEqual(
      defaultPrivilegeRequirements({
        ...inventory,
        publicDefaultPrivilegeRevokes: ["ALTER DEFAULT PRIVILEGES REVOKE USAGE ON TYPES FROM PUBLIC"],
      }),
      [
        ["r", REQUIRED_TABLE_PRIVILEGES],
        ["S", REQUIRED_SEQUENCE_PRIVILEGES],
        ["T", REQUIRED_TYPE_PRIVILEGES],
      ],
    );
  });

  it("derives mapped Prisma table and enum names instead of assuming model names", () => {
    const root = mkdtempSync(join(tmpdir(), "grainline-grant-inventory-"));
    mkdirSync(join(root, "prisma", "migrations", "0001"), { recursive: true });
    writeFileSync(
      join(root, "prisma", "schema.prisma"),
      [
        "model InternalUser {",
        "  id String @id @default(cuid())",
        '  @@map("User")',
        "}",
        "",
        "enum InternalRole {",
        "  USER",
        '  @@map("Role")',
        "}",
      ].join("\n"),
    );
    writeFileSync(
      join(root, "prisma", "migrations", "0001", "migration.sql"),
      [
        'CREATE OR REPLACE FUNCTION "grainline_test"() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;',
        "REVOKE EXECUTE ON FUNCTION grainline_test() FROM PUBLIC;",
        "ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;",
      ].join("\n"),
    );

    const inventory = deriveGrantInventory(root);

    assert.deepEqual(inventory.tables, ["User"]);
    assert.deepEqual(inventory.enums, ["Role"]);
    assert.deepEqual(inventory.functions, ["grainline_test"]);
    assert.deepEqual(inventory.publicRevokes, [
      "ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC",
      "REVOKE EXECUTE ON FUNCTION grainline_test() FROM PUBLIC",
    ]);
    assert.deepEqual(inventory.publicDefaultPrivilegeRevokes, [
      "ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC",
    ]);
  });

  it("derives the SavedBlogPost predecessor grant posture only from the complete provisioning guard", () => {
    const root = mkdtempSync(join(tmpdir(), "grainline-saved-blog-grant-inventory-"));
    mkdirSync(join(root, "prisma", "migrations"), { recursive: true });
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(
      join(root, "prisma", "schema.prisma"),
      [
        "model SavedBlogPost {",
        "  id String @id",
        "}",
      ].join("\n"),
    );

    // Historical access-source replays intentionally restore an older grant-audit
    // script. Future-only grant posture assertions do not apply to that snapshot.
    if (
      !Object.prototype.hasOwnProperty.call(
        deriveGrantInventory(root),
        "savedBlogPostOwnerPrivilegesProvisioned",
      )
    ) return;

    const guard = "SavedBlogPost RLS is partially or unexpectedly configured; refusing runtime-role provisioning";
    const revoke = 'REVOKE UPDATE ON TABLE public."SavedBlogPost" FROM :"runtime_role"';
    const provisioningPath = join(root, "scripts", "provision-runtime-db-role.sql");

    assert.equal(deriveGrantInventory(root).savedBlogPostOwnerPrivilegesProvisioned, false);
    writeFileSync(provisioningPath, `${guard}\n`);
    assert.equal(deriveGrantInventory(root).savedBlogPostOwnerPrivilegesProvisioned, false);
    writeFileSync(provisioningPath, `${revoke};\n`);
    assert.equal(deriveGrantInventory(root).savedBlogPostOwnerPrivilegesProvisioned, false);
    writeFileSync(provisioningPath, `${guard}\n${revoke};\n`);
    assert.equal(deriveGrantInventory(root).savedBlogPostOwnerPrivilegesProvisioned, true);
  });

  it("does not demand the staged refund-reconciliation table before its sealed migration is restored", () => {
    const root = mkdtempSync(join(tmpdir(), "grainline-refund-inventory-"));
    mkdirSync(join(root, "prisma", "migrations"), { recursive: true });
    writeFileSync(
      join(root, "prisma", "schema.prisma"),
      [
        "model OrderRefundReconciliation {",
        "  id String @id",
        "}",
      ].join("\n"),
    );
    assert.deepEqual(deriveGrantInventory(root).tables, []);

    const migrationDirectory = join(
      root,
      "prisma",
      "migrations",
      "20260824040000_prepare_order_refund_reconciliation_authority",
    );
    mkdirSync(migrationDirectory, { recursive: true });
    writeFileSync(
      join(migrationDirectory, "migration.sql"),
      "SELECT 1;",
    );
    assert.deepEqual(deriveGrantInventory(root).tables, []);

    writeFileSync(
      join(migrationDirectory, "migration.sql"),
      'CREATE TABLE public."OrderRefundReconciliation" (id text PRIMARY KEY);',
    );
    assert.deepEqual(
      deriveGrantInventory(root).tables,
      ["OrderRefundReconciliation"],
    );
  });

  it("does not demand the staged seller-deauthorization ledger before its exact migration is restored", () => {
    const root = mkdtempSync(join(tmpdir(), "grainline-deauthorization-inventory-"));
    mkdirSync(join(root, "prisma", "migrations"), { recursive: true });
    writeFileSync(
      join(root, "prisma", "schema.prisma"),
      [
        "model SellerDeauthorizationApplication {",
        "  eventId String @id",
        "}",
      ].join("\n"),
    );
    assert.deepEqual(deriveGrantInventory(root).tables, []);

    const migrationDirectory = join(
      root,
      "prisma",
      "migrations",
      "20260905120000_prepare_order_seller_deauthorization_authority",
    );
    mkdirSync(migrationDirectory, { recursive: true });
    writeFileSync(
      join(migrationDirectory, "migration.sql"),
      'CREATE TABLE public."SellerDeauthorizationApplication" ("eventId" text PRIMARY KEY);',
    );
    assert.deepEqual(
      deriveGrantInventory(root).tables,
      ["SellerDeauthorizationApplication"],
    );
  });

  it("does not demand the staged staff capability before its exact migration is restored", () => {
    const root = mkdtempSync(join(tmpdir(), "grainline-staff-capability-inventory-"));
    mkdirSync(join(root, "prisma", "migrations"), { recursive: true });
    writeFileSync(
      join(root, "prisma", "schema.prisma"),
      [
        "model OrderStaffCapability {",
        "  id String @id",
        "}",
      ].join("\n"),
    );
    assert.deepEqual(deriveGrantInventory(root).tables, []);

    const wrongDirectory = join(root, "prisma", "migrations", "0001_wrong");
    mkdirSync(wrongDirectory, { recursive: true });
    writeFileSync(
      join(wrongDirectory, "migration.sql"),
      'CREATE TABLE public."OrderStaffCapability" (id text PRIMARY KEY);',
    );
    assert.deepEqual(deriveGrantInventory(root).tables, []);

    const migrationDirectory = join(
      root,
      "prisma",
      "migrations",
      "20260905100000_prepare_order_ban_review_authority",
    );
    mkdirSync(migrationDirectory, { recursive: true });
    writeFileSync(
      join(migrationDirectory, "migration.sql"),
      'CREATE TABLE public."OrderStaffCapability" (id text PRIMARY KEY);',
    );
    assert.deepEqual(
      deriveGrantInventory(root).tables,
      ["OrderStaffCapability"],
    );
  });

  it("does not demand staged dispute-recovery objects before their exact migration is restored", () => {
    const root = mkdtempSync(join(tmpdir(), "grainline-dispute-recovery-inventory-"));
    mkdirSync(join(root, "prisma", "migrations"), { recursive: true });
    writeFileSync(
      join(root, "prisma", "schema.prisma"),
      [
        "model OrderDisputeRecovery {",
        "  id String @id",
        "}",
        "",
        "enum OrderDisputeRecoveryStatus {",
        "  REVERSAL_PENDING",
        "}",
      ].join("\n"),
    );
    assert.deepEqual(deriveGrantInventory(root).tables, []);
    assert.deepEqual(deriveGrantInventory(root).enums, []);

    const migrationDirectory = join(
      root,
      "prisma",
      "migrations",
      "20260930040000_prepare_order_dispute_recovery",
    );
    mkdirSync(migrationDirectory, { recursive: true });
    writeFileSync(
      join(migrationDirectory, "migration.sql"),
      'CREATE TABLE public."OrderDisputeRecovery" (id text PRIMARY KEY);',
    );
    assert.deepEqual(deriveGrantInventory(root).tables, []);
    assert.deepEqual(deriveGrantInventory(root).enums, []);

    writeFileSync(
      join(migrationDirectory, "migration.sql"),
      [
        'CREATE TYPE public."OrderDisputeRecoveryStatus" AS ENUM (\'REVERSAL_PENDING\');',
        'CREATE TABLE public."OrderDisputeRecovery" (id text PRIMARY KEY);',
      ].join("\n"),
    );
    assert.deepEqual(
      deriveGrantInventory(root).tables,
      ["OrderDisputeRecovery"],
    );
    assert.deepEqual(
      deriveGrantInventory(root).enums,
      ["OrderDisputeRecoveryStatus"],
    );
  });

  it("documents source-derived inventory and the live-proof boundary", () => {
    const plan = source("docs/db-defense-in-depth-plan.md");
    const rls = source("docs/rls-feasibility-plan.md");
    const runbook = source("docs/runbook.md");
    const launch = source("docs/launch-checklist.md");
    const envExample = source(".env.example");
    const pkg = source("package.json");

    assert.match(plan, /Source-derived grant inventory/);
    assert.match(plan, /60 Prisma model tables/);
    assert.match(plan, /21 Prisma enum types/);
    assert.match(plan, /0 source-derived sequences/);
    assert.match(plan, /1 source-derived extension/);
    assert.match(plan, /pg_trgm/);
    assert.match(plan, /bootstrap-owned\s+trusted-extension functions/);
    assert.match(plan, /PUBLIC` default/);
    assert.match(plan, /grainline_notification_preferences_valid/);
    assert.match(plan, /PUBLIC.*dependency/);
    assert.match(plan, /role memberships/);
    assert.match(plan, /current_user` and `session_user`/);
    assert.match(plan, /RLS policies.*ROW LEVEL SECURITY.*FORCE ROW LEVEL SECURITY/s);
    assert.match(plan, /version-controlled SQL/);
    assert.match(plan, /synthetic Postgres roles\/databases/);
    assert.match(plan, /tracked app objects owned by the migration role/);
    assert.match(plan, /database-level `CREATE`/);
    assert.match(plan, /non-public schemas/);
    assert.match(plan, /non-model public tables inherit runtime table DML/);
    assert.match(plan, /add them to the audit inventory or explicitly\s+`REVOKE` runtime access/);
    assert.match(plan, /audit:db-grants/);
    assert.match(runbook, /`DIRECT_URL` must authenticate as the declared migration owner role/);
    assert.match(runbook, /version-controlled SQL or migrations/);
    assert.match(runbook, /pg_trgm/);
    assert.match(runbook, /bootstrap\/admin role/);
    assert.match(runbook, /runtime lacks\s+access that the declared migration role cannot restore/);
    assert.match(runbook, /same environment\/secret set that will run migrations/);
    assert.match(runbook, /RLS policies.*ROW LEVEL SECURITY.*FORCE ROW LEVEL SECURITY/s);
    assert.match(runbook, /Non-model public tables created by the migration role can inherit runtime DML/);
    assert.match(runbook, /grant-audit\s+inventory or explicitly `REVOKE` runtime access/);
    assert.match(launch, /GRANT_AUDIT_DATABASE_URL="\$DIRECT_URL"/);
    assert.match(launch, /RUNTIME_DB_ROLE=grainline_app_runtime/);
    assert.match(launch, /MIGRATION_DB_ROLE=neondb_owner/);
    assert.match(launch, /SAVED_SEARCH_CATALOG_STATE=\{\.\.\.\}/);
    assert.match(runbook, /SAVED_SEARCH_CATALOG_STATE=\{\.\.\.\}/);
    assert.match(envExample, /^RUNTIME_DB_ROLE=grainline_app_runtime$/m);
    assert.match(envExample, /^MIGRATION_DB_ROLE=neondb_owner$/m);
    assert.match(launch, /clean checkout of the exact release commit/);
    const ownershipIndex = launch.indexOf('query `public."SavedSearch"` ownership');
    const provisionIndex = launch.indexOf("scripts/provision-runtime-db-role.sql");
    const migrateIndex = launch.indexOf("npm run migrate:deploy:guarded");
    const statusIndex = launch.indexOf("npx prisma migrate status");
    const auditIndex = launch.indexOf("npm run audit:db-grants");
    assert.ok(ownershipIndex < provisionIndex);
    assert.ok(provisionIndex < migrateIndex);
    assert.ok(migrateIndex < statusIndex);
    assert.ok(statusIndex < auditIndex);
    assert.match(rls, /public-default dependency/);
    assert.match(rls, /runtime `EXECUTE` is missing/);
    assert.match(pkg, /"audit:db-grants": "node scripts\/audit-runtime-db-grants\.mjs"/);
    assert.match(
      pkg,
      /"migrate:deploy:guarded": "node scripts\/guard-saved-search-rls-deploy\.mjs && prisma migrate deploy && npm run audit:db-grants -- --require-direct-url"/,
    );
  });

  it("keeps the runtime-role provisioning SQL aligned with the grant inventory", () => {
    const inventory = deriveGrantInventory();
    const provision = source("scripts/provision-runtime-db-role.sql");
    const plan = source("docs/db-defense-in-depth-plan.md");
    const runbook = source("docs/runbook.md");
    const launch = source("docs/launch-checklist.md");

    assert.match(provision, /psql "\$DIRECT_URL"/);
    assert.match(provision, /-v runtime_role=grainline_app_runtime/);
    assert.match(provision, /-v migration_role=grainline_migration_owner/);
    assert.match(provision, /current_user/);
    assert.match(provision, /session_user/);
    assert.match(provision, /rolbypassrls/);
    assert.match(provision, /ALTER ROLE %I LOGIN NOINHERIT/);
    assert.match(provision, /REVOKE %s \(%s\) ON TABLE %I\.%I FROM %I/);
    assert.match(provision, /pg_auth_members/);
    const guardResultCount = (provision.match(/^\\gset$/gm) ?? []).length;
    const sellerProfilePublicProvisioningPresent = provision.includes(
      "SellerExactMapConsentEvent",
    );
    const supportRequestProvisioningPresent = provision.includes(
      "support_request_rls_active",
    );
    const savedBlogPostProvisioningPresent = provision.includes(
      "SavedBlogPost RLS is partially or unexpectedly configured",
    );
    const cartCartItemProvisioningPresent = provision.includes(
      "grainline_cart_rls_active",
    );
    const stockNotificationProvisioningPresent = provision.includes(
      "grainline_stock_notification_rls_active",
    );
    const followProvisioningPresent = provision.includes(
      "grainline_follow_rls_active",
    );
    assert.equal(
      guardResultCount,
      (sellerProfilePublicProvisioningPresent ? 25 : 24)
        + Number(supportRequestProvisioningPresent)
        + Number(savedBlogPostProvisioningPresent)
        + Number(cartCartItemProvisioningPresent)
        + Number(stockNotificationProvisioningPresent)
        + Number(followProvisioningPresent),
    );
    if (sellerProfilePublicProvisioningPresent) {
      assert.match(provision, /seller_profile_rls_active/);
      assert.match(
        provision,
        /REVOKE ALL ON TABLE public\."SellerProfile"\s+FROM PUBLIC, :"runtime_role"/,
      );
    } else {
      assert.doesNotMatch(provision, /seller_profile_rls_active/);
      assert.doesNotMatch(
        provision,
        /REVOKE ALL ON TABLE public\."SellerProfile"\s+FROM PUBLIC, :"runtime_role"/,
      );
    }
    if (supportRequestProvisioningPresent) {
      assert.match(
        provision,
        /SupportRequest RLS is partially or unexpectedly configured; refusing runtime-role provisioning/,
      );
      assert.match(
        provision,
        /\\if :support_request_rls_active[\s\S]*REVOKE ALL ON TABLE public\."SupportRequest"\s+FROM PUBLIC, :"runtime_role"/,
      );
    }
    if (savedBlogPostProvisioningPresent) {
      assert.match(
        provision,
        /SavedBlogPost RLS is partially or unexpectedly configured; refusing runtime-role provisioning/,
      );
      assert.match(
        provision,
        /REVOKE UPDATE ON TABLE public\."SavedBlogPost" FROM :"runtime_role"/,
      );
    }
    if (cartCartItemProvisioningPresent) {
      for (const functionName of CART_CART_ITEM_RUNTIME_FUNCTION_NAMES) {
        assert.match(
          provision,
          new RegExp(
            `REVOKE ALL ON FUNCTION public\\.${functionName}\\(text\\)[\\s\\S]*GRANT EXECUTE ON FUNCTION public\\.${functionName}\\(text\\)`,
          ),
        );
      }
    }
    if (stockNotificationProvisioningPresent) {
      assert.match(
        provision,
        /StockNotification RLS is partially or unexpectedly configured; refusing runtime-role provisioning/,
      );
      assert.match(
        provision,
        /\\if :grainline_stock_notification_rls_active[\s\S]*REVOKE ALL ON TABLE public\."StockNotification"[\s\S]*GRANT SELECT, DELETE ON TABLE public\."StockNotification"/,
      );
    }
    if (followProvisioningPresent) {
      assert.match(
        provision,
        /Follow RLS is partially or unexpectedly configured; refusing runtime-role provisioning/,
      );
      assert.match(
        provision,
        /\\if :grainline_follow_rls_active[\s\S]*REVOKE ALL ON TABLE public\."Follow"\s+FROM PUBLIC, :"runtime_role"/,
      );
    }
    assert.equal(
      (provision.match(/EXISTS \(SELECT 1 FROM failure\) AS grainline_role_provisioning_failed/g) ?? []).length,
      guardResultCount,
    );
    assert.equal(
      (provision.match(/^\\if :grainline_role_provisioning_failed$/gm) ?? []).length,
      guardResultCount,
    );
    assert.doesNotMatch(provision, /^\\quit(?:\s|$)/m);
    assert.equal(
      (
        provision.match(
          /RAISE EXCEPTION 'runtime-role provisioning refused'/g,
        ) ?? []
      ).length,
      guardResultCount + 2,
    );
    assert.doesNotMatch(provision, /^\\if :\{\?grainline_role_provisioning_failure\}$/m);
    assert.match(provision, /GRANT USAGE ON SCHEMA public TO :"runtime_role"/);
    assert.match(provision, /REVOKE CREATE ON SCHEMA public FROM :"runtime_role"/);
    assert.match(provision, /REVOKE CREATE ON DATABASE/);
    assert.match(
      provision,
      /DirectUpload RLS is partially or unexpectedly configured; refusing runtime-role provisioning/,
    );
    assert.match(
      provision,
      /\\if :direct_upload_rls_active[\s\S]*REVOKE ALL ON TABLE public\."DirectUpload"/,
    );
    assert.match(
      provision,
      /Case-family RLS is partially or unexpectedly configured; refusing runtime-role provisioning/,
    );
    assert.match(
      provision,
      /\\if :case_rls_active[\s\S]*REVOKE ALL ON TABLE[\s\S]*public\."Case"[\s\S]*public\."CaseMessage"[\s\S]*public\."CaseMessageAttachment"/,
    );
    assert.match(
      provision,
      /StripeWebhookEvent RLS is partially or unexpectedly configured; refusing runtime-role provisioning/,
    );
    assert.match(
      provision,
      /\\if :stripe_webhook_event_rls_active[\s\S]*REVOKE ALL ON TABLE public\."StripeWebhookEvent"/,
    );
    assert.match(
      provision,
      /ClerkWebhookEvent RLS is partially or unexpectedly configured; refusing runtime-role provisioning/,
    );
    assert.match(
      provision,
      /\\if :clerk_webhook_event_rls_active[\s\S]*REVOKE ALL ON TABLE public\."ClerkWebhookEvent"/,
    );
    assert.match(
      provision,
      /AccountDeletionSideEffect RLS is partially or unexpectedly configured; refusing runtime-role provisioning/,
    );
    assert.match(
      provision,
      /\\if :account_deletion_side_effect_rls_active[\s\S]*REVOKE ALL ON TABLE public\."AccountDeletionSideEffect"/,
    );
    assert.match(
      provision,
      /grainline_account_deletion_worker_role_guard[\s\S]*grainline_account_deletion_runtime role posture drifted/,
    );
    assert.match(
      provision,
      /REVOKE ALL ON TABLE public\."AccountDeletionSideEffect"[\s\S]*FROM PUBLIC, grainline_account_deletion_runtime;[\s\S]*GRANT SELECT, INSERT, UPDATE, DELETE[\s\S]*TO grainline_account_deletion_runtime/,
    );
    assert.match(
      provision,
      /grainline_account_deletion_worker_postflight[\s\S]*grainline_account_deletion_runtime has unrelated object authority[\s\S]*grainline_account_deletion_runtime function authority drifted/,
    );
    assert.match(
      provision,
      /CheckoutStockReservation RLS is partially or unexpectedly configured; refusing runtime-role provisioning/,
    );
    assert.match(
      provision,
      /\\if :checkout_stock_reservation_rls_active[\s\S]*REVOKE ALL ON TABLE public\."CheckoutStockReservation"/,
    );
    assert.match(
      provision,
      /\\if :checkout_stock_reservation_rls_active[\s\S]*REVOKE EXECUTE ON FUNCTION[\s\S]*grainline_checkout_reservation_create_cart[\s\S]*grainline_checkout_reservation_create_single/,
    );
    assert.match(
      provision,
      /Core Order RLS is partially or unexpectedly configured; refusing runtime-role provisioning/,
    );
    assert.match(
      provision,
      /\\if :core_order_rls_active\s+REVOKE ALL ON TABLE public\."Order"\s+FROM PUBLIC, :"runtime_role";\s+\\endif/,
    );
    assert.match(
      provision,
      /UserEmailAddress RLS is partially or unexpectedly configured; refusing runtime-role provisioning/,
    );
    assert.match(
      provision,
      /\\if :user_email_address_rls_active\s+REVOKE ALL ON TABLE public\."UserEmailAddress"\s+FROM PUBLIC, :"runtime_role";\s+\\endif/,
    );
    assert.match(
      provision,
      /User RLS is partially or unexpectedly configured; refusing runtime-role provisioning/,
    );
    assert.match(
      provision,
      /\\if :user_rls_active\s+REVOKE ALL ON TABLE public\."User"\s+FROM PUBLIC, :"runtime_role";\s+\\endif/,
    );
    for (const functionName of [
      "grainline_user_email_address_delete_for_current_user",
      "grainline_user_email_address_newer_current_claim",
      "grainline_user_email_address_owner_rows",
      "grainline_user_email_address_sync",
    ]) {
      assert.match(provision, new RegExp(`public\\."${functionName}"\\(`));
    }
    assert.match(
      provision,
      /OrderPaymentEvent RLS is partially or unexpectedly configured; refusing runtime-role provisioning/,
    );
    assert.match(
      provision,
      /\\if :order_payment_event_rls_active[\s\S]*REVOKE ALL ON TABLE public\."OrderPaymentEvent"[\s\S]*grainline_blocked_checkout_refund_claim[\s\S]*grainline_case_seller_refund_apply/,
    );
    assert.match(
      provision,
      /grainline_direct_upload_record_private_message[\s\S]*grainline_direct_upload_cleanup_lease[\s\S]*FROM :"runtime_role"/,
    );
    assert.match(provision, /aclexplode/);
    assert.match(provision, /REVOKE %s ON TABLE %I\.%I FROM %I/);
    assert.match(provision, /REVOKE GRANT OPTION FOR %s ON TABLE %I\.%I FROM %I/);
    assert.match(provision, /ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE %s ON TABLES FROM %I/);
    assert.match(provision, /ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE GRANT OPTION FOR %s ON TABLES FROM %I/);
    assert.match(provision, /_prisma_migrations/);
    assert.match(provision, /ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA public\s+GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"runtime_role"/);
    assert.match(provision, /ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA public\s+GRANT USAGE, SELECT ON SEQUENCES TO :"runtime_role"/);
    assert.match(provision, /required extension pg_trgm is not installed/);
    assert.match(provision, /lacks EXECUTE on pg_trgm function/);
    assert.match(provision, /has_function_privilege\(:'runtime_role', p\.oid, 'EXECUTE'\)/);
    assert.match(provision, /EXECUTE WITH GRANT OPTION/);
    assert.match(provision, /e\.extname = 'pg_trgm'/);
    assert.match(provision, /pg_get_function_identity_arguments\(p\.oid\)/);
    assert.match(provision, /Public search\/autocomplete SQL uses pg_trgm/);
    assert.match(provision, /PUBLIC defaults remain intact/);
    assert.match(provision, /public\."grainline_notification_preferences_valid"\(jsonb\)/);
    assert.match(provision, /public\."grainline_saved_search_list"\(text, integer, text\)/);
    assert.match(provision, /public\."grainline_saved_search_delete_one"\(text, text\)/);
    assert.match(
      provision,
      /COUNT\(DISTINCT relforcerowsecurity\) = 1[\s\S]*relrowsecurity[\s\S]*policy_count = 1[\s\S]*expected_policy_count = 1/,
    );
    for (const functionName of RUNTIME_PRIVATE_FUNCTIONS.filter(
      (name) => name !== "grainline_notification_create_core",
    )) {
      assert.match(
        provision,
        new RegExp(`public\\."${functionName}"\\(`),
      );
    }
    for (const functionName of CONVERSATION_MESSAGE_PRIVATE_FUNCTION_NAMES) {
      assert.doesNotMatch(
        provision,
        new RegExp(
          `GRANT EXECUTE ON FUNCTION public\\."${functionName}"\\(`,
        ),
      );
    }
    const conversationMessagePublicCatalog = provision.match(
      /WITH conversation_message_public_authority\(function_signature\) AS \(\s+VALUES([\s\S]*?)\n\)\nSELECT format/,
    );
    assert.ok(conversationMessagePublicCatalog);
    assert.equal(
      (
        conversationMessagePublicCatalog[1].match(
          /\('public\."grainline_[^"]+"\(/g,
        ) ?? []
      ).length,
      19,
    );
    const savedSearchGrantIndex = provision.indexOf('public."SavedSearch",');
    const savedSearchUpdateRevokeIndex = provision.indexOf(
      'REVOKE UPDATE ON TABLE public."SavedSearch" FROM :"runtime_role"',
    );
    assert.ok(savedSearchGrantIndex > 0);
    assert.ok(savedSearchUpdateRevokeIndex > savedSearchGrantIndex);
    if (savedBlogPostProvisioningPresent) {
      const savedBlogPostGrantIndex = provision.indexOf('public."SavedBlogPost",');
      const savedBlogPostUpdateRevokeIndex = provision.indexOf(
        'REVOKE UPDATE ON TABLE public."SavedBlogPost" FROM :"runtime_role"',
      );
      assert.ok(savedBlogPostGrantIndex > 0);
      assert.ok(savedBlogPostUpdateRevokeIndex > savedBlogPostGrantIndex);
      assert.match(
        provision,
        /SavedBlogPost RLS is partially or unexpectedly configured; refusing runtime-role provisioning/,
      );
    }
    const beginIndex = provision.indexOf("BEGIN;");
    const notificationGrantIndex = provision.indexOf('public."Notification",');
    const notificationNarrowIndex = provision.indexOf(
      "REVOKE INSERT, UPDATE, DELETE ON TABLE public.\"Notification\"",
    );
    const commitIndex = provision.lastIndexOf("COMMIT;");
    assert.ok(beginIndex > 0);
    assert.ok(notificationGrantIndex > beginIndex);
    assert.ok(notificationNarrowIndex > notificationGrantIndex);
    assert.ok(commitIndex > notificationNarrowIndex);
    assert.match(provision, /Notification RLS is partially or unexpectedly configured/);
    assert.match(provision, /GRANT UPDATE \(read\) ON TABLE public\."Notification"/);
    const conversationGrantIndex = provision.indexOf('public."Conversation",');
    const messageGrantIndex = provision.indexOf('public."Message",');
    const conversationMessageNarrowIndex = provision.indexOf(
      "REVOKE INSERT, UPDATE, DELETE ON TABLE\n  public.\"Conversation\",\n  public.\"Message\"",
    );
    assert.ok(conversationGrantIndex > beginIndex);
    assert.ok(messageGrantIndex > beginIndex);
    assert.ok(conversationMessageNarrowIndex > conversationGrantIndex);
    assert.ok(conversationMessageNarrowIndex > messageGrantIndex);
    assert.ok(commitIndex > conversationMessageNarrowIndex);
    assert.match(
      provision,
      /Conversation\/Message RLS is partially or unexpectedly configured/,
    );
    assert.equal(
      (provision.match(/^REVOKE ALL ON FUNCTION public\.grainline_notification_(?!preferences_valid)/gm) ?? []).length,
      25,
    );
    assert.equal(
      (provision.match(/^GRANT EXECUTE ON FUNCTION public\.grainline_notification_(?!preferences_valid)/gm) ?? []).length,
      24,
    );
    assert.doesNotMatch(
      provision,
      /GRANT EXECUTE ON FUNCTION public\.grainline_notification_create_core/,
    );
    assert.match(provision, /REVOKE ALL ON FUNCTION %s FROM PUBLIC/);
    assert.match(provision, /REVOKE ALL ON FUNCTION %s FROM %I/);
    assert.match(provision, /GRANT EXECUTE ON FUNCTION %s TO %I/);
    assert.match(provision, /to_regprocedure\(function_signature\) IS NOT NULL/);
    assert.doesNotMatch(provision, /PASSWORD\s+'(?!\[REDACTED\])/i);
    assert.doesNotMatch(provision, /GRANT\s+[^;]*ON\s+ALL\s+TABLES\s+IN\s+SCHEMA\s+public\s+TO/i);
    assert.doesNotMatch(provision, /GRANT\s+[^;]*ON\s+ALL\s+SEQUENCES\s+IN\s+SCHEMA\s+public\s+TO/i);

    const runtimePrivateTablesForProvision = new Set(RUNTIME_PRIVATE_TABLES);
    if (!sellerProfilePublicProvisioningPresent) {
      runtimePrivateTablesForProvision.add("SellerExactMapConsentEvent");
    }
    assert.deepEqual(
      provisionedObjects(provision, "TABLE"),
      inventory.tables.filter(
        (tableName) => !runtimePrivateTablesForProvision.has(tableName),
      ),
    );
    assert.deepEqual(
      provisionedObjects(provision, "TYPE"),
      inventory.enums.filter(
        (typeName) => ![
          "CaseResolutionClaimStatus",
          "OrderDisputeRecoveryStatus",
        ].includes(typeName),
      ),
    );
    assert.match(
      provision,
      /to_regtype\('public\."CaseResolutionClaimStatus"'\) IS NOT NULL[\s\S]*\\gexec/,
    );
    assert.match(
      provision,
      /GRANT USAGE ON TYPE public\."CaseResolutionClaimStatus" TO %I/,
    );
    assert.match(
      provision,
      /to_regtype\('public\."OrderDisputeRecoveryStatus"'\) IS NOT NULL[\s\S]*\\gexec/,
    );
    assert.match(
      provision,
      /GRANT USAGE ON TYPE public\."OrderDisputeRecoveryStatus" TO %I/,
    );
    const provisionedFunctionNames = (sellerProfilePublicProvisioningPresent
      ? inventory.functions
      : inventory.functions.filter(
          (functionName) => ![
            ...SELLER_PROFILE_PUBLIC_CANDIDATE_FUNCTION_NAMES,
            ...SELLER_PROFILE_PUBLIC_VISIBILITY_MIRROR_PRIVATE_FUNCTION_NAMES,
          ].includes(functionName),
        )).filter(
          (functionName) => savedBlogPostProvisioningPresent
            || functionName !== "grainline_saved_blog_post_insert_guard",
        ).filter(
          (functionName) => cartCartItemProvisioningPresent
            || !CART_CART_ITEM_RUNTIME_FUNCTION_NAMES.includes(functionName),
        );
    for (const fn of provisionedFunctionNames) {
      const quoted = `public\\."${escapeRegExp(fn)}"`;
      const unquoted = `public\\.${escapeRegExp(fn)}`;
      assert.match(provision, new RegExp(`(?:${quoted}|${unquoted})`));
    }
    for (const extension of inventory.extensions) {
      assert.match(provision, new RegExp(`e\\.extname = '${escapeRegExp(extension)}'`));
    }

    assert.match(plan, /scripts\/provision-runtime-db-role\.sql/);
    assert.match(runbook, /scripts\/provision-runtime-db-role\.sql/);
    assert.match(launch, /scripts\/provision-runtime-db-role\.sql/);
  });
});
