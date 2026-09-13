-- Run legacy cleanup separately from the one-statement concurrent index build.
-- Ordinary DROP INDEX is compatible with Prisma's transactional execution.

DROP INDEX IF EXISTS "CaseMessage_caseId_createdAt_idx";
DROP INDEX IF EXISTS "CaseMessage_caseId_idx";
