import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

const migrationPath =
  "prisma/migrations/20260726184500_prepare_direct_upload_reference_ledger/migration.sql";

describe("DirectUpload reference-ledger preparation", () => {
  it("models lifecycle ownership, fenced cleanup, and normalized references", () => {
    const schema = source("prisma/schema.prisma");
    const directUpload =
      schema.match(/model DirectUpload \{[\s\S]*?\n\}/)?.[0] ?? "";
    const reference =
      schema.match(/model DirectUploadReference \{[\s\S]*?\n\}/)?.[0] ?? "";

    assert.match(directUpload, /user\s+User\s+@relation/);
    assert.match(directUpload, /cleanupLeaseId\s+String\?/);
    assert.match(directUpload, /cleanupLeaseAt\s+DateTime\?/);
    assert.match(directUpload, /references\s+DirectUploadReference\[\]/);
    assert.match(reference, /directUploadId\s+String/);
    assert.match(reference, /sourceType\s+String\s+@db\.VarChar\(50\)/);
    assert.match(reference, /sourceId\s+String\s+@db\.VarChar\(191\)/);
    assert.match(reference, /exclusive\s+Boolean/);
    assert.match(reference, /releasedAt\s+DateTime\?/);
    assert.match(reference, /releaseReason\s+String\?\s+@db\.VarChar\(200\)/);
  });

  it("adds only compatible DirectUpload constraints and a NOT VALID owner foreign key", () => {
    const migration = source(migrationPath);

    assert.match(migration, /\bBEGIN;/);
    assert.match(migration, /\bCOMMIT;/);
    assert.match(
      migration,
      /"DirectUpload_userId_fkey"[\s\S]*REFERENCES public\."User"\("id"\)[\s\S]*NOT VALID/,
    );
    assert.match(migration, /"DirectUpload_endpoint_check"[\s\S]*NOT VALID/);
    assert.match(
      migration,
      /"DirectUpload_endpoint_storage_content_size_check"[\s\S]*NOT VALID/,
    );
    assert.match(migration, /'messagePrivateImage'/);
    assert.doesNotMatch(
      migration,
      /ALTER TABLE public\."DirectUpload" (?:ENABLE|FORCE) ROW LEVEL SECURITY/,
    );
    assert.doesNotMatch(
      migration,
      /REVOKE ALL ON TABLE public\."DirectUpload"/,
    );
  });

  it("bridges old and new Case attachment writers without trusting either identifier", () => {
    const migration = source(migrationPath);

    assert.match(
      migration,
      /ADD COLUMN "directUploadId" TEXT[\s\S]*UPDATE public\."CaseMessageAttachment" AS attachment/,
    );
    assert.match(
      migration,
      /upload\.key = attachment\."objectKey"[\s\S]*upload\."userId" = attachment\."uploaderId"[\s\S]*upload\.endpoint = 'caseEvidenceImage'/,
    );
    assert.match(
      migration,
      /ALTER COLUMN "directUploadId" SET NOT NULL[\s\S]*"CaseMessageAttachment_directUploadId_fkey"/,
    );
    assert.match(
      migration,
      /grainline_direct_upload_case_attachment_bind\(\)[\s\S]*SECURITY DEFINER[\s\S]*FOR UPDATE/,
    );
    assert.match(
      migration,
      /NEW\."directUploadId" IS DISTINCT FROM upload\.id/,
    );
    assert.match(
      migration,
      /NEW\."caseMessageId" IS DISTINCT FROM OLD\."caseMessageId"[\s\S]*CaseMessageAttachment identity fields are immutable/,
    );
    assert.match(
      migration,
      /BEFORE INSERT OR UPDATE[\s\S]*grainline_direct_upload_case_attachment_bind\(\)/,
    );
    assert.doesNotMatch(migration, /DROP COLUMN "objectKey"/);
  });

  it("makes the reference ledger FORCE-hardened and runtime-inaccessible at birth", () => {
    const migration = source(migrationPath);

    assert.match(migration, /CREATE TABLE public\."DirectUploadReference"/);
    assert.match(
      migration,
      /ALTER TABLE public\."DirectUploadReference" ENABLE ROW LEVEL SECURITY;/,
    );
    assert.match(
      migration,
      /ALTER TABLE public\."DirectUploadReference" FORCE ROW LEVEL SECURITY;/,
    );
    assert.match(
      migration,
      /REVOKE ALL ON TABLE public\."DirectUploadReference"\s+FROM PUBLIC, grainline_app_runtime;/,
    );
    assert.doesNotMatch(
      migration,
      /CREATE POLICY[\s\S]*DirectUploadReference/,
    );
  });

  it("enforces active-reference identity and private exclusivity in indexes", () => {
    const migration = source(migrationPath);

    assert.match(
      migration,
      /CREATE UNIQUE INDEX "DirectUploadReference_active_source_key"[\s\S]*WHERE "releasedAt" IS NULL;/,
    );
    assert.match(
      migration,
      /CREATE UNIQUE INDEX "DirectUploadReference_active_exclusive_key"[\s\S]*WHERE "releasedAt" IS NULL AND exclusive = true;/,
    );
    assert.match(
      migration,
      /NEW\.exclusive := lifecycle\."storageClass" = 'PRIVATE';/,
    );
    assert.match(
      migration,
      /SELECT upload\."storageClass", upload\.status[\s\S]*FOR UPDATE;/,
    );
  });

  it("locks lifecycle identity and status transitions without caller-selected reference identity", () => {
    const migration = source(migrationPath);

    assert.match(migration, /grainline_direct_upload_identity_immutable/);
    assert.match(migration, /DirectUpload identity fields are immutable/);
    assert.match(migration, /grainline_direct_upload_status_transition/);
    assert.match(
      migration,
      /OLD\.status = 'CLAIMED' AND NEW\.status = 'VERIFIED'/,
    );
    assert.match(migration, /DirectUploadReference identity fields are immutable/);
    assert.match(migration, /DirectUploadReference release is immutable/);

    for (const functionName of [
      "grainline_direct_upload_identity_immutable",
      "grainline_direct_upload_status_transition",
      "grainline_direct_upload_reference_guard",
    ]) {
      assert.match(
        migration,
        new RegExp(
          `REVOKE ALL ON FUNCTION\\s+public\\.${functionName}\\(\\)\\s+FROM PUBLIC, grainline_app_runtime;`,
        ),
      );
    }
  });
});
