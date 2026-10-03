-- Fail closed if historical drift contains more than one current row for a
-- user. The read-only recovery preflight must prove zero duplicate-current
-- user groups before this one concurrent statement is authorized.
CREATE UNIQUE INDEX CONCURRENTLY "UserEmailAddress_one_current_per_user_key"
ON "UserEmailAddress" ("userId")
WHERE "isCurrent" = true;
