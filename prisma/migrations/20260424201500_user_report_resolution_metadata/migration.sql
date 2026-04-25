ALTER TABLE "UserReport"
  ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "resolvedById" TEXT;

CREATE INDEX IF NOT EXISTS "UserReport_resolvedById_idx" ON "UserReport"("resolvedById");

ALTER TABLE "UserReport" DROP CONSTRAINT IF EXISTS "UserReport_resolvedById_fkey";
ALTER TABLE "UserReport"
  ADD CONSTRAINT "UserReport_resolvedById_fkey"
  FOREIGN KEY ("resolvedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
