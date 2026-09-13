-- Compatible, additive indexes for bounded Conversation/Message keyset reads.
-- CONCURRENTLY avoids long write-blocking index builds when this preparation
-- migration is eventually promoted ahead of RLS activation.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Conversation_userAId_updatedAt_id_idx"
  ON "Conversation" ("userAId", "updatedAt" DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Conversation_userBId_updatedAt_id_idx"
  ON "Conversation" ("userBId", "updatedAt" DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Message_conversationId_createdAt_id_idx"
  ON "Message" ("conversationId", "createdAt" DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Message_conversationId_recipientId_readAt_idx"
  ON "Message" ("conversationId", "recipientId", "readAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Message_contextListingId_idx"
  ON "Message" ("contextListingId");
