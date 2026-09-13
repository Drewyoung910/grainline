CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Listing_description_trgm_active_idx"
  ON "Listing" USING GIN ("description" gin_trgm_ops)
  WHERE "status" = 'ACTIVE' AND "isPrivate" = false;
