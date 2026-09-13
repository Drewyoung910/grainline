CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Listing_title_trgm_active_idx"
  ON "Listing" USING GIN ("title" gin_trgm_ops)
  WHERE "status" = 'ACTIVE' AND "isPrivate" = false;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Listing_tags_gin_idx"
  ON "Listing" USING GIN ("tags");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "BlogPost_title_trgm_published_idx"
  ON "BlogPost" USING GIN ("title" gin_trgm_ops)
  WHERE "status" = 'PUBLISHED';
