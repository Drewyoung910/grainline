ALTER TABLE "SellerMetrics"
  ALTER COLUMN "totalSalesCents" TYPE BIGINT;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "SupportRequest_status_closedAt_idx"
  ON "SupportRequest"("status", "closedAt");
