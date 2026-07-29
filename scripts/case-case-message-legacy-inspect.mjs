#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  parseGuardedNeonDatabaseIdentity,
} from "./guard-saved-search-rls-deploy.mjs";
import {
  assertDeterministicPostgresEnvironment,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";

const { Client } = pg;

export const CASE_LEGACY_INSPECTION_CONFIRMATION =
  "inspect-prelaunch-case-case-message-legacy-state";
export const CASE_LEGACY_PREREQUISITE_CONFIRMATION =
  "case-compatible-app-and-direct-upload-preparation-passed";

const REVIEWED_TARGET = Object.freeze({
  databaseName: "neondb",
  endpointId: "ep-plain-river-aaqg8gj4",
  ownerRole: "neondb_owner",
  region: "westus3.azure",
  runtimeRole: "grainline_app_runtime",
});
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function required(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${name} is required without surrounding whitespace`);
  }
  return value;
}

export function parseCaseLegacyInspectionConfig(env = process.env) {
  assertDeterministicPostgresEnvironment(
    env,
    "Case/CaseMessage legacy inspection",
  );
  if (
    env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_REF !== "refs/heads/main"
  ) {
    throw new Error(
      "Case/CaseMessage legacy inspection requires a manual main-branch GitHub Actions dispatch",
    );
  }
  const releaseCommit = required(
    env,
    "CASE_LEGACY_INSPECT_RELEASE_COMMIT",
  );
  if (
    !COMMIT_PATTERN.test(releaseCommit)
    || releaseCommit !== required(env, "GITHUB_SHA")
  ) {
    throw new Error(
      "Case/CaseMessage legacy inspection commit must match the dispatched main commit",
    );
  }
  if (
    env.CASE_LEGACY_INSPECT_CONFIRM
      !== CASE_LEGACY_INSPECTION_CONFIRMATION
  ) {
    throw new Error(
      "Case/CaseMessage legacy inspection confirmation is not exact",
    );
  }
  if (
    env.CASE_LEGACY_PREREQUISITES_CONFIRMED
      !== CASE_LEGACY_PREREQUISITE_CONFIRMATION
  ) {
    throw new Error(
      "Case/CaseMessage legacy inspection prerequisites are not explicitly confirmed",
    );
  }
  for (const forbidden of [
    "DATABASE_URL",
    "DIRECT_UPLOAD_CLEANUP_DATABASE_URL",
    "GRANT_AUDIT_DATABASE_URL",
  ]) {
    if (Object.hasOwn(env, forbidden)) {
      throw new Error(
        "runtime, cleanup, and grant-audit URLs must remain absent from the owner-only inspection job",
      );
    }
  }

  const directUrl = required(env, "DIRECT_URL");
  const directUrlSha256 = createHash("sha256")
    .update(directUrl, "utf8")
    .digest("hex");
  const expectedDigest = required(
    env,
    "PRODUCTION_MIGRATION_DIRECT_URL_SHA256",
  );
  if (
    !SHA256_PATTERN.test(expectedDigest)
    || expectedDigest !== directUrlSha256
  ) {
    throw new Error(
      "DIRECT_URL does not match the protected Production digest",
    );
  }
  const identity = parseGuardedNeonDatabaseIdentity(directUrl, "DIRECT_URL");
  if (
    identity.isPooler
    || identity.endpointId !== REVIEWED_TARGET.endpointId
    || identity.databaseName !== REVIEWED_TARGET.databaseName
    || identity.region !== REVIEWED_TARGET.region
    || identity.username !== REVIEWED_TARGET.ownerRole
    || required(env, "MIGRATION_DB_ROLE") !== REVIEWED_TARGET.ownerRole
    || required(env, "RUNTIME_DB_ROLE") !== REVIEWED_TARGET.runtimeRole
  ) {
    throw new Error(
      "DIRECT_URL is not the reviewed direct production owner target",
    );
  }

  const runnerTemp = path.resolve(required(env, "RUNNER_TEMP"));
  const evidencePath = path.resolve(
    required(env, "CASE_LEGACY_INSPECT_EVIDENCE_PATH"),
  );
  const expectedPath = path.join(
    runnerTemp,
    `case-case-message-legacy-inspection-${releaseCommit}.json`,
  );
  if (evidencePath !== expectedPath || existsSync(evidencePath)) {
    throw new Error(
      "Case/CaseMessage evidence path is not the fresh reviewed runner path",
    );
  }
  return Object.freeze({
    directUrl,
    directUrlSha256,
    evidencePath,
    identity,
    releaseCommit,
  });
}

export function buildCaseLegacyInspectionClientOptions(config) {
  if (
    typeof config?.directUrl !== "string"
    || config.directUrl.length === 0
  ) {
    throw new TypeError(
      "Case/CaseMessage legacy inspection config must include directUrl",
    );
  }
  return Object.freeze({
    application_name: "grainline-case-legacy-inspection",
    connectionString: config.directUrl,
    connectionTimeoutMillis: 10_000,
    query_timeout: 55_000,
    statement_timeout: 50_000,
    ...postgresChannelBindingClientOptions(new URL(config.directUrl)),
  });
}

export function readCaseLegacyInspectionGitState(cwd = process.cwd()) {
  const run = (args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  return Object.freeze({
    head: run(["rev-parse", "HEAD"]),
    status: run(["status", "--porcelain=v1", "--untracked-files=all"]),
  });
}

export function assertCaseLegacyInspectionGitState(state, releaseCommit) {
  if (state?.head !== releaseCommit || state.status !== "") {
    throw new Error(
      "Case/CaseMessage legacy inspection checkout is not the exact clean dispatched commit",
    );
  }
  return Object.freeze({ clean: true, head: state.head });
}

export const CASE_LEGACY_COUNT_FIELDS = Object.freeze([
  "case_count",
  "case_message_count",
  "attachment_count",
  "case_order_missing_count",
  "case_buyer_order_mismatch_count",
  "case_seller_order_mismatch_count",
  "case_multi_seller_order_count",
  "case_self_party_count",
  "case_created_after_updated_count",
  "case_seller_deadline_before_created_count",
  "case_discussion_clock_pair_mismatch_count",
  "case_discussion_clock_order_count",
  "active_case_resolution_evidence_count",
  "terminal_case_missing_resolution_count",
  "terminal_case_missing_resolved_at_count",
  "dismissed_case_refund_evidence_count",
  "refund_case_missing_provider_evidence_count",
  "refund_case_invalid_amount_count",
  "pending_close_mark_count_mismatch_count",
  "non_pending_active_resolution_mark_count",
  "active_both_marked_resolved_count",
  "empty_case_count",
  "author_kind_null_count",
  "null_author_buyer_count",
  "null_author_seller_count",
  "null_author_staff_count",
  "null_author_unclassifiable_count",
  "author_kind_relationship_mismatch_count",
  "staff_kind_current_role_mismatch_count",
  "message_before_case_count",
  "message_after_case_updated_count",
  "message_timestamp_tie_group_count",
  "case_over_250_messages_count",
  "max_case_message_count",
  "attachment_uploader_author_mismatch_count",
  "attachment_direct_upload_missing_count",
  "attachment_binding_mismatch_count",
  "attachment_reference_missing_count",
  "attachment_reference_duplicate_count",
  "attachment_reference_orphan_source_count",
  "attachment_reference_binding_mismatch_count",
  "attachment_reference_nonexclusive_count",
  "case_attachment_claim_orphan_count",
  "attachment_invalid_metadata_count",
  "attachment_timestamp_before_message_count",
  "blocking_case_row_count",
  "blocking_message_row_count",
  "blocking_attachment_row_count",
  "blocking_attachment_reference_row_count",
  "blocking_attachment_claim_row_count",
]);

const DISTRIBUTION_FIELDS = Object.freeze([
  "case_status_counts",
  "case_resolution_counts",
  "author_kind_counts",
]);
const DISTRIBUTION_KEYS = Object.freeze({
  author_kind_counts: Object.freeze([
    "BUYER",
    "SELLER",
    "STAFF",
    "NULL",
  ]),
  case_resolution_counts: Object.freeze([
    "REFUND_FULL",
    "REFUND_PARTIAL",
    "DISMISSED",
    "NULL",
  ]),
  case_status_counts: Object.freeze([
    "OPEN",
    "IN_DISCUSSION",
    "PENDING_CLOSE",
    "UNDER_REVIEW",
    "RESOLVED",
    "CLOSED",
  ]),
});

function camelCase(field) {
  return field.replaceAll("_", " ").replace(
    / (\w)/g,
    (_, letter) => letter.toUpperCase(),
  );
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(
      `Case/CaseMessage legacy inspection returned invalid ${label}`,
    );
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(
      `Case/CaseMessage legacy inspection returned unexpected ${label} schema`,
    );
  }
  const normalized = {};
  for (const key of keys) {
    const count = Number(value[key]);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new TypeError(
        `Case/CaseMessage legacy inspection returned invalid ${label} counts`,
      );
    }
    normalized[key] = count;
  }
  return Object.freeze(normalized);
}

export function normalizeCaseLegacyResult(row) {
  const expected = [...CASE_LEGACY_COUNT_FIELDS, ...DISTRIBUTION_FIELDS].sort();
  const actual = row && typeof row === "object"
    ? Object.keys(row).sort()
    : [];
  if (
    actual.length !== expected.length
    || actual.some((field, index) => field !== expected[index])
  ) {
    throw new TypeError(
      "Case/CaseMessage legacy inspection returned an unexpected aggregate schema",
    );
  }
  const counts = {};
  for (const field of CASE_LEGACY_COUNT_FIELDS) {
    const value = Number(row[field]);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(
        "Case/CaseMessage legacy inspection returned invalid aggregate counts",
      );
    }
    counts[camelCase(field)] = value;
  }
  const distributions = {};
  for (const field of DISTRIBUTION_FIELDS) {
    distributions[camelCase(field.replace(/_counts$/, ""))] = exactObject(
      row[field],
      DISTRIBUTION_KEYS[field],
      field,
    );
  }
  return Object.freeze({
    counts: Object.freeze(counts),
    distributions: Object.freeze(distributions),
  });
}

export const CASE_LEGACY_COUNTS_SQL = `
WITH order_seller_summary AS (
  SELECT
    orders.id AS order_id,
    orders."buyerId" AS order_buyer_id,
    pg_catalog.count(DISTINCT seller."userId") FILTER (
      WHERE seller."userId" IS NOT NULL
    )::integer AS seller_count,
    pg_catalog.min(seller."userId") AS only_seller_id
  FROM public."Order" AS orders
  LEFT JOIN public."OrderItem" AS item ON item."orderId" = orders.id
  LEFT JOIN public."Listing" AS listing ON listing.id = item."listingId"
  LEFT JOIN public."SellerProfile" AS seller
    ON seller.id = listing."sellerId"
  GROUP BY orders.id, orders."buyerId"
),
message_counts AS (
  SELECT message."caseId", pg_catalog.count(*)::integer AS message_count
  FROM public."CaseMessage" AS message
  GROUP BY message."caseId"
),
message_ties AS (
  SELECT message."caseId", message."createdAt"
  FROM public."CaseMessage" AS message
  GROUP BY message."caseId", message."createdAt"
  HAVING pg_catalog.count(*) > 1
),
attachment_reference_counts AS (
  SELECT
    attachment.id AS attachment_id,
    pg_catalog.count(reference.id) FILTER (
      WHERE reference."releasedAt" IS NULL
        AND reference."sourceType" = 'CASE_MESSAGE_ATTACHMENT'
        AND reference."sourceId" = attachment.id
        AND reference."directUploadId" = attachment."directUploadId"
    )::integer AS active_reference_count
  FROM public."CaseMessageAttachment" AS attachment
  LEFT JOIN public."DirectUploadReference" AS reference
    ON reference."sourceId" = attachment.id
   AND reference."sourceType" = 'CASE_MESSAGE_ATTACHMENT'
  GROUP BY attachment.id
),
case_attachment_reference_anomalies AS (
  SELECT
    reference.id,
    attachment.id IS NULL AS orphan_source,
    (
      attachment.id IS NOT NULL
      AND reference."directUploadId"
          IS DISTINCT FROM attachment."directUploadId"
    ) AS binding_mismatch,
    reference.exclusive IS DISTINCT FROM true AS nonexclusive,
    (
      attachment.id IS NULL
      OR reference."directUploadId"
         IS DISTINCT FROM attachment."directUploadId"
      OR reference.exclusive IS DISTINCT FROM true
    ) AS blocking
  FROM public."DirectUploadReference" AS reference
  LEFT JOIN public."CaseMessageAttachment" AS attachment
    ON attachment.id = reference."sourceId"
  WHERE reference."sourceType" = 'CASE_MESSAGE_ATTACHMENT'
    AND reference."releasedAt" IS NULL
),
case_attachment_claim_anomalies AS (
  SELECT
    upload.id,
    (
      attachment.id IS NULL
      OR upload.id IS DISTINCT FROM attachment."directUploadId"
    ) AS blocking
  FROM public."DirectUpload" AS upload
  LEFT JOIN public."CaseMessageAttachment" AS attachment
    ON attachment.id = upload."claimedById"
  WHERE upload."claimedByType" = 'CASE_MESSAGE_ATTACHMENT'
),
case_anomalies AS (
  SELECT
    case_row.id,
    (
      orders.id IS NULL
      OR case_row."buyerId" IS DISTINCT FROM summary.order_buyer_id
      OR summary.seller_count IS DISTINCT FROM 1
      OR case_row."sellerId" IS DISTINCT FROM summary.only_seller_id
      OR (
        case_row."buyerId" IS NOT NULL
        AND case_row."buyerId" = case_row."sellerId"
      )
      OR case_row."createdAt" > case_row."updatedAt"
      OR case_row."sellerRespondBy" < case_row."createdAt"
      OR (
        (case_row."discussionStartedAt" IS NULL)
        <> (case_row."escalateUnlocksAt" IS NULL)
      )
      OR (
        case_row."discussionStartedAt" IS NOT NULL
        AND (
          case_row."discussionStartedAt" < case_row."createdAt"
          OR case_row."escalateUnlocksAt"
             < case_row."discussionStartedAt"
        )
      )
      OR (
        case_row.status NOT IN (
          'RESOLVED'::public."CaseStatus",
          'CLOSED'::public."CaseStatus"
        )
        AND (
          case_row.resolution IS NOT NULL
          OR case_row."resolvedAt" IS NOT NULL
          OR case_row."resolvedById" IS NOT NULL
          OR case_row."refundAmountCents" IS NOT NULL
          OR case_row."stripeRefundId" IS NOT NULL
        )
      )
      OR (
        case_row.status IN (
          'RESOLVED'::public."CaseStatus",
          'CLOSED'::public."CaseStatus"
        )
        AND (
          case_row.resolution IS NULL
          OR case_row."resolvedAt" IS NULL
        )
      )
      OR (
        case_row.resolution = 'DISMISSED'::public."CaseResolution"
        AND (
          case_row."refundAmountCents" IS NOT NULL
          OR case_row."stripeRefundId" IS NOT NULL
        )
      )
      OR (
        case_row.resolution IN (
          'REFUND_FULL'::public."CaseResolution",
          'REFUND_PARTIAL'::public."CaseResolution"
        )
        AND (
          case_row."stripeRefundId" IS NULL
          OR COALESCE(case_row."refundAmountCents", 0) <= 0
        )
      )
      OR (
        case_row.status = 'PENDING_CLOSE'::public."CaseStatus"
        AND (
          CASE WHEN case_row."buyerMarkedResolved" THEN 1 ELSE 0 END
          + CASE WHEN case_row."sellerMarkedResolved" THEN 1 ELSE 0 END
        ) <> 1
      )
      OR (
        case_row.status IN (
          'OPEN'::public."CaseStatus",
          'IN_DISCUSSION'::public."CaseStatus",
          'UNDER_REVIEW'::public."CaseStatus"
        )
        AND (
          case_row."buyerMarkedResolved"
          OR case_row."sellerMarkedResolved"
        )
      )
      OR (
        case_row.status NOT IN (
          'RESOLVED'::public."CaseStatus",
          'CLOSED'::public."CaseStatus"
        )
        AND case_row."buyerMarkedResolved"
        AND case_row."sellerMarkedResolved"
      )
    ) AS blocking
  FROM public."Case" AS case_row
  LEFT JOIN public."Order" AS orders ON orders.id = case_row."orderId"
  LEFT JOIN order_seller_summary AS summary
    ON summary.order_id = case_row."orderId"
),
message_anomalies AS (
  SELECT
    message.id,
    (
      (
        message."authorKind" = 'BUYER'::public."CaseMessageAuthorKind"
        AND message."authorId" IS DISTINCT FROM case_row."buyerId"
      )
      OR (
        message."authorKind" = 'SELLER'::public."CaseMessageAuthorKind"
        AND message."authorId" IS DISTINCT FROM case_row."sellerId"
      )
      OR (
        message."authorKind" = 'STAFF'::public."CaseMessageAuthorKind"
        AND message."authorId" IN (
          case_row."buyerId",
          case_row."sellerId"
        )
      )
      OR (
        message."authorKind" IS NULL
        AND message."authorId" IS DISTINCT FROM case_row."buyerId"
        AND message."authorId" IS DISTINCT FROM case_row."sellerId"
        AND author.role NOT IN (
          'EMPLOYEE'::public."Role",
          'ADMIN'::public."Role"
        )
      )
      OR message."createdAt" < case_row."createdAt"
      OR message."createdAt" > case_row."updatedAt"
    ) AS blocking
  FROM public."CaseMessage" AS message
  JOIN public."Case" AS case_row ON case_row.id = message."caseId"
  JOIN public."User" AS author ON author.id = message."authorId"
),
attachment_anomalies AS (
  SELECT
    attachment.id,
    (
      upload.id IS NULL
      OR attachment."uploaderId" IS DISTINCT FROM message."authorId"
      OR attachment."objectKey" IS DISTINCT FROM upload.key
      OR attachment."uploaderId" IS DISTINCT FROM upload."userId"
      OR upload.endpoint IS DISTINCT FROM 'caseEvidenceImage'
      OR upload."storageClass" IS DISTINCT FROM 'PRIVATE'
      OR upload."publicUrl" IS NOT NULL
      OR attachment."contentType" IS DISTINCT FROM upload."contentType"
      OR attachment."byteSize" IS DISTINCT FROM upload."expectedSize"
      OR upload.status IS DISTINCT FROM 'CLAIMED'
      OR upload."claimedByType"
         IS DISTINCT FROM 'CASE_MESSAGE_ATTACHMENT'
      OR upload."claimedById" IS DISTINCT FROM attachment.id
      OR COALESCE(reference_count.active_reference_count, 0) IS DISTINCT FROM 1
      OR attachment."contentType" NOT IN (
        'image/jpeg',
        'image/png',
        'image/webp'
      )
      OR attachment."byteSize" <= 0
      OR attachment."byteSize" > 8388608
      OR attachment."createdAt" < message."createdAt"
    ) AS blocking
  FROM public."CaseMessageAttachment" AS attachment
  JOIN public."CaseMessage" AS message
    ON message.id = attachment."caseMessageId"
  LEFT JOIN public."DirectUpload" AS upload
    ON upload.id = attachment."directUploadId"
  LEFT JOIN attachment_reference_counts AS reference_count
    ON reference_count.attachment_id = attachment.id
)
SELECT
  (SELECT pg_catalog.count(*)::integer FROM public."Case")
    AS case_count,
  (SELECT pg_catalog.count(*)::integer FROM public."CaseMessage")
    AS case_message_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."CaseMessageAttachment")
    AS attachment_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."Case" AS case_row
     LEFT JOIN public."Order" AS orders ON orders.id = case_row."orderId"
    WHERE orders.id IS NULL)
    AS case_order_missing_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."Case" AS case_row
     JOIN order_seller_summary AS summary
       ON summary.order_id = case_row."orderId"
    WHERE case_row."buyerId" IS DISTINCT FROM summary.order_buyer_id)
    AS case_buyer_order_mismatch_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."Case" AS case_row
     JOIN order_seller_summary AS summary
       ON summary.order_id = case_row."orderId"
    WHERE summary.seller_count IS DISTINCT FROM 1
       OR case_row."sellerId" IS DISTINCT FROM summary.only_seller_id)
    AS case_seller_order_mismatch_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."Case" AS case_row
     JOIN order_seller_summary AS summary
       ON summary.order_id = case_row."orderId"
    WHERE summary.seller_count > 1)
    AS case_multi_seller_order_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."Case"
    WHERE "buyerId" IS NOT NULL AND "buyerId" = "sellerId")
    AS case_self_party_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."Case"
    WHERE "createdAt" > "updatedAt")
    AS case_created_after_updated_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."Case"
    WHERE "sellerRespondBy" < "createdAt")
    AS case_seller_deadline_before_created_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."Case"
    WHERE ("discussionStartedAt" IS NULL)
          <> ("escalateUnlocksAt" IS NULL))
    AS case_discussion_clock_pair_mismatch_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."Case"
    WHERE "discussionStartedAt" IS NOT NULL
      AND (
        "discussionStartedAt" < "createdAt"
        OR "escalateUnlocksAt" < "discussionStartedAt"
      ))
    AS case_discussion_clock_order_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."Case"
    WHERE status NOT IN (
      'RESOLVED'::public."CaseStatus",
      'CLOSED'::public."CaseStatus"
    )
      AND (
        resolution IS NOT NULL
        OR "resolvedAt" IS NOT NULL
        OR "resolvedById" IS NOT NULL
        OR "refundAmountCents" IS NOT NULL
        OR "stripeRefundId" IS NOT NULL
      ))
    AS active_case_resolution_evidence_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."Case"
    WHERE status IN (
      'RESOLVED'::public."CaseStatus",
      'CLOSED'::public."CaseStatus"
    )
      AND resolution IS NULL)
    AS terminal_case_missing_resolution_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."Case"
    WHERE status IN (
      'RESOLVED'::public."CaseStatus",
      'CLOSED'::public."CaseStatus"
    )
      AND "resolvedAt" IS NULL)
    AS terminal_case_missing_resolved_at_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."Case"
    WHERE resolution = 'DISMISSED'::public."CaseResolution"
      AND (
        "refundAmountCents" IS NOT NULL
        OR "stripeRefundId" IS NOT NULL
      ))
    AS dismissed_case_refund_evidence_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."Case"
    WHERE resolution IN (
      'REFUND_FULL'::public."CaseResolution",
      'REFUND_PARTIAL'::public."CaseResolution"
    )
      AND "stripeRefundId" IS NULL)
    AS refund_case_missing_provider_evidence_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."Case"
    WHERE resolution IN (
      'REFUND_FULL'::public."CaseResolution",
      'REFUND_PARTIAL'::public."CaseResolution"
    )
      AND COALESCE("refundAmountCents", 0) <= 0)
    AS refund_case_invalid_amount_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."Case"
    WHERE status = 'PENDING_CLOSE'::public."CaseStatus"
      AND (
        CASE WHEN "buyerMarkedResolved" THEN 1 ELSE 0 END
        + CASE WHEN "sellerMarkedResolved" THEN 1 ELSE 0 END
      ) <> 1)
    AS pending_close_mark_count_mismatch_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."Case"
    WHERE status IN (
      'OPEN'::public."CaseStatus",
      'IN_DISCUSSION'::public."CaseStatus",
      'UNDER_REVIEW'::public."CaseStatus"
    )
      AND (
        "buyerMarkedResolved"
        OR "sellerMarkedResolved"
      ))
    AS non_pending_active_resolution_mark_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."Case"
    WHERE status NOT IN (
      'RESOLVED'::public."CaseStatus",
      'CLOSED'::public."CaseStatus"
    )
      AND "buyerMarkedResolved"
      AND "sellerMarkedResolved")
    AS active_both_marked_resolved_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."Case" AS case_row
    WHERE NOT EXISTS (
      SELECT 1 FROM public."CaseMessage" AS message
      WHERE message."caseId" = case_row.id
    ))
    AS empty_case_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."CaseMessage"
    WHERE "authorKind" IS NULL)
    AS author_kind_null_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."CaseMessage" AS message
     JOIN public."Case" AS case_row ON case_row.id = message."caseId"
    WHERE message."authorKind" IS NULL
      AND message."authorId" = case_row."buyerId")
    AS null_author_buyer_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."CaseMessage" AS message
     JOIN public."Case" AS case_row ON case_row.id = message."caseId"
    WHERE message."authorKind" IS NULL
      AND message."authorId" IS DISTINCT FROM case_row."buyerId"
      AND message."authorId" = case_row."sellerId")
    AS null_author_seller_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."CaseMessage" AS message
     JOIN public."Case" AS case_row ON case_row.id = message."caseId"
     JOIN public."User" AS author ON author.id = message."authorId"
    WHERE message."authorKind" IS NULL
      AND message."authorId" IS DISTINCT FROM case_row."buyerId"
      AND message."authorId" IS DISTINCT FROM case_row."sellerId"
      AND author.role IN (
        'EMPLOYEE'::public."Role",
        'ADMIN'::public."Role"
      ))
    AS null_author_staff_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."CaseMessage" AS message
     JOIN public."Case" AS case_row ON case_row.id = message."caseId"
     JOIN public."User" AS author ON author.id = message."authorId"
    WHERE message."authorKind" IS NULL
      AND message."authorId" IS DISTINCT FROM case_row."buyerId"
      AND message."authorId" IS DISTINCT FROM case_row."sellerId"
      AND author.role NOT IN (
        'EMPLOYEE'::public."Role",
        'ADMIN'::public."Role"
      ))
    AS null_author_unclassifiable_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."CaseMessage" AS message
     JOIN public."Case" AS case_row ON case_row.id = message."caseId"
    WHERE (
      message."authorKind" = 'BUYER'::public."CaseMessageAuthorKind"
      AND message."authorId" IS DISTINCT FROM case_row."buyerId"
    ) OR (
      message."authorKind" = 'SELLER'::public."CaseMessageAuthorKind"
      AND message."authorId" IS DISTINCT FROM case_row."sellerId"
    ) OR (
      message."authorKind" = 'STAFF'::public."CaseMessageAuthorKind"
      AND message."authorId" IN (
        case_row."buyerId",
        case_row."sellerId"
      )
    ))
    AS author_kind_relationship_mismatch_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."CaseMessage" AS message
     JOIN public."User" AS author ON author.id = message."authorId"
    WHERE message."authorKind" = 'STAFF'::public."CaseMessageAuthorKind"
      AND author.role NOT IN (
        'EMPLOYEE'::public."Role",
        'ADMIN'::public."Role"
      ))
    AS staff_kind_current_role_mismatch_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."CaseMessage" AS message
     JOIN public."Case" AS case_row ON case_row.id = message."caseId"
    WHERE message."createdAt" < case_row."createdAt")
    AS message_before_case_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."CaseMessage" AS message
     JOIN public."Case" AS case_row ON case_row.id = message."caseId"
    WHERE message."createdAt" > case_row."updatedAt")
    AS message_after_case_updated_count,
  (SELECT pg_catalog.count(*)::integer FROM message_ties)
    AS message_timestamp_tie_group_count,
  (SELECT pg_catalog.count(*)::integer
     FROM message_counts
    WHERE message_count > 250)
    AS case_over_250_messages_count,
  (SELECT COALESCE(pg_catalog.max(message_count), 0)::integer
     FROM message_counts)
    AS max_case_message_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."CaseMessageAttachment" AS attachment
     JOIN public."CaseMessage" AS message
       ON message.id = attachment."caseMessageId"
    WHERE attachment."uploaderId" IS DISTINCT FROM message."authorId")
    AS attachment_uploader_author_mismatch_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."CaseMessageAttachment" AS attachment
     LEFT JOIN public."DirectUpload" AS upload
       ON upload.id = attachment."directUploadId"
    WHERE upload.id IS NULL)
    AS attachment_direct_upload_missing_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."CaseMessageAttachment" AS attachment
     JOIN public."DirectUpload" AS upload
       ON upload.id = attachment."directUploadId"
    WHERE attachment."objectKey" IS DISTINCT FROM upload.key
       OR attachment."uploaderId" IS DISTINCT FROM upload."userId"
       OR upload.endpoint IS DISTINCT FROM 'caseEvidenceImage'
       OR upload."storageClass" IS DISTINCT FROM 'PRIVATE'
       OR upload."publicUrl" IS NOT NULL
       OR attachment."contentType" IS DISTINCT FROM upload."contentType"
       OR attachment."byteSize" IS DISTINCT FROM upload."expectedSize"
       OR upload.status IS DISTINCT FROM 'CLAIMED'
       OR upload."claimedByType"
          IS DISTINCT FROM 'CASE_MESSAGE_ATTACHMENT'
       OR upload."claimedById" IS DISTINCT FROM attachment.id)
    AS attachment_binding_mismatch_count,
  (SELECT pg_catalog.count(*)::integer
     FROM attachment_reference_counts
    WHERE active_reference_count = 0)
    AS attachment_reference_missing_count,
  (SELECT pg_catalog.count(*)::integer
     FROM attachment_reference_counts
    WHERE active_reference_count > 1)
    AS attachment_reference_duplicate_count,
  (SELECT pg_catalog.count(*)::integer
     FROM case_attachment_reference_anomalies
    WHERE orphan_source)
    AS attachment_reference_orphan_source_count,
  (SELECT pg_catalog.count(*)::integer
     FROM case_attachment_reference_anomalies
    WHERE binding_mismatch)
    AS attachment_reference_binding_mismatch_count,
  (SELECT pg_catalog.count(*)::integer
     FROM case_attachment_reference_anomalies
    WHERE nonexclusive)
    AS attachment_reference_nonexclusive_count,
  (SELECT pg_catalog.count(*)::integer
     FROM case_attachment_claim_anomalies
    WHERE blocking)
    AS case_attachment_claim_orphan_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."CaseMessageAttachment"
    WHERE "contentType" NOT IN (
      'image/jpeg',
      'image/png',
      'image/webp'
    )
       OR "byteSize" <= 0
       OR "byteSize" > 8388608)
    AS attachment_invalid_metadata_count,
  (SELECT pg_catalog.count(*)::integer
     FROM public."CaseMessageAttachment" AS attachment
     JOIN public."CaseMessage" AS message
       ON message.id = attachment."caseMessageId"
    WHERE attachment."createdAt" < message."createdAt")
    AS attachment_timestamp_before_message_count,
  (SELECT pg_catalog.count(*)::integer
     FROM case_anomalies WHERE blocking)
    AS blocking_case_row_count,
  (SELECT pg_catalog.count(*)::integer
     FROM message_anomalies WHERE blocking)
    AS blocking_message_row_count,
  (SELECT pg_catalog.count(*)::integer
     FROM attachment_anomalies WHERE blocking)
    AS blocking_attachment_row_count,
  (SELECT pg_catalog.count(*)::integer
     FROM case_attachment_reference_anomalies
    WHERE blocking)
    AS blocking_attachment_reference_row_count,
  (SELECT pg_catalog.count(*)::integer
     FROM case_attachment_claim_anomalies
    WHERE blocking)
    AS blocking_attachment_claim_row_count,
  pg_catalog.jsonb_build_object(
    'OPEN', (SELECT pg_catalog.count(*) FROM public."Case"
      WHERE status = 'OPEN'::public."CaseStatus"),
    'IN_DISCUSSION', (SELECT pg_catalog.count(*) FROM public."Case"
      WHERE status = 'IN_DISCUSSION'::public."CaseStatus"),
    'PENDING_CLOSE', (SELECT pg_catalog.count(*) FROM public."Case"
      WHERE status = 'PENDING_CLOSE'::public."CaseStatus"),
    'UNDER_REVIEW', (SELECT pg_catalog.count(*) FROM public."Case"
      WHERE status = 'UNDER_REVIEW'::public."CaseStatus"),
    'RESOLVED', (SELECT pg_catalog.count(*) FROM public."Case"
      WHERE status = 'RESOLVED'::public."CaseStatus"),
    'CLOSED', (SELECT pg_catalog.count(*) FROM public."Case"
      WHERE status = 'CLOSED'::public."CaseStatus")
  ) AS case_status_counts,
  pg_catalog.jsonb_build_object(
    'REFUND_FULL', (SELECT pg_catalog.count(*) FROM public."Case"
      WHERE resolution = 'REFUND_FULL'::public."CaseResolution"),
    'REFUND_PARTIAL', (SELECT pg_catalog.count(*) FROM public."Case"
      WHERE resolution = 'REFUND_PARTIAL'::public."CaseResolution"),
    'DISMISSED', (SELECT pg_catalog.count(*) FROM public."Case"
      WHERE resolution = 'DISMISSED'::public."CaseResolution"),
    'NULL', (SELECT pg_catalog.count(*) FROM public."Case"
      WHERE resolution IS NULL)
  ) AS case_resolution_counts,
  pg_catalog.jsonb_build_object(
    'BUYER', (SELECT pg_catalog.count(*) FROM public."CaseMessage"
      WHERE "authorKind" = 'BUYER'::public."CaseMessageAuthorKind"),
    'SELLER', (SELECT pg_catalog.count(*) FROM public."CaseMessage"
      WHERE "authorKind" = 'SELLER'::public."CaseMessageAuthorKind"),
    'STAFF', (SELECT pg_catalog.count(*) FROM public."CaseMessage"
      WHERE "authorKind" = 'STAFF'::public."CaseMessageAuthorKind"),
    'NULL', (SELECT pg_catalog.count(*) FROM public."CaseMessage"
      WHERE "authorKind" IS NULL)
  ) AS author_kind_counts
`;

function assertBoolean(value, expected, label) {
  if (value !== expected) {
    throw new Error(`Case/CaseMessage production posture drifted: ${label}`);
  }
}

export function assertCaseLegacyPosture(row) {
  if (
    !row
    || row.current_user !== REVIEWED_TARGET.ownerRole
    || row.database_name !== REVIEWED_TARGET.databaseName
    || row.case_owner !== REVIEWED_TARGET.ownerRole
    || row.message_owner !== REVIEWED_TARGET.ownerRole
    || row.attachment_owner !== REVIEWED_TARGET.ownerRole
  ) {
    throw new Error(
      "Case/CaseMessage production posture has the wrong identity or ownership",
    );
  }
  for (const [label, value, expected] of [
    ["owner BYPASSRLS", row.owner_bypass_rls, true],
    ["runtime BYPASSRLS", row.runtime_bypass_rls, false],
    ["runtime superuser", row.runtime_superuser, false],
    ["Case RLS", row.case_rls_enabled, false],
    ["Case FORCE", row.case_rls_forced, false],
    ["CaseMessage RLS", row.message_rls_enabled, false],
    ["CaseMessage FORCE", row.message_rls_forced, false],
    ["attachment RLS", row.attachment_rls_enabled, false],
    ["attachment FORCE", row.attachment_rls_forced, false],
    ["runtime Case CRUD", row.runtime_case_crud, true],
    ["runtime CaseMessage CRUD", row.runtime_message_crud, true],
    ["runtime attachment CRUD", row.runtime_attachment_crud, true],
    ["authorKind prepared", row.author_kind_prepared, true],
    ["attachment directUpload prepared", row.direct_upload_prepared, true],
    ["attachment compatibility key", row.object_key_prepared, true],
    ["message history index", row.history_index_present, true],
    ["DirectUpload RLS", row.direct_upload_rls_enabled, false],
    ["DirectUpload FORCE", row.direct_upload_rls_forced, false],
    ["DirectUploadReference RLS", row.reference_rls_enabled, true],
    ["DirectUploadReference FORCE", row.reference_rls_forced, true],
  ]) {
    assertBoolean(value, expected, label);
  }
  for (const [label, value] of [
    ["Case policy count", row.case_policy_count],
    ["CaseMessage policy count", row.message_policy_count],
    ["attachment policy count", row.attachment_policy_count],
    ["DirectUpload policy count", row.direct_upload_policy_count],
    ["DirectUploadReference policy count", row.reference_policy_count],
  ]) {
    if (Number(value) !== 0) {
      throw new Error(
        `Case/CaseMessage production posture drifted: ${label}`,
      );
    }
  }
  return Object.freeze({ accepted: true });
}

async function readPosture(client) {
  const result = await client.query(`
    SELECT
      CURRENT_USER AS current_user,
      pg_catalog.current_database() AS database_name,
      owner_role.rolbypassrls AS owner_bypass_rls,
      runtime_role.rolbypassrls AS runtime_bypass_rls,
      runtime_role.rolsuper AS runtime_superuser,
      case_owner.rolname AS case_owner,
      message_owner.rolname AS message_owner,
      attachment_owner.rolname AS attachment_owner,
      case_table.relrowsecurity AS case_rls_enabled,
      case_table.relforcerowsecurity AS case_rls_forced,
      message_table.relrowsecurity AS message_rls_enabled,
      message_table.relforcerowsecurity AS message_rls_forced,
      attachment_table.relrowsecurity AS attachment_rls_enabled,
      attachment_table.relforcerowsecurity AS attachment_rls_forced,
      direct_upload.relrowsecurity AS direct_upload_rls_enabled,
      direct_upload.relforcerowsecurity AS direct_upload_rls_forced,
      reference.relrowsecurity AS reference_rls_enabled,
      reference.relforcerowsecurity AS reference_rls_forced,
      (
        SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_policy
        WHERE polrelid = case_table.oid
      ) AS case_policy_count,
      (
        SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_policy
        WHERE polrelid = message_table.oid
      ) AS message_policy_count,
      (
        SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_policy
        WHERE polrelid = attachment_table.oid
      ) AS attachment_policy_count,
      (
        SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_policy
        WHERE polrelid = direct_upload.oid
      ) AS direct_upload_policy_count,
      (
        SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_policy
        WHERE polrelid = reference.oid
      ) AS reference_policy_count,
      pg_catalog.has_table_privilege(
        'grainline_app_runtime',
        'public."Case"',
        'SELECT,INSERT,UPDATE,DELETE'
      ) AS runtime_case_crud,
      pg_catalog.has_table_privilege(
        'grainline_app_runtime',
        'public."CaseMessage"',
        'SELECT,INSERT,UPDATE,DELETE'
      ) AS runtime_message_crud,
      pg_catalog.has_table_privilege(
        'grainline_app_runtime',
        'public."CaseMessageAttachment"',
        'SELECT,INSERT,UPDATE,DELETE'
      ) AS runtime_attachment_crud,
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute
        WHERE attrelid = message_table.oid
          AND attname = 'authorKind'
          AND attnum > 0
          AND NOT attisdropped
          AND NOT attnotnull
      ) AS author_kind_prepared,
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute
        WHERE attrelid = attachment_table.oid
          AND attname = 'directUploadId'
          AND attnum > 0
          AND NOT attisdropped
          AND attnotnull
      ) AS direct_upload_prepared,
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute
        WHERE attrelid = attachment_table.oid
          AND attname = 'objectKey'
          AND attnum > 0
          AND NOT attisdropped
          AND attnotnull
      ) AS object_key_prepared,
      pg_catalog.to_regclass(
        'public."CaseMessage_caseId_createdAt_id_idx"'
      ) IS NOT NULL AS history_index_present
    FROM pg_catalog.pg_class AS case_table
    JOIN pg_catalog.pg_namespace AS case_schema
      ON case_schema.oid = case_table.relnamespace
     AND case_schema.nspname = 'public'
    JOIN pg_catalog.pg_roles AS case_owner
      ON case_owner.oid = case_table.relowner
    JOIN pg_catalog.pg_class AS message_table
      ON message_table.relname = 'CaseMessage'
    JOIN pg_catalog.pg_namespace AS message_schema
      ON message_schema.oid = message_table.relnamespace
     AND message_schema.nspname = 'public'
    JOIN pg_catalog.pg_roles AS message_owner
      ON message_owner.oid = message_table.relowner
    JOIN pg_catalog.pg_class AS attachment_table
      ON attachment_table.relname = 'CaseMessageAttachment'
    JOIN pg_catalog.pg_namespace AS attachment_schema
      ON attachment_schema.oid = attachment_table.relnamespace
     AND attachment_schema.nspname = 'public'
    JOIN pg_catalog.pg_roles AS attachment_owner
      ON attachment_owner.oid = attachment_table.relowner
    JOIN pg_catalog.pg_class AS direct_upload
      ON direct_upload.relname = 'DirectUpload'
    JOIN pg_catalog.pg_namespace AS direct_upload_schema
      ON direct_upload_schema.oid = direct_upload.relnamespace
     AND direct_upload_schema.nspname = 'public'
    JOIN pg_catalog.pg_class AS reference
      ON reference.relname = 'DirectUploadReference'
    JOIN pg_catalog.pg_namespace AS reference_schema
      ON reference_schema.oid = reference.relnamespace
     AND reference_schema.nspname = 'public'
    JOIN pg_catalog.pg_roles AS owner_role
      ON owner_role.rolname = 'neondb_owner'
    JOIN pg_catalog.pg_roles AS runtime_role
      ON runtime_role.rolname = 'grainline_app_runtime'
    WHERE case_table.relname = 'Case'
      AND case_table.relkind = 'r'
      AND message_table.relkind = 'r'
      AND attachment_table.relkind = 'r'
      AND direct_upload.relkind = 'r'
      AND reference.relkind = 'r'
  `);
  if (result.rows.length !== 1) {
    throw new Error(
      "Case/CaseMessage production posture catalog is not exact",
    );
  }
  assertCaseLegacyPosture(result.rows[0]);
  return Object.freeze({ ...result.rows[0] });
}

async function assertReadOnlyTransaction(client) {
  const result = await client.query(
    "SELECT pg_catalog.current_setting('transaction_read_only') AS read_only",
  );
  if (result.rows[0]?.read_only !== "on") {
    throw new Error(
      "Case/CaseMessage legacy inspection transaction is not read-only",
    );
  }
}

export function writeCaseLegacyInspectionEvidence(pathname, evidence) {
  const descriptor = openSync(pathname, "wx", 0o600);
  try {
    writeFileSync(
      descriptor,
      `${JSON.stringify(evidence, null, 2)}\n`,
      "utf8",
    );
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(pathname, 0o600);
  if (
    !lstatSync(pathname).isFile()
    || (lstatSync(pathname).mode & 0o777) !== 0o600
  ) {
    throw new Error(
      "Case/CaseMessage legacy inspection evidence mode is not 0600",
    );
  }
}

async function main() {
  const config = parseCaseLegacyInspectionConfig(process.env);
  const git = assertCaseLegacyInspectionGitState(
    readCaseLegacyInspectionGitState(),
    config.releaseCommit,
  );
  const client = new Client(
    buildCaseLegacyInspectionClientOptions(config),
  );
  let posture;
  let inventory;
  try {
    await client.connect();
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    await assertReadOnlyTransaction(client);
    posture = await readPosture(client);
    const result = await client.query(CASE_LEGACY_COUNTS_SQL);
    if (result.rows.length !== 1) {
      throw new Error(
        "Case/CaseMessage legacy inspection aggregate row is not exact",
      );
    }
    inventory = normalizeCaseLegacyResult(result.rows[0]);
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }

  const evidence = Object.freeze({
    inventory,
    operation: "case-case-message-legacy-inspection",
    posture: Object.freeze({
      attachmentRlsEnabled: posture.attachment_rls_enabled,
      caseRlsEnabled: posture.case_rls_enabled,
      directUploadRlsEnabled: posture.direct_upload_rls_enabled,
      messageRlsEnabled: posture.message_rls_enabled,
      referenceRlsForced: posture.reference_rls_forced,
      runtimeBypassRls: posture.runtime_bypass_rls,
    }),
    schemaVersion: 1,
    source: Object.freeze({
      clean: git.clean,
      commit: git.head,
    }),
    target: Object.freeze({
      databaseName: config.identity.databaseName,
      directUrlSha256: config.directUrlSha256,
      endpointId: config.identity.endpointId,
      ownerRole: config.identity.username,
      region: config.identity.region,
      runtimeRole: REVIEWED_TARGET.runtimeRole,
    }),
  });
  writeCaseLegacyInspectionEvidence(config.evidencePath, evidence);
  process.stdout.write(
    `${JSON.stringify({
      attachmentCount: inventory.counts.attachmentCount,
      caseCount: inventory.counts.caseCount,
      caseMessageCount: inventory.counts.caseMessageCount,
      blockingAttachmentRowCount:
        inventory.counts.blockingAttachmentRowCount,
      blockingAttachmentClaimRowCount:
        inventory.counts.blockingAttachmentClaimRowCount,
      blockingAttachmentReferenceRowCount:
        inventory.counts.blockingAttachmentReferenceRowCount,
      blockingCaseRowCount:
        inventory.counts.blockingCaseRowCount,
      blockingMessageRowCount:
        inventory.counts.blockingMessageRowCount,
    })}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message =
      error instanceof Error
        ? error.message
        : "Case/CaseMessage legacy inspection failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
