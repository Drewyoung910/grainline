-- Support capped admin queue reads with their filter/order/tie-breaker shapes.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Listing_status_createdAt_id_idx"
  ON "Listing"("status", "createdAt", "id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "MakerVerification_status_appliedAt_id_idx"
  ON "MakerVerification"("status", "appliedAt", "id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "BlogComment_approved_createdAt_id_idx"
  ON "BlogComment"("approved", "createdAt", "id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "UserReport_resolved_createdAt_id_idx"
  ON "UserReport"("resolved", "createdAt", "id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "UserReport_createdAt_reporterId_idx"
  ON "UserReport"("createdAt", "reporterId");
