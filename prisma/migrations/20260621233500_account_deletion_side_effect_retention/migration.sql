-- Speed up completed account-deletion side-effect retention pruning.
CREATE INDEX "AccountDeletionSideEffect_status_processedAt_idx"
ON "AccountDeletionSideEffect"("status", "processedAt");
