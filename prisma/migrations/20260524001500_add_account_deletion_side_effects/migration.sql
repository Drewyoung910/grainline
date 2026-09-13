-- Durable retry queue for account-deletion side effects that happen outside
-- the main anonymization transaction.
CREATE TABLE "AccountDeletionSideEffect" (
  "id" TEXT NOT NULL,
  "userId" VARCHAR(191) NOT NULL,
  "kind" VARCHAR(40) NOT NULL,
  "dedupKey" VARCHAR(300) NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "lastError" VARCHAR(1000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AccountDeletionSideEffect_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountDeletionSideEffect_dedupKey_key"
  ON "AccountDeletionSideEffect"("dedupKey");

CREATE INDEX "AccountDeletionSideEffect_status_nextAttemptAt_idx"
  ON "AccountDeletionSideEffect"("status", "nextAttemptAt");

CREATE INDEX "AccountDeletionSideEffect_userId_kind_idx"
  ON "AccountDeletionSideEffect"("userId", "kind");
