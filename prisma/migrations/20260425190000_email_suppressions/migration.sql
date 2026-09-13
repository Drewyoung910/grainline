CREATE TYPE "EmailSuppressionReason" AS ENUM ('BOUNCE', 'COMPLAINT', 'MANUAL');

CREATE TABLE "EmailSuppression" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "reason" "EmailSuppressionReason" NOT NULL,
  "source" TEXT,
  "eventId" TEXT,
  "details" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailSuppression_email_key" ON "EmailSuppression"("email");
CREATE INDEX "EmailSuppression_reason_idx" ON "EmailSuppression"("reason");
CREATE INDEX "EmailSuppression_createdAt_idx" ON "EmailSuppression"("createdAt");
