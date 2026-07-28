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
import { parseGuardedNeonDatabaseIdentity } from "./guard-saved-search-rls-deploy.mjs";
import {
  assertDeterministicPostgresEnvironment,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";

const { Client } = pg;

export const DIRECT_UPLOAD_LEGACY_INSPECTION_CONFIRMATION =
  "inspect-prelaunch-direct-upload-legacy-state";
export const DIRECT_UPLOAD_LEGACY_PREREQUISITE_CONFIRMATION =
  "compatible-app-drained-private-surfaces-disabled";

const REVIEWED_TARGET = Object.freeze({
  endpointId: "ep-plain-river-aaqg8gj4",
  databaseName: "neondb",
  region: "westus3.azure",
  ownerRole: "neondb_owner",
  runtimeRole: "grainline_app_runtime",
});
const REVIEWED_MAIN_REF = "refs/heads/main";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function required(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${name} is required without surrounding whitespace`);
  }
  return value;
}

function reviewedFirstPartyBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("CLOUDFLARE_R2_PUBLIC_URL is not a valid reviewed URL");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("CLOUDFLARE_R2_PUBLIC_URL is not a credential-free HTTPS base URL");
  }
  const normalizedPath = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${normalizedPath}`;
}

export function parseDirectUploadLegacyInspectionConfig(env = process.env) {
  assertDeterministicPostgresEnvironment(env, "DirectUpload legacy inspection");
  if (
    env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_REF !== REVIEWED_MAIN_REF
  ) {
    throw new Error("DirectUpload legacy inspection requires a manual main-branch GitHub Actions dispatch");
  }
  const releaseCommit = required(
    env,
    "DIRECT_UPLOAD_LEGACY_INSPECT_RELEASE_COMMIT",
  );
  const githubCommit = required(env, "GITHUB_SHA");
  if (!COMMIT_PATTERN.test(releaseCommit) || releaseCommit !== githubCommit) {
    throw new Error("DirectUpload legacy inspection commit must match the dispatched main commit");
  }
  if (
    env.DIRECT_UPLOAD_LEGACY_INSPECT_CONFIRM
      !== DIRECT_UPLOAD_LEGACY_INSPECTION_CONFIRMATION
  ) {
    throw new Error("DirectUpload legacy inspection confirmation is not exact");
  }
  if (
    env.DIRECT_UPLOAD_LEGACY_PREREQUISITES_CONFIRMED
      !== DIRECT_UPLOAD_LEGACY_PREREQUISITE_CONFIRMATION
  ) {
    throw new Error("DirectUpload legacy inspection prerequisites are not explicitly confirmed");
  }
  if (Object.hasOwn(env, "DATABASE_URL") || Object.hasOwn(env, "GRANT_AUDIT_DATABASE_URL")) {
    throw new Error("runtime and grant-audit URLs must remain absent from the owner-only inspection job");
  }

  const directUrl = required(env, "DIRECT_URL");
  const expectedDigest = required(
    env,
    "PRODUCTION_MIGRATION_DIRECT_URL_SHA256",
  );
  const directUrlSha256 = createHash("sha256")
    .update(directUrl, "utf8")
    .digest("hex");
  if (!SHA256_PATTERN.test(expectedDigest) || expectedDigest !== directUrlSha256) {
    throw new Error("DIRECT_URL does not match the protected Production digest");
  }
  const migrationRole = required(env, "MIGRATION_DB_ROLE");
  const runtimeRole = required(env, "RUNTIME_DB_ROLE");
  const identity = parseGuardedNeonDatabaseIdentity(directUrl, "DIRECT_URL");
  if (
    identity.isPooler
    || identity.endpointId !== REVIEWED_TARGET.endpointId
    || identity.databaseName !== REVIEWED_TARGET.databaseName
    || identity.region !== REVIEWED_TARGET.region
    || identity.username !== REVIEWED_TARGET.ownerRole
    || migrationRole !== REVIEWED_TARGET.ownerRole
    || runtimeRole !== REVIEWED_TARGET.runtimeRole
  ) {
    throw new Error("DIRECT_URL is not the reviewed direct production owner target");
  }

  const firstPartyBaseUrl = reviewedFirstPartyBaseUrl(
    required(env, "CLOUDFLARE_R2_PUBLIC_URL"),
  );
  const firstPartyBaseUrlSha256 = createHash("sha256")
    .update(firstPartyBaseUrl, "utf8")
    .digest("hex");
  const runnerTemp = path.resolve(required(env, "RUNNER_TEMP"));
  const evidencePath = path.resolve(
    required(env, "DIRECT_UPLOAD_LEGACY_INSPECT_EVIDENCE_PATH"),
  );
  const expectedPath = path.join(
    runnerTemp,
    `direct-upload-legacy-inspection-${releaseCommit}.json`,
  );
  if (evidencePath !== expectedPath || existsSync(evidencePath)) {
    throw new Error("DirectUpload legacy inspection evidence path is not the fresh reviewed runner path");
  }

  return Object.freeze({
    mode: "inspect",
    directUrl,
    directUrlSha256,
    evidencePath,
    firstPartyBaseUrl,
    firstPartyBaseUrlSha256,
    identity,
    releaseCommit,
  });
}

export function readDirectUploadLegacyInspectionGitState(
  cwd = process.cwd(),
) {
  const run = (args) => execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return Object.freeze({
    head: run(["rev-parse", "HEAD"]),
    status: run(["status", "--porcelain=v1", "--untracked-files=all"]),
  });
}

export function assertDirectUploadLegacyInspectionGitState(
  state,
  releaseCommit,
) {
  if (state?.head !== releaseCommit || state.status !== "") {
    throw new Error("DirectUpload legacy inspection checkout is not the exact clean dispatched commit");
  }
  return Object.freeze({ head: state.head, clean: true });
}

export const DIRECT_UPLOAD_LEGACY_COUNT_FIELDS = Object.freeze([
  "direct_upload_count",
  "direct_upload_reference_count",
  "active_reference_count",
  "released_reference_count",
  "missing_user_count",
  "invalid_endpoint_count",
  "invalid_storage_class_count",
  "invalid_status_count",
  "invalid_key_endpoint_count",
  "invalid_public_url_storage_count",
  "invalid_content_size_count",
  "state_timestamp_coherence_count",
  "cleanup_lease_pair_mismatch_count",
  "claim_pair_mismatch_count",
  "unknown_claim_type_count",
  "dangling_claim_source_count",
  "cleanup_eligible_count",
  "stale_deleting_lease_count",
  "invalid_reference_source_type_count",
  "active_reference_source_missing_count",
  "active_reference_owner_mismatch_count",
  "active_reference_exclusivity_mismatch_count",
  "active_public_reference_url_mismatch_count",
  "private_multi_active_reference_upload_count",
  "claimed_zero_active_reference_upload_count",
  "public_multi_active_reference_upload_count",
  "durable_source_url_count",
  "first_party_durable_source_url_count",
  "first_party_untracked_source_url_count",
  "first_party_backfillable_source_url_count",
  "legacy_utfs_durable_source_url_count",
  "legacy_utfs_untracked_source_url_count",
  "unknown_external_durable_source_url_count",
  "case_attachment_count",
  "case_attachment_key_id_mismatch_count",
  "case_attachment_metadata_mismatch_count",
  "case_attachment_missing_active_reference_count",
  "case_attachment_duplicate_active_reference_count",
  "listing_video_upload_count",
  "message_file_upload_count",
  "message_any_upload_count",
  "message_private_image_upload_count",
  "unrepairable_lifecycle_row_count",
]);

const DISTRIBUTION_FIELDS = Object.freeze([
  "endpoint_counts",
  "storage_class_counts",
  "status_counts",
  "content_type_counts",
  "claim_type_counts",
  "durable_provider_counts",
]);
const DISTRIBUTION_KEYS = Object.freeze({
  endpoint_counts: Object.freeze([
    "listingImage",
    "messageImage",
    "messageFile",
    "messageAny",
    "caseEvidenceImage",
    "messagePrivateImage",
    "reviewPhoto",
    "listingVideo",
    "bannerImage",
    "galleryImage",
    "blogImage",
    "UNKNOWN",
  ]),
  storage_class_counts: Object.freeze(["PUBLIC", "PRIVATE", "UNKNOWN"]),
  status_counts: Object.freeze([
    "PRESIGNED",
    "VERIFIED",
    "CLAIMED",
    "DELETING",
    "DELETED",
    "DELETE_FAILED",
    "UNKNOWN",
  ]),
  content_type_counts: Object.freeze([
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
    "video/mp4",
    "video/quicktime",
    "UNKNOWN",
  ]),
  claim_type_counts: Object.freeze([
    "UNCLAIMED",
    "LISTING_PHOTO",
    "LISTING_VIDEO",
    "SELLER_PROFILE_BANNER",
    "SELLER_PROFILE_AVATAR",
    "SELLER_PROFILE_WORKSHOP",
    "SELLER_PROFILE_GALLERY",
    "REVIEW_PHOTO",
    "BLOG_POST_COVER",
    "COMMISSION_REFERENCE",
    "SELLER_BROADCAST_IMAGE",
    "LEGACY_MESSAGE_ATTACHMENT",
    "CASE_MESSAGE_ATTACHMENT",
    "MESSAGE_ATTACHMENT",
    "UNKNOWN",
  ]),
});

export function normalizeDirectUploadLegacyCounts(row) {
  const rowFields = row && typeof row === "object"
    ? Object.keys(row).sort()
    : [];
  const expectedFields = [...DIRECT_UPLOAD_LEGACY_COUNT_FIELDS].sort();
  if (
    rowFields.length !== expectedFields.length
    || rowFields.some((field, index) => field !== expectedFields[index])
  ) {
    throw new TypeError("DirectUpload legacy inspection returned an unexpected aggregate schema");
  }
  const normalized = {};
  for (const field of DIRECT_UPLOAD_LEGACY_COUNT_FIELDS) {
    const value = Number(row[field]);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError("DirectUpload legacy inspection returned invalid aggregate counts");
    }
    normalized[
      field.replaceAll("_", " ").replace(/ (\w)/g, (_, letter) => letter.toUpperCase())
    ] = value;
  }
  return Object.freeze(normalized);
}

function normalizeFixedDistribution(value, field) {
  const expectedKeys = DISTRIBUTION_KEYS[field];
  const actualKeys = value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];
  const sortedExpected = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpected.length
    || actualKeys.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new TypeError("DirectUpload legacy inspection returned an unexpected distribution schema");
  }
  const normalized = {};
  for (const key of expectedKeys) {
    const count = Number(value[key]);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new TypeError("DirectUpload legacy inspection returned invalid distribution counts");
    }
    normalized[key] = count;
  }
  return Object.freeze(normalized);
}

function normalizeProviderDistribution(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("DirectUpload legacy inspection returned an unexpected provider distribution");
  }
  const sourceTypes = [
    "LISTING_PHOTO",
    "LISTING_VIDEO",
    "SELLER_PROFILE_BANNER",
    "SELLER_PROFILE_AVATAR",
    "SELLER_PROFILE_WORKSHOP",
    "SELLER_PROFILE_GALLERY",
    "REVIEW_PHOTO",
    "BLOG_POST_COVER",
    "COMMISSION_REFERENCE",
    "SELLER_BROADCAST_IMAGE",
    "LEGACY_MESSAGE_ATTACHMENT",
  ];
  const providers = [
    "FIRST_PARTY",
    "UTFS_IO",
    "UFS_SH",
    "UTFS_TENANT",
    "UNKNOWN_EXTERNAL",
  ];
  const allowedKeys = new Set(
    sourceTypes.flatMap(
      (sourceType) => providers.map(
        (provider) => `${sourceType}:${provider}`,
      ),
    ),
  );
  const normalized = {};
  for (const [key, rawCount] of Object.entries(value)) {
    const count = Number(rawCount);
    if (
      !allowedKeys.has(key)
      || !Number.isSafeInteger(count)
      || count < 0
    ) {
      throw new TypeError("DirectUpload legacy inspection returned invalid provider counts");
    }
    normalized[key] = count;
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(normalized).sort(([left], [right]) =>
        left.localeCompare(right)),
    ),
  );
}

export function normalizeDirectUploadLegacyResult(row) {
  const expectedFields = [
    ...DIRECT_UPLOAD_LEGACY_COUNT_FIELDS,
    ...DISTRIBUTION_FIELDS,
  ].sort();
  const actualFields = row && typeof row === "object"
    ? Object.keys(row).sort()
    : [];
  if (
    actualFields.length !== expectedFields.length
    || actualFields.some((field, index) => field !== expectedFields[index])
  ) {
    throw new TypeError("DirectUpload legacy inspection returned an unexpected result schema");
  }
  const countRow = Object.fromEntries(
    DIRECT_UPLOAD_LEGACY_COUNT_FIELDS.map(
      (field) => [field, row[field]],
    ),
  );
  return Object.freeze({
    counts: normalizeDirectUploadLegacyCounts(countRow),
    distributions: Object.freeze({
      endpoints: normalizeFixedDistribution(
        row.endpoint_counts,
        "endpoint_counts",
      ),
      storageClasses: normalizeFixedDistribution(
        row.storage_class_counts,
        "storage_class_counts",
      ),
      statuses: normalizeFixedDistribution(
        row.status_counts,
        "status_counts",
      ),
      contentTypes: normalizeFixedDistribution(
        row.content_type_counts,
        "content_type_counts",
      ),
      claimTypes: normalizeFixedDistribution(
        row.claim_type_counts,
        "claim_type_counts",
      ),
      durableProviders: normalizeProviderDistribution(
        row.durable_provider_counts,
      ),
    }),
  });
}

async function readPosture(client) {
  const result = await client.query(`
    SELECT
      CURRENT_USER AS current_user_name,
      pg_catalog.current_database() AS database_name,
      owner_role.rolbypassrls AS owner_bypass_rls,
      runtime_role.rolbypassrls AS runtime_bypass_rls,
      runtime_role.rolsuper AS runtime_superuser,
      direct_upload.relrowsecurity AS direct_upload_rls_enabled,
      direct_upload.relforcerowsecurity AS direct_upload_rls_forced,
      direct_upload_owner.rolname AS direct_upload_owner,
      (
        SELECT pg_catalog.count(*)::integer
        FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = direct_upload.oid
      ) AS direct_upload_policy_count,
      pg_catalog.has_table_privilege(
        'grainline_app_runtime',
        direct_upload.oid,
        'SELECT,INSERT,UPDATE,DELETE'
      ) AS runtime_direct_upload_crud,
      reference.relrowsecurity AS reference_rls_enabled,
      reference.relforcerowsecurity AS reference_rls_forced,
      reference_owner.rolname AS reference_owner,
      (
        SELECT pg_catalog.count(*)::integer
        FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = reference.oid
      ) AS reference_policy_count,
      pg_catalog.has_table_privilege(
        'grainline_app_runtime',
        reference.oid,
        'SELECT,INSERT,UPDATE,DELETE'
      ) AS runtime_reference_crud,
      (
        SELECT pg_catalog.count(*)::integer
        FROM pg_catalog.pg_constraint AS constraint_state
        WHERE constraint_state.conrelid = direct_upload.oid
          AND constraint_state.conname = ANY(ARRAY[
            'DirectUpload_userId_fkey',
            'DirectUpload_endpoint_check',
            'DirectUpload_key_endpoint_check',
            'DirectUpload_public_url_key_check',
            'DirectUpload_endpoint_storage_content_size_check',
            'DirectUpload_cleanup_lease_pair_check'
          ]::text[])
          AND NOT constraint_state.convalidated
      ) AS reviewed_unvalidated_constraint_count,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid =
                'public."CaseMessageAttachment"'::pg_catalog.regclass
          AND attribute.attname = 'objectKey'
          AND attribute.attnotnull
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
      ) AS case_object_key_present,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid =
                'public."CaseMessageAttachment"'::pg_catalog.regclass
          AND attribute.attname = 'directUploadId'
          AND attribute.attnotnull
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
      ) AS case_direct_upload_id_present
    FROM pg_catalog.pg_class AS direct_upload
    JOIN pg_catalog.pg_namespace AS direct_upload_schema
      ON direct_upload_schema.oid = direct_upload.relnamespace
    JOIN pg_catalog.pg_roles AS direct_upload_owner
      ON direct_upload_owner.oid = direct_upload.relowner
    JOIN pg_catalog.pg_class AS reference
      ON reference.relname = 'DirectUploadReference'
    JOIN pg_catalog.pg_namespace AS reference_schema
      ON reference_schema.oid = reference.relnamespace
     AND reference_schema.nspname = 'public'
    JOIN pg_catalog.pg_roles AS reference_owner
      ON reference_owner.oid = reference.relowner
    JOIN pg_catalog.pg_roles AS owner_role
      ON owner_role.rolname = 'neondb_owner'
    JOIN pg_catalog.pg_roles AS runtime_role
      ON runtime_role.rolname = 'grainline_app_runtime'
    WHERE direct_upload_schema.nspname = 'public'
      AND direct_upload.relname = 'DirectUpload'
      AND direct_upload.relkind = 'r'
      AND reference.relkind = 'r'
  `);
  const row = result.rows[0];
  if (
    result.rows.length !== 1
    || row.current_user_name !== REVIEWED_TARGET.ownerRole
    || row.database_name !== REVIEWED_TARGET.databaseName
    || row.owner_bypass_rls !== true
    || row.runtime_bypass_rls !== false
    || row.runtime_superuser !== false
    || row.direct_upload_owner !== REVIEWED_TARGET.ownerRole
    || row.direct_upload_rls_enabled !== false
    || row.direct_upload_rls_forced !== false
    || Number(row.direct_upload_policy_count) !== 0
    || row.runtime_direct_upload_crud !== true
    || row.reference_owner !== REVIEWED_TARGET.ownerRole
    || row.reference_rls_enabled !== true
    || row.reference_rls_forced !== true
    || Number(row.reference_policy_count) !== 0
    || row.runtime_reference_crud !== false
    || Number(row.reviewed_unvalidated_constraint_count) !== 6
    || row.case_object_key_present !== true
    || row.case_direct_upload_id_present !== true
  ) {
    throw new Error("DirectUpload database posture is not the reviewed drained compatible state");
  }
  return Object.freeze({
    currentUser: row.current_user_name,
    databaseName: row.database_name,
    directUploadOwner: row.direct_upload_owner,
    directUploadRlsEnabled: false,
    directUploadRlsForced: false,
    directUploadPolicyCount: 0,
    legacyRuntimeCrudRetained: true,
    referenceOwner: row.reference_owner,
    referenceRlsEnabled: true,
    referenceRlsForced: true,
    referencePolicyCount: 0,
    referenceRuntimeCrud: false,
    reviewedUnvalidatedConstraintCount: 6,
    caseDualColumnCompatibilityPresent: true,
  });
}

export const DIRECT_UPLOAD_LEGACY_COUNTS_SQL = `
  WITH durable_source_roots AS MATERIALIZED (
    SELECT 'LISTING_PHOTO'::text AS source_type,
           listing.id::text AS source_id,
           seller."userId"::text AS owner_id
      FROM public."Listing" AS listing
      JOIN public."SellerProfile" AS seller ON seller.id = listing."sellerId"
    UNION ALL
    SELECT 'LISTING_VIDEO', listing.id, seller."userId"
      FROM public."Listing" AS listing
      JOIN public."SellerProfile" AS seller ON seller.id = listing."sellerId"
    UNION ALL
    SELECT source_type.value, seller.id, seller."userId"
      FROM public."SellerProfile" AS seller
      CROSS JOIN pg_catalog.unnest(ARRAY[
        'SELLER_PROFILE_BANNER',
        'SELLER_PROFILE_AVATAR',
        'SELLER_PROFILE_WORKSHOP',
        'SELLER_PROFILE_GALLERY'
      ]::text[]) AS source_type(value)
    UNION ALL
    SELECT 'REVIEW_PHOTO', review.id, review."reviewerId"
      FROM public."Review" AS review
    UNION ALL
    SELECT 'BLOG_POST_COVER', post.id, post."authorId"
      FROM public."BlogPost" AS post
    UNION ALL
    SELECT 'COMMISSION_REFERENCE', request.id, request."buyerId"
      FROM public."CommissionRequest" AS request
    UNION ALL
    SELECT 'SELLER_BROADCAST_IMAGE', broadcast.id, seller."userId"
      FROM public."SellerBroadcast" AS broadcast
      JOIN public."SellerProfile" AS seller
        ON seller.id = broadcast."sellerProfileId"
    UNION ALL
    SELECT 'LEGACY_MESSAGE_ATTACHMENT', message.id, message."senderId"
      FROM public."Message" AS message
     WHERE public.grainline_direct_upload_message_url_core(
             message.kind,
             message.body
           ) IS NOT NULL
    UNION ALL
    SELECT 'CASE_MESSAGE_ATTACHMENT', attachment.id, attachment."uploaderId"
      FROM public."CaseMessageAttachment" AS attachment
  ), durable_sources_raw AS MATERIALIZED (
    SELECT 'LISTING_PHOTO'::text AS source_type,
           listing.id::text AS source_id,
           seller."userId"::text AS owner_id,
           photo.url::text AS url,
           ARRAY['listingImage']::text[] AS allowed_endpoints
      FROM public."Photo" AS photo
      JOIN public."Listing" AS listing ON listing.id = photo."listingId"
      JOIN public."SellerProfile" AS seller ON seller.id = listing."sellerId"
    UNION ALL
    SELECT 'LISTING_PHOTO', listing.id, seller."userId",
           photo."originalUrl", ARRAY['listingImage']::text[]
      FROM public."Photo" AS photo
      JOIN public."Listing" AS listing ON listing.id = photo."listingId"
      JOIN public."SellerProfile" AS seller ON seller.id = listing."sellerId"
    UNION ALL
    SELECT 'LISTING_VIDEO', listing.id, seller."userId",
           listing."videoUrl", ARRAY['listingVideo']::text[]
      FROM public."Listing" AS listing
      JOIN public."SellerProfile" AS seller ON seller.id = listing."sellerId"
    UNION ALL
    SELECT 'SELLER_PROFILE_BANNER', seller.id, seller."userId",
           seller."bannerImageUrl", ARRAY['bannerImage']::text[]
      FROM public."SellerProfile" AS seller
    UNION ALL
    SELECT 'SELLER_PROFILE_AVATAR', seller.id, seller."userId",
           seller."avatarImageUrl", ARRAY['galleryImage']::text[]
      FROM public."SellerProfile" AS seller
    UNION ALL
    SELECT 'SELLER_PROFILE_WORKSHOP', seller.id, seller."userId",
           seller."workshopImageUrl", ARRAY['galleryImage']::text[]
      FROM public."SellerProfile" AS seller
    UNION ALL
    SELECT 'SELLER_PROFILE_GALLERY', seller.id, seller."userId",
           gallery.url, ARRAY['galleryImage']::text[]
      FROM public."SellerProfile" AS seller
      CROSS JOIN LATERAL pg_catalog.unnest(
        COALESCE(seller."galleryImageUrls", ARRAY[]::text[])
      ) AS gallery(url)
    UNION ALL
    SELECT 'REVIEW_PHOTO', review.id, review."reviewerId",
           photo.url, ARRAY['reviewPhoto']::text[]
      FROM public."ReviewPhoto" AS photo
      JOIN public."Review" AS review ON review.id = photo."reviewId"
    UNION ALL
    SELECT 'BLOG_POST_COVER', post.id, post."authorId",
           post."coverImageUrl", ARRAY['galleryImage', 'blogImage']::text[]
      FROM public."BlogPost" AS post
    UNION ALL
    SELECT 'COMMISSION_REFERENCE', request.id, request."buyerId",
           image.url, ARRAY['messageImage']::text[]
      FROM public."CommissionRequest" AS request
      CROSS JOIN LATERAL pg_catalog.unnest(
        COALESCE(request."referenceImageUrls", ARRAY[]::text[])
      ) AS image(url)
    UNION ALL
    SELECT 'SELLER_BROADCAST_IMAGE', broadcast.id, seller."userId",
           broadcast."imageUrl",
           ARRAY['listingImage', 'bannerImage', 'galleryImage']::text[]
      FROM public."SellerBroadcast" AS broadcast
      JOIN public."SellerProfile" AS seller
        ON seller.id = broadcast."sellerProfileId"
    UNION ALL
    SELECT 'LEGACY_MESSAGE_ATTACHMENT', message.id, message."senderId",
           public.grainline_direct_upload_message_url_core(
             message.kind,
             message.body
           ),
           ARRAY['messageImage', 'messageFile', 'messageAny']::text[]
      FROM public."Message" AS message
  ), durable_sources AS MATERIALIZED (
    SELECT DISTINCT
      source_type,
      source_id,
      owner_id,
      pg_catalog.btrim(url) AS url,
      allowed_endpoints
    FROM durable_sources_raw
    WHERE url IS NOT NULL
      AND pg_catalog.btrim(url) <> ''
      AND pg_catalog.char_length(pg_catalog.btrim(url)) <= 2048
  ), active_reference_counts AS MATERIALIZED (
    SELECT reference."directUploadId" AS direct_upload_id,
           pg_catalog.count(*)::integer AS active_count
      FROM public."DirectUploadReference" AS reference
     WHERE reference."releasedAt" IS NULL
     GROUP BY reference."directUploadId"
  ), classified_durable_sources AS MATERIALIZED (
    SELECT
      source.*,
      (
        source.url = $1
        OR source.url LIKE $1 || '/%'
      ) AS first_party,
      (
        source.url LIKE 'https://utfs.io/%'
        OR source.url LIKE 'https://ufs.sh/%'
        OR source.url LIKE 'https://qu5gyczaki.ufs.sh/%'
      ) AS legacy_utfs,
      COALESCE(match.match_count, 0)::integer AS match_count,
      COALESCE(match.unreferenced_match_count, 0)::integer
        AS unreferenced_match_count
    FROM durable_sources AS source
    LEFT JOIN LATERAL (
      SELECT
        pg_catalog.count(*)::integer AS match_count,
        pg_catalog.count(*) FILTER (
          WHERE NOT EXISTS (
            SELECT 1
            FROM public."DirectUploadReference" AS reference
            WHERE reference."directUploadId" = upload.id
              AND reference."sourceType" = source.source_type
              AND reference."sourceId" = source.source_id
              AND reference."releasedAt" IS NULL
          )
        )::integer AS unreferenced_match_count
      FROM public."DirectUpload" AS upload
      WHERE upload."userId" = source.owner_id
        AND upload."storageClass" = 'PUBLIC'
        AND upload.endpoint = ANY(source.allowed_endpoints)
        AND upload."publicUrl" = source.url
        AND upload.status IN ('VERIFIED', 'CLAIMED')
    ) AS match ON true
  )
  SELECT
    (SELECT pg_catalog.count(*) FROM public."DirectUpload")
      AS direct_upload_count,
    (SELECT pg_catalog.count(*) FROM public."DirectUploadReference")
      AS direct_upload_reference_count,
    (SELECT pg_catalog.count(*) FROM public."DirectUploadReference"
      WHERE "releasedAt" IS NULL) AS active_reference_count,
    (SELECT pg_catalog.count(*) FROM public."DirectUploadReference"
      WHERE "releasedAt" IS NOT NULL) AS released_reference_count,
    (SELECT pg_catalog.count(*)
       FROM public."DirectUpload" AS upload
       LEFT JOIN public."User" AS owner ON owner.id = upload."userId"
      WHERE owner.id IS NULL) AS missing_user_count,
    (SELECT pg_catalog.count(*) FROM public."DirectUpload"
      WHERE endpoint NOT IN (
        'listingImage', 'messageImage', 'messageFile', 'messageAny',
        'caseEvidenceImage', 'messagePrivateImage', 'reviewPhoto',
        'listingVideo', 'bannerImage', 'galleryImage', 'blogImage'
      )) AS invalid_endpoint_count,
    (SELECT pg_catalog.count(*) FROM public."DirectUpload"
      WHERE "storageClass" NOT IN ('PUBLIC', 'PRIVATE'))
      AS invalid_storage_class_count,
    (SELECT pg_catalog.count(*) FROM public."DirectUpload"
      WHERE status NOT IN (
        'PRESIGNED', 'VERIFIED', 'CLAIMED',
        'DELETING', 'DELETED', 'DELETE_FAILED'
      )) AS invalid_status_count,
    (SELECT pg_catalog.count(*) FROM public."DirectUpload"
      WHERE key NOT LIKE endpoint || '/%'
         OR position('..' IN key) > 0
         OR key ~ '[[:cntrl:]]') AS invalid_key_endpoint_count,
    (SELECT pg_catalog.count(*) FROM public."DirectUpload"
      WHERE ("storageClass" = 'PRIVATE' AND "publicUrl" IS NOT NULL)
         OR ("storageClass" = 'PUBLIC' AND (
           "publicUrl" IS NULL
           OR "publicUrl" NOT LIKE 'https://%'
           OR pg_catalog.right(
                "publicUrl",
                pg_catalog.char_length(key) + 1
              ) IS DISTINCT FROM '/' || key
         ))) AS invalid_public_url_storage_count,
    (SELECT pg_catalog.count(*) FROM public."DirectUpload"
      WHERE "expectedSize" <= 0
         OR NOT (
           (
             "storageClass" = 'PUBLIC'
             AND endpoint IN (
               'listingImage', 'messageImage', 'messageAny', 'reviewPhoto',
               'bannerImage', 'galleryImage', 'blogImage'
             )
             AND "contentType" IN ('image/jpeg', 'image/png', 'image/webp')
             AND "expectedSize" <= CASE endpoint
               WHEN 'listingImage' THEN 12582912
               WHEN 'bannerImage' THEN 15728640
               ELSE 8388608
             END
           )
           OR (
             "storageClass" = 'PUBLIC'
             AND endpoint = 'listingVideo'
             AND "contentType" IN ('video/mp4', 'video/quicktime')
             AND "expectedSize" <= 134217728
           )
           OR (
             "storageClass" = 'PUBLIC'
             AND endpoint IN ('messageFile', 'messageAny')
             AND "contentType" = 'application/pdf'
             AND "expectedSize" <= 8388608
           )
           OR (
             "storageClass" = 'PRIVATE'
             AND endpoint IN ('caseEvidenceImage', 'messagePrivateImage')
             AND "contentType" IN ('image/jpeg', 'image/png', 'image/webp')
             AND "expectedSize" <= 8388608
           )
         )) AS invalid_content_size_count,
    (SELECT pg_catalog.count(*) FROM public."DirectUpload"
      WHERE "createdAt" > "updatedAt"
         OR (status IN ('VERIFIED', 'CLAIMED') AND "verifiedAt" IS NULL)
         OR (status = 'CLAIMED' AND "claimedAt" IS NULL)
         OR (status <> 'CLAIMED' AND (
           "claimedAt" IS NOT NULL
           OR "claimedByType" IS NOT NULL
           OR "claimedById" IS NOT NULL
         ))
         OR (status = 'DELETED' AND "deletedAt" IS NULL)
         OR (status <> 'DELETED' AND "deletedAt" IS NOT NULL)
         OR attempts < 0) AS state_timestamp_coherence_count,
    (SELECT pg_catalog.count(*) FROM public."DirectUpload"
      WHERE ("cleanupLeaseId" IS NULL) <> ("cleanupLeaseAt" IS NULL))
      AS cleanup_lease_pair_mismatch_count,
    (SELECT pg_catalog.count(*) FROM public."DirectUpload"
      WHERE ("claimedByType" IS NULL) <> ("claimedById" IS NULL))
      AS claim_pair_mismatch_count,
    (SELECT pg_catalog.count(*) FROM public."DirectUpload"
      WHERE "claimedByType" IS NOT NULL
        AND "claimedByType" NOT IN (
          'LISTING_PHOTO', 'LISTING_VIDEO', 'SELLER_PROFILE_BANNER',
          'SELLER_PROFILE_AVATAR', 'SELLER_PROFILE_WORKSHOP',
          'SELLER_PROFILE_GALLERY', 'REVIEW_PHOTO', 'BLOG_POST_COVER',
          'COMMISSION_REFERENCE', 'SELLER_BROADCAST_IMAGE',
          'LEGACY_MESSAGE_ATTACHMENT', 'CASE_MESSAGE_ATTACHMENT',
          'MESSAGE_ATTACHMENT'
        )) AS unknown_claim_type_count,
    (SELECT pg_catalog.count(*)
       FROM public."DirectUpload" AS upload
       LEFT JOIN durable_source_roots AS source
         ON source.source_type = upload."claimedByType"
        AND source.source_id = upload."claimedById"
      WHERE upload."claimedByType" IS NOT NULL
        AND upload."claimedById" IS NOT NULL
        AND upload."claimedByType" IN (
          'LISTING_PHOTO', 'LISTING_VIDEO', 'SELLER_PROFILE_BANNER',
          'SELLER_PROFILE_AVATAR', 'SELLER_PROFILE_WORKSHOP',
          'SELLER_PROFILE_GALLERY', 'REVIEW_PHOTO', 'BLOG_POST_COVER',
          'COMMISSION_REFERENCE', 'SELLER_BROADCAST_IMAGE',
          'LEGACY_MESSAGE_ATTACHMENT', 'CASE_MESSAGE_ATTACHMENT'
        )
        AND source.source_id IS NULL) AS dangling_claim_source_count,
    (SELECT pg_catalog.count(*) FROM public."DirectUpload" AS upload
      WHERE upload.status IN (
        'PRESIGNED', 'VERIFIED', 'DELETING', 'DELETE_FAILED'
      )
        AND upload."cleanupAfter" <= CURRENT_TIMESTAMP
        AND NOT EXISTS (
          SELECT 1 FROM public."DirectUploadReference" AS reference
          WHERE reference."directUploadId" = upload.id
            AND reference."releasedAt" IS NULL
        )) AS cleanup_eligible_count,
    (SELECT pg_catalog.count(*) FROM public."DirectUpload"
      WHERE status = 'DELETING'
        AND "cleanupAfter" <= CURRENT_TIMESTAMP)
      AS stale_deleting_lease_count,
    (SELECT pg_catalog.count(*) FROM public."DirectUploadReference"
      WHERE "sourceType" NOT IN (
        'LISTING_PHOTO', 'LISTING_VIDEO', 'SELLER_PROFILE_BANNER',
        'SELLER_PROFILE_AVATAR', 'SELLER_PROFILE_WORKSHOP',
        'SELLER_PROFILE_GALLERY', 'REVIEW_PHOTO', 'BLOG_POST_COVER',
        'COMMISSION_REFERENCE', 'SELLER_BROADCAST_IMAGE',
        'LEGACY_MESSAGE_ATTACHMENT', 'CASE_MESSAGE_ATTACHMENT',
        'MESSAGE_ATTACHMENT'
      )) AS invalid_reference_source_type_count,
    (SELECT pg_catalog.count(*)
       FROM public."DirectUploadReference" AS reference
       LEFT JOIN durable_source_roots AS source
         ON source.source_type = reference."sourceType"
        AND source.source_id = reference."sourceId"
      WHERE reference."releasedAt" IS NULL
        AND source.source_id IS NULL)
      AS active_reference_source_missing_count,
    (SELECT pg_catalog.count(*)
       FROM public."DirectUploadReference" AS reference
       JOIN public."DirectUpload" AS upload
         ON upload.id = reference."directUploadId"
       JOIN durable_source_roots AS source
         ON source.source_type = reference."sourceType"
        AND source.source_id = reference."sourceId"
      WHERE reference."releasedAt" IS NULL
        AND upload."userId" IS DISTINCT FROM source.owner_id)
      AS active_reference_owner_mismatch_count,
    (SELECT pg_catalog.count(*)
       FROM public."DirectUploadReference" AS reference
       JOIN public."DirectUpload" AS upload
         ON upload.id = reference."directUploadId"
      WHERE reference."releasedAt" IS NULL
        AND reference.exclusive IS DISTINCT FROM (
          upload."storageClass" = 'PRIVATE'
        )) AS active_reference_exclusivity_mismatch_count,
    (SELECT pg_catalog.count(*)
       FROM public."DirectUploadReference" AS reference
       JOIN public."DirectUpload" AS upload
         ON upload.id = reference."directUploadId"
      WHERE reference."releasedAt" IS NULL
        AND upload."storageClass" = 'PUBLIC'
        AND NOT EXISTS (
          SELECT 1
          FROM durable_sources AS source
          WHERE source.source_type = reference."sourceType"
            AND source.source_id = reference."sourceId"
            AND source.owner_id = upload."userId"
            AND source.url = upload."publicUrl"
            AND upload.endpoint = ANY(source.allowed_endpoints)
        )) AS active_public_reference_url_mismatch_count,
    (SELECT pg_catalog.count(*)
       FROM (
         SELECT reference."directUploadId"
         FROM public."DirectUploadReference" AS reference
         JOIN public."DirectUpload" AS upload
           ON upload.id = reference."directUploadId"
         WHERE reference."releasedAt" IS NULL
           AND upload."storageClass" = 'PRIVATE'
         GROUP BY reference."directUploadId"
         HAVING pg_catalog.count(*) > 1
       ) AS duplicate_private) AS private_multi_active_reference_upload_count,
    (SELECT pg_catalog.count(*)
       FROM public."DirectUpload" AS upload
       LEFT JOIN active_reference_counts AS reference
         ON reference.direct_upload_id = upload.id
      WHERE upload.status = 'CLAIMED'
        AND COALESCE(reference.active_count, 0) = 0)
      AS claimed_zero_active_reference_upload_count,
    (SELECT pg_catalog.count(*)
       FROM active_reference_counts AS reference
       JOIN public."DirectUpload" AS upload
         ON upload.id = reference.direct_upload_id
      WHERE upload."storageClass" = 'PUBLIC'
        AND reference.active_count > 1)
      AS public_multi_active_reference_upload_count,
    (SELECT pg_catalog.count(*) FROM durable_sources)
      AS durable_source_url_count,
    (SELECT pg_catalog.count(*) FROM classified_durable_sources
      WHERE first_party) AS first_party_durable_source_url_count,
    (SELECT pg_catalog.count(*) FROM classified_durable_sources
      WHERE first_party AND match_count = 0)
      AS first_party_untracked_source_url_count,
    (SELECT pg_catalog.count(*) FROM classified_durable_sources
      WHERE first_party AND unreferenced_match_count > 0)
      AS first_party_backfillable_source_url_count,
    (SELECT pg_catalog.count(*) FROM classified_durable_sources
      WHERE legacy_utfs) AS legacy_utfs_durable_source_url_count,
    (SELECT pg_catalog.count(*) FROM classified_durable_sources
      WHERE legacy_utfs AND match_count = 0)
      AS legacy_utfs_untracked_source_url_count,
    (SELECT pg_catalog.count(*) FROM classified_durable_sources
      WHERE NOT first_party AND NOT legacy_utfs)
      AS unknown_external_durable_source_url_count,
    (SELECT pg_catalog.count(*) FROM public."CaseMessageAttachment")
      AS case_attachment_count,
    (SELECT pg_catalog.count(*)
       FROM public."CaseMessageAttachment" AS attachment
       LEFT JOIN public."DirectUpload" AS upload
         ON upload.id = attachment."directUploadId"
      WHERE upload.id IS NULL
         OR attachment."objectKey" IS DISTINCT FROM upload.key)
      AS case_attachment_key_id_mismatch_count,
    (SELECT pg_catalog.count(*)
       FROM public."CaseMessageAttachment" AS attachment
       LEFT JOIN public."DirectUpload" AS upload
         ON upload.id = attachment."directUploadId"
       LEFT JOIN public."CaseMessage" AS message
         ON message.id = attachment."caseMessageId"
       LEFT JOIN public."Case" AS case_row
         ON case_row.id = message."caseId"
      WHERE upload.id IS NULL
         OR message.id IS NULL
         OR case_row.id IS NULL
         OR attachment."uploaderId" IS DISTINCT FROM message."authorId"
         OR attachment."uploaderId" NOT IN (
           case_row."buyerId",
           case_row."sellerId"
         )
         OR upload."userId" IS DISTINCT FROM attachment."uploaderId"
         OR upload.endpoint IS DISTINCT FROM 'caseEvidenceImage'
         OR upload."storageClass" IS DISTINCT FROM 'PRIVATE'
         OR upload."publicUrl" IS NOT NULL
         OR upload."contentType" IS DISTINCT FROM attachment."contentType"
         OR upload."expectedSize" IS DISTINCT FROM attachment."byteSize"
         OR upload.status NOT IN ('VERIFIED', 'CLAIMED'))
      AS case_attachment_metadata_mismatch_count,
    (SELECT pg_catalog.count(*)
       FROM public."CaseMessageAttachment" AS attachment
      WHERE NOT EXISTS (
        SELECT 1
        FROM public."DirectUploadReference" AS reference
        WHERE reference."directUploadId" = attachment."directUploadId"
          AND reference."sourceType" = 'CASE_MESSAGE_ATTACHMENT'
          AND reference."sourceId" = attachment.id
          AND reference."releasedAt" IS NULL
      )) AS case_attachment_missing_active_reference_count,
    (SELECT pg_catalog.count(*)
       FROM (
         SELECT attachment.id
         FROM public."CaseMessageAttachment" AS attachment
         JOIN public."DirectUploadReference" AS reference
           ON reference."directUploadId" = attachment."directUploadId"
          AND reference."sourceType" = 'CASE_MESSAGE_ATTACHMENT'
          AND reference."sourceId" = attachment.id
          AND reference."releasedAt" IS NULL
         GROUP BY attachment.id
         HAVING pg_catalog.count(*) > 1
       ) AS duplicate_case_reference)
      AS case_attachment_duplicate_active_reference_count,
    (SELECT pg_catalog.count(*) FROM public."DirectUpload"
      WHERE endpoint = 'listingVideo') AS listing_video_upload_count,
    (SELECT pg_catalog.count(*) FROM public."DirectUpload"
      WHERE endpoint = 'messageFile') AS message_file_upload_count,
    (SELECT pg_catalog.count(*) FROM public."DirectUpload"
      WHERE endpoint = 'messageAny') AS message_any_upload_count,
    (SELECT pg_catalog.count(*) FROM public."DirectUpload"
      WHERE endpoint = 'messagePrivateImage')
      AS message_private_image_upload_count,
    (SELECT pg_catalog.count(*)
       FROM public."DirectUpload" AS upload
       LEFT JOIN public."User" AS owner ON owner.id = upload."userId"
      WHERE owner.id IS NULL
         OR upload.endpoint NOT IN (
           'listingImage', 'messageImage', 'messageFile', 'messageAny',
           'caseEvidenceImage', 'messagePrivateImage', 'reviewPhoto',
           'listingVideo', 'bannerImage', 'galleryImage', 'blogImage'
         )
         OR upload."storageClass" NOT IN ('PUBLIC', 'PRIVATE')
         OR upload.status NOT IN (
           'PRESIGNED', 'VERIFIED', 'CLAIMED',
           'DELETING', 'DELETED', 'DELETE_FAILED'
         )
         OR upload.key NOT LIKE upload.endpoint || '/%'
         OR position('..' IN upload.key) > 0
         OR upload.key ~ '[[:cntrl:]]')
      AS unrepairable_lifecycle_row_count,
    (SELECT pg_catalog.jsonb_build_object(
       'listingImage', pg_catalog.count(*) FILTER (WHERE endpoint = 'listingImage'),
       'messageImage', pg_catalog.count(*) FILTER (WHERE endpoint = 'messageImage'),
       'messageFile', pg_catalog.count(*) FILTER (WHERE endpoint = 'messageFile'),
       'messageAny', pg_catalog.count(*) FILTER (WHERE endpoint = 'messageAny'),
       'caseEvidenceImage', pg_catalog.count(*) FILTER (WHERE endpoint = 'caseEvidenceImage'),
       'messagePrivateImage', pg_catalog.count(*) FILTER (WHERE endpoint = 'messagePrivateImage'),
       'reviewPhoto', pg_catalog.count(*) FILTER (WHERE endpoint = 'reviewPhoto'),
       'listingVideo', pg_catalog.count(*) FILTER (WHERE endpoint = 'listingVideo'),
       'bannerImage', pg_catalog.count(*) FILTER (WHERE endpoint = 'bannerImage'),
       'galleryImage', pg_catalog.count(*) FILTER (WHERE endpoint = 'galleryImage'),
       'blogImage', pg_catalog.count(*) FILTER (WHERE endpoint = 'blogImage'),
       'UNKNOWN', pg_catalog.count(*) FILTER (WHERE endpoint NOT IN (
         'listingImage', 'messageImage', 'messageFile', 'messageAny',
         'caseEvidenceImage', 'messagePrivateImage', 'reviewPhoto',
         'listingVideo', 'bannerImage', 'galleryImage', 'blogImage'
       ))
     ) FROM public."DirectUpload") AS endpoint_counts,
    (SELECT pg_catalog.jsonb_build_object(
       'PUBLIC', pg_catalog.count(*) FILTER (WHERE "storageClass" = 'PUBLIC'),
       'PRIVATE', pg_catalog.count(*) FILTER (WHERE "storageClass" = 'PRIVATE'),
       'UNKNOWN', pg_catalog.count(*) FILTER (
         WHERE "storageClass" NOT IN ('PUBLIC', 'PRIVATE')
       )
     ) FROM public."DirectUpload") AS storage_class_counts,
    (SELECT pg_catalog.jsonb_build_object(
       'PRESIGNED', pg_catalog.count(*) FILTER (WHERE status = 'PRESIGNED'),
       'VERIFIED', pg_catalog.count(*) FILTER (WHERE status = 'VERIFIED'),
       'CLAIMED', pg_catalog.count(*) FILTER (WHERE status = 'CLAIMED'),
       'DELETING', pg_catalog.count(*) FILTER (WHERE status = 'DELETING'),
       'DELETED', pg_catalog.count(*) FILTER (WHERE status = 'DELETED'),
       'DELETE_FAILED', pg_catalog.count(*) FILTER (WHERE status = 'DELETE_FAILED'),
       'UNKNOWN', pg_catalog.count(*) FILTER (WHERE status NOT IN (
         'PRESIGNED', 'VERIFIED', 'CLAIMED',
         'DELETING', 'DELETED', 'DELETE_FAILED'
       ))
     ) FROM public."DirectUpload") AS status_counts,
    (SELECT pg_catalog.jsonb_build_object(
       'image/jpeg', pg_catalog.count(*) FILTER (WHERE "contentType" = 'image/jpeg'),
       'image/png', pg_catalog.count(*) FILTER (WHERE "contentType" = 'image/png'),
       'image/webp', pg_catalog.count(*) FILTER (WHERE "contentType" = 'image/webp'),
       'application/pdf', pg_catalog.count(*) FILTER (WHERE "contentType" = 'application/pdf'),
       'video/mp4', pg_catalog.count(*) FILTER (WHERE "contentType" = 'video/mp4'),
       'video/quicktime', pg_catalog.count(*) FILTER (WHERE "contentType" = 'video/quicktime'),
       'UNKNOWN', pg_catalog.count(*) FILTER (WHERE "contentType" NOT IN (
         'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
         'video/mp4', 'video/quicktime'
       ))
     ) FROM public."DirectUpload") AS content_type_counts,
    (SELECT pg_catalog.jsonb_build_object(
       'UNCLAIMED', pg_catalog.count(*) FILTER (WHERE "claimedByType" IS NULL),
       'LISTING_PHOTO', pg_catalog.count(*) FILTER (WHERE "claimedByType" = 'LISTING_PHOTO'),
       'LISTING_VIDEO', pg_catalog.count(*) FILTER (WHERE "claimedByType" = 'LISTING_VIDEO'),
       'SELLER_PROFILE_BANNER', pg_catalog.count(*) FILTER (WHERE "claimedByType" = 'SELLER_PROFILE_BANNER'),
       'SELLER_PROFILE_AVATAR', pg_catalog.count(*) FILTER (WHERE "claimedByType" = 'SELLER_PROFILE_AVATAR'),
       'SELLER_PROFILE_WORKSHOP', pg_catalog.count(*) FILTER (WHERE "claimedByType" = 'SELLER_PROFILE_WORKSHOP'),
       'SELLER_PROFILE_GALLERY', pg_catalog.count(*) FILTER (WHERE "claimedByType" = 'SELLER_PROFILE_GALLERY'),
       'REVIEW_PHOTO', pg_catalog.count(*) FILTER (WHERE "claimedByType" = 'REVIEW_PHOTO'),
       'BLOG_POST_COVER', pg_catalog.count(*) FILTER (WHERE "claimedByType" = 'BLOG_POST_COVER'),
       'COMMISSION_REFERENCE', pg_catalog.count(*) FILTER (WHERE "claimedByType" = 'COMMISSION_REFERENCE'),
       'SELLER_BROADCAST_IMAGE', pg_catalog.count(*) FILTER (WHERE "claimedByType" = 'SELLER_BROADCAST_IMAGE'),
       'LEGACY_MESSAGE_ATTACHMENT', pg_catalog.count(*) FILTER (WHERE "claimedByType" = 'LEGACY_MESSAGE_ATTACHMENT'),
       'CASE_MESSAGE_ATTACHMENT', pg_catalog.count(*) FILTER (WHERE "claimedByType" = 'CASE_MESSAGE_ATTACHMENT'),
       'MESSAGE_ATTACHMENT', pg_catalog.count(*) FILTER (WHERE "claimedByType" = 'MESSAGE_ATTACHMENT'),
       'UNKNOWN', pg_catalog.count(*) FILTER (
         WHERE "claimedByType" IS NOT NULL
           AND "claimedByType" NOT IN (
             'LISTING_PHOTO', 'LISTING_VIDEO', 'SELLER_PROFILE_BANNER',
             'SELLER_PROFILE_AVATAR', 'SELLER_PROFILE_WORKSHOP',
             'SELLER_PROFILE_GALLERY', 'REVIEW_PHOTO', 'BLOG_POST_COVER',
             'COMMISSION_REFERENCE', 'SELLER_BROADCAST_IMAGE',
             'LEGACY_MESSAGE_ATTACHMENT', 'CASE_MESSAGE_ATTACHMENT',
             'MESSAGE_ATTACHMENT'
           )
       )
     ) FROM public."DirectUpload") AS claim_type_counts,
    (SELECT COALESCE(
       pg_catalog.jsonb_object_agg(
         provider_counts.group_key,
         provider_counts.row_count
       ),
       '{}'::jsonb
     )
     FROM (
       SELECT
         source.source_type || ':' ||
           CASE
             WHEN source.first_party THEN 'FIRST_PARTY'
             WHEN source.url LIKE 'https://utfs.io/%' THEN 'UTFS_IO'
             WHEN source.url LIKE 'https://qu5gyczaki.ufs.sh/%' THEN 'UTFS_TENANT'
             WHEN source.url LIKE 'https://ufs.sh/%' THEN 'UFS_SH'
             ELSE 'UNKNOWN_EXTERNAL'
           END AS group_key,
         pg_catalog.count(*) AS row_count
       FROM classified_durable_sources AS source
       GROUP BY 1
       ORDER BY 1
     ) AS provider_counts) AS durable_provider_counts
`;

async function readCounts(client, firstPartyBaseUrl) {
  const result = await client.query(
    DIRECT_UPLOAD_LEGACY_COUNTS_SQL,
    [firstPartyBaseUrl],
  );
  return normalizeDirectUploadLegacyResult(result.rows[0]);
}

export async function runDirectUploadLegacyInspection(config) {
  const parsedUrl = new URL(config.directUrl);
  const client = new Client({
    connectionString: config.directUrl,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 90_000,
    query_timeout: 95_000,
    application_name: "grainline-direct-upload-legacy-inspection",
    ...postgresChannelBindingClientOptions(parsedUrl),
  });
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    transactionOpen = true;
    const posture = await readPosture(client);
    const inventory = await readCounts(client, config.firstPartyBaseUrl);
    await client.query("ROLLBACK");
    transactionOpen = false;
    return Object.freeze({
      mode: config.mode,
      releaseCommit: config.releaseCommit,
      directUrlSha256: config.directUrlSha256,
      firstPartyBaseUrlSha256: config.firstPartyBaseUrlSha256,
      posture,
      counts: inventory.counts,
      distributions: inventory.distributions,
      transaction: Object.freeze({
        isolation: "repeatable read",
        readOnly: true,
      }),
      retained: Object.freeze({
        rawRows: false,
        identifiers: false,
        keys: false,
        urls: false,
        messageBodies: false,
        credentials: false,
      }),
    });
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

export function writeDirectUploadLegacyInspectionEvidence(filePath, evidence) {
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (
    /postgres(?:ql)?:\/\/|DIRECT_URL|"(?:key|url|body|email|userId|sourceId)"\s*:/i
      .test(serialized)
  ) {
    throw new Error("DirectUpload legacy inspection evidence contains sensitive-shaped data");
  }
  const handle = openSync(filePath, "wx", 0o600);
  try {
    writeFileSync(handle, serialized, "utf8");
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  chmodSync(filePath, 0o600);
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error("DirectUpload legacy inspection evidence is not a private regular file");
  }
}

async function main() {
  try {
    const config = parseDirectUploadLegacyInspectionConfig(process.env);
    const git = assertDirectUploadLegacyInspectionGitState(
      readDirectUploadLegacyInspectionGitState(),
      config.releaseCommit,
    );
    const result = await runDirectUploadLegacyInspection(config);
    const evidence = Object.freeze({
      generatedAt: new Date().toISOString(),
      status: "passed",
      git,
      ...result,
    });
    writeDirectUploadLegacyInspectionEvidence(config.evidencePath, evidence);
    process.stdout.write(`${JSON.stringify({
      status: evidence.status,
      releaseCommit: evidence.releaseCommit,
      posture: evidence.posture,
      counts: evidence.counts,
      distributions: evidence.distributions,
      transaction: evidence.transaction,
      retained: evidence.retained,
      evidenceWritten: true,
    })}\n`);
  } catch {
    process.stderr.write("DirectUpload legacy inspection failed closed.\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
