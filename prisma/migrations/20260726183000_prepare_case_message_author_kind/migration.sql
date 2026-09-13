-- Compatible CaseMessage integrity preparation.
--
-- authorKind is intentionally nullable until the protected aggregate-only
-- legacy inspection classifies every existing row. New application writes set
-- it from the authenticated actor's durable relationship to the parent Case.

BEGIN;

CREATE TYPE "CaseMessageAuthorKind" AS ENUM ('BUYER', 'SELLER', 'STAFF');

ALTER TABLE "CaseMessage"
  ADD COLUMN "authorKind" "CaseMessageAuthorKind";

COMMIT;
