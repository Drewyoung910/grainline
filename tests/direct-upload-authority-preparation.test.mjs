import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

const migrationPath =
  "prisma/migrations/20260726185000_prepare_direct_upload_authority/migration.sql";

const runtimeFunctions = [
  "grainline_direct_upload_record_processed_public",
  "grainline_direct_upload_record_presigned_public",
  "grainline_direct_upload_record_private_case",
  "grainline_direct_upload_record_private_message",
  "grainline_direct_upload_verify_public",
  "grainline_direct_upload_owned_lookup",
  "grainline_direct_upload_reference_case_attachment",
  "grainline_direct_upload_case_attachment_read",
  "grainline_direct_upload_cleanup_lease",
  "grainline_direct_upload_cleanup_complete",
  "grainline_direct_upload_cleanup_fail",
  "grainline_direct_upload_export",
  "grainline_direct_upload_account_public_urls",
  "grainline_direct_upload_release_for_account",
];

describe("DirectUpload fixed-authority preparation", () => {
  it("keeps preparation compatible while checking both table postures", () => {
    const migration = source(migrationPath);

    assert.match(migration, /\bBEGIN;/);
    assert.match(migration, /\bCOMMIT;/);
    assert.match(
      migration,
      /DirectUpload must retain pre-activation RLS posture during preparation/,
    );
    assert.match(
      migration,
      /DirectUpload preparation requires old-application CRUD compatibility/,
    );
    assert.match(
      migration,
      /DirectUploadReference must remain runtime table-inaccessible/,
    );
    assert.doesNotMatch(
      migration,
      /ALTER TABLE public\."DirectUpload" (?:ENABLE|FORCE) ROW LEVEL SECURITY/,
    );
    assert.doesNotMatch(
      migration,
      /REVOKE ALL ON TABLE public\."DirectUpload"/,
    );
  });

  it("derives UTC clocks and lifecycle ids inside private database cores", () => {
    const migration = source(migrationPath);

    assert.match(
      migration,
      /grainline_direct_upload_utc_now\(\)[\s\S]*pg_catalog\.timezone\(\s*'UTC',\s*pg_catalog\.clock_timestamp\(\)/,
    );
    assert.match(migration, /pg_catalog\.gen_random_uuid\(\)::text/);
    assert.match(
      migration,
      /recorded_at := public\.grainline_direct_upload_utc_now\(\)/,
    );
    assert.match(
      migration,
      /recorded_at \+ CASE p_status[\s\S]*interval '2 hours'[\s\S]*interval '24 hours'/,
    );
    assert.doesNotMatch(
      migration,
      /p_(?:now|created_at|verified_at|cleanup_after)/i,
    );
  });

  it("validates actor, endpoint, storage, and exact private parent scope", () => {
    const migration = source(migrationPath);

    assert.match(migration, /grainline_direct_upload_actor_valid/);
    assert.match(migration, /actor\.banned = false/);
    assert.match(migration, /actor\."deletedAt" IS NULL/);
    assert.match(
      migration,
      /p_endpoint = 'caseEvidenceImage'[\s\S]*split_part\(p_key, '\/', 3\) <> p_context_id/,
    );
    assert.match(
      migration,
      /p_user_id IN \(case_record\."buyerId", case_record\."sellerId"\)/,
    );
    assert.match(
      migration,
      /p_endpoint = 'messagePrivateImage'[\s\S]*public\."Conversation"/,
    );
    assert.match(
      migration,
      /seller upload requires a seller profile/,
    );
    assert.match(
      migration,
      /regexp_replace\(\s*actor\."clerkId",\s*'\[\^A-Za-z0-9_-\]',\s*'_',\s*'g'/,
    );
    assert.match(
      migration,
      /split_part\(p_key, '\/', 2\) IS DISTINCT FROM actor_key_segment/,
    );
    assert.match(
      migration,
      /split_part\(p_key, '\/', 1\) IS DISTINCT FROM p_endpoint/,
    );
  });

  it("keeps caller-selected reference identity behind an ungranted core", () => {
    const migration = source(migrationPath);

    assert.match(migration, /grainline_direct_upload_reference_core/);
    assert.match(
      migration,
      /REVOKE ALL ON FUNCTION\s+public\.grainline_direct_upload_reference_core\(text, text, text\)\s+FROM PUBLIC, grainline_app_runtime;/,
    );
    assert.match(
      migration,
      /grainline_direct_upload_reference_case_attachment[\s\S]*attachment\."directUploadId"[\s\S]*message\."authorId"[\s\S]*case_row\."buyerId"[\s\S]*case_row\."sellerId"/,
    );
    assert.match(
      migration,
      /candidate\.upload_user_id IS DISTINCT FROM p_user_id/,
    );
    assert.match(
      migration,
      /candidate\.endpoint IS DISTINCT FROM 'caseEvidenceImage'/,
    );
    assert.match(
      migration,
      /FOR UPDATE OF attachment, message, case_row, upload/,
    );
    assert.match(
      migration,
      /p_user_id IS DISTINCT FROM candidate\."buyerId"[\s\S]*p_user_id IS DISTINCT FROM candidate\."sellerId"/,
    );
    assert.match(migration, /p_storage_class IS NULL/);
    assert.match(migration, /p_status IS NULL/);
    assert.doesNotMatch(
      migration,
      /candidate\.(?:"uploaderId"|"authorId"|upload_user_id|endpoint|"storageClass"|upload_content_type|"expectedSize")\s*<>/,
    );
    assert.match(
      migration,
      /'CASE_MESSAGE_ATTACHMENT',\s*p_attachment_id/,
    );
    assert.match(
      migration,
      /grainline_direct_upload_case_attachment_reference_trigger[\s\S]*TG_OP = 'INSERT'[\s\S]*grainline_direct_upload_reference_case_attachment[\s\S]*TG_OP = 'DELETE'[\s\S]*grainline_direct_upload_release_core/,
    );
    assert.match(
      migration,
      /CREATE CONSTRAINT TRIGGER[\s\S]*AFTER INSERT ON public\."CaseMessageAttachment"[\s\S]*DEFERRABLE INITIALLY DEFERRED[\s\S]*BEFORE DELETE ON public\."CaseMessageAttachment"/,
    );
    assert.match(
      migration,
      /grainline_direct_upload_case_attachment_reference_backfill[\s\S]*ORDER BY row\.id/,
    );
  });

  it("fences cleanup completion and failure by an exact database lease", () => {
    const migration = source(migrationPath);

    assert.match(
      migration,
      /grainline_direct_upload_cleanup_lease[\s\S]*FOR UPDATE OF upload SKIP LOCKED/,
    );
    assert.match(
      migration,
      /NOT EXISTS \([\s\S]*DirectUploadReference[\s\S]*"releasedAt" IS NULL/,
    );
    assert.match(
      migration,
      /"cleanupLeaseId" = pg_catalog\.gen_random_uuid\(\)::text/,
    );
    for (const functionName of [
      "grainline_direct_upload_cleanup_complete",
      "grainline_direct_upload_cleanup_fail",
    ]) {
      const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${functionName}`);
      const end = migration.indexOf("\nCREATE OR REPLACE FUNCTION", start + 1);
      const block = migration.slice(start, end < 0 ? undefined : end);
      assert.match(block, /upload\.status = 'DELETING'/);
      assert.match(block, /upload\."cleanupLeaseId" = p_lease_id/);
    }
  });

  it("exports a sanitized projection and schedules public account media cleanup", () => {
    const migration = source(migrationPath);
    const exportStart = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.grainline_direct_upload_export",
    );
    const exportEnd = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.grainline_direct_upload_account_public_urls",
      exportStart,
    );
    const exportBlock = migration.slice(exportStart, exportEnd);

    for (const forbidden of [
      "key",
      "publicUrl",
      "claimedByType",
      "claimedById",
      "lastError",
      "sourceId",
    ]) {
      assert.doesNotMatch(
        exportBlock,
        new RegExp(`"${forbidden}"|\\b${forbidden}\\b`),
        `sanitized export must omit ${forbidden}`,
      );
    }
    assert.match(
      migration,
      /grainline_direct_upload_release_for_account[\s\S]*"releaseReason" = 'ACCOUNT_DELETION'/,
    );
    assert.match(
      migration,
      /upload\."storageClass" = 'PUBLIC'/,
    );

    const accountUrlsStart = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.grainline_direct_upload_account_public_urls",
    );
    const accountReleaseStart = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.grainline_direct_upload_release_for_account",
      accountUrlsStart,
    );
    const accountReleaseEnd = migration.indexOf(
      "\nREVOKE ALL ON FUNCTION",
      accountReleaseStart,
    );
    const accountUrlsBlock = migration.slice(accountUrlsStart, accountReleaseStart);
    const accountReleaseBlock = migration.slice(accountReleaseStart, accountReleaseEnd);

    for (const [label, block] of [
      ["account public URLs", accountUrlsBlock],
      ["account release", accountReleaseBlock],
    ]) {
      assert.doesNotMatch(
        block,
        /grainline_direct_upload_actor_valid/,
        `${label} must not reject a banned account before deletion cleanup`,
      );
      assert.match(block, /account_actor\.id = p_user_id/);
      assert.match(block, /account_actor\."deletedAt" IS NULL/);
      assert.doesNotMatch(block, /account_actor\.banned = false/);
    }
  });

  it("pins the exact runtime ACL catalog and keeps all cores private", () => {
    const migration = source(migrationPath);

    for (const functionName of runtimeFunctions) {
      assert.match(
        migration,
        new RegExp(
          `REVOKE ALL ON FUNCTION\\s+public\\.${functionName}\\([\\s\\S]{0,180}?\\)\\s+FROM PUBLIC, grainline_app_runtime;`,
        ),
        `${functionName} revoke`,
      );
      assert.match(
        migration,
        new RegExp(
          `GRANT EXECUTE ON FUNCTION\\s+public\\.${functionName}\\([\\s\\S]{0,180}?\\)\\s+TO grainline_app_runtime;`,
        ),
        `${functionName} runtime grant`,
      );
    }
    assert.match(migration, /IF runtime_grant_count <> 14/);
    assert.match(migration, /IF public_grant_count <> 0/);
    assert.match(migration, /IF private_core_grant_count <> 0/);
  });

  it("routes runtime lifecycle and isolated cleanup through separate fixed operations", () => {
    const lifecycle = source("src/lib/directUploadLifecycle.ts");
    const cleanupWorker = source("scripts/direct-upload-cleanup-worker.mjs");
    const caseEvidence = source("src/lib/caseEvidence.ts");
    const caseMessages = source("src/app/api/cases/[id]/messages/route.ts");
    const caseRead = source(
      "src/app/api/cases/[id]/attachments/[attachmentId]/route.ts",
    );

    for (const functionName of [
      "grainline_direct_upload_record_processed_public",
      "grainline_direct_upload_record_presigned_public",
      "grainline_direct_upload_record_private_case",
      "grainline_direct_upload_verify_public",
      "grainline_direct_upload_owned_lookup",
      "grainline_direct_upload_reference_case_attachment",
      "grainline_direct_upload_case_attachment_read",
    ]) {
      assert.match(lifecycle, new RegExp(functionName), functionName);
    }
    for (const functionName of [
      "grainline_direct_upload_cleanup_lease",
      "grainline_direct_upload_cleanup_complete",
      "grainline_direct_upload_cleanup_fail",
    ]) {
      assert.doesNotMatch(lifecycle, new RegExp(functionName), functionName);
      assert.match(cleanupWorker, new RegExp(functionName), functionName);
    }
    assert.match(caseEvidence, /findOwnedDirectUploadForKey/);
    assert.match(caseMessages, /replyToCaseWithFixedAuthority/);
    assert.doesNotMatch(caseMessages, /referenceDirectUploadCaseAttachment/);
    assert.doesNotMatch(caseMessages, /tx\.directUpload\./);
    assert.match(caseRead, /readDirectUploadCaseAttachment/);
    assert.doesNotMatch(caseRead, /prisma\.directUpload|directUpload:\s*\{/);
  });
});
