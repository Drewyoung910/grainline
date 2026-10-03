-- PostgreSQL requires CONCURRENTLY outside an explicit transaction. Account
-- export/deletion and unsubscribe replay checks must not block identity writes
-- while these suppression-key indexes are built.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "User_active_email_suppression_key_idx"
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

CREATE INDEX CONCURRENTLY IF NOT EXISTS "UserEmailAddress_current_suppression_key_idx"
ON "UserEmailAddress" (
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
  ),
  "currentSinceAt" DESC
)
WHERE "isCurrent" = true;

-- Fail closed if historical drift contains more than one current row for a
-- user. The inspection gate must report zero duplicate-current user groups
-- before this migration is authorized for Production.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "UserEmailAddress_one_current_per_user_key"
ON "UserEmailAddress" ("userId")
WHERE "isCurrent" = true;
