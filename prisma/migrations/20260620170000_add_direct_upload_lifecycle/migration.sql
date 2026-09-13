-- Durable lifecycle records for direct-to-R2 uploads (PDF/video). These rows
-- let the app clean up successful but never-attached direct uploads without
-- relying on bucket listing.
CREATE TABLE "DirectUpload" (
  "id" TEXT NOT NULL,
  "key" VARCHAR(500) NOT NULL,
  "endpoint" VARCHAR(40) NOT NULL,
  "userId" VARCHAR(191) NOT NULL,
  "publicUrl" VARCHAR(2048) NOT NULL,
  "contentType" VARCHAR(100) NOT NULL,
  "expectedSize" INTEGER NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'PRESIGNED',
  "cleanupAfter" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "claimedAt" TIMESTAMP(3),
  "claimedByType" VARCHAR(80),
  "claimedById" VARCHAR(191),
  "deletedAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" VARCHAR(1000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DirectUpload_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DirectUpload_status_chk" CHECK ("status" IN ('PRESIGNED', 'VERIFIED', 'CLAIMED', 'DELETING', 'DELETED', 'DELETE_FAILED')),
  CONSTRAINT "DirectUpload_expectedSize_positive_chk" CHECK ("expectedSize" > 0),
  CONSTRAINT "DirectUpload_attempts_nonnegative_chk" CHECK ("attempts" >= 0)
);

CREATE UNIQUE INDEX "DirectUpload_key_key"
  ON "DirectUpload"("key");

CREATE INDEX "DirectUpload_status_cleanupAfter_idx"
  ON "DirectUpload"("status", "cleanupAfter");

CREATE INDEX "DirectUpload_userId_endpoint_idx"
  ON "DirectUpload"("userId", "endpoint");

CREATE INDEX "DirectUpload_claimedByType_claimedById_idx"
  ON "DirectUpload"("claimedByType", "claimedById");
