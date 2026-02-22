CREATE TABLE "audit_logs" (
  "id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_entityType_entityId_createdAt_idx"
ON "audit_logs"("entityType", "entityId", "createdAt");

CREATE INDEX "audit_logs_actorId_createdAt_idx"
ON "audit_logs"("actorId", "createdAt");

CREATE INDEX "audit_logs_createdAt_idx"
ON "audit_logs"("createdAt");
