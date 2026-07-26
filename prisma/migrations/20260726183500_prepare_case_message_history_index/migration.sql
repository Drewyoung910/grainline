-- Keep this concurrent index migration separate from the enum/column migration.
-- Every statement is rerunnable and the live CaseMessage table stays writable.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "CaseMessage_caseId_createdAt_id_idx"
  ON "CaseMessage" ("caseId", "createdAt", "id");

DROP INDEX CONCURRENTLY IF EXISTS "CaseMessage_caseId_createdAt_idx";
DROP INDEX CONCURRENTLY IF EXISTS "CaseMessage_caseId_idx";
