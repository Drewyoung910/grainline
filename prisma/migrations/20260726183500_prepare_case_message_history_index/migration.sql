-- Keep this single concurrent statement separate from transactional migrations.
-- Prisma must execute CREATE INDEX CONCURRENTLY outside a transaction block.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "CaseMessage_caseId_createdAt_id_idx"
  ON "CaseMessage" ("caseId", "createdAt", "id");
