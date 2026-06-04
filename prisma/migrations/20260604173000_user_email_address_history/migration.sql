CREATE TABLE "UserEmailAddress" (
  "id" TEXT NOT NULL,
  "userId" VARCHAR(191) NOT NULL,
  "email" VARCHAR(254) NOT NULL,
  "source" VARCHAR(80),
  "isCurrent" BOOLEAN NOT NULL DEFAULT false,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserEmailAddress_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "UserEmailAddress"
  ADD CONSTRAINT "UserEmailAddress_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "UserEmailAddress_userId_email_key" ON "UserEmailAddress"("userId", "email");
CREATE INDEX "UserEmailAddress_email_idx" ON "UserEmailAddress"("email");
CREATE INDEX "UserEmailAddress_userId_isCurrent_idx" ON "UserEmailAddress"("userId", "isCurrent");

INSERT INTO "UserEmailAddress" ("id", "userId", "email", "source", "isCurrent", "firstSeenAt", "lastSeenAt")
SELECT
  'user_email_current_' || md5(u."id" || ':' || u."email"),
  u."id",
  u."email",
  'current_user_email',
  true,
  COALESCE(u."createdAt", CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP
FROM "User" u
WHERE u."email" IS NOT NULL
ON CONFLICT ("userId", "email") DO UPDATE
SET
  "isCurrent" = true,
  "lastSeenAt" = CURRENT_TIMESTAMP;

INSERT INTO "UserEmailAddress" ("id", "userId", "email", "source", "isCurrent", "firstSeenAt", "lastSeenAt")
SELECT
  'user_email_outbox_' || md5(e."userId" || ':' || e."recipientEmail"),
  e."userId",
  e."recipientEmail",
  'email_outbox_user_link',
  false,
  MIN(e."createdAt"),
  MAX(e."createdAt")
FROM "EmailOutbox" e
WHERE e."userId" IS NOT NULL
GROUP BY e."userId", e."recipientEmail"
ON CONFLICT ("userId", "email") DO UPDATE
SET
  "lastSeenAt" = GREATEST("UserEmailAddress"."lastSeenAt", EXCLUDED."lastSeenAt");
