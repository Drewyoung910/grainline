import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  DIRECT_UPLOAD_LEGACY_COUNT_FIELDS,
  DIRECT_UPLOAD_LEGACY_COUNTS_SQL,
  DIRECT_UPLOAD_LEGACY_INSPECTION_CONFIRMATION,
  DIRECT_UPLOAD_LEGACY_PREREQUISITE_CONFIRMATION,
  assertDirectUploadLegacyInspectionGitState,
  normalizeDirectUploadLegacyCounts,
  normalizeDirectUploadLegacyResult,
  parseDirectUploadLegacyInspectionConfig,
  writeDirectUploadLegacyInspectionEvidence,
} from "../scripts/direct-upload-legacy-inspect.mjs";

const DIRECT_URL =
  "postgresql://neondb_owner:secret@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const COMMIT = "e".repeat(40);
const RUNNER_TEMP = "/private/tmp/direct-upload-legacy-inspection-test";
const PUBLIC_BASE = "https://cdn.example.com/media/";

function configEnv(overrides = {}) {
  return {
    CLOUDFLARE_R2_PUBLIC_URL: PUBLIC_BASE,
    DIRECT_URL,
    DIRECT_UPLOAD_LEGACY_INSPECT_CONFIRM:
      DIRECT_UPLOAD_LEGACY_INSPECTION_CONFIRMATION,
    DIRECT_UPLOAD_LEGACY_INSPECT_EVIDENCE_PATH:
      `${RUNNER_TEMP}/direct-upload-legacy-inspection-${COMMIT}.json`,
    DIRECT_UPLOAD_LEGACY_INSPECT_RELEASE_COMMIT: COMMIT,
    DIRECT_UPLOAD_LEGACY_PREREQUISITES_CONFIRMED:
      DIRECT_UPLOAD_LEGACY_PREREQUISITE_CONFIRMATION,
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: COMMIT,
    MIGRATION_DB_ROLE: "neondb_owner",
    PRODUCTION_MIGRATION_DIRECT_URL_SHA256:
      createHash("sha256").update(DIRECT_URL).digest("hex"),
    RUNTIME_DB_ROLE: "grainline_app_runtime",
    RUNNER_TEMP,
    ...overrides,
  };
}

describe("DirectUpload aggregate-only legacy inspection", () => {
  it("requires exact main dispatch, prerequisite, owner target, and reviewed public base", () => {
    const config = parseDirectUploadLegacyInspectionConfig(configEnv());
    assert.equal(config.mode, "inspect");
    assert.equal(config.firstPartyBaseUrl, "https://cdn.example.com/media");
    assert.equal(
      config.firstPartyBaseUrlSha256,
      createHash("sha256")
        .update("https://cdn.example.com/media")
        .digest("hex"),
    );
    for (const drift of [
      { GITHUB_REF: "refs/heads/feature" },
      { GITHUB_EVENT_NAME: "push" },
      { GITHUB_SHA: "f".repeat(40) },
      { DIRECT_UPLOAD_LEGACY_INSPECT_CONFIRM: "yes" },
      { DIRECT_UPLOAD_LEGACY_PREREQUISITES_CONFIRMED: "pending" },
      { PRODUCTION_MIGRATION_DIRECT_URL_SHA256: "0".repeat(64) },
      { DATABASE_URL: "present" },
      { GRANT_AUDIT_DATABASE_URL: "present" },
      { CLOUDFLARE_R2_PUBLIC_URL: "http://cdn.example.com" },
      { CLOUDFLARE_R2_PUBLIC_URL: "https://user:pass@cdn.example.com" },
      { CLOUDFLARE_R2_PUBLIC_URL: "https://cdn.example.com?scope=wide" },
    ]) {
      assert.throws(() =>
        parseDirectUploadLegacyInspectionConfig(configEnv(drift)));
    }
  });

  it("rejects pooler and non-owner targets", () => {
    const poolerUrl = DIRECT_URL.replace(".westus3", "-pooler.westus3");
    assert.throws(
      () => parseDirectUploadLegacyInspectionConfig(configEnv({
        DIRECT_URL: poolerUrl,
        PRODUCTION_MIGRATION_DIRECT_URL_SHA256:
          createHash("sha256").update(poolerUrl).digest("hex"),
      })),
      /not the reviewed direct production owner target/,
    );
    assert.throws(
      () => parseDirectUploadLegacyInspectionConfig(configEnv({
        MIGRATION_DB_ROLE: "grainline_app_runtime",
      })),
      /not the reviewed direct production owner target/,
    );
  });

  it("requires the exact clean dispatched checkout", () => {
    assert.deepEqual(
      assertDirectUploadLegacyInspectionGitState(
        { head: COMMIT, status: "" },
        COMMIT,
      ),
      { head: COMMIT, clean: true },
    );
    assert.throws(
      () => assertDirectUploadLegacyInspectionGitState(
        { head: COMMIT, status: "?? unexpected.sql" },
        COMMIT,
      ),
      /exact clean dispatched commit/,
    );
  });

  it("normalizes the exact aggregate schema and rejects malformed results", () => {
    const row = Object.fromEntries(
      DIRECT_UPLOAD_LEGACY_COUNT_FIELDS.map(
        (field, index) => [field, String(index)],
      ),
    );
    const counts = normalizeDirectUploadLegacyCounts(row);
    assert.equal(
      Object.keys(counts).length,
      DIRECT_UPLOAD_LEGACY_COUNT_FIELDS.length,
    );
    assert.equal(counts.directUploadCount, 0);
    assert.equal(
      counts.unrepairableLifecycleRowCount,
      DIRECT_UPLOAD_LEGACY_COUNT_FIELDS.length - 1,
    );
    assert.throws(
      () => normalizeDirectUploadLegacyCounts({
        ...row,
        direct_upload_count: "NaN",
      }),
      /invalid aggregate counts/,
    );
    assert.throws(
      () => normalizeDirectUploadLegacyCounts({
        ...row,
        accidental_object_key: "private",
      }),
      /unexpected aggregate schema/,
    );
    const { direct_upload_count: _removed, ...missing } = row;
    assert.throws(
      () => normalizeDirectUploadLegacyCounts(missing),
      /unexpected aggregate schema/,
    );
    const result = normalizeDirectUploadLegacyResult({
      ...row,
      endpoint_counts: {
        listingImage: 1,
        messageImage: 0,
        messageFile: 0,
        messageAny: 0,
        caseEvidenceImage: 0,
        messagePrivateImage: 0,
        reviewPhoto: 0,
        listingVideo: 0,
        bannerImage: 0,
        galleryImage: 0,
        blogImage: 0,
        UNKNOWN: 0,
      },
      storage_class_counts: { PUBLIC: 1, PRIVATE: 0, UNKNOWN: 0 },
      status_counts: {
        PRESIGNED: 0,
        VERIFIED: 1,
        CLAIMED: 0,
        DELETING: 0,
        DELETED: 0,
        DELETE_FAILED: 0,
        UNKNOWN: 0,
      },
      content_type_counts: {
        "image/jpeg": 0,
        "image/png": 0,
        "image/webp": 1,
        "application/pdf": 0,
        "video/mp4": 0,
        "video/quicktime": 0,
        UNKNOWN: 0,
      },
      claim_type_counts: {
        UNCLAIMED: 1,
        LISTING_PHOTO: 0,
        LISTING_VIDEO: 0,
        SELLER_PROFILE_BANNER: 0,
        SELLER_PROFILE_AVATAR: 0,
        SELLER_PROFILE_WORKSHOP: 0,
        SELLER_PROFILE_GALLERY: 0,
        REVIEW_PHOTO: 0,
        BLOG_POST_COVER: 0,
        COMMISSION_REFERENCE: 0,
        SELLER_BROADCAST_IMAGE: 0,
        LEGACY_MESSAGE_ATTACHMENT: 0,
        CASE_MESSAGE_ATTACHMENT: 0,
        MESSAGE_ATTACHMENT: 0,
        UNKNOWN: 0,
      },
      durable_provider_counts: {
        "LISTING_PHOTO:FIRST_PARTY": 1,
      },
    });
    assert.equal(result.distributions.endpoints.listingImage, 1);
    assert.equal(
      result.distributions.durableProviders[
        "LISTING_PHOTO:FIRST_PARTY"
      ],
      1,
    );
    assert.throws(
      () => normalizeDirectUploadLegacyResult({
        ...row,
        endpoint_counts: {},
      }),
      /unexpected result schema|unexpected distribution schema/,
    );
  });

  it("uses one repeatable-read aggregate transaction and covers every documented family", () => {
    const source = fs.readFileSync(
      "scripts/direct-upload-legacy-inspect.mjs",
      "utf8",
    );
    assert.match(
      source,
      /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/,
    );
    assert.doesNotMatch(
      source,
      /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO|FROM|public\.)/i,
    );
    assert.match(DIRECT_UPLOAD_LEGACY_COUNTS_SQL, /durable_source_roots/);
    assert.match(DIRECT_UPLOAD_LEGACY_COUNTS_SQL, /durable_sources_raw/);
    for (const family of [
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
    ]) {
      assert.match(DIRECT_UPLOAD_LEGACY_COUNTS_SQL, new RegExp(family));
    }
    assert.match(DIRECT_UPLOAD_LEGACY_COUNTS_SQL, /https:\/\/utfs\.io/);
    assert.match(DIRECT_UPLOAD_LEGACY_COUNTS_SQL, /first_party_untracked_source_url_count/);
    assert.match(DIRECT_UPLOAD_LEGACY_COUNTS_SQL, /case_attachment_metadata_mismatch_count/);
    assert.match(DIRECT_UPLOAD_LEGACY_COUNTS_SQL, /stale_deleting_lease_count/);
    assert.match(DIRECT_UPLOAD_LEGACY_COUNTS_SQL, /unrepairable_lifecycle_row_count/);
    assert.match(DIRECT_UPLOAD_LEGACY_COUNTS_SQL, /endpoint_counts/);
    assert.match(DIRECT_UPLOAD_LEGACY_COUNTS_SQL, /durable_provider_counts/);
  });

  it("writes aggregate-only evidence once as a private regular file", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "direct-upload-legacy-evidence-"),
    );
    try {
      const evidencePath = path.join(directory, "evidence.json");
      writeDirectUploadLegacyInspectionEvidence(evidencePath, {
        status: "passed",
        counts: { directUploadCount: 0 },
        retained: {
          rawRows: false,
          identifiers: false,
          keys: false,
          urls: false,
          credentials: false,
        },
      });
      const stat = fs.lstatSync(evidencePath);
      assert.equal(stat.isFile(), true);
      assert.equal(stat.isSymbolicLink(), false);
      assert.equal(stat.mode & 0o077, 0);
      assert.throws(
        () => writeDirectUploadLegacyInspectionEvidence(
          evidencePath,
          { status: "passed" },
        ),
        /EEXIST/,
      );
      assert.throws(
        () => writeDirectUploadLegacyInspectionEvidence(
          path.join(directory, "unsafe.json"),
          { url: "https://private.example/object" },
        ),
        /sensitive-shaped data/,
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("pins a protected serialized workflow and disposable SQL execution", () => {
    const workflow = fs.readFileSync(
      ".github/workflows/direct-upload-legacy-inspection.yml",
      "utf8",
    );
    assert.match(workflow, /^\s*workflow_dispatch:/m);
    assert.match(workflow, /^\s+environment: Production$/m);
    assert.match(workflow, /group: production-database-migrations/);
    assert.match(workflow, /cancel-in-progress: false/);
    assert.match(workflow, /secrets\.PRODUCTION_MIGRATION_DIRECT_URL/);
    assert.match(workflow, /vars\.PRODUCTION_MIGRATION_DIRECT_URL_SHA256/);
    assert.match(workflow, /vars\.CLOUDFLARE_R2_PUBLIC_URL/);
    assert.doesNotMatch(workflow, /secrets\.(?:DIRECT_URL|DATABASE_URL)\b/);
    assert.match(workflow, /upload-artifact@v4/);
    assert.match(workflow, /retention-days: 30/);
    const proof = fs.readFileSync(
      "scripts/direct-upload-authority-postgres-proof.mjs",
      "utf8",
    );
    assert.match(proof, /DIRECT_UPLOAD_LEGACY_COUNTS_SQL/);
    assert.match(proof, /aggregate_only_legacy_query/);
    const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
    assert.equal(
      packageJson.scripts?.["ops:direct-upload-legacy-inspect"],
      "node scripts/direct-upload-legacy-inspect.mjs",
    );
  });
});
