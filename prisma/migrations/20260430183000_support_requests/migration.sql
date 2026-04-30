CREATE TYPE "SupportRequestKind" AS ENUM ('SUPPORT', 'DATA_REQUEST');

CREATE TYPE "SupportRequestStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'CLOSED');

CREATE TABLE "SupportRequest" (
  "id" TEXT NOT NULL,
  "kind" "SupportRequestKind" NOT NULL,
  "status" "SupportRequestStatus" NOT NULL DEFAULT 'OPEN',
  "name" VARCHAR(100),
  "email" VARCHAR(254) NOT NULL,
  "topic" VARCHAR(80) NOT NULL,
  "orderId" VARCHAR(80),
  "message" VARCHAR(4000) NOT NULL,
  "slaDueAt" TIMESTAMP(3) NOT NULL,
  "emailSentAt" TIMESTAMP(3),
  "emailLastError" VARCHAR(1000),
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SupportRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupportRequest_kind_status_slaDueAt_idx" ON "SupportRequest"("kind", "status", "slaDueAt");
CREATE INDEX "SupportRequest_email_createdAt_idx" ON "SupportRequest"("email", "createdAt");
CREATE INDEX "SupportRequest_status_createdAt_idx" ON "SupportRequest"("status", "createdAt");
