-- Inbox search uses case-insensitive substring matching on Message.body.
-- Keep it indexable as the private message table grows. This migration is
-- intentionally non-transactional because PostgreSQL forbids CONCURRENTLY
-- inside a transaction block.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Message_body_trgm_idx"
  ON public."Message" USING GIN ("body" gin_trgm_ops);
