-- AddPerformanceIndexes
-- Adds missing indexes for common query patterns

-- Order: paidAt (analytics range queries) and fulfillmentStatus (dashboard/admin filters)
CREATE INDEX IF NOT EXISTS "Order_paidAt_idx" ON "Order"("paidAt");
CREATE INDEX IF NOT EXISTS "Order_fulfillmentStatus_idx" ON "Order"("fulfillmentStatus");

-- SavedSearch: userId (dashboard saved searches list)
CREATE INDEX IF NOT EXISTS "SavedSearch_userId_idx" ON "SavedSearch"("userId");

-- Case: buyerId (buyer order detail case lookup) and status+createdAt (admin queue sort)
CREATE INDEX IF NOT EXISTS "Case_buyerId_idx" ON "Case"("buyerId");
CREATE INDEX IF NOT EXISTS "Case_status_createdAt_idx" ON "Case"("status", "createdAt");

-- CaseMessage: caseId (loading case thread messages)
CREATE INDEX IF NOT EXISTS "CaseMessage_caseId_idx" ON "CaseMessage"("caseId");

-- Notification: read+createdAt (cleanup cron and read/unread filtering)
CREATE INDEX IF NOT EXISTS "Notification_read_createdAt_idx" ON "Notification"("read", "createdAt");
