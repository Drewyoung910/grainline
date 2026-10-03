-- Keep exactly one concurrent statement in this migration so Prisma does not
-- place it in the implicit transaction created by a multi-statement query.
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
