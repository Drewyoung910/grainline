-- Accelerates the terminal-row retention sweep in pruneEmailOutboxRetention().
-- The retention query filters terminal rows by status and orders by updatedAt.
CREATE INDEX "EmailOutbox_status_updatedAt_idx" ON "public"."EmailOutbox"("status", "updatedAt");
