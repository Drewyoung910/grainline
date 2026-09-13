CREATE TABLE "ClerkWebhookEvent" (
  "svixId" VARCHAR(255) NOT NULL,
  "type" VARCHAR(100) NOT NULL,
  "processingStartedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "lastError" VARCHAR(2000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ClerkWebhookEvent_pkey" PRIMARY KEY ("svixId")
);

CREATE INDEX "ClerkWebhookEvent_type_createdAt_idx" ON "ClerkWebhookEvent"("type", "createdAt");
CREATE INDEX "ClerkWebhookEvent_processedAt_idx" ON "ClerkWebhookEvent"("processedAt");
