#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  functionSourceFromMigration,
  privateTablePreparation,
  privateTablePreparationTables,
  verifyPrivateTablePreparationSource,
} from "./private-table-preparation-catalog.mjs";

const RELEASE_ID_PATTERN = /^[a-z][a-z0-9_]{2,63}$/u;

export const PRIVATE_TABLE_RLS_ACTIVATION_CONFIRMATION =
  "activate-reviewed-private-table-rls";

const OWNER_USER_ID_QUAL =
  "(\"userId\" = NULLIF(current_setting('app.user_id'::text, true), ''::text))";
const OWNER_SOCIAL_MINIMUM_COMPATIBLE_COMMIT =
  "0c0e9e67081c2ad7b27d97bc3f5956ecd2090549";
const SELLER_ANALYTICS_MINIMUM_COMPATIBLE_COMMIT =
  "ee7dbad06c4f45479fc316ad60f862f38b8281d9";
const BLOCK_REPORT_FAQ_MINIMUM_COMPATIBLE_COMMIT =
  "42cd3fd3db89ef2e9a02e37ff56bff80502be802";
const PREDECESSOR_CRUD = Object.freeze([
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
]);
const NO_PRIVILEGES = Object.freeze([]);
const NO_POLICIES = Object.freeze([]);
const NO_FUNCTION_CHANGES = Object.freeze({
  retained: Object.freeze([]),
  replacements: Object.freeze([]),
  additions: Object.freeze([]),
});
const PREPARATION_MIGRATION_PATH_ENV_BY_RELEASE = Object.freeze({
  favorite_v1: "FAVORITE_PREPARATION_MIGRATION_PATH",
  follow_v1: "FOLLOW_PREPARATION_MIGRATION_PATH",
  review_vote_v1: "REVIEW_VOTE_PREPARATION_MIGRATION_PATH",
  maker_verification_v1: "MAKER_VERIFICATION_PREPARATION_MIGRATION_PATH",
  commission_domain_v1: "COMMISSION_DOMAIN_PREPARATION_MIGRATION_PATH",
  seller_broadcast_v1: "SELLER_BROADCAST_PREPARATION_MIGRATION_PATH",
  seller_analytics_daily_v1:
    "SELLER_ANALYTICS_DAILY_PREPARATION_MIGRATION_PATH",
  block_v1: "BLOCK_PREPARATION_MIGRATION_PATH",
  user_report_v1: "USER_REPORT_PREPARATION_MIGRATION_PATH",
  seller_faq_v1: "SELLER_FAQ_PREPARATION_MIGRATION_PATH",
  admin_audit_log_v1: "ADMIN_AUDIT_LOG_PREPARATION_MIGRATION_PATH",
});
const ACTIVATION_MIGRATION_PATH_ENV_BY_RELEASE = Object.freeze({
  favorite_v1: "FAVORITE_RLS_ACTIVATION_MIGRATION_PATH",
  follow_v1: "FOLLOW_RLS_ACTIVATION_MIGRATION_PATH",
  review_vote_v1: "REVIEW_VOTE_RLS_ACTIVATION_MIGRATION_PATH",
  maker_verification_v1: "MAKER_VERIFICATION_ACTIVATION_MIGRATION_PATH",
  commission_domain_v1: "COMMISSION_DOMAIN_ACTIVATION_MIGRATION_PATH",
  seller_broadcast_v1: "SELLER_BROADCAST_RLS_ACTIVATION_MIGRATION_PATH",
  seller_analytics_daily_v1:
    "SELLER_ANALYTICS_DAILY_ACTIVATION_MIGRATION_PATH",
  block_v1: "BLOCK_RLS_ACTIVATION_MIGRATION_PATH",
  user_report_v1: "USER_REPORT_RLS_ACTIVATION_MIGRATION_PATH",
  seller_faq_v1: "SELLER_FAQ_RLS_ACTIVATION_MIGRATION_PATH",
  admin_audit_log_v1: "ADMIN_AUDIT_LOG_RLS_ACTIVATION_MIGRATION_PATH",
});

export const PRIVATE_TABLE_RLS_ACTIVATIONS = Object.freeze({
  favorite_v1: Object.freeze({
    preparationReleaseId: "favorite_v1",
    minimumCompatibleAppCommit: OWNER_SOCIAL_MINIMUM_COMPATIBLE_COMMIT,
    migration: "20261028050000_activate_favorite_rls",
    migrationSha256:
      "e338d85fd1e2a124ce0a32cb755836f35c565ce4fabc374d0df4cdc07f9fb358",
    rollbackPath: "docs/rls-drafts/favorite-activation-rollback.sql",
    rollbackSha256:
      "dc0b04333dee53f3a729dc2de20f49a91d6117238ef97e0821acf42940b6a304",
    table: "Favorite",
    mode: "owner_policy_combined_enable_force",
    policies: Object.freeze([
      Object.freeze({
        name: "favorite_owner_select",
        command: "r",
        permissive: true,
        roles: Object.freeze(["grainline_app_runtime"]),
        using: OWNER_USER_ID_QUAL,
        withCheck: null,
      }),
      Object.freeze({
        name: "favorite_owner_delete",
        command: "d",
        permissive: true,
        roles: Object.freeze(["grainline_app_runtime"]),
        using: OWNER_USER_ID_QUAL,
        withCheck: null,
      }),
    ]),
    predecessorRuntimePrivileges: PREDECESSOR_CRUD,
    activatedRuntimePrivileges: Object.freeze(["SELECT", "DELETE"]),
    activatedStaffPrivileges: NO_PRIVILEGES,
    activatedPublicPrivileges: NO_PRIVILEGES,
    sourceTests: Object.freeze(["tests/favorite-rls-activation.test.mjs"]),
    rollbackTriggerDrops: Object.freeze([]),
    functionChanges: NO_FUNCTION_CHANGES,
  }),
  follow_v1: Object.freeze({
    preparationReleaseId: "follow_v1",
    minimumCompatibleAppCommit: OWNER_SOCIAL_MINIMUM_COMPATIBLE_COMMIT,
    migration: "20261028060000_activate_follow_rls",
    migrationSha256:
      "a2b8de8d2e6ad171b4eee951b32cbecdcf40999fcad85b1f1a72e8bab71007e2",
    rollbackPath: "docs/rls-drafts/follow-activation-rollback.sql",
    rollbackSha256:
      "db9baa25124fc650e9d08e383933a5b13bdad7fdb30b77726d7499a66019bc0c",
    table: "Follow",
    mode: "policyless_combined_enable_force",
    policies: NO_POLICIES,
    predecessorRuntimePrivileges: PREDECESSOR_CRUD,
    activatedRuntimePrivileges: NO_PRIVILEGES,
    activatedStaffPrivileges: NO_PRIVILEGES,
    activatedPublicPrivileges: NO_PRIVILEGES,
    sourceTests: Object.freeze(["tests/follow-rls-activation.test.mjs"]),
    rollbackTriggerDrops: Object.freeze([]),
    functionChanges: Object.freeze({
      retained: Object.freeze([
        Object.freeze({
          name: "grainline_user_follower_notification_page",
          arguments: "text, text, integer",
          sourceMd5: "471b1caf9907d6d370ec1cb8ea5aa718",
          securityDefiner: true,
          predecessorExecuteRole: "runtime",
          activatedExecuteRole: "none",
        }),
      ]),
      replacements: Object.freeze([]),
      additions: Object.freeze([]),
    }),
  }),
  review_vote_v1: Object.freeze({
    preparationReleaseId: "review_vote_v1",
    minimumCompatibleAppCommit: OWNER_SOCIAL_MINIMUM_COMPATIBLE_COMMIT,
    migration: "20261028070000_activate_review_vote_rls",
    migrationSha256:
      "0d9a9081354a199f0ead4744ca2b8782a5e370c5fe95013c796ffde6ced6ff6a",
    rollbackPath: "docs/rls-drafts/review-vote-activation-rollback.sql",
    rollbackSha256:
      "3b8db98d85c6fb8309f13608d787775cc796a409afba99b60f51bc718c3cc6b3",
    table: "ReviewVote",
    mode: "owner_policy_combined_enable_force",
    policies: Object.freeze([
      Object.freeze({
        name: "review_vote_owner_select",
        command: "r",
        permissive: true,
        roles: Object.freeze(["grainline_app_runtime"]),
        using: OWNER_USER_ID_QUAL,
        withCheck: null,
      }),
    ]),
    predecessorRuntimePrivileges: PREDECESSOR_CRUD,
    activatedRuntimePrivileges: Object.freeze(["SELECT"]),
    activatedStaffPrivileges: NO_PRIVILEGES,
    activatedPublicPrivileges: NO_PRIVILEGES,
    sourceTests: Object.freeze(["tests/review-vote-rls-activation.test.mjs"]),
    rollbackTriggerDrops: Object.freeze(["ReviewVote_count_after_delete"]),
    functionChanges: Object.freeze({
      retained: Object.freeze([]),
      replacements: Object.freeze([]),
      additions: Object.freeze([
        Object.freeze({
          name: "grainline_review_vote_count_after_delete",
          arguments: "",
          executeRole: "none",
        }),
      ]),
    }),
  }),
  maker_verification_v1: Object.freeze({
    preparationReleaseId: "maker_verification_v1",
    minimumCompatibleAppCommit: OWNER_SOCIAL_MINIMUM_COMPATIBLE_COMMIT,
    migration: "20261028080000_activate_maker_verification_rls",
    migrationSha256:
      "7868277f03b599768784c0f3a44a3c7bb28c8b64772a24f6183c538ec6f3401c",
    rollbackPath: "docs/rls-drafts/maker-verification-activation-rollback.sql",
    rollbackSha256:
      "b0deed025ab8d21daa57818f66f9324cfa5a71c353230a49d2d97003a4a867d0",
    table: "MakerVerification",
    mode: "policyless_combined_enable_force",
    policies: NO_POLICIES,
    predecessorRuntimePrivileges: PREDECESSOR_CRUD,
    activatedRuntimePrivileges: NO_PRIVILEGES,
    activatedStaffPrivileges: NO_PRIVILEGES,
    activatedPublicPrivileges: NO_PRIVILEGES,
    sourceTests: Object.freeze(["tests/maker-verification-preparation.test.mjs"]),
    rollbackTriggerDrops: Object.freeze([]),
    functionChanges: NO_FUNCTION_CHANGES,
  }),
  commission_domain_v1: Object.freeze({
    preparationReleaseId: "commission_domain_v1",
    minimumCompatibleAppCommit:
      "461d10dbe86b34e6f286a4fe62b5a9ad28bea1a8",
    migration: "20261101070000_activate_commission_domain_rls",
    migrationSha256:
      "c21445e3c09ebc85041daef861629d871c11f9676cc0116c9d621ffcda3d1f9f",
    rollbackPath: "docs/rls-drafts/commission-domain-activation-rollback.sql",
    rollbackSha256:
      "57618bffcffeb3b0f775219f7c805668e8395054b757dbb44b172c969136cbdb",
    table: "CommissionRequest",
    additionalTables: Object.freeze(["CommissionInterest"]),
    mode: "policyless_combined_enable_force",
    policies: NO_POLICIES,
    predecessorRuntimePrivileges: PREDECESSOR_CRUD,
    activatedRuntimePrivileges: NO_PRIVILEGES,
    activatedStaffPrivileges: NO_PRIVILEGES,
    activatedPublicPrivileges: NO_PRIVILEGES,
    sourceTests: Object.freeze([
      "tests/commission-domain-rls-activation.test.mjs",
    ]),
    rollbackTriggerDrops: Object.freeze([]),
    functionChanges: NO_FUNCTION_CHANGES,
  }),
  block_v1: Object.freeze({
    preparationReleaseId: "block_v1",
    minimumCompatibleAppCommit: BLOCK_REPORT_FAQ_MINIMUM_COMPATIBLE_COMMIT,
    migration: "20261030040000_activate_block_rls",
    migrationSha256:
      "cec9c1c6345225304fcae3b2d433ade6c73e1d6d98f0d461126390f7f0c29e73",
    rollbackPath: "docs/rls-drafts/block-activation-rollback.sql",
    rollbackSha256:
      "e1d0d020ca072149e441c7db5110209579d7d2449692cc3728b98b920c7bea28",
    table: "Block",
    mode: "policyless_combined_enable_force",
    policies: NO_POLICIES,
    predecessorRuntimePrivileges: PREDECESSOR_CRUD,
    activatedRuntimePrivileges: NO_PRIVILEGES,
    activatedStaffPrivileges: NO_PRIVILEGES,
    activatedPublicPrivileges: NO_PRIVILEGES,
    sourceTests: Object.freeze([
      "tests/block-report-seller-faq-rls-activation.test.mjs",
    ]),
    rollbackTriggerDrops: Object.freeze([]),
    functionChanges: Object.freeze({
      retained: Object.freeze([
        Object.freeze({
          name: "grainline_conversation_inbox",
          arguments: "text, boolean, text, timestamp without time zone, text, integer",
          sourceMd5: "4b2884765f4ca0db432c4678f98b1bdd",
          securityDefiner: false,
          predecessorExecuteRole: "runtime",
          activatedExecuteRole: "none",
        }),
        Object.freeze({
          name: "grainline_message_unread_count",
          arguments: "text",
          sourceMd5: "6465832d045b72cc2762907f66a461f3",
          securityDefiner: false,
          predecessorExecuteRole: "runtime",
          activatedExecuteRole: "none",
        }),
      ]),
      replacements: Object.freeze([]),
      additions: Object.freeze([]),
    }),
  }),
  user_report_v1: Object.freeze({
    preparationReleaseId: "user_report_v1",
    minimumCompatibleAppCommit: BLOCK_REPORT_FAQ_MINIMUM_COMPATIBLE_COMMIT,
    migration: "20261030050000_activate_user_report_rls",
    migrationSha256:
      "0c488a187a0f2389d32c2860f03e39d6a93dede288a9caf43483fe87c1f626fc",
    rollbackPath: "docs/rls-drafts/user-report-activation-rollback.sql",
    rollbackSha256:
      "db500b9c9f25092946c9742ee4fbe5ab20d069741dd4a43d157c4ddb6514c1dc",
    table: "UserReport",
    mode: "policyless_combined_enable_force",
    policies: NO_POLICIES,
    predecessorRuntimePrivileges: PREDECESSOR_CRUD,
    activatedRuntimePrivileges: NO_PRIVILEGES,
    activatedStaffPrivileges: NO_PRIVILEGES,
    activatedPublicPrivileges: NO_PRIVILEGES,
    sourceTests: Object.freeze([
      "tests/block-report-seller-faq-rls-activation.test.mjs",
    ]),
    rollbackTriggerDrops: Object.freeze([]),
    functionChanges: NO_FUNCTION_CHANGES,
  }),
  seller_faq_v1: Object.freeze({
    preparationReleaseId: "seller_faq_v1",
    minimumCompatibleAppCommit: BLOCK_REPORT_FAQ_MINIMUM_COMPATIBLE_COMMIT,
    migration: "20261030060000_activate_seller_faq_rls",
    migrationSha256:
      "d79661da61c150e893e927ea389afcaede307ad3c8b45b95977ce38e26634154",
    rollbackPath: "docs/rls-drafts/seller-faq-activation-rollback.sql",
    rollbackSha256:
      "877666c051dacca7ef4e9ff169437fde8d01360b972966d6914bd79ebfb45150",
    table: "SellerFaq",
    mode: "policyless_combined_enable_force",
    policies: NO_POLICIES,
    predecessorRuntimePrivileges: PREDECESSOR_CRUD,
    activatedRuntimePrivileges: NO_PRIVILEGES,
    activatedStaffPrivileges: NO_PRIVILEGES,
    activatedPublicPrivileges: NO_PRIVILEGES,
    sourceTests: Object.freeze([
      "tests/block-report-seller-faq-rls-activation.test.mjs",
    ]),
    rollbackTriggerDrops: Object.freeze([]),
    functionChanges: NO_FUNCTION_CHANGES,
  }),
  seller_analytics_daily_v1: Object.freeze({
    preparationReleaseId: "seller_analytics_daily_v1",
    minimumCompatibleAppCommit: SELLER_ANALYTICS_MINIMUM_COMPATIBLE_COMMIT,
    migration: "20261101040000_activate_seller_analytics_daily_rls",
    migrationSha256:
      "460aa8dacd516918af35f42fa041c533396b363a6384f9bf156400fa0d69206d",
    rollbackPath:
      "docs/rls-drafts/seller-analytics-daily-activation-rollback.sql",
    rollbackSha256:
      "f126710f9469ace8e80a19809cddfd3b7fa5b962ef103d0e56aa2b923f621ef3",
    table: "ListingViewDaily",
    additionalTables: Object.freeze(["SellerProfileViewDaily"]),
    mode: "policyless_combined_enable_force",
    policies: NO_POLICIES,
    predecessorRuntimePrivileges: PREDECESSOR_CRUD,
    activatedRuntimePrivileges: NO_PRIVILEGES,
    activatedStaffPrivileges: NO_PRIVILEGES,
    activatedPublicPrivileges: NO_PRIVILEGES,
    sourceTests: Object.freeze([
      "tests/seller-analytics-daily-rls-activation.test.mjs",
    ]),
    rollbackTriggerDrops: Object.freeze([]),
    functionChanges: Object.freeze({
      retained: Object.freeze([
        Object.freeze({
          name: "grainline_order_seller_analytics_top_listings",
          arguments: "text, bigint, bigint, boolean, boolean",
          sourceMd5: "195c87faa7dab7e74006f768b0a2e488",
          securityDefiner: true,
          predecessorExecuteRole: "runtime",
          activatedExecuteRole: "runtime",
        }),
      ]),
      replacements: Object.freeze([]),
      additions: Object.freeze([]),
    }),
  }),
  seller_broadcast_v1: Object.freeze({
    preparationReleaseId: "seller_broadcast_v1",
    minimumCompatibleAppCommit:
      "d956364ead259e5ae26b49171af57e5a89e522a2",
    migration: "20261101050000_activate_seller_broadcast_rls",
    migrationSha256:
      "9e71df11bc80f2acebc56b0148031943be07db45244c52e6236d4a2c88bf6990",
    rollbackPath: "docs/rls-drafts/seller-broadcast-activation-rollback.sql",
    rollbackSha256:
      "a6167ce605c8f4bd7df4b5ca6c5a7d59688f79b23207c36a1de3b0e99acd8050",
    table: "SellerBroadcast",
    mode: "policyless_combined_enable_force",
    policies: NO_POLICIES,
    predecessorRuntimePrivileges: PREDECESSOR_CRUD,
    activatedRuntimePrivileges: NO_PRIVILEGES,
    activatedStaffPrivileges: NO_PRIVILEGES,
    activatedPublicPrivileges: NO_PRIVILEGES,
    sourceTests: Object.freeze([
      "tests/seller-broadcast-rls-activation.test.mjs",
    ]),
    rollbackTriggerDrops: Object.freeze([]),
    functionChanges: NO_FUNCTION_CHANGES,
  }),
  admin_audit_log_v1: Object.freeze({
    preparationReleaseId: "admin_audit_log_v1",
    minimumCompatibleAppCommit:
      "f17482eb25adcf6d8d6c0f7d60eb1d1222414883",
    migration: "20261102020000_activate_admin_audit_log_rls",
    migrationSha256:
      "5c56b89f5261ec9ed250a9ea1d93769a3350bb76a34af0e011aec9f08e948bd2",
    rollbackPath: "docs/rls-drafts/admin-audit-log-activation-rollback.sql",
    rollbackSha256:
      "68525b71f2b7f2ea2e69739eddfdd64ed19a43ec047b070fe7696423e52a69d1",
    table: "AdminAuditLog",
    mode: "policyless_combined_enable_force",
    policies: NO_POLICIES,
    predecessorRuntimePrivileges: PREDECESSOR_CRUD,
    activatedRuntimePrivileges: NO_PRIVILEGES,
    activatedStaffPrivileges: NO_PRIVILEGES,
    activatedAccountDeletionPrivileges: NO_PRIVILEGES,
    activatedPublicPrivileges: NO_PRIVILEGES,
    sourceTests: Object.freeze([
      "tests/admin-audit-log-rls-activation.test.mjs",
    ]),
    rollbackTriggerDrops: Object.freeze([]),
    functionChanges: NO_FUNCTION_CHANGES,
  }),
});

export const PRIVATE_TABLE_RLS_ACTIVATION_BATCHES = Object.freeze({
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
  return new Error(`private-table RLS activation stopped: ${message}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function artifact(rootDir, relativePath, expectedDigest, label) {
  const absolutePath = path.isAbsolute(relativePath)
    ? relativePath
    : path.join(rootDir, relativePath);
  const bytes = readFileSync(absolutePath);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== expectedDigest) throw stopped(`${label} digest drifted`);
  return Object.freeze({
    path: absolutePath,
    digest,
    sql: bytes.toString("utf8"),
  });
}

function signatureLiteral(entry) {
  return `public.${entry.name}(${entry.arguments.replace(/,\s+/gu, ",")})`;
}

export function privateTableRlsActivation(releaseId) {
  if (typeof releaseId !== "string" || !RELEASE_ID_PATTERN.test(releaseId)) {
    throw stopped("release id is invalid");
  }
  const release = PRIVATE_TABLE_RLS_ACTIVATIONS[releaseId];
  if (!release) throw stopped("release id is not reviewed");
  const preparation = privateTablePreparation(release.preparationReleaseId);
  const activationTables = privateTableRlsActivationTables(release);
  if (
    privateTablePreparationTables(preparation).join("|")
      !== activationTables.join("|")
  ) {
    throw stopped("preparation table drifted");
  }
  return Object.freeze({ ...release, preparation });
}

export function privateTableRlsActivationTables(release) {
  const tables = [release.table, ...(release.additionalTables ?? [])];
  if (
    tables.some((table) => (
      typeof table !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(table)
    ))
    || new Set(tables).size !== tables.length
  ) {
    throw stopped("activation table catalog is invalid");
  }
  return Object.freeze(tables);
}

export function privateTableRlsActivationReleaseIds(selectionId) {
  if (typeof selectionId !== "string" || !RELEASE_ID_PATTERN.test(selectionId)) {
    throw stopped("release id is invalid");
  }
  if (PRIVATE_TABLE_RLS_ACTIVATIONS[selectionId]) {
    return Object.freeze([selectionId]);
  }
  const batch = PRIVATE_TABLE_RLS_ACTIVATION_BATCHES[selectionId];
  if (!batch) throw stopped("release id is not reviewed");
  const releases = batch.map((releaseId) => privateTableRlsActivation(releaseId));
  const migrations = releases.map((release) => release.migration);
  if (new Set(batch).size !== batch.length || new Set(migrations).size !== migrations.length) {
    throw stopped("batch contains duplicate releases");
  }
  const sortedMigrations = [...migrations].sort((left, right) => left.localeCompare(right));
  if (migrations.join("|") !== sortedMigrations.join("|")) {
    throw stopped("batch migrations are not ordered");
  }
  const minimumCommits = new Set(
    releases.map((release) => release.minimumCompatibleAppCommit),
  );
  if (minimumCommits.size !== 1) {
    throw stopped("batch minimum compatible app commits differ");
  }
  return batch;
}

export function privateTableRlsActivationMigrationPath(release) {
  return `prisma/migrations/${release.migration}/migration.sql`;
}

function migrationPathOverride(releaseId, envByRelease, genericEnvName) {
  const releaseEnvName = envByRelease[releaseId];
  const releasePath = releaseEnvName
    ? process.env[releaseEnvName]?.trim()
    : undefined;
  const configured = releasePath || process.env[genericEnvName]?.trim();
  if (!configured) return undefined;
  return configured.endsWith("/migration.sql")
    ? configured
    : `${configured}/migration.sql`;
}

export function privateTablePreparationMigrationOverride(releaseId) {
  return migrationPathOverride(
    releaseId,
    PREPARATION_MIGRATION_PATH_ENV_BY_RELEASE,
    "PRIVATE_TABLE_PREPARATION_MIGRATION_PATH",
  );
}

export function privateTableRlsActivationMigrationOverride(releaseId) {
  return migrationPathOverride(
    releaseId,
    ACTIVATION_MIGRATION_PATH_ENV_BY_RELEASE,
    "PRIVATE_TABLE_RLS_ACTIVATION_MIGRATION_PATH",
  );
}

export function verifyPrivateTableRlsActivationSource(
  releaseId,
  rootDir = process.cwd(),
) {
  const release = privateTableRlsActivation(releaseId);
  const preparation = verifyPrivateTablePreparationSource(
    release.preparationReleaseId,
    rootDir,
    privateTablePreparationMigrationOverride(releaseId),
  );
  const activation = artifact(
    rootDir,
    privateTableRlsActivationMigrationOverride(releaseId)
      || privateTableRlsActivationMigrationPath(release),
    release.migrationSha256,
    "activation migration",
  );
  const rollback = artifact(
    rootDir,
    release.rollbackPath,
    release.rollbackSha256,
    "rollback",
  );
  if (
    !Array.isArray(release.policies)
    || new Set(release.policies.map((policy) => policy.name)).size
      !== release.policies.length
    || release.policies.some((policy) => (
      !/^[a-z][a-z0-9_]{2,63}$/u.test(policy.name)
      || !["r", "a", "w", "d"].includes(policy.command)
      || policy.permissive !== true
      || !Array.isArray(policy.roles)
      || policy.roles.length < 1
      || typeof policy.using !== "string"
      || (policy.withCheck !== null && typeof policy.withCheck !== "string")
    ))
  ) {
    throw stopped("policy catalog is invalid");
  }
  if (
    !Array.isArray(release.sourceTests)
    || release.sourceTests.length < 1
    || release.sourceTests.some((testPath) => (
      typeof testPath !== "string"
      || !/^tests\/[A-Za-z0-9._-]+\.test\.mjs$/u.test(testPath)
    ))
  ) {
    throw stopped("source-test catalog is invalid");
  }
  const tables = privateTableRlsActivationTables(release);
  if (tables.length > 1 && release.policies.length > 0) {
    throw stopped("multi-table activation must be policyless");
  }
  const tablePatterns = tables.map(
    (table) => `public\\."${escapeRegExp(table)}"`,
  );
  const tablePattern = tablePatterns[0];
  const activationAlterTables = [
    ...activation.sql.matchAll(/\bALTER\s+TABLE\s+public\."([^"]+)"/giu),
  ].map((match) => match[1]);
  const activationLock = activation.sql.match(
    /\bLOCK\s+TABLE\s+([\s\S]*?)\s+IN\s+ACCESS\s+EXCLUSIVE\s+MODE\s*;/iu,
  )?.[1] ?? "";
  const activationRevokeTables = [
    ...activation.sql.matchAll(
      /\bREVOKE\s+ALL(?:\s+PRIVILEGES)?\s+ON\s+TABLE\s+([\s\S]*?)\s+FROM\s+PUBLIC,\s*grainline_app_runtime(?:,\s*grainline_staff_read_runtime)?(?:,\s*grainline_account_deletion_runtime)?\s*;/giu,
    ),
  ].flatMap((statement) => (
    [...statement[1].matchAll(/public\."([^"]+)"/gu)].map((match) => match[1])
  ));
  const activationTablesExact = tables.every((table) => (
    activationAlterTables.filter((candidate) => candidate === table).length === 2
    && activationLock.includes('public."' + table + '"')
    && activationRevokeTables.filter((candidate) => candidate === table).length === 1
  ))
    && activationAlterTables.every((table) => tables.includes(table))
    && activationRevokeTables.every((table) => tables.includes(table));
  if (
    !["owner_policy_combined_enable_force", "policyless_combined_enable_force"]
      .includes(release.mode)
    || (release.mode === "policyless_combined_enable_force"
      && release.policies.length !== 0)
    || (release.mode === "owner_policy_combined_enable_force"
      && release.policies.length === 0)
    || !activationTablesExact
    || /\b(?:NO\s+FORCE|DISABLE)\s+ROW\s+LEVEL\s+SECURITY\b/iu.test(activation.sql)
    || /\bDROP\s+(?:TABLE|COLUMN|POLICY|TRIGGER)\b/iu.test(activation.sql)
  ) {
    throw stopped("migration is not the reviewed combined activation shape");
  }
  for (const candidateTablePattern of tablePatterns) {
    if (
      !new RegExp(
        `ALTER\\s+TABLE\\s+${candidateTablePattern}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
        "iu",
      ).test(activation.sql)
      || !new RegExp(
        `ALTER\\s+TABLE\\s+${candidateTablePattern}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
        "iu",
      ).test(activation.sql)
    ) {
      throw stopped("migration table authority shape drifted");
    }
  }
  for (const policy of release.policies) {
    if (!new RegExp(
      `CREATE\\s+POLICY\\s+${escapeRegExp(policy.name)}\\s+ON\\s+${tablePattern}`,
      "iu",
    ).test(activation.sql)) {
      throw stopped(`reviewed policy ${policy.name} is absent from activation`);
    }
  }
  const activationPolicyNames = [
    ...activation.sql.matchAll(/\bCREATE\s+POLICY\s+([a-z][a-z0-9_]*)/giu),
  ].map((match) => match[1]).sort();
  const expectedPolicyNames = release.policies.map((policy) => policy.name).sort();
  if (activationPolicyNames.join("|") !== expectedPolicyNames.join("|")) {
    throw stopped("activation policy set drifted");
  }
  const activatedPrivileges = release.activatedRuntimePrivileges.join(",\\s*");
  for (const table of tables) {
    const activatedTablePattern = `public\\."${escapeRegExp(table)}"`;
    const activationGrant = new RegExp(
      `GRANT\\s+${activatedPrivileges}\\s+ON\\s+TABLE\\s+${activatedTablePattern}\\s+TO\\s+grainline_app_runtime`,
      "iu",
    );
    if (
      (release.activatedRuntimePrivileges.length > 0
        && !activationGrant.test(activation.sql))
      || (release.activatedRuntimePrivileges.length === 0
        && new RegExp(
          `GRANT[\\s\\S]{0,120}ON\\s+TABLE[\\s\\S]{0,120}${activatedTablePattern}`,
          "iu",
        ).test(activation.sql))
    ) {
      throw stopped(`activation runtime grant shape drifted for ${table}`);
    }
  }
  for (const entry of [
    ...preparation.release.functions,
    ...(preparation.release.retainedFunctions ?? []),
  ]) {
    const literal = signatureLiteral(entry).replaceAll("'", "''");
    if (!activation.sql.includes(`'${literal}'`)) {
      throw stopped(`reviewed operation ${literal} is absent from activation preflight`);
    }
  }
  const rollbackAlterTables = [
    ...rollback.sql.matchAll(/\bALTER\s+TABLE\s+public\."([^"]+)"/giu),
  ].map((match) => match[1]);
  const rollbackLock = rollback.sql.match(
    /\bLOCK\s+TABLE\s+([\s\S]*?)\s+IN\s+ACCESS\s+EXCLUSIVE\s+MODE\s*;/iu,
  )?.[1] ?? "";
  const rollbackGrantTables = [
    ...rollback.sql.matchAll(
      /\bGRANT\s+SELECT,\s*INSERT,\s*UPDATE,\s*DELETE\s+ON\s+TABLE\s+([\s\S]*?)\s+TO\s+grainline_app_runtime\s*;/giu,
    ),
  ].flatMap((statement) => (
    [...statement[1].matchAll(/public\."([^"]+)"/gu)].map((match) => match[1])
  ));
  const rollbackTablesExact = tables.every((table) => (
    rollbackAlterTables.filter((candidate) => candidate === table).length === 2
    && rollbackLock.includes('public."' + table + '"')
    && rollbackGrantTables.filter((candidate) => candidate === table).length === 1
  ))
    && rollbackAlterTables.every((table) => tables.includes(table))
    && rollbackGrantTables.every((table) => tables.includes(table));
  if (
    !rollbackTablesExact
    || /\b(?:ENABLE|FORCE)\s+ROW\s+LEVEL\s+SECURITY\b/iu.test(
      rollback.sql.replace(/NO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/giu, ""),
    )
    || /\bCREATE\s+POLICY\b/iu.test(rollback.sql)
    || /\bDROP\s+(?:TABLE|COLUMN)\b/iu.test(rollback.sql)
  ) {
    throw stopped("rollback is not the reviewed predecessor-restoration shape");
  }
  for (const candidateTablePattern of tablePatterns) {
    if (
      !new RegExp(
        `ALTER\\s+TABLE\\s+${candidateTablePattern}\\s+NO\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
        "iu",
      ).test(rollback.sql)
      || !new RegExp(
        `ALTER\\s+TABLE\\s+${candidateTablePattern}\\s+DISABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
        "iu",
      ).test(rollback.sql)
    ) {
      throw stopped("rollback table authority shape drifted");
    }
  }
  for (const policy of release.policies) {
    if (!new RegExp(
      `DROP\\s+POLICY\\s+${escapeRegExp(policy.name)}\\s+ON\\s+${tablePattern}`,
      "iu",
    ).test(rollback.sql)) {
      throw stopped(`reviewed policy ${policy.name} is absent from rollback`);
    }
  }
  const rollbackPolicyNames = [
    ...rollback.sql.matchAll(/\bDROP\s+POLICY\s+([a-z][a-z0-9_]*)/giu),
  ].map((match) => match[1]).sort();
  if (rollbackPolicyNames.join("|") !== expectedPolicyNames.join("|")) {
    throw stopped("rollback policy set drifted");
  }
  const rollbackTriggerNames = [
    ...rollback.sql.matchAll(/\bDROP\s+TRIGGER\s+"?([A-Za-z0-9_]+)"?/giu),
  ].map((match) => match[1]).sort();
  const expectedRollbackTriggerNames = [...release.rollbackTriggerDrops].sort();
  if (rollbackTriggerNames.join("|") !== expectedRollbackTriggerNames.join("|")) {
    throw stopped("rollback trigger set drifted");
  }
  for (const change of release.functionChanges.retained) {
    const literal = signatureLiteral(change);
    if (
      !activation.sql.includes(literal)
      || !rollback.sql.includes(literal)
      || !/^[0-9a-f]{32}$/u.test(change.sourceMd5)
      || typeof change.securityDefiner !== "boolean"
    ) {
      throw stopped(`retained function transition drifted for ${literal}`);
    }
  }
  const activeFunctionSources = new Map();
  for (const change of release.functionChanges.replacements) {
    const source = functionSourceFromMigration(activation.sql, change.name);
    activeFunctionSources.set(change.name, source);
    if (
      !activation.sql.includes(`RENAME TO ${change.compatibilityName}`)
      || !rollback.sql.includes(`RENAME TO ${change.name}`)
    ) {
      throw stopped(`replacement transition drifted for ${change.name}`);
    }
  }
  for (const change of release.functionChanges.additions) {
    activeFunctionSources.set(
      change.name,
      functionSourceFromMigration(activation.sql, change.name),
    );
    if (!rollback.sql.includes(`DROP FUNCTION public.${change.name}(`)) {
      throw stopped(`added function rollback drifted for ${change.name}`);
    }
  }
  return Object.freeze({
    releaseId,
    release,
    preparation,
    migrationPath: activation.path,
    migrationDigest: activation.digest,
    rollbackPath: rollback.path,
    rollbackDigest: rollback.digest,
    activeFunctionSources,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const selection = process.env.PRIVATE_TABLE_RLS_ACTIVATION_RELEASE_ID ?? "";
    const releaseIds = privateTableRlsActivationReleaseIds(selection);
    const verified = releaseIds.map((releaseId) => (
      verifyPrivateTableRlsActivationSource(releaseId)
    ));
    if (process.argv.includes("--release-ids")) {
      process.stdout.write(`${releaseIds.join("\n")}\n`);
    } else if (process.argv.includes("--preparation-release-ids")) {
      process.stdout.write(`${verified.map(
        (entry) => entry.release.preparationReleaseId,
      ).join("\n")}\n`);
    } else if (process.argv.includes("--migrations")) {
      process.stdout.write(`${verified.map((entry) => entry.release.migration).join("\n")}\n`);
    } else if (process.argv.includes("--tests")) {
      process.stdout.write(`${[...new Set(verified.flatMap(
        (entry) => entry.release.sourceTests,
      ))].join("\n")}\n`);
    } else if (process.argv.includes("--minimum-compatible-app-commit")) {
      process.stdout.write(`${verified[0].release.minimumCompatibleAppCommit}\n`);
    } else {
      process.stdout.write(`${verified[0].release.migration}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
