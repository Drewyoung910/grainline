-- Low-risk FK/deletion-path hygiene indexes verified from audit allegations.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Listing_reservedForUserId_idx"
  ON "Listing"("reservedForUserId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Conversation_contextListingId_idx"
  ON "Conversation"("contextListingId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Case_resolvedById_idx"
  ON "Case"("resolvedById");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "MakerVerification_reviewedById_idx"
  ON "MakerVerification"("reviewedById");
