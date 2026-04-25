-- Additional indexes for seller metrics, admin sorting, and chronological thread reads.
-- Review_listingId_createdAt_idx already exists from 20260424_add_performance_indexes_v2;
-- keeping IF NOT EXISTS makes this migration safe across environments.

CREATE INDEX IF NOT EXISTS "Review_listingId_createdAt_idx"
  ON "Review"("listingId", "createdAt");

CREATE INDEX IF NOT EXISTS "Conversation_createdAt_idx"
  ON "Conversation"("createdAt");

CREATE INDEX IF NOT EXISTS "Order_createdAt_idx"
  ON "Order"("createdAt");

CREATE INDEX IF NOT EXISTS "CaseMessage_caseId_createdAt_idx"
  ON "CaseMessage"("caseId", "createdAt");

CREATE INDEX IF NOT EXISTS "BlogComment_postId_createdAt_idx"
  ON "BlogComment"("postId", "createdAt");
