CREATE TABLE "SystemAuditLog" (
    "id" TEXT NOT NULL,
    "actorType" VARCHAR(40) NOT NULL,
    "actorId" VARCHAR(255),
    "action" VARCHAR(100) NOT NULL,
    "targetType" VARCHAR(100) NOT NULL,
    "targetId" VARCHAR(255) NOT NULL,
    "reason" VARCHAR(1000),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SystemAuditLog_actorType_createdAt_idx" ON "SystemAuditLog"("actorType", "createdAt");
CREATE INDEX "SystemAuditLog_action_createdAt_idx" ON "SystemAuditLog"("action", "createdAt");
CREATE INDEX "SystemAuditLog_targetType_targetId_idx" ON "SystemAuditLog"("targetType", "targetId");
CREATE INDEX "SystemAuditLog_createdAt_idx" ON "SystemAuditLog"("createdAt");

ALTER TABLE "SystemAuditLog"
  ADD CONSTRAINT "SystemAuditLog_metadata_size_chk"
  CHECK (octet_length("metadata"::text) <= 64000) NOT VALID;
