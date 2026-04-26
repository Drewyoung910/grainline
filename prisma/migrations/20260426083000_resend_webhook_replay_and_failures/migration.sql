CREATE TABLE "ResendWebhookEvent" (
  "svixId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "processingStartedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ResendWebhookEvent_pkey" PRIMARY KEY ("svixId")
);

CREATE INDEX "ResendWebhookEvent_type_createdAt_idx" ON "ResendWebhookEvent"("type", "createdAt");
CREATE INDEX "ResendWebhookEvent_processedAt_idx" ON "ResendWebhookEvent"("processedAt");

CREATE TABLE "EmailFailureCount" (
  "email" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "firstFailedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastFailedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastEventId" TEXT,

  CONSTRAINT "EmailFailureCount_pkey" PRIMARY KEY ("email")
);

CREATE INDEX "EmailFailureCount_lastFailedAt_idx" ON "EmailFailureCount"("lastFailedAt");
