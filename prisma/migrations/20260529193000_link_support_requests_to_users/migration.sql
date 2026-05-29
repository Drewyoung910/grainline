ALTER TABLE "SupportRequest" ADD COLUMN "userId" TEXT;

UPDATE "SupportRequest" sr
SET "userId" = u.id
FROM "User" u
WHERE sr.email = u.email
  AND sr."userId" IS NULL;

CREATE INDEX "SupportRequest_userId_createdAt_idx" ON "SupportRequest"("userId", "createdAt");

ALTER TABLE "SupportRequest"
  ADD CONSTRAINT "SupportRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
