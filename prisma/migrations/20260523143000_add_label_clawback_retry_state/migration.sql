-- Durable retry state for Stripe transfer reversals that claw back Shippo
-- label costs after label purchase.
ALTER TABLE "Order"
  ADD COLUMN "labelClawbackStatus" VARCHAR(50),
  ADD COLUMN "labelClawbackReversalId" VARCHAR(255),
  ADD COLUMN "labelClawbackRetryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "labelClawbackLastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "labelClawbackNextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "labelClawbackResolvedAt" TIMESTAMP(3);

CREATE INDEX "Order_labelClawbackStatus_labelClawbackNextAttemptAt_idx"
  ON "Order"("labelClawbackStatus", "labelClawbackNextAttemptAt");
