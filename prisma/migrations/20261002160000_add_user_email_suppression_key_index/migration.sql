-- Keep exactly one concurrent statement in this migration. Prisma submits a
-- migration file as one query; PostgreSQL treats a multi-statement query as a
-- transaction block and rejects CREATE/DROP INDEX CONCURRENTLY. The failed
-- Production attempt was rejected before this first statement had any effect,
-- so recovery can create the reviewed index without a cleanup DROP.
CREATE INDEX CONCURRENTLY "User_active_email_suppression_key_idx"
ON "User" (
  (
    CASE
      WHEN lower(split_part(btrim("email"), '@', 2)) IN ('gmail.com', 'googlemail.com')
      THEN replace(
        split_part(lower(split_part(btrim("email"), '@', 1)), '+', 1),
        '.',
        ''
      ) || '@gmail.com'
      ELSE lower(btrim("email"))
    END
  )
)
WHERE "deletedAt" IS NULL;
