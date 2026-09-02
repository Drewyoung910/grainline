import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  ORDER_RECEIPT_NOTIFICATION_AUTHORITY_MIGRATION,
  verifyOrderReceiptNotificationAuthorityMigrationBytes,
} from "./order-receipt-notification-authority-catalog.mjs";
import {
  ORDER_FULFILLMENT_AUTHORITY_MIGRATION,
  verifyOrderFulfillmentAuthorityMigrationBytes,
} from "./order-fulfillment-authority-catalog.mjs";
import {
  ORDER_LABEL_AUTHORITY_MIGRATION,
  verifyOrderLabelAuthorityMigrationBytes,
} from "./order-label-authority-catalog.mjs";
import {
  ORDER_CHARGED_TOTAL_COMPATIBILITY_MIGRATION,
  verifyOrderChargedTotalCompatibilityMigrationBytes,
} from "./order-charged-total-compatibility-catalog.mjs";
import {
  ORDER_PARTICIPANT_LIST_PROJECTION_CORRECTION_MIGRATION,
  verifyOrderParticipantListProjectionCorrectionBytes,
} from "./order-participant-list-projection-correction-catalog.mjs";

export const ORDER_PARTICIPANT_LIST_AUTHORITY_MIGRATION =
  "20260831233000_prepare_order_participant_list_authority";
export const ORDER_PARTICIPANT_LIST_AUTHORITY_MIGRATION_SHA256 =
  "20912226c1c096509f8aaca10f4dd117fd08e2e9455c05b65570ec8d55cb37ce";
export const ORDER_PARTICIPANT_LIST_AUTHORITY_MIGRATION_TREE_SHA256 =
  "79f9757418fdb4bcee828213d356ed027eb0b6ad777dea5d420d33e75f4ac82e";
export const ORDER_PARTICIPANT_DETAIL_AUTHORITY_MIGRATION =
  "20260901010000_prepare_order_participant_detail_authority";
export const ORDER_PARTICIPANT_DETAIL_AUTHORITY_MIGRATION_SHA256 =
  "7f971c993418c4900b9e37972b24a8e5e6ef8e4a846b73b8b739e4364d96d054";
export const ORDER_PARTICIPANT_DETAIL_AUTHORITY_MIGRATION_TREE_SHA256 =
  "800d7e486e2108e021988b79d534ac7ef40914edabe590844f048216881ffea4";
export const ORDER_STAFF_READ_AUTHORITY_MIGRATION =
  "20260901020000_prepare_order_staff_read_authority";
export const ORDER_STAFF_READ_AUTHORITY_MIGRATION_SHA256 =
  "fe0f35a081f58a62eaf1d655a1cb5749b7f042b00cc9206cd61abf957b4e2912";
export const ORDER_STAFF_READ_AUTHORITY_MIGRATION_TREE_SHA256 =
  "2e39518ebf1c7874472bf0751d9978fc9ccb7c4e70b1e468ef01917dd3cdadc2";
export const ORDER_PARTICIPANT_EXPORT_AUTHORITY_MIGRATION =
  "20260901030000_prepare_order_participant_export_authority";
export const ORDER_PARTICIPANT_EXPORT_AUTHORITY_MIGRATION_SHA256 =
  "0afda9317f3b81c7869aa4d0ca7bb4c261d0017c533d808b1411b310c30c6619";
export const ORDER_PARTICIPANT_EXPORT_AUTHORITY_MIGRATION_TREE_SHA256 =
  "c697eff5672fa8a1302e8767417fc44aa3f4608db5578b4bb287032ea635bd3a";
export const ORDER_ELIGIBILITY_AUTHORITY_MIGRATION =
  "20260901040000_prepare_order_eligibility_authority";
export const ORDER_ELIGIBILITY_AUTHORITY_MIGRATION_SHA256 =
  "fad09e052f6d6c840bc928bdc46c8a9f39169b4cf3b0ed4f2e66e8c0616374f2";
export const ORDER_ELIGIBILITY_AUTHORITY_MIGRATION_TREE_SHA256 =
  "c0122c1a9438646ba7302960cc324c3422ef23372d90a6e323dc3820ac2415c2";
export const ORDER_PUBLIC_AGGREGATE_AUTHORITY_MIGRATION =
  "20260901050000_prepare_order_public_aggregate_authority";
export const ORDER_PUBLIC_AGGREGATE_AUTHORITY_MIGRATION_SHA256 =
  "148bd7fc2a407ce3bd422fe0c245918225e7a5e48668cebf181773a3270917c1";
export const ORDER_PUBLIC_AGGREGATE_AUTHORITY_MIGRATION_TREE_SHA256 =
  "f2d1d2961e8bc42dda5c7bb8c765e82c0f782be7759c12e3fa00bdcd1ca04f19";
export const ORDER_SELLER_ANALYTICS_AUTHORITY_MIGRATION =
  "20260901060000_prepare_order_seller_analytics_authority";
export const ORDER_SELLER_ANALYTICS_AUTHORITY_MIGRATION_SHA256 =
  "647b84643f0dbc58fe447a123f17d92dd91920e5d1b28fe0b43c6ba8e9adbcbf";
export const ORDER_SELLER_ANALYTICS_AUTHORITY_MIGRATION_TREE_SHA256 =
  "69bb1ff415709b6e1412d00beb8cf5e5abcc2aed81ffc662ce096996d4b3c7da";
export const ORDER_SELLER_METRICS_AUTHORITY_MIGRATION =
  "20260901070000_prepare_order_seller_metrics_authority";
export const ORDER_SELLER_METRICS_AUTHORITY_MIGRATION_SHA256 =
  "bc555f857d7fc253bd84cb01913cda5001e42d3328b4042e4945e35745b8c336";
export const ORDER_SELLER_METRICS_AUTHORITY_MIGRATION_TREE_SHA256 =
  "ab1b2c2f91dc62aa41007b145ba7a3c9acce9505b837004a1900c12d79f11171";
export const ORDER_PARTICIPANT_SUMMARY_AUTHORITY_MIGRATION =
  "20260901080000_prepare_order_participant_summary_authority";
export const ORDER_PARTICIPANT_SUMMARY_AUTHORITY_MIGRATION_SHA256 =
  "bc400e434c07e65bdba178641ca8ff00d0ba00b7ac6a7f8b90d71b9e8164b18b";
export const ORDER_PARTICIPANT_SUMMARY_AUTHORITY_MIGRATION_TREE_SHA256 =
  "800a12cd2545e93327d280e58a03f805abb6a76435363aede3c0170bd6848c9b";
export const ORDER_PARTICIPANT_CURSOR_AUTHORITY_MIGRATION =
  "20260901090000_prepare_order_participant_cursor_authority";
export const ORDER_PARTICIPANT_CURSOR_AUTHORITY_MIGRATION_SHA256 =
  "374b6f43af74b45e8abaecea9610cd9083f9c94cadab1118f94607a4cfc31af4";
export const ORDER_PARTICIPANT_CURSOR_AUTHORITY_MIGRATION_TREE_SHA256 =
  "4cd6bff3ea76a287465ccd083b40b4ef17f047fdd31241929dcdc151c0fe9bee";
export const ORDER_PARTICIPANT_DETAIL_PROJECTION_MIGRATION =
  "20260901100000_prepare_order_participant_detail_projection";
export const ORDER_PARTICIPANT_DETAIL_PROJECTION_MIGRATION_SHA256 =
  "5b229132f959e444c3a2ec0d6f5f7f35935cd1b6b70f7c493355c3892246bc72";
export const ORDER_PARTICIPANT_DETAIL_PROJECTION_MIGRATION_TREE_SHA256 =
  "1ccc6693ae4c752b4c33a31c01f57fb522c9536c72cdcd83a255c43734a0212f";
export const ORDER_PARTICIPANT_SNAPSHOT_CORRECTION_MIGRATION =
  "20260901105000_correct_order_participant_snapshot_projection";
export const ORDER_PARTICIPANT_SNAPSHOT_CORRECTION_MIGRATION_SHA256 =
  "831bf30b23d6b96a21bccbf3b51de9959f58719258351185e8e17412516159ac";
export const ORDER_PARTICIPANT_SNAPSHOT_CORRECTION_MIGRATION_TREE_SHA256 =
  "b5a8485a00215ff829f59e017c8fbd8e8484b2c13951e923537d1815f03426b1";
export const ORDER_CHECKOUT_RECEIPT_AUTHORITY_MIGRATION =
  "20260901110000_prepare_order_checkout_receipt_authority";
export const ORDER_CHECKOUT_RECEIPT_AUTHORITY_MIGRATION_SHA256 =
  "0935e61efd8bc257c2c10e058b89d56cd136255ab42f5e98065a07260c96bbaf";
export const ORDER_CHECKOUT_RECEIPT_AUTHORITY_MIGRATION_TREE_SHA256 =
  "c01af7ffe6dddf4bbcb3a3149e0ab0e9b60c0543f768fa901e35f048408e7417";

export const ORDER_PARTICIPANT_LIST_AUTHORITY_FUNCTIONS = Object.freeze([
  "grainline_order_buyer_count(text)",
  "grainline_order_buyer_page(text,integer,bigint,text)",
  "grainline_order_seller_count(text)",
  "grainline_order_seller_page(text,integer,bigint,text)",
]);
export const ORDER_PARTICIPANT_DETAIL_AUTHORITY_FUNCTIONS = Object.freeze([
  "grainline_order_buyer_detail(text,text)",
  "grainline_order_seller_detail(text,text)",
]);
export const ORDER_STAFF_READ_AUTHORITY_FUNCTIONS = Object.freeze([
  "grainline_order_staff_page(text,text,integer,integer)",
  "grainline_order_staff_detail(text,text)",
]);
export const ORDER_PARTICIPANT_EXPORT_AUTHORITY_FUNCTIONS = Object.freeze([
  "grainline_order_buyer_export_page(text,integer,bigint,text)",
  "grainline_order_seller_export_page(text,integer,bigint,text)",
]);
export const ORDER_ELIGIBILITY_AUTHORITY_FUNCTIONS = Object.freeze([
  "grainline_order_review_eligibility_lock(text,text,bigint)",
  "grainline_order_report_target_access(text,text,text)",
  "grainline_order_seller_verification_sales(text,text)",
  "grainline_listing_order_archive_blocked(text,text,bigint)",
]);
export const ORDER_PUBLIC_AGGREGATE_AUTHORITY_FUNCTIONS = Object.freeze([
  "grainline_order_public_fulfilled_count()",
  "grainline_order_public_seller_stats(text,bigint)",
  "grainline_order_public_listing_counts(text[])",
  "grainline_order_public_marketplace_listing_metrics()",
]);
export const ORDER_SELLER_ANALYTICS_AUTHORITY_FUNCTIONS = Object.freeze([
  "grainline_order_seller_analytics_summary(text,bigint,bigint,boolean)",
  "grainline_order_seller_analytics_buckets(text,bigint,bigint,boolean,text)",
  "grainline_order_seller_analytics_top_listings(text,bigint,bigint,boolean,boolean)",
  "grainline_order_seller_recent_sales(text)",
  "grainline_order_seller_completed_count(text)",
]);
export const ORDER_SELLER_METRICS_AUTHORITY_FUNCTIONS = Object.freeze([
  "grainline_order_seller_metrics_facts(text,bigint)",
]);
export const ORDER_PARTICIPANT_SUMMARY_AUTHORITY_FUNCTIONS = Object.freeze([
  "grainline_order_summary_items(text)",
  "grainline_order_buyer_summary_page(text,integer,bigint,text)",
  "grainline_order_seller_summary_page(text,integer,bigint,text)",
]);
export const ORDER_PARTICIPANT_CURSOR_AUTHORITY_FUNCTIONS = Object.freeze([
  "grainline_order_buyer_summary_after_page(text,integer,bigint,text)",
  "grainline_order_seller_summary_after_page(text,integer,bigint,text)",
]);
export const ORDER_PARTICIPANT_DETAIL_PROJECTION_FUNCTIONS = Object.freeze([
  "grainline_order_buyer_detail_v2(text,text)",
  "grainline_order_seller_detail_v2(text,text)",
]);
export const ORDER_PARTICIPANT_SNAPSHOT_CORRECTION_FUNCTIONS = Object.freeze([
  "grainline_order_buyer_detail_v3(text,text)",
  "grainline_order_seller_detail_v3(text,text)",
]);
export const ORDER_CHECKOUT_RECEIPT_AUTHORITY_FUNCTIONS = Object.freeze([
  "grainline_order_buyer_receipts_by_sessions(text,text[])",
]);

// These functions are present in the compatible migration chain but are not
// ordinary-runtime RPCs in its final posture. The v1 detail functions are
// private predecessors of the v2/v3 projections, the staff readers require a
// separately provisioned staff-only login, and the summary helper is invoked
// only from the actor-bound page functions.
export const ORDER_PARTICIPANT_RUNTIME_PRIVATE_FUNCTION_NAMES = Object.freeze([
  "grainline_order_buyer_detail",
  "grainline_order_seller_detail",
  "grainline_order_staff_page",
  "grainline_order_staff_detail",
  "grainline_order_summary_items",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function verifyOrderParticipantListAuthorityMigrationBytes(
  root = process.cwd(),
) {
  const migrationPath = path.join(
    root,
    "prisma/migrations",
    ORDER_PARTICIPANT_LIST_AUTHORITY_MIGRATION,
    "migration.sql",
  );
  const migration = readFileSync(migrationPath, "utf8");
  const migrationSha256 = sha256(migration);
  assert.equal(
    migrationSha256,
    ORDER_PARTICIPANT_LIST_AUTHORITY_MIGRATION_SHA256,
    "Order participant list-authority migration bytes drifted",
  );
  return Object.freeze({ migration, migrationSha256 });
}

export function verifyOrderParticipantDetailAuthorityMigrationBytes(
  root = process.cwd(),
) {
  const migrationPath = path.join(
    root,
    "prisma/migrations",
    ORDER_PARTICIPANT_DETAIL_AUTHORITY_MIGRATION,
    "migration.sql",
  );
  const migration = readFileSync(migrationPath, "utf8");
  const migrationSha256 = sha256(migration);
  assert.equal(
    migrationSha256,
    ORDER_PARTICIPANT_DETAIL_AUTHORITY_MIGRATION_SHA256,
    "Order participant detail-authority migration bytes drifted",
  );
  return Object.freeze({ migration, migrationSha256 });
}

export function verifyOrderStaffReadAuthorityMigrationBytes(
  root = process.cwd(),
) {
  const migrationPath = path.join(
    root,
    "prisma/migrations",
    ORDER_STAFF_READ_AUTHORITY_MIGRATION,
    "migration.sql",
  );
  const migration = readFileSync(migrationPath, "utf8");
  const migrationSha256 = sha256(migration);
  assert.equal(
    migrationSha256,
    ORDER_STAFF_READ_AUTHORITY_MIGRATION_SHA256,
    "Order staff read-authority migration bytes drifted",
  );
  return Object.freeze({ migration, migrationSha256 });
}

export function verifyOrderParticipantExportAuthorityMigrationBytes(
  root = process.cwd(),
) {
  const migrationPath = path.join(
    root,
    "prisma/migrations",
    ORDER_PARTICIPANT_EXPORT_AUTHORITY_MIGRATION,
    "migration.sql",
  );
  const migration = readFileSync(migrationPath, "utf8");
  const migrationSha256 = sha256(migration);
  assert.equal(
    migrationSha256,
    ORDER_PARTICIPANT_EXPORT_AUTHORITY_MIGRATION_SHA256,
    "Order participant export-authority migration bytes drifted",
  );
  return Object.freeze({ migration, migrationSha256 });
}

export function verifyOrderEligibilityAuthorityMigrationBytes(
  root = process.cwd(),
) {
  const migrationPath = path.join(
    root,
    "prisma/migrations",
    ORDER_ELIGIBILITY_AUTHORITY_MIGRATION,
    "migration.sql",
  );
  const migration = readFileSync(migrationPath, "utf8");
  const migrationSha256 = sha256(migration);
  assert.equal(
    migrationSha256,
    ORDER_ELIGIBILITY_AUTHORITY_MIGRATION_SHA256,
    "Order eligibility-authority migration bytes drifted",
  );
  return Object.freeze({ migration, migrationSha256 });
}

export function verifyOrderPublicAggregateAuthorityMigrationBytes(
  root = process.cwd(),
) {
  const migrationPath = path.join(
    root,
    "prisma/migrations",
    ORDER_PUBLIC_AGGREGATE_AUTHORITY_MIGRATION,
    "migration.sql",
  );
  const migration = readFileSync(migrationPath, "utf8");
  const migrationSha256 = sha256(migration);
  assert.equal(
    migrationSha256,
    ORDER_PUBLIC_AGGREGATE_AUTHORITY_MIGRATION_SHA256,
    "Order public aggregate-authority migration bytes drifted",
  );
  return Object.freeze({ migration, migrationSha256 });
}

export function verifyOrderSellerAnalyticsAuthorityMigrationBytes(
  root = process.cwd(),
) {
  const migrationPath = path.join(
    root,
    "prisma/migrations",
    ORDER_SELLER_ANALYTICS_AUTHORITY_MIGRATION,
    "migration.sql",
  );
  const migration = readFileSync(migrationPath, "utf8");
  const migrationSha256 = sha256(migration);
  assert.equal(
    migrationSha256,
    ORDER_SELLER_ANALYTICS_AUTHORITY_MIGRATION_SHA256,
    "Order seller analytics-authority migration bytes drifted",
  );
  return Object.freeze({ migration, migrationSha256 });
}

export function verifyOrderSellerMetricsAuthorityMigrationBytes(
  root = process.cwd(),
) {
  const migrationPath = path.join(
    root,
    "prisma/migrations",
    ORDER_SELLER_METRICS_AUTHORITY_MIGRATION,
    "migration.sql",
  );
  const migration = readFileSync(migrationPath, "utf8");
  const migrationSha256 = sha256(migration);
  assert.equal(
    migrationSha256,
    ORDER_SELLER_METRICS_AUTHORITY_MIGRATION_SHA256,
    "Order seller metrics-authority migration bytes drifted",
  );
  return Object.freeze({ migration, migrationSha256 });
}

export function verifyOrderParticipantSummaryAuthorityMigrationBytes(
  root = process.cwd(),
) {
  const migrationPath = path.join(
    root,
    "prisma/migrations",
    ORDER_PARTICIPANT_SUMMARY_AUTHORITY_MIGRATION,
    "migration.sql",
  );
  const migration = readFileSync(migrationPath, "utf8");
  const migrationSha256 = sha256(migration);
  assert.equal(
    migrationSha256,
    ORDER_PARTICIPANT_SUMMARY_AUTHORITY_MIGRATION_SHA256,
    "Order participant summary-authority migration bytes drifted",
  );
  return Object.freeze({ migration, migrationSha256 });
}

export function verifyOrderParticipantCursorAuthorityMigrationBytes(
  root = process.cwd(),
) {
  const migrationPath = path.join(
    root,
    "prisma/migrations",
    ORDER_PARTICIPANT_CURSOR_AUTHORITY_MIGRATION,
    "migration.sql",
  );
  const migration = readFileSync(migrationPath, "utf8");
  const migrationSha256 = sha256(migration);
  assert.equal(
    migrationSha256,
    ORDER_PARTICIPANT_CURSOR_AUTHORITY_MIGRATION_SHA256,
    "Order participant cursor-authority migration bytes drifted",
  );
  return Object.freeze({ migration, migrationSha256 });
}

export function verifyOrderParticipantDetailProjectionMigrationBytes(
  root = process.cwd(),
) {
  const migrationPath = path.join(
    root,
    "prisma/migrations",
    ORDER_PARTICIPANT_DETAIL_PROJECTION_MIGRATION,
    "migration.sql",
  );
  const migration = readFileSync(migrationPath, "utf8");
  const migrationSha256 = sha256(migration);
  assert.equal(
    migrationSha256,
    ORDER_PARTICIPANT_DETAIL_PROJECTION_MIGRATION_SHA256,
    "Order participant detail-projection migration bytes drifted",
  );
  return Object.freeze({ migration, migrationSha256 });
}

export function verifyOrderParticipantSnapshotCorrectionMigrationBytes(
  root = process.cwd(),
) {
  const migrationPath = path.join(
    root,
    "prisma/migrations",
    ORDER_PARTICIPANT_SNAPSHOT_CORRECTION_MIGRATION,
    "migration.sql",
  );
  const migration = readFileSync(migrationPath, "utf8");
  const migrationSha256 = sha256(migration);
  assert.equal(
    migrationSha256,
    ORDER_PARTICIPANT_SNAPSHOT_CORRECTION_MIGRATION_SHA256,
    "Order participant snapshot-correction migration bytes drifted",
  );
  return Object.freeze({ migration, migrationSha256 });
}

export function verifyOrderCheckoutReceiptAuthorityMigrationBytes(
  root = process.cwd(),
) {
  const migrationPath = path.join(
    root,
    "prisma/migrations",
    ORDER_CHECKOUT_RECEIPT_AUTHORITY_MIGRATION,
    "migration.sql",
  );
  const migration = readFileSync(migrationPath, "utf8");
  const migrationSha256 = sha256(migration);
  assert.equal(
    migrationSha256,
    ORDER_CHECKOUT_RECEIPT_AUTHORITY_MIGRATION_SHA256,
    "Order checkout receipt-authority migration bytes drifted",
  );
  return Object.freeze({ migration, migrationSha256 });
}

export function appendReviewedOrderParticipantListAuthoritySuccessor({
  root = process.cwd(),
  laterMigrations,
  reviewedSuccessors,
  expectedPredecessor,
}) {
  if (!laterMigrations.includes(ORDER_PARTICIPANT_LIST_AUTHORITY_MIGRATION)) {
    return false;
  }
  assert.equal(
    reviewedSuccessors.at(-1),
    expectedPredecessor,
    "Order participant list authority requires its exact reviewed predecessor",
  );
  verifyOrderParticipantListAuthorityMigrationBytes(root);
  reviewedSuccessors.push(ORDER_PARTICIPANT_LIST_AUTHORITY_MIGRATION);
  if (laterMigrations.includes(ORDER_PARTICIPANT_DETAIL_AUTHORITY_MIGRATION)) {
    verifyOrderParticipantDetailAuthorityMigrationBytes(root);
    reviewedSuccessors.push(ORDER_PARTICIPANT_DETAIL_AUTHORITY_MIGRATION);
  }
  if (laterMigrations.includes(ORDER_STAFF_READ_AUTHORITY_MIGRATION)) {
    assert.equal(
      reviewedSuccessors.at(-1),
      ORDER_PARTICIPANT_DETAIL_AUTHORITY_MIGRATION,
      "Order staff read authority requires the exact detail-authority predecessor",
    );
    verifyOrderStaffReadAuthorityMigrationBytes(root);
    reviewedSuccessors.push(ORDER_STAFF_READ_AUTHORITY_MIGRATION);
  }
  if (laterMigrations.includes(ORDER_PARTICIPANT_EXPORT_AUTHORITY_MIGRATION)) {
    assert.equal(
      reviewedSuccessors.at(-1),
      ORDER_STAFF_READ_AUTHORITY_MIGRATION,
      "Order participant export authority requires the exact staff-authority predecessor",
    );
    verifyOrderParticipantExportAuthorityMigrationBytes(root);
    reviewedSuccessors.push(ORDER_PARTICIPANT_EXPORT_AUTHORITY_MIGRATION);
  }
  if (laterMigrations.includes(ORDER_ELIGIBILITY_AUTHORITY_MIGRATION)) {
    assert.equal(
      reviewedSuccessors.at(-1),
      ORDER_PARTICIPANT_EXPORT_AUTHORITY_MIGRATION,
      "Order eligibility authority requires the exact export-authority predecessor",
    );
    verifyOrderEligibilityAuthorityMigrationBytes(root);
    reviewedSuccessors.push(ORDER_ELIGIBILITY_AUTHORITY_MIGRATION);
  }
  if (laterMigrations.includes(ORDER_PUBLIC_AGGREGATE_AUTHORITY_MIGRATION)) {
    assert.equal(
      reviewedSuccessors.at(-1),
      ORDER_ELIGIBILITY_AUTHORITY_MIGRATION,
      "Order public aggregate authority requires the exact eligibility-authority predecessor",
    );
    verifyOrderPublicAggregateAuthorityMigrationBytes(root);
    reviewedSuccessors.push(ORDER_PUBLIC_AGGREGATE_AUTHORITY_MIGRATION);
  }
  if (laterMigrations.includes(ORDER_SELLER_ANALYTICS_AUTHORITY_MIGRATION)) {
    assert.equal(
      reviewedSuccessors.at(-1),
      ORDER_PUBLIC_AGGREGATE_AUTHORITY_MIGRATION,
      "Order seller analytics authority requires the exact public-aggregate predecessor",
    );
    verifyOrderSellerAnalyticsAuthorityMigrationBytes(root);
    reviewedSuccessors.push(ORDER_SELLER_ANALYTICS_AUTHORITY_MIGRATION);
  }
  if (laterMigrations.includes(ORDER_SELLER_METRICS_AUTHORITY_MIGRATION)) {
    assert.equal(
      reviewedSuccessors.at(-1),
      ORDER_SELLER_ANALYTICS_AUTHORITY_MIGRATION,
      "Order seller metrics authority requires the exact seller-analytics predecessor",
    );
    verifyOrderSellerMetricsAuthorityMigrationBytes(root);
    reviewedSuccessors.push(ORDER_SELLER_METRICS_AUTHORITY_MIGRATION);
  }
  if (laterMigrations.includes(ORDER_PARTICIPANT_SUMMARY_AUTHORITY_MIGRATION)) {
    assert.equal(
      reviewedSuccessors.at(-1),
      ORDER_SELLER_METRICS_AUTHORITY_MIGRATION,
      "Order participant summary authority requires the exact seller-metrics predecessor",
    );
    verifyOrderParticipantSummaryAuthorityMigrationBytes(root);
    reviewedSuccessors.push(ORDER_PARTICIPANT_SUMMARY_AUTHORITY_MIGRATION);
  }
  if (laterMigrations.includes(ORDER_PARTICIPANT_CURSOR_AUTHORITY_MIGRATION)) {
    assert.equal(
      reviewedSuccessors.at(-1),
      ORDER_PARTICIPANT_SUMMARY_AUTHORITY_MIGRATION,
      "Order participant cursor authority requires the exact summary-authority predecessor",
    );
    verifyOrderParticipantCursorAuthorityMigrationBytes(root);
    reviewedSuccessors.push(ORDER_PARTICIPANT_CURSOR_AUTHORITY_MIGRATION);
  }
  if (laterMigrations.includes(ORDER_PARTICIPANT_DETAIL_PROJECTION_MIGRATION)) {
    assert.equal(
      reviewedSuccessors.at(-1),
      ORDER_PARTICIPANT_CURSOR_AUTHORITY_MIGRATION,
      "Order participant detail projection requires the exact cursor-authority predecessor",
    );
    verifyOrderParticipantDetailProjectionMigrationBytes(root);
    reviewedSuccessors.push(ORDER_PARTICIPANT_DETAIL_PROJECTION_MIGRATION);
  }
  if (laterMigrations.includes(ORDER_PARTICIPANT_SNAPSHOT_CORRECTION_MIGRATION)) {
    assert.equal(
      reviewedSuccessors.at(-1),
      ORDER_PARTICIPANT_DETAIL_PROJECTION_MIGRATION,
      "Order participant snapshot correction requires the exact detail-projection predecessor",
    );
    verifyOrderParticipantSnapshotCorrectionMigrationBytes(root);
    reviewedSuccessors.push(ORDER_PARTICIPANT_SNAPSHOT_CORRECTION_MIGRATION);
  }
  if (laterMigrations.includes(ORDER_CHECKOUT_RECEIPT_AUTHORITY_MIGRATION)) {
    assert.equal(
      reviewedSuccessors.at(-1),
      ORDER_PARTICIPANT_SNAPSHOT_CORRECTION_MIGRATION,
      "Order checkout receipt authority requires the exact snapshot-correction predecessor",
    );
    verifyOrderCheckoutReceiptAuthorityMigrationBytes(root);
    reviewedSuccessors.push(ORDER_CHECKOUT_RECEIPT_AUTHORITY_MIGRATION);
  }
  if (laterMigrations.includes(ORDER_RECEIPT_NOTIFICATION_AUTHORITY_MIGRATION)) {
    assert.equal(
      reviewedSuccessors.at(-1),
      ORDER_CHECKOUT_RECEIPT_AUTHORITY_MIGRATION,
      "Order receipt Notification authority requires the exact checkout-receipt predecessor",
    );
    verifyOrderReceiptNotificationAuthorityMigrationBytes(root);
    reviewedSuccessors.push(ORDER_RECEIPT_NOTIFICATION_AUTHORITY_MIGRATION);
  }
  if (laterMigrations.includes(ORDER_FULFILLMENT_AUTHORITY_MIGRATION)) {
    assert.equal(
      reviewedSuccessors.at(-1),
      ORDER_RECEIPT_NOTIFICATION_AUTHORITY_MIGRATION,
      "Order fulfillment authority requires the exact receipt-Notification predecessor",
    );
    verifyOrderFulfillmentAuthorityMigrationBytes(root);
    reviewedSuccessors.push(ORDER_FULFILLMENT_AUTHORITY_MIGRATION);
  }
  if (laterMigrations.includes(ORDER_LABEL_AUTHORITY_MIGRATION)) {
    assert.equal(
      reviewedSuccessors.at(-1),
      ORDER_FULFILLMENT_AUTHORITY_MIGRATION,
      "Order label authority requires the exact fulfillment-authority predecessor",
    );
    verifyOrderLabelAuthorityMigrationBytes(root);
    reviewedSuccessors.push(ORDER_LABEL_AUTHORITY_MIGRATION);
  }
  if (laterMigrations.includes(ORDER_CHARGED_TOTAL_COMPATIBILITY_MIGRATION)) {
    assert.equal(
      reviewedSuccessors.at(-1),
      ORDER_LABEL_AUTHORITY_MIGRATION,
      "Order charged-total compatibility requires the exact label-authority predecessor",
    );
    verifyOrderChargedTotalCompatibilityMigrationBytes(root);
    reviewedSuccessors.push(ORDER_CHARGED_TOTAL_COMPATIBILITY_MIGRATION);
  }
  if (
    laterMigrations.includes(
      ORDER_PARTICIPANT_LIST_PROJECTION_CORRECTION_MIGRATION,
    )
  ) {
    assert.equal(
      reviewedSuccessors.at(-1),
      ORDER_CHARGED_TOTAL_COMPATIBILITY_MIGRATION,
      "Order participant list projection correction requires the exact charged-total predecessor",
    );
    verifyOrderParticipantListProjectionCorrectionBytes(root);
    reviewedSuccessors.push(
      ORDER_PARTICIPANT_LIST_PROJECTION_CORRECTION_MIGRATION,
    );
  }
  return true;
}
