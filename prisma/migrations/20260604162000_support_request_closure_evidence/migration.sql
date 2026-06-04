ALTER TABLE "SupportRequest"
  ADD COLUMN "closureEvidence" VARCHAR(4000),
  ADD COLUMN "closureEvidenceAt" TIMESTAMP(3),
  ADD COLUMN "closureEvidenceById" TEXT;

CREATE INDEX "SupportRequest_closureEvidenceById_idx" ON "SupportRequest"("closureEvidenceById");

ALTER TABLE "SupportRequest"
  ADD CONSTRAINT "SupportRequest_closureEvidenceById_fkey"
  FOREIGN KEY ("closureEvidenceById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
