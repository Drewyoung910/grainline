import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SELLER_PROFILE_CONVERTED_AUTHORITY_FUNCTIONS } from "./seller-profile-public-catalog-disposition.mjs";

const db = (file) => Object.freeze({ kind: "DIRECT_DATABASE_BEHAVIOR", files: Object.freeze([file]) });
const composed = (...files) => Object.freeze({ kind: "COMPOSED_DATABASE_BEHAVIOR", files: Object.freeze(files) });
const sourceOnly = (file) => Object.freeze({ kind: "SOURCE_ONLY_GAP", files: Object.freeze([file]) });

// Exact Phase 0 evidence map for the 98 installed SellerProfile-reading
// authorities executable by either the shared app runtime or staff-read role.
// Source/catalog assertions are deliberately labelled as gaps rather than
// being counted as behavioral proof.
export const SELLER_PROFILE_RETAINED_AUTHORITY_EVIDENCE = Object.freeze({
  'grainline_case_guild_unresolved_guard(text)': db('scripts/case-seller-aggregate-authority-postgres-proof.mjs'),
  'grainline_case_open(text,text,text,text)': db('scripts/case-open-authority-postgres-proof.mjs'),
  'grainline_case_order_active_for_seller(text,text)': db('scripts/case-order-active-authority-postgres-proof.mjs'),
  'grainline_case_seller_active_count(text)': db('scripts/case-seller-aggregate-authority-postgres-proof.mjs'),
  'grainline_case_seller_verification_eligibility(text,text)': db('scripts/case-seller-aggregate-authority-postgres-proof.mjs'),
  'grainline_case_staff_resolution_prepare(text,text,"CaseResolution",integer,jsonb)': db('tests/case-case-message-invariant-postgres-proof.test.mjs'),
  'grainline_case_stripe_dispute_apply(text)': db('scripts/case-case-message-invariant-postgres-proof.mjs'),
  'grainline_checkout_reservation_account_claim_batch(text,integer)': sourceOnly('tests/checkout-stock-reservation-rls-audit.test.mjs'),
  'grainline_checkout_reservation_account_scrub(text)': db('tests/checkout-stock-reservation-authority-postgres-proof.test.mjs'),
  'grainline_checkout_reservation_complete(text,bigint,text,text)': db('tests/checkout-stock-reservation-authority-postgres-proof.test.mjs'),
  'grainline_checkout_reservation_create_cart_snapshot(text,text,text,text,text,jsonb)': db('tests/checkout-stock-reservation-authority-postgres-proof.test.mjs'),
  'grainline_checkout_reservation_create_single_snapshot(text,text,integer,text[],text,jsonb)': db('tests/checkout-stock-reservation-authority-postgres-proof.test.mjs'),
  'grainline_checkout_reservation_export(text)': db('tests/checkout-stock-reservation-authority-postgres-proof.test.mjs'),
  'grainline_direct_upload_sync_listing(text,text)': db('scripts/direct-upload-activation-postgres-proof.mjs'),
  'grainline_direct_upload_sync_seller_broadcast(text,text)': db('scripts/direct-upload-authority-postgres-proof.mjs'),
  'grainline_direct_upload_sync_seller_profile(text,text)': composed(
    'tests/direct-upload-legacy-repair-postgres-proof.test.mjs',
    'scripts/direct-upload-legacy-repair-postgres-proof.mjs',
    'prisma/migrations/20260726185700_repair_direct_upload_legacy_references/migration.sql',
  ),
  'grainline_listing_delete_reference_state(text,text)': sourceOnly('tests/listing-delete.test.mjs'),
  'grainline_listing_order_archive_blocked(text,text,bigint)': db('tests/order-eligibility-authority-postgres.test.mjs'),
  'grainline_message_create_commission_interest(text,text,text,text,text)': db('scripts/conversation-message-recipient-rls-proof.mjs'),
  'grainline_message_send_custom_order_ready(text,text,text)': db('scripts/conversation-message-recipient-rls-proof.mjs'),
  'grainline_message_send_custom_request(text,text,text,text,text,text,integer,text,text)': db('scripts/conversation-message-recipient-rls-proof.mjs'),
  'grainline_notification_claim_back_in_stock(text,text,text)': db('scripts/notification-rls-ephemeral-proof.mjs'),
  'grainline_order_account_deletion_blockers(text)': db('tests/order-account-deletion-authority-postgres.test.mjs'),
  'grainline_order_buyer_detail_v2(text,text)': composed(
    'tests/order-participant-detail-authority-postgres.test.mjs',
    'prisma/migrations/20260901105000_correct_order_participant_snapshot_projection/migration.sql',
  ),
  'grainline_order_buyer_receipt_confirm(text,text)': db('tests/order-fulfillment-authority-postgres.test.mjs'),
  'grainline_order_flag_banned_seller_open_orders(text,text)': db('tests/order-ban-review-authority-postgres.test.mjs'),
  'grainline_order_payment_seller_export_page(text,integer,bigint,text)': db('scripts/order-payment-event-force-postgres-proof.mjs'),
  'grainline_order_payment_seller_refund_outcomes(text,text[])': db('scripts/order-payment-event-force-postgres-proof.mjs'),
  'grainline_order_payment_signed_dispute_apply(text,bigint,text,text,bigint,integer,text,text,text)': db('tests/order-payment-event-signed-authority-postgres-proof.test.mjs'),
  'grainline_order_public_listing_counts(text[])': db('tests/order-public-aggregate-authority-postgres.test.mjs'),
  'grainline_order_public_marketplace_listing_metrics()': db('tests/order-public-aggregate-authority-postgres.test.mjs'),
  'grainline_order_public_seller_stats(text,bigint)': db('tests/order-public-aggregate-authority-postgres.test.mjs'),
  'grainline_order_report_target_access(text,text,text)': db('tests/order-eligibility-authority-postgres.test.mjs'),
  'grainline_order_restore_banned_seller_reviews(text,text,jsonb)': db('tests/order-ban-review-authority-postgres.test.mjs'),
  'grainline_order_seller_analytics_buckets(text,bigint,bigint,boolean,text)': db('tests/order-seller-analytics-authority-postgres.test.mjs'),
  'grainline_order_seller_analytics_summary(text,bigint,bigint,boolean)': db('tests/order-seller-analytics-authority-postgres.test.mjs'),
  'grainline_order_seller_analytics_top_listings(text,bigint,bigint,boolean,boolean)': db('tests/order-seller-analytics-authority-postgres.test.mjs'),
  'grainline_order_seller_completed_count(text)': db('tests/order-seller-analytics-authority-postgres.test.mjs'),
  'grainline_order_seller_count(text)': db('tests/order-participant-list-authority-postgres.test.mjs'),
  'grainline_order_seller_export_page(text,integer,bigint,text)': db('tests/order-participant-export-authority-postgres.test.mjs'),
  'grainline_order_seller_fulfillment_transition(text,text,text,text,text)': db('tests/order-fulfillment-authority-postgres.test.mjs'),
  'grainline_order_seller_label_claim(text,text,text)': db('tests/order-label-authority-postgres.test.mjs'),
  'grainline_order_seller_label_download(text,text)': db('tests/order-label-authority-postgres.test.mjs'),
  'grainline_order_seller_label_preflight(text,text)': db('tests/order-label-authority-postgres.test.mjs'),
  'grainline_order_seller_label_provider_record(text,text,text,bigint,text,text,text,text,integer,text,text,text,text)': db('scripts/order-input-correction-runtime-postgres-proof.mjs'),
  'grainline_order_seller_label_quote_replace(text,text,text,jsonb)': db('tests/order-label-authority-postgres.test.mjs'),
  'grainline_order_seller_metrics_facts(text,bigint)': db('tests/order-seller-metrics-authority-postgres.test.mjs'),
  'grainline_order_seller_notes_update(text,text,text)': db('tests/order-fulfillment-authority-postgres.test.mjs'),
  'grainline_order_seller_page(text,integer,bigint,text)': db('tests/order-participant-list-authority-postgres.test.mjs'),
  'grainline_order_seller_summary_after_page(text,integer,bigint,text)': db('tests/order-participant-summary-authority-postgres.test.mjs'),
  'grainline_order_seller_summary_page(text,integer,bigint,text)': db('tests/order-participant-summary-authority-postgres.test.mjs'),
  'grainline_order_seller_verification_sales(text,text)': db('tests/order-eligibility-authority-postgres.test.mjs'),
  'grainline_order_staff_detail_v2(text,text)': db('tests/order-staff-read-authority-postgres.test.mjs'),
  'grainline_seller_account_deletion_anonymize(text,text,boolean,text,text,text,text,bigint,uuid)': db('tests/seller-profile-private-account-deletion-app-authority-postgres.test.mjs'),
  'grainline_seller_account_deletion_pause(text,text,text,bigint,uuid)': db('tests/seller-profile-private-account-deletion-app-authority-postgres.test.mjs'),
  'grainline_seller_account_deletion_reconciliation_clear(text,text,text,bigint,uuid)': db('tests/seller-profile-private-remaining-app-authorities-postgres.test.mjs'),
  'grainline_seller_checkout_private_state(text,text,text,text)': db('tests/seller-profile-private-checkout-app-authority-postgres.test.mjs'),
  'grainline_seller_guild_listing_threshold_sync(text)': sourceOnly('tests/guild-listing-edit-followups.test.mjs'),
  'grainline_seller_guild_member_cron_batch(text,integer)': db('tests/seller-profile-private-guild-cron-batch-authorities-postgres.test.mjs'),
  'grainline_seller_guild_member_revoke(text)': db('tests/seller-profile-private-guild-member-revocation-authority-postgres.test.mjs'),
  'grainline_seller_guild_metrics_apply(text,timestamp without time zone)': db('tests/seller-profile-private-guild-metrics-authority-postgres.test.mjs'),
  'grainline_seller_guild_metrics_cron_batch(text,integer)': db('tests/seller-profile-private-guild-cron-batch-authorities-postgres.test.mjs'),
  'grainline_seller_guild_staff_master_pending(text)': db('tests/seller-profile-private-guild-staff-read-authorities-postgres.test.mjs'),
  'grainline_seller_guild_staff_roster(text,text)': db('tests/seller-profile-private-guild-staff-read-authorities-postgres.test.mjs'),
  'grainline_seller_guild_staff_transition(text,text,text,text,text,boolean)': db('tests/seller-profile-private-guild-staff-transition-authority-postgres.test.mjs'),
  'grainline_seller_message_response_metrics(text,timestamp without time zone)': db('scripts/conversation-message-recipient-rls-proof.mjs'),
  'grainline_seller_owner_guild_master_application_record(text,text,timestamp without time zone)': db('tests/seller-profile-private-remaining-app-authorities-postgres.test.mjs'),
  'grainline_seller_owner_onboarding_complete(text,text)': db('tests/seller-profile-private-owner-app-authority-postgres.test.mjs'),
  'grainline_seller_owner_onboarding_step_update(text,text,integer,integer)': db('tests/seller-profile-private-owner-app-authority-postgres.test.mjs'),
  'grainline_seller_owner_private_state(text)': db('tests/seller-profile-private-owner-app-authority-postgres.test.mjs'),
  'grainline_seller_owner_shop_settings_update(text,text,text,text,double precision,double precision,double precision,boolean,integer,integer,boolean,boolean,text[],text,text,text,text,text,text,text,text,double precision,double precision,double precision,integer)': db('tests/seller-profile-private-owner-app-authority-postgres.test.mjs'),
  'grainline_seller_payout_event_apply(text,bigint,bigint,text,text,integer,text,text,text)': db('tests/seller-payout-event-authority-postgres-proof.test.mjs'),
  'grainline_seller_payout_export_page(text,integer,bigint,text)': db('tests/seller-payout-event-authority-postgres-proof.test.mjs'),
  'grainline_seller_payout_latest_failure(text)': db('tests/seller-payout-event-authority-postgres-proof.test.mjs'),
  'grainline_seller_profile_view_record(text,date)': db('tests/seller-profile-private-remaining-app-authorities-postgres.test.mjs'),
  'grainline_seller_refund_claim(text,text)': db('scripts/order-payment-event-force-postgres-proof.mjs'),
  'grainline_seller_refund_preflight(text,text)': db('tests/order-seller-refund-preflight-authority-postgres.test.mjs'),
  'grainline_seller_refund_record(text,text,bigint,text,text,text,integer)': db('scripts/order-refund-inactive-seller-recovery-postgres-proof.mjs'),
  'grainline_seller_shipping_quote_state(text,text,text,text)': db('tests/seller-profile-private-shipping-app-authority-postgres.test.mjs'),
  'grainline_seller_staff_orderability_state(text,text)': db('tests/seller-profile-private-remaining-app-authorities-postgres.test.mjs'),
  'grainline_seller_stripe_account_bind(text,text,text,text,text)': db('tests/seller-profile-private-stripe-app-authorities-postgres.test.mjs'),
  'grainline_seller_stripe_charges_update(text,text,boolean)': db('tests/seller-profile-private-stripe-app-authorities-postgres.test.mjs'),
  'grainline_seller_stripe_mirror_state(text)': db('tests/seller-profile-private-stripe-app-authorities-postgres.test.mjs'),
  'grainline_seller_stripe_owner_state(text)': db('tests/seller-profile-private-stripe-app-authorities-postgres.test.mjs'),
  'grainline_seller_stripe_reconciliation_page(text,integer)': db('tests/seller-profile-private-stripe-app-authorities-postgres.test.mjs'),
  'grainline_stripe_checkout_order_create(text,bigint,text,text,timestamp without time zone,jsonb)': db('scripts/order-paid-repair-lock-postgres-proof.mjs'),
  'grainline_stripe_checkout_order_existing(text,bigint,text)': db('tests/order-checkout-existing-authority-postgres.test.mjs'),
  'grainline_stripe_checkout_postpayment(text,bigint,text)': db('tests/order-checkout-postpayment-authority-postgres.test.mjs'),
  'grainline_stripe_seller_deauthorization_apply(text,bigint,text,timestamp without time zone)': db('tests/order-seller-deauthorization-authority.test.mjs'),
  'grainline_user_ban_repair_target(text,text)': db('tests/user-staff-ban-authorities.test.mjs'),
  'grainline_user_blocked_account_page()': db('tests/user-block-email-authorities-postgres.test.mjs'),
  'grainline_user_block_targets()': db('tests/user-block-email-authorities-postgres.test.mjs'),
  'grainline_user_clerk_commission_context(text)': db('tests/user-current-clerk-authorities-postgres.test.mjs'),
  'grainline_user_custom_order_seller_state(text,text)': db('tests/user-relationship-authorities.test.mjs'),
  'grainline_user_follower_notification_page(text,text,integer)': db('tests/user-follower-authorities-postgres.test.mjs'),
  'grainline_user_owner_broadcast_follower_page(text,text,integer,boolean)': db('tests/user-follower-authorities-postgres.test.mjs'),
  'grainline_user_public_listing_favorite_counts(text[])': db('tests/user-follower-authorities-postgres.test.mjs'),
  'grainline_user_staff_directory_page(text,text,integer)': db('tests/user-staff-ban-authorities.test.mjs'),
});

const DATABASE_MARKER = /PGlite|pg\.Client|client\.query\(|database\.query\(|db\.query\(|await client\.query\(migration\.sql\)/u;

function functionName(signature) {
  return signature.slice(0, signature.indexOf('('));
}

export function verifySellerProfileRetainedAuthorityEvidence(root, catalog) {
  const installed = catalog.functions
    .filter((row) => (
      row.runtime_execute || row.execute_grantees.includes('grainline_staff_read_runtime')
    ) && !SELLER_PROFILE_CONVERTED_AUTHORITY_FUNCTIONS.has(row.signature))
    .map((row) => row.signature)
    .sort();
  const mapped = Object.keys(SELLER_PROFILE_RETAINED_AUTHORITY_EVIDENCE).sort();
  const missing = installed.filter((signature) => !mapped.includes(signature));
  const stale = mapped.filter((signature) => !installed.includes(signature));
  if (missing.length || stale.length) {
    throw new Error(
      `SellerProfile retained-authority evidence drifted: missing=${missing.join(',') || 'none'}; `
      + `stale=${stale.join(',') || 'none'}`,
    );
  }

  const counts = {
    DIRECT_DATABASE_BEHAVIOR: 0,
    COMPOSED_DATABASE_BEHAVIOR: 0,
    SOURCE_ONLY_GAP: 0,
  };
  const gaps = [];
  for (const [signature, evidence] of Object.entries(SELLER_PROFILE_RETAINED_AUTHORITY_EVIDENCE)) {
    const sources = evidence.files.map((file) => {
      const absolute = path.join(root, file);
      if (!fs.existsSync(absolute)) throw new Error(`${signature} evidence file is missing: ${file}`);
      return fs.readFileSync(absolute, 'utf8');
    });
    if (!sources.some((source) => source.includes(functionName(signature)))) {
      throw new Error(`${signature} evidence no longer names the reviewed authority`);
    }
    if (evidence.kind !== 'SOURCE_ONLY_GAP' && !sources.some((source) => DATABASE_MARKER.test(source))) {
      throw new Error(`${signature} evidence no longer executes database behavior`);
    }
    counts[evidence.kind] += 1;
    if (evidence.kind === 'SOURCE_ONLY_GAP') gaps.push(signature);
  }

  return {
    retainedAuthorities: installed.length,
    evidenceCounts: counts,
    gaps: gaps.sort(),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const catalogPath = process.env.SELLER_PROFILE_PUBLIC_CATALOG_REPORT;
  if (!catalogPath) throw new Error('SELLER_PROFILE_PUBLIC_CATALOG_REPORT is required');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  process.stdout.write(`${JSON.stringify(verifySellerProfileRetainedAuthorityEvidence(root, catalog), null, 2)}\n`);
}
