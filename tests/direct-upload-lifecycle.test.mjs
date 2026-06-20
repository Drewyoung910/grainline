import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  DIRECT_UPLOAD_STATUS,
  DIRECT_UPLOAD_PRESIGNED_CLEANUP_MS,
  DIRECT_UPLOAD_VERIFIED_CLEANUP_MS,
  DIRECT_UPLOAD_CLEANUP_RETRY_MS,
  directUploadPresignedCleanupAfter,
  directUploadVerifiedCleanupAfter,
  directUploadRetryCleanupAfter,
  directUploadStatusIsClaimable,
  directUploadErrorMessage,
} = await import("../src/lib/directUploadLifecycleState.ts");

function source(path) {
  return readFileSync(path, "utf8");
}

describe("direct upload lifecycle", () => {
  it("uses explicit TTLs and status transitions for unclaimed direct uploads", () => {
    const now = new Date("2026-06-20T12:00:00.000Z");

    assert.equal(
      directUploadPresignedCleanupAfter(now).getTime() - now.getTime(),
      DIRECT_UPLOAD_PRESIGNED_CLEANUP_MS,
    );
    assert.equal(
      directUploadVerifiedCleanupAfter(now).getTime() - now.getTime(),
      DIRECT_UPLOAD_VERIFIED_CLEANUP_MS,
    );
    assert.equal(
      directUploadRetryCleanupAfter(now).getTime() - now.getTime(),
      DIRECT_UPLOAD_CLEANUP_RETRY_MS,
    );

    assert.equal(directUploadStatusIsClaimable(DIRECT_UPLOAD_STATUS.PRESIGNED), true);
    assert.equal(directUploadStatusIsClaimable(DIRECT_UPLOAD_STATUS.VERIFIED), true);
    assert.equal(directUploadStatusIsClaimable(DIRECT_UPLOAD_STATUS.DELETING), false);
    assert.equal(directUploadStatusIsClaimable(DIRECT_UPLOAD_STATUS.DELETED), false);
    assert.equal(directUploadStatusIsClaimable(DIRECT_UPLOAD_STATUS.DELETE_FAILED), false);
  });

  it("bounds cleanup error text before persistence", () => {
    const message = directUploadErrorMessage(new Error(`bad\u0000${"x".repeat(1200)}`));

    assert.equal(message.includes("\u0000"), false);
    assert.equal(message.length, 1000);
  });

  it("adds schema and migration guardrails for direct upload lifecycle rows", () => {
    const schema = source("prisma/schema.prisma");
    const migration = source("prisma/migrations/20260620170000_add_direct_upload_lifecycle/migration.sql");

    assert.match(schema, /model DirectUpload \{/);
    assert.match(schema, /key\s+String\s+@unique\s+@db\.VarChar\(500\)/);
    assert.match(schema, /status\s+String\s+@default\("PRESIGNED"\)\s+@db\.VarChar\(20\)/);
    assert.match(schema, /cleanupAfter\s+DateTime\?/);
    assert.match(schema, /@@index\(\[status, cleanupAfter\]\)/);

    assert.match(migration, /CREATE TABLE "DirectUpload"/);
    assert.match(migration, /"DirectUpload_status_chk"/);
    assert.match(migration, /'PRESIGNED', 'VERIFIED', 'CLAIMED', 'DELETING', 'DELETED', 'DELETE_FAILED'/);
    assert.match(migration, /"DirectUpload_status_cleanupAfter_idx"/);
  });

  it("records presigned direct uploads and verifies lifecycle state before accepting them", () => {
    const presign = source("src/app/api/upload/presign/route.ts");
    const verify = source("src/app/api/upload/verify/route.ts");

    assert.match(presign, /recordDirectUploadPresigned/);
    assert.match(presign, /userId: me\.id/);
    assert.ok(
      presign.indexOf("await recordDirectUploadPresigned") <
        presign.indexOf("return privateJson({\n    presignedUrl"),
      "presign must create lifecycle row before returning the signed URL",
    );

    assert.match(verify, /markDirectUploadVerified/);
    assert.match(verify, /userId: me\.id/);
    assert.match(verify, /upload_verify_lifecycle_missing_cleanup/);
    assert.ok(
      verify.indexOf("await markDirectUploadVerified") <
        verify.indexOf("return privateJson({ ok: true, size: actualSize })"),
      "verify must mark lifecycle state before accepting the upload",
    );
  });

  it("claims tracked direct uploads in the same transaction that persists message attachments", () => {
    const threadPage = source("src/app/messages/[id]/page.tsx");

    assert.match(threadPage, /claimDirectUploadForUrl/);
    assert.match(threadPage, /DirectUploadClaimError/);
    assert.match(threadPage, /await prisma\.\$transaction\(async \(tx\) => \{/);
    assert.ok(
      threadPage.indexOf("await claimDirectUploadForUrl({") <
        threadPage.indexOf("const createdAttachment = await tx.message.create"),
      "message send must claim tracked uploads before attachment rows are created",
    );
    assert.match(threadPage, /claimedByType: "Message"/);
    assert.match(threadPage, /claimedById: createdAttachment\.id/);
  });

  it("runs cron cleanup without bucket listing and reports partial failures through CronRun result", () => {
    const lifecycle = source("src/lib/directUploadLifecycle.ts");
    const route = source("src/app/api/cron/direct-upload-cleanup/route.ts");
    const r2 = source("src/lib/r2.ts");
    const vercel = source("vercel.json");

    assert.match(lifecycle, /processExpiredDirectUploadBatch/);
    assert.match(lifecycle, /deleteR2ObjectByKey\(row\.key\)/);
    assert.doesNotMatch(lifecycle, /ListObjects/);
    assert.match(lifecycle, /failures\.push\(/);
    assert.match(lifecycle, /complete: rows\.length < take/);

    assert.match(r2, /export async function deleteR2ObjectByKey/);
    assert.match(route, /verifyCronRequest/);
    assert.match(route, /withSentryCronMonitor\("direct-upload-cleanup", \{ value: "50 \* \* \* \*"/);
    assert.match(route, /processExpiredDirectUploadBatch/);
    assert.match(vercel, /"path": "\/api\/cron\/direct-upload-cleanup"/);
  });
});
