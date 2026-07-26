-- Compatible private Case evidence preparation.
--
-- This migration adds storage metadata and the parent-scoped attachment table.
-- It does not enable RLS or narrow any existing runtime grant.

BEGIN;

ALTER TABLE "DirectUpload"
  ALTER COLUMN "publicUrl" DROP NOT NULL,
  ADD COLUMN "storageClass" VARCHAR(20) NOT NULL DEFAULT 'PUBLIC';

ALTER TABLE "DirectUpload"
  ADD CONSTRAINT "DirectUpload_storageClass_check"
  CHECK ("storageClass" IN ('PUBLIC', 'PRIVATE')),
  ADD CONSTRAINT "DirectUpload_storageClass_publicUrl_check"
  CHECK (
    ("storageClass" = 'PUBLIC' AND "publicUrl" IS NOT NULL)
    OR ("storageClass" = 'PRIVATE' AND "publicUrl" IS NULL)
  );

CREATE TABLE "CaseMessageAttachment" (
  "id" TEXT NOT NULL,
  "caseMessageId" TEXT NOT NULL,
  "uploaderId" TEXT NOT NULL,
  "objectKey" VARCHAR(500) NOT NULL,
  "contentType" VARCHAR(100) NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CaseMessageAttachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CaseMessageAttachment_objectKey_key" UNIQUE ("objectKey"),
  CONSTRAINT "CaseMessageAttachment_contentType_check"
    CHECK ("contentType" IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT "CaseMessageAttachment_byteSize_check"
    CHECK ("byteSize" > 0 AND "byteSize" <= 8388608),
  CONSTRAINT "CaseMessageAttachment_objectKey_check"
    CHECK ("objectKey" LIKE 'caseEvidenceImage/%')
);

ALTER TABLE "CaseMessageAttachment"
  ADD CONSTRAINT "CaseMessageAttachment_caseMessageId_fkey"
  FOREIGN KEY ("caseMessageId") REFERENCES "CaseMessage"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CaseMessageAttachment"
  ADD CONSTRAINT "CaseMessageAttachment_uploaderId_fkey"
  FOREIGN KEY ("uploaderId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "CaseMessageAttachment_caseMessageId_createdAt_id_idx"
  ON "CaseMessageAttachment" ("caseMessageId", "createdAt", "id");

CREATE INDEX "CaseMessageAttachment_uploaderId_idx"
  ON "CaseMessageAttachment" ("uploaderId");

COMMIT;
