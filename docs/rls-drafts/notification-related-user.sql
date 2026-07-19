-- Preparation-only Bucket B metadata draft. This file is deliberately outside
-- prisma/migrations so it cannot enter the sealed SavedSearch Phase-B artifact.
-- Move it into a newly reviewed migration only after SavedSearch Phase B and
-- runtime credential separation pass their production postflights. This is a
-- lifecycle metadata key, not a Prisma ownership relation: the service create
-- path validates it and account deletion removes matching rows explicitly.
ALTER TABLE "Notification"
  ADD COLUMN "relatedUserId" TEXT;

CREATE INDEX "Notification_relatedUserId_idx"
  ON "Notification"("relatedUserId");
