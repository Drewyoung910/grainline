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
  listing_domain_v1: Object.freeze({
    migration: "20261102050000_prepare_listing_domain_authorities",
    migrationSha256: "d78b139032fd82371a684e38f3f8c2eff4c780c4e28908b49515a7d6b126241c",
    table: "Listing",
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
      "tests/listing-owner-create-authority.test.mjs",
      "tests/listing-owner-content-update-authority.test.mjs",
      "tests/listing-owner-summary-authority.test.mjs",
      "tests/listing-public-catalog-page-authority.test.mjs",
      "tests/listing-detail-source-authority.test.mjs",
      "tests/listing-stock-runtime.test.mjs",
      "tests/listing-message-context-authority.test.mjs",
      "tests/seller-profile-owner-featured-listing-toggle-conversion.test.mjs",
      "tests/seller-profile-staff-listing-review-transition.test.mjs",
      "tests/listing-account-deletion-authority.test.mjs",
      "tests/listing-analytics-guardrails.test.mjs",
    ]),
    functions: Object.freeze([
      Object.freeze({ name: "grainline_seller_staff_listing_review_transition", arguments: "text, text, text, text, timestamp without time zone", executeRole: "staff" }),
      Object.freeze({ name: "grainline_seller_staff_listing_remove_transition", arguments: "text, text, timestamp without time zone", executeRole: "staff" }),
      Object.freeze({ name: "grainline_seller_staff_listing_undo_transition", arguments: "text, text, text", executeRole: "staff" }),
      Object.freeze({ name: "grainline_seller_staff_listing_review_queue", arguments: "text, integer", executeRole: "staff", volatility: "s" }),
      Object.freeze({ name: "grainline_listing_staff_reference_targets", arguments: "text, text[]", executeRole: "staff", volatility: "s" }),
      Object.freeze({ name: "grainline_listing_actor_review_contexts", arguments: "text[]", volatility: "s" }),
      Object.freeze({ name: "grainline_listing_public_customer_photo_page", arguments: "text, integer, integer", volatility: "s" }),
      Object.freeze({ name: "grainline_listing_staff_seller_active_public_count", arguments: "text, text", executeRole: "staff", volatility: "s" }),
      Object.freeze({ name: "grainline_listing_owner_editor", arguments: "text", volatility: "s" }),
      Object.freeze({ name: "grainline_listing_owner_export_page", arguments: "timestamp without time zone, text, integer", volatility: "s" }),
      Object.freeze({ name: "grainline_listing_owner_catalog_page", arguments: "text, jsonb, integer, integer", volatility: "s" }),
      Object.freeze({ name: "grainline_listing_owner_summary_page", arguments: "text, text, boolean, integer, timestamp without time zone, text, integer", volatility: "s" }),
      Object.freeze({ name: "grainline_listing_owner_workshop_summary", arguments: "", volatility: "s" }),
      Object.freeze({ name: "grainline_listing_owner_counts", arguments: "", volatility: "s" }),
      Object.freeze({ name: "grainline_listing_owner_rating_buckets", arguments: "bigint, bigint, boolean", volatility: "s" }),
      Object.freeze({ name: "grainline_listing_seller_rating_summary_refresh", arguments: "text" }),
      Object.freeze({ name: "grainline_listing_service_quality_score_apply", arguments: "jsonb" }),
      Object.freeze({ name: "grainline_listing_owner_stock_lock", arguments: "text, text" }),
      Object.freeze({ name: "grainline_listing_owner_stock_apply", arguments: "text, text, boolean, integer, integer" }),
      Object.freeze({ name: "grainline_listing_owner_action_state", arguments: "text", volatility: "s" }),
      Object.freeze({ name: "grainline_listing_owner_assign_metros", arguments: "text, timestamp without time zone, text, text" }),
      Object.freeze({ name: "grainline_listing_children_replace_core", arguments: "text, integer, jsonb, jsonb", executeRoles: Object.freeze([]) }),
      Object.freeze({ name: "grainline_listing_owner_create", arguments: "text, text, boolean, text, text, text, text, integer, text[], text, text[], double precision, double precision, double precision, double precision, double precision, double precision, integer, text, text, integer, integer, integer, integer, jsonb, jsonb" }),
      Object.freeze({ name: "grainline_listing_owner_content_update", arguments: "text, timestamp without time zone, text, text, text, text, integer, boolean, text[], text, text[], double precision, double precision, double precision, double precision, double precision, double precision, integer, text, text, integer, integer, integer, integer, jsonb, jsonb" }),
      Object.freeze({ name: "grainline_listing_actor_transaction_source_core", arguments: "text, boolean", executeRoles: Object.freeze([]), volatility: "s" }),
      Object.freeze({ name: "grainline_listing_actor_transaction_source", arguments: "text", volatility: "s" }),
      Object.freeze({ name: "grainline_listing_actor_cart_transaction_sources", arguments: "text", volatility: "s" }),
      Object.freeze({ name: "grainline_listing_public_analytics_increment", arguments: "text, text" }),
      Object.freeze({ name: "grainline_listing_public_catalog_page", arguments: "jsonb, integer, integer", volatility: "s" }),
      Object.freeze({ name: "grainline_listing_public_title_suggestions", arguments: "text" }),
      Object.freeze({ name: "grainline_listing_detail_source_core", arguments: "text", executeRoles: Object.freeze([]), volatility: "s" }),
      Object.freeze({ name: "grainline_listing_actor_detail_source", arguments: "text", volatility: "s" }),
      Object.freeze({ name: "grainline_listing_staff_detail_source", arguments: "text, text", executeRole: "staff", volatility: "s" }),
      Object.freeze({ name: "grainline_listing_owner_ai_review_context", arguments: "text", volatility: "s" }),
      Object.freeze({ name: "grainline_listing_owner_alt_text_backfill", arguments: "text, text[], text[]" }),
      Object.freeze({ name: "grainline_listing_account_deletion_redact", arguments: "text, text, bigint, uuid, timestamp without time zone" }),
      Object.freeze({ name: "grainline_listing_owner_delete_lock", arguments: "text" }),
      Object.freeze({ name: "grainline_listing_owner_archive", arguments: "text, timestamp without time zone" }),
      Object.freeze({ name: "grainline_listing_owner_hard_delete", arguments: "text, timestamp without time zone" }),
      Object.freeze({ name: "grainline_listing_owner_transition", arguments: "text, text, timestamp without time zone" }),
      Object.freeze({ name: "grainline_listing_owner_review_transition", arguments: "text, timestamp without time zone, text, text, text[], double precision" }),
      Object.freeze({ name: "grainline_listing_message_context_titles", arguments: "text", volatility: "s" }),
      Object.freeze({
        name: "grainline_seller_owner_featured_listing_toggle",
        arguments: "text, text",
        predecessorSourceSha256: "941d21df3f4816d7906e6d45b4e48b6ead29fc718f0b47316a58264a87dbe30c",
      }),
      Object.freeze({
        name: "grainline_message_list",
        arguments: "text, text, text, timestamp without time zone, text, integer",
        securityDefiner: false,
        predecessorSourceSha256: "3651da639fcbabc46bcb15142d55f22d015c2b5ef0c9eb71087957599b8b9df7",
      }),
      Object.freeze({ name: "grainline_listing_materials_guard", arguments: "", executeRoles: Object.freeze([]) }),
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
  let delimiter = `$${name}$`;
  let marker = `AS ${delimiter}`;
  let start = sql.indexOf(marker);
  if (start < 0) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const versioned = new RegExp(
      `AS (\\$${escapedName}_[A-Za-z0-9_]+\\$)`,
      "u",
    ).exec(sql);
    if (!versioned) throw stopped(`function source is absent for ${name}`);
    delimiter = versioned[1];
    marker = `AS ${delimiter}`;
    start = versioned.index;
  }
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
  migrationPathOverride =
    process.env.PRIVATE_TABLE_PREPARATION_MIGRATION_PATH?.trim() || undefined,
) {
  const release = privateTablePreparation(releaseId);
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
  const allowedExecuteRoles = new Set(["runtime", "staff"]);
  if (release.functions.some((entry) => {
    const roles = privateTableFunctionExecuteRoles(entry);
    return new Set(roles).size !== roles.length
      || roles.some((role) => !allowedExecuteRoles.has(role));
  })) {
    throw stopped("function execution role is invalid");
  }
  if (release.functions.some((entry) => (
    entry.volatility !== undefined && !["i", "s", "v"].includes(entry.volatility)
  ))) {
    throw stopped("function volatility is invalid");
  }
  if (release.functions.some((entry) => (
    entry.securityDefiner !== undefined
    && typeof entry.securityDefiner !== "boolean"
  ))) {
    throw stopped("function security mode is invalid");
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
