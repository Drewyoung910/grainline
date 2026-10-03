-- PostgreSQL requires CONCURRENTLY outside an explicit transaction. Account
-- export/deletion and unsubscribe replay checks must not block identity writes
-- while these suppression-key indexes are built.
-- A failed concurrent build can leave an invalid same-name index. Dropping the
-- artifact first keeps a migration retry from treating that invalid index as
-- success through IF NOT EXISTS.
DROP INDEX CONCURRENTLY IF EXISTS "User_active_email_suppression_key_idx";

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

DROP INDEX CONCURRENTLY IF EXISTS "UserEmailAddress_current_suppression_key_idx";

CREATE INDEX CONCURRENTLY "UserEmailAddress_current_suppression_key_idx"
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
DROP INDEX CONCURRENTLY IF EXISTS "UserEmailAddress_one_current_per_user_key";

CREATE UNIQUE INDEX CONCURRENTLY "UserEmailAddress_one_current_per_user_key"
ON "UserEmailAddress" ("userId")
WHERE "isCurrent" = true;
