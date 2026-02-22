-- Add sync jobs and intercom idempotency support.

CREATE TYPE "SyncJobType" AS ENUM ('intercom_backfill', 'intercom_incremental_sync');
CREATE TYPE "SyncJobStatus" AS ENUM ('running', 'succeeded', 'failed');

CREATE TABLE "SyncJob" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "jobType" "SyncJobType" NOT NULL,
  "status" "SyncJobStatus" NOT NULL,
  "fromDate" TIMESTAMP(3),
  "toDate" TIMESTAMP(3),
  "cursor" TEXT,
  "recordsProcessed" INTEGER NOT NULL DEFAULT 0,
  "apiAttempts" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FeedbackItem_source_externalId_key" ON "FeedbackItem"("source", "externalId");
CREATE INDEX "SyncJob_provider_jobType_idx" ON "SyncJob"("provider", "jobType");
CREATE INDEX "SyncJob_status_startedAt_idx" ON "SyncJob"("status", "startedAt");
