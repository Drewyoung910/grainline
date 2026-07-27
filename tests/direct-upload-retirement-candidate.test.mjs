import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  DIRECT_UPLOAD_RETIREMENT_ACK,
  DIRECT_UPLOAD_RETIREMENT_MIGRATION,
  buildDirectUploadRetirementCandidate,
} from "../scripts/stage-direct-upload-retirement-migration.mjs";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("DirectUpload compatibility-key retirement candidate", () => {
  it("keeps the candidate unapplied and loopback-only", () => {
    assert.equal(
      DIRECT_UPLOAD_RETIREMENT_MIGRATION,
      "20260726190000_retire_direct_upload_compatibility_key",
    );
    assert.equal(
      DIRECT_UPLOAD_RETIREMENT_ACK,
      "I_ACKNOWLEDGE_LOOPBACK_DIRECT_UPLOAD_RETIREMENT_STAGING",
    );
    assert.throws(
      () => readFileSync(
        `prisma/migrations/${DIRECT_UPLOAD_RETIREMENT_MIGRATION}/migration.sql`,
        "utf8",
      ),
      /ENOENT/,
    );
    const script = source(
      "scripts/stage-direct-upload-retirement-migration.mjs",
    );
    assert.match(script, /localhost/);
    assert.match(script, /127\.0\.0\.1/);
    assert.match(script, /grainline_ci/);
    assert.match(script, /--stage\|--unstage/);
  });

  it("requires exact compatibility identity and active-reference coherence", () => {
    const { migration } = buildDirectUploadRetirementCandidate();

    assert.match(
      migration,
      /upload\.key IS DISTINCT FROM attachment\."objectKey"/,
    );
    assert.match(
      migration,
      /reference\."sourceType" = 'CASE_MESSAGE_ATTACHMENT'/,
    );
    assert.match(migration, /pg_catalog\.count\(reference\.id\) <> 1/);
    assert.match(
      migration,
      /upload\.status = 'CLAIMED'[\s\S]*NOT EXISTS[\s\S]*"releasedAt" IS NULL/,
    );
    assert.match(
      migration,
      /reference\.exclusive IS DISTINCT FROM[\s\S]*upload\."storageClass" = 'PRIVATE'/,
    );
  });

  it("validates known legacy constraints without changing RLS or grants", () => {
    const { migration } = buildDirectUploadRetirementCandidate();

    assert.equal(
      (migration.match(/VALIDATE CONSTRAINT/g) ?? []).length,
      6,
    );
    assert.doesNotMatch(
      migration,
      /ALTER TABLE public\."DirectUpload" (?:ENABLE|FORCE) ROW LEVEL SECURITY/,
    );
    assert.doesNotMatch(
      migration,
      /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|EXECUTE)/i,
    );
  });

  it("drops only the duplicate key and replaces the binding trigger", () => {
    const { migration } = buildDirectUploadRetirementCandidate();

    assert.equal(
      (migration.match(/DROP COLUMN "objectKey"/g) ?? []).length,
      1,
    );
    assert.match(
      migration,
      /DROP TRIGGER grainline_direct_upload_case_attachment_bind[\s\S]*DROP COLUMN "objectKey"[\s\S]*CREATE OR REPLACE FUNCTION[\s\S]*grainline_direct_upload_case_attachment_bind\(\)/,
    );
    const replacement = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION"),
    );
    assert.doesNotMatch(replacement, /NEW\."objectKey"|OLD\."objectKey"/);
    assert.match(
      replacement,
      /candidate\.id = NEW\."directUploadId"[\s\S]*FOR UPDATE/,
    );
    assert.match(
      replacement,
      /NEW\."directUploadId" IS DISTINCT FROM OLD\."directUploadId"/,
    );
    assert.match(
      replacement,
      /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, grainline_app_runtime/,
    );
  });

  it("keeps the disabled application shape compatible with the retired column", () => {
    const schema =
      source("prisma/schema.prisma")
        .match(/model CaseMessageAttachment \{[\s\S]*?\n\}/)?.[0] ?? "";
    const evidence = source("src/lib/caseEvidence.ts");
    const route = source("src/app/api/cases/[id]/messages/route.ts");

    assert.doesNotMatch(schema, /objectKey/);
    assert.match(schema, /directUploadId\s+String\s+@unique/);
    assert.match(evidence, /attachment: \{[\s\S]*directUploadId: string;/);
    assert.doesNotMatch(
      evidence.match(/attachment: \{[\s\S]*?\n\s*\};/)?.[0] ?? "",
      /\b(?:objectKey|key): string/,
    );
    assert.doesNotMatch(
      route.match(
        /attachments: \{[\s\S]*?create: verifiedAttachments[\s\S]*?\n\s*\},/,
      )?.[0] ?? "",
      /objectKey:/,
    );
    assert.match(route, /directUploadId: attachment\.directUploadId/);
  });
});
