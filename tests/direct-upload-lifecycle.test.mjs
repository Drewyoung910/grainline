import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

    assert.equal(directUploadStatusIsClaimable(DIRECT_UPLOAD_STATUS.PRESIGNED), false);
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
    const imageRoute = source("src/app/api/upload/image/route.ts");

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

    assert.match(imageRoute, /recordDirectUploadVerified/);
    assert.ok(
      imageRoute.indexOf("await assertPublicMediaAvailable(publicUrl)") <
        imageRoute.indexOf("await recordDirectUploadVerified"),
      "processed image uploads must be publicly reachable before they become verified lifecycle rows",
    );
    assert.ok(
      imageRoute.indexOf("await recordDirectUploadVerified") <
        imageRoute.indexOf("return privateJson({\n    publicUrl"),
      "processed image uploads must create cleanup-addressable lifecycle rows before returning",
    );
  });

  it("requires tracked uploads to pass verification before fixed-family persistence", () => {
    const lifecycle = source("src/lib/directUploadLifecycle.ts");
    const verifier = source("src/lib/uploadPersistenceVerification.ts");
    const publicReferences = source(
      "prisma/migrations/20260726185500_prepare_direct_upload_public_references/migration.sql",
    );

    assert.doesNotMatch(lifecycle, /claimDirectUploadFor(?:Url|Key)|claimDirectUploadsForUrls/);
    assert.match(publicReferences, /upload\.status IN \('VERIFIED', 'CLAIMED'\)/);
    assert.doesNotMatch(publicReferences, /upload\.status IN \([^)]*'PRESIGNED'/);
    assert.match(verifier, /accountUserId/);
    assert.match(verifier, /findOwnedDirectUploadForKey\(\{/);
    assert.match(verifier, /lifecycle\?\.status === DIRECT_UPLOAD_STATUS\.VERIFIED/);
    assert.match(verifier, /lifecycle\?\.status === DIRECT_UPLOAD_STATUS\.CLAIMED/);
    assert.match(verifier, /lifecycle\?\.endpoint === endpoint/);
    assert.match(verifier, /lifecycle\.storageClass === "PUBLIC"/);
    assert.match(verifier, /lifecycle\.expectedSize === size/);
    assert.match(verifier, /uploadContentTypeMatches\(head\.ContentType, lifecycle\.contentType\)/);
  });

  it("derives public reference identity from fixed durable-source families", () => {
    const lifecycle = source("src/lib/directUploadLifecycle.ts");
    const migration = source(
      "prisma/migrations/20260726185500_prepare_direct_upload_public_references/migration.sql",
    );

    assert.match(
      migration,
      /CREATE OR REPLACE FUNCTION public\.grainline_direct_upload_sync_listing[\s\S]*FROM public\."Listing"[\s\S]*owner_id IS DISTINCT FROM p_user_id/,
    );
    assert.match(
      migration,
      /'LISTING_PHOTO',\s*p_listing_id[\s\S]*'LISTING_VIDEO',\s*p_listing_id/,
    );
    assert.match(
      migration,
      /REVOKE ALL ON FUNCTION\s+public\.grainline_direct_upload_sync_public_core[\s\S]*FROM PUBLIC, grainline_app_runtime/,
    );
    assert.doesNotMatch(lifecycle, /claimedByType|claimedById/);
  });

  it("synchronizes every persisted public-media family through its fixed wrapper", () => {
    const checked = [
      ["src/app/dashboard/listings/new/page.tsx", /syncListingDirectUploadReferences/],
      ["src/app/dashboard/listings/custom/page.tsx", /syncListingDirectUploadReferences/],
      ["src/app/dashboard/listings/[id]/edit/page.tsx", /syncListingDirectUploadReferences/],
      ["src/app/api/reviews/route.ts", /syncReviewDirectUploadReferences/],
      ["src/app/api/reviews/[id]/route.ts", /syncReviewDirectUploadReferences/],
      ["src/app/api/commission/route.ts", /syncCommissionRequestDirectUploadReferences/],
      ["src/app/dashboard/profile/page.tsx", /syncSellerProfileDirectUploadReferences/],
      ["src/app/dashboard/onboarding/actions.ts", /syncSellerProfileDirectUploadReferences/],
      ["src/app/api/seller/broadcast/route.ts", /syncSellerBroadcastDirectUploadReferences/],
      ["src/app/dashboard/blog/new/page.tsx", /syncBlogPostDirectUploadReferences/],
      ["src/app/dashboard/blog/[id]/edit/page.tsx", /syncBlogPostDirectUploadReferences/],
    ];

    for (const [path, syncPattern] of checked) {
      const text = source(path);
      assert.match(text, syncPattern, path);
      if (path.startsWith("src/app/dashboard/blog/")) {
        assert.match(text, /normalizeBlogCoverImageUrl\([\s\S]*author\.id/, path);
      } else {
        assert.match(text, /accountUserId:/, path);
      }
      assert.doesNotMatch(text, /claimedByType|claimedById/, path);
    }
  });

  it("references tracked message uploads from the durable message in the same transaction", () => {
    const threadPage = source("src/app/messages/[id]/page.tsx");

    assert.match(threadPage, /syncLegacyMessageDirectUploadReference/);
    assert.match(threadPage, /DirectUploadClaimError/);
    assert.match(threadPage, /await prisma\.\$transaction\(async \(tx\) => \{/);
    assert.ok(
      threadPage.indexOf("const createdAttachment = await sendActorOrdinaryMessage") <
        threadPage.indexOf("await syncLegacyMessageDirectUploadReference({"),
      "message reference identity must be derived after the durable message exists",
    );
    assert.match(threadPage, /messageId: createdAttachment\.messageId/);
    assert.match(threadPage, /requireAllTracked: true/);
  });

  it("retires ordinary-runtime cleanup without enabling the replacement scheduler", () => {
    const lifecycle = source("src/lib/directUploadLifecycle.ts");
    const r2 = source("src/lib/r2.ts");
    const vercel = source("vercel.json");
    const workflow = source(".github/workflows/direct-upload-cleanup.yml");

    assert.doesNotMatch(lifecycle, /processExpiredDirectUploadBatch/);
    assert.doesNotMatch(lifecycle, /deleteR2ObjectByStorageClass/);
    assert.doesNotMatch(
      lifecycle,
      /grainline_direct_upload_cleanup_(?:lease|complete|fail)/,
    );
    assert.doesNotMatch(lifecycle, /prisma\.directUpload\.findMany/);

    assert.match(r2, /export async function deleteR2ObjectByKey/);
    assert.match(r2, /export async function deletePrivateR2ObjectByKey/);
    assert.match(r2, /storageClass === "PRIVATE"/);
    assert.equal(
      existsSync("src/app/api/cron/direct-upload-cleanup/route.ts"),
      false,
    );
    assert.doesNotMatch(vercel, /\/api\/cron\/direct-upload-cleanup/);
    assert.match(workflow, /workflow_dispatch:/);
    assert.doesNotMatch(workflow, /^\s*schedule:/m);
    assert.match(workflow, /ops:direct-upload-cleanup-worker/);
  });
});
