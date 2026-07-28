import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("private CaseMessage evidence", () => {
  it("adds only opaque parent-scoped image metadata and private upload lifecycle state", () => {
    const schema = source("prisma/schema.prisma");
    const compatibilityMigration = source(
      "prisma/migrations/20260726184000_prepare_private_case_message_attachments/migration.sql",
    );
    const lifecycleMigration = source(
      "prisma/migrations/20260726184500_prepare_direct_upload_reference_ledger/migration.sql",
    );

    assert.match(schema, /model CaseMessageAttachment \{/);
    assert.match(schema, /caseMessage\s+CaseMessage[\s\S]*onDelete: Cascade/);
    assert.match(schema, /directUploadId\s+String\s+@unique/);
    assert.match(
      schema,
      /directUpload\s+DirectUpload\s+@relation\(fields: \[directUploadId\], references: \[id\], onDelete: Restrict\)/,
    );
    assert.match(schema, /contentType\s+String\s+@db\.VarChar\(100\)/);
    assert.match(schema, /byteSize\s+Int/);
    assert.match(
      schema.match(/model CaseMessageAttachment \{[\s\S]*?\n\}/)?.[0] ?? "",
      /Compatibility-only duplicate[\s\S]*objectKey\s+String\s+@unique/,
    );
    assert.doesNotMatch(
      schema.match(/model CaseMessageAttachment \{[\s\S]*?\n\}/)?.[0] ?? "",
      /\burl\b|publicUrl/,
    );
    assert.match(schema, /publicUrl\s+String\?\s+@db\.VarChar\(2048\)/);
    assert.match(schema, /storageClass\s+String\s+@default\("PUBLIC"\)/);

    assert.match(compatibilityMigration, /\bBEGIN;/);
    assert.match(compatibilityMigration, /\bCOMMIT;/);
    assert.match(compatibilityMigration, /ALTER COLUMN "publicUrl" DROP NOT NULL/);
    assert.match(compatibilityMigration, /CHECK \("storageClass" IN \('PUBLIC', 'PRIVATE'\)\)/);
    assert.match(
      compatibilityMigration,
      /"storageClass" = 'PUBLIC' AND "publicUrl" IS NOT NULL[\s\S]*"storageClass" = 'PRIVATE' AND "publicUrl" IS NULL/,
    );
    assert.match(
      compatibilityMigration,
      /CHECK \("contentType" IN \('image\/jpeg', 'image\/png', 'image\/webp'\)\)/,
    );
    assert.match(compatibilityMigration, /CHECK \("byteSize" > 0 AND "byteSize" <= 8388608\)/);
    assert.match(compatibilityMigration, /"objectKey" VARCHAR\(500\) NOT NULL/);
    assert.match(
      lifecycleMigration,
      /Old code writes objectKey; new code dual-writes[\s\S]*ADD COLUMN "directUploadId" TEXT/,
    );
    assert.match(
      lifecycleMigration,
      /UPDATE public\."CaseMessageAttachment" AS attachment[\s\S]*CaseMessageAttachment contains an unbindable DirectUpload source/,
    );
    assert.match(
      lifecycleMigration,
      /ALTER COLUMN "directUploadId" SET NOT NULL[\s\S]*"CaseMessageAttachment_directUploadId_fkey"[\s\S]*REFERENCES public\."DirectUpload"\(id\)/,
    );
    assert.match(
      lifecycleMigration,
      /grainline_direct_upload_case_attachment_bind\(\)[\s\S]*SECURITY DEFINER[\s\S]*CaseMessageAttachment identity fields are immutable/,
    );
    assert.doesNotMatch(lifecycleMigration, /DROP COLUMN "objectKey"/);
  });

  it("keeps Case evidence out of every public upload path", () => {
    const imageRoute = source("src/app/api/upload/image/route.ts");
    const presignRoute = source("src/app/api/upload/presign/route.ts");
    const uploadRoute = source(
      "src/app/api/cases/[id]/attachments/route.ts",
    );
    const r2 = source("src/lib/r2.ts");

    assert.match(
      imageRoute,
      /endpoint === "caseEvidenceImage"[\s\S]*private Case attachment endpoint/,
    );
    assert.match(
      presignRoute,
      /endpoint === "caseEvidenceImage"[\s\S]*private Case attachment endpoint/,
    );
    assert.match(uploadRoute, /privateR2BucketName\(\)/);
    assert.match(uploadRoute, /getExplicitCrossOriginPostRejection/);
    assert.match(uploadRoute, /CacheControl: "private, no-store"/);
    assert.match(uploadRoute, /publicUrl: null/);
    assert.match(uploadRoute, /storageClass: CASE_EVIDENCE_STORAGE_CLASS/);
    assert.doesNotMatch(uploadRoute, /R2_PUBLIC_URL|assertPublicMediaAvailable/);
    assert.match(r2, /CLOUDFLARE_R2_PRIVATE_BUCKET_NAME/);
    assert.match(r2, /must differ from the public R2 bucket/);
  });

  it("authorizes upload and retrieval through the exact parent Case", () => {
    const uploadRoute = source(
      "src/app/api/cases/[id]/attachments/route.ts",
    );
    const readRoute = source(
      "src/app/api/cases/[id]/attachments/[attachmentId]/route.ts",
    );

    for (const route of [uploadRoute, readRoute]) {
      assert.match(route, /me\.id === caseRecord\.buyerId/);
      assert.match(route, /me\.id === caseRecord\.sellerId/);
      assert.match(route, /me\.role === "EMPLOYEE" \|\| me\.role === "ADMIN"/);
      assert.match(route, /requireStaffAdminPinForApi/);
      assert.match(route, /return privateJson\(\{ error: "Forbidden\."/);
    }
    assert.match(uploadRoute, /uploadFileSignatureMatches/);
    assert.match(uploadRoute, /stripMetadata/);
    assert.match(uploadRoute, /const actsAsStaff = isStaff && !isParty/);
    assert.match(
      uploadRoute,
      /canCreateCaseMessageForStatus\(caseRecord\.status, \{ isStaff: actsAsStaff \}\)/,
    );
    assert.match(
      readRoute,
      /readDirectUploadCaseAttachment\(\{[\s\S]*caseId: id,[\s\S]*attachmentId/,
    );
    assert.match(readRoute, /CASE_EVIDENCE_SIGNED_URL_TTL_SECONDS = 60/);
    assert.match(readRoute, /"Cache-Control": "private, no-store, max-age=0"/);
    assert.match(readRoute, /"Referrer-Policy": "no-referrer"/);
  });

  it("verifies and claims evidence in the same transaction as its CaseMessage", () => {
    const route = source("src/app/api/cases/[id]/messages/route.ts");
    const evidence = source("src/lib/caseEvidence.ts");
    const lifecycle = source("src/lib/directUploadLifecycle.ts");

    assert.match(route, /verifyPrivateCaseEvidenceForPersistence/);
    assert.match(
      evidence,
      /lifecycle\.publicUrl !== null[\s\S]*lifecycle\.storageClass !== CASE_EVIDENCE_STORAGE_CLASS/,
    );
    assert.match(evidence, /lifecycle\.status !== DIRECT_UPLOAD_STATUS\.VERIFIED/);
    assert.match(evidence, /uploadFileSignatureMatches/);
    assert.match(route, /await prisma\.\$transaction\(async \(tx\) =>/);
    assert.match(route, /referenceDirectUploadCaseAttachment\(\{[\s\S]*client: tx/);
    assert.match(
      route,
      /attachments: \{[\s\S]*create:[\s\S]*objectKey: attachment\.objectKey,[\s\S]*directUploadId: attachment\.directUploadId[\s\S]*referenceDirectUploadCaseAttachment/,
    );
    assert.match(route, /attachmentKeysMatch/);
    assert.match(lifecycle, /grainline_direct_upload_reference_case_attachment/);
    assert.match(
      lifecycle,
      /deleteR2ObjectByStorageClass\(row\.key, row\.storageClass\)/,
    );
  });

  it("keeps private object keys server-side and serializes locked reads", () => {
    const route = source("src/app/api/cases/[id]/messages/route.ts");
    const transactionStart = route.indexOf(
      "const messageResult = await prisma.$transaction",
    );
    const transactionEnd = route.indexOf(
      "if (messageResult.duplicate)",
      transactionStart,
    );
    const transaction = route.slice(transactionStart, transactionEnd);

    assert.match(
      route,
      /function caseMessageResponse<[\s\S]*attachments: attachments\.map/,
    );
    assert.match(
      route,
      /return privateJson\(caseMessageResponse\(claimedRetry\), \{ status: 200 \}\)/,
    );
    assert.match(
      route,
      /return privateJson\(caseMessageResponse\(message\), \{ status: 201 \}\)/,
    );
    assert.doesNotMatch(
      route,
      /return privateJson\((?:claimedRetry|messageResult\.message|message),/,
    );
    assert.doesNotMatch(transaction, /Promise\.all/);
    assert.ok(
      transaction.indexOf("const lockedCase = await tx.case.findUnique") <
        transaction.indexOf("const lockedActor = await tx.user.findUnique"),
      "locked Case and current actor reads must remain sequential",
    );
  });

  it("keeps evidence bounded in UI/export and retained during account anonymization", () => {
    const reply = source("src/components/CaseReplyBox.tsx");
    const history = source("src/lib/caseMessageHistory.ts");
    const exportRoute = source("src/app/api/account/export/route.ts");
    const deletion = source("src/lib/accountDeletion.ts");
    const plan = source("docs/rls-case-case-message-plan.md");

    assert.match(reply, /MAX_CASE_MESSAGE_ATTACHMENTS/);
    assert.match(reply, /accept="image\/jpeg,image\/png,image\/webp"/);
    assert.match(reply, /attachmentKeys:/);
    assert.match(history, /attachments: \{[\s\S]*byteSize: true/);
    assert.match(exportRoute, /attachments: \{[\s\S]*byteSize: true/);
    assert.match(
      deletion,
      /Private Case evidence is retained with the dispute\/order record/,
    );
    assert.match(
      deletion,
      /releaseDirectUploadsForAccount\(\{\s*client: tx,\s*userId: user\.id/s,
    );
    assert.match(plan, /PDFs remain prohibited/);
    assert.match(plan, /future Case retention purge must[\s\S]*private-object deletion/);
    assert.match(plan, /Code presence is not evidence that the bucket is private/);
  });

  it("keeps the private Case path fail-closed until its release gate is explicit", () => {
    const release = source("src/lib/caseEvidenceRelease.ts");
    const uploadRoute = source("src/app/api/cases/[id]/attachments/route.ts");
    const readRoute = source(
      "src/app/api/cases/[id]/attachments/[attachmentId]/route.ts",
    );
    const messageRoute = source("src/app/api/cases/[id]/messages/route.ts");
    const reply = source("src/components/CaseReplyBox.tsx");
    const pages = [
      source("src/app/dashboard/orders/[id]/page.tsx"),
      source("src/app/dashboard/sales/[orderId]/page.tsx"),
      source("src/app/admin/cases/[id]/page.tsx"),
    ];

    assert.match(
      release,
      /CASE_EVIDENCE_ATTACHMENTS_ENABLED_ENV[\s\S]*=== "true"/,
    );
    assert.match(uploadRoute, /if \(!caseEvidenceAttachmentsEnabled\(\)\)/);
    assert.match(readRoute, /if \(!caseEvidenceAttachmentsEnabled\(\)\)/);
    assert.match(
      messageRoute,
      /attachmentKeys\.length > 0[\s\S]*!caseEvidenceAttachmentsEnabled\(\)/,
    );
    assert.match(reply, /attachmentsEnabled[\s\S]*Evidence images/);
    for (const page of pages) {
      assert.match(
        page,
        /attachmentsEnabled=\{caseEvidenceAttachmentsEnabled\(\)\}/,
      );
    }
  });
});
