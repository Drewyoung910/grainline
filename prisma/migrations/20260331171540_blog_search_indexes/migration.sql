-- CreateIndex
CREATE INDEX "BlogPost_title_idx" ON "public"."BlogPost"("title");

-- CreateIndex
CREATE INDEX "BlogPost_tags_idx" ON "public"."BlogPost"("tags");

-- Full-text search GIN index (title + excerpt + body)
CREATE INDEX IF NOT EXISTS "BlogPost_search_idx"
ON "public"."BlogPost"
USING GIN (
  to_tsvector('english',
    coalesce(title, '') || ' ' ||
    coalesce(excerpt, '') || ' ' ||
    coalesce(body, '')
  )
);

-- GIN index for tags array
CREATE INDEX IF NOT EXISTS "BlogPost_tags_gin_idx"
ON "public"."BlogPost"
USING GIN (tags);
