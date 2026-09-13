-- Support public seller/author substring search predicates.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "SellerProfile_displayName_trgm_idx"
  ON "SellerProfile" USING GIN ("displayName" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "SellerProfile_displayNameNormalized_trgm_idx"
  ON "SellerProfile" USING GIN ("displayNameNormalized" gin_trgm_ops);
