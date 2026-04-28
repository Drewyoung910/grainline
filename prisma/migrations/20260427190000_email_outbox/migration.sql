CREATE TABLE "public"."EmailOutbox" (
    "id" TEXT NOT NULL,
    "recipientEmail" VARCHAR(254) NOT NULL,
    "userId" VARCHAR(191),
    "preferenceKey" VARCHAR(80),
    "subject" VARCHAR(300) NOT NULL,
    "html" TEXT NOT NULL,
    "dedupKey" VARCHAR(128) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "lastError" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailOutbox_dedupKey_key" ON "public"."EmailOutbox"("dedupKey");
CREATE INDEX "EmailOutbox_status_nextAttemptAt_idx" ON "public"."EmailOutbox"("status", "nextAttemptAt");
CREATE INDEX "EmailOutbox_userId_preferenceKey_idx" ON "public"."EmailOutbox"("userId", "preferenceKey");
CREATE INDEX "EmailOutbox_recipientEmail_createdAt_idx" ON "public"."EmailOutbox"("recipientEmail", "createdAt");
