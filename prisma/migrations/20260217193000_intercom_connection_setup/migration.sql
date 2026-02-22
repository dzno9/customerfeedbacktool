-- Initial schema for Customer Feedback Consolidation MVP.

-- Create enums
CREATE TYPE "FeedbackSource" AS ENUM ('intercom', 'upload');
CREATE TYPE "ProcessingStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');
CREATE TYPE "OpportunityStatus" AS ENUM ('suggested', 'approved', 'rejected');
CREATE TYPE "ReviewActionType" AS ENUM ('approve', 'reject', 'merge', 'split', 'relabel');

-- Create tables
CREATE TABLE "FeedbackItem" (
  "id" TEXT NOT NULL,
  "source" "FeedbackSource" NOT NULL,
  "externalId" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "rawText" TEXT NOT NULL,
  "summary" TEXT,
  "customerName" TEXT,
  "customerEmail" TEXT,
  "accountId" TEXT,
  "sentiment" TEXT,
  "severity" TEXT,
  "metadataJson" JSONB,
  "sourceUrl" TEXT,
  "processingStatus" "ProcessingStatus" NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "FeedbackItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UploadBatch" (
  "id" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "totalRows" INTEGER NOT NULL DEFAULT 0,
  "successRows" INTEGER NOT NULL DEFAULT 0,
  "failedRows" INTEGER NOT NULL DEFAULT 0,
  "uploadedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UploadBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UploadError" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "rowRef" TEXT,
  "errorCode" TEXT NOT NULL,
  "errorMessage" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UploadError_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Opportunity" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" "OpportunityStatus" NOT NULL DEFAULT 'suggested',
  "scoreTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "scoreFrequency" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "scoreRecency" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "scoreSeverity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "scoreSegment" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "evidenceCount" INTEGER NOT NULL DEFAULT 0,
  "lastEvidenceAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OpportunityItem" (
  "opportunityId" TEXT NOT NULL,
  "feedbackItemId" TEXT NOT NULL,
  "similarityScore" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpportunityItem_pkey" PRIMARY KEY ("opportunityId", "feedbackItemId")
);

CREATE TABLE "ReviewAction" (
  "id" TEXT NOT NULL,
  "opportunityId" TEXT NOT NULL,
  "action" "ReviewActionType" NOT NULL,
  "payloadJson" JSONB,
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReviewAction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScoringConfig" (
  "id" TEXT NOT NULL,
  "frequencyWeight" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "recencyWeight" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "severityWeight" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "segmentWeight" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScoringConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WeeklyBrief" (
  "id" TEXT NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "snapshotJson" JSONB NOT NULL,
  "generatedBy" TEXT,
  CONSTRAINT "WeeklyBrief_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IntegrationConnection" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "encryptedCredentials" TEXT NOT NULL,
  "lastCheckedAt" TIMESTAMP(3),
  "lastSyncAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "UploadError"
ADD CONSTRAINT "UploadError_batchId_fkey"
FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OpportunityItem"
ADD CONSTRAINT "OpportunityItem_opportunityId_fkey"
FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OpportunityItem"
ADD CONSTRAINT "OpportunityItem_feedbackItemId_fkey"
FOREIGN KEY ("feedbackItemId") REFERENCES "FeedbackItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReviewAction"
ADD CONSTRAINT "ReviewAction_opportunityId_fkey"
FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "FeedbackItem_source_idx" ON "FeedbackItem"("source");
CREATE INDEX "FeedbackItem_externalId_idx" ON "FeedbackItem"("externalId");
CREATE INDEX "FeedbackItem_occurredAt_idx" ON "FeedbackItem"("occurredAt");
CREATE INDEX "UploadError_batchId_idx" ON "UploadError"("batchId");
CREATE INDEX "OpportunityItem_feedbackItemId_idx" ON "OpportunityItem"("feedbackItemId");
CREATE INDEX "ReviewAction_opportunityId_idx" ON "ReviewAction"("opportunityId");
CREATE INDEX "ReviewAction_actorId_idx" ON "ReviewAction"("actorId");
CREATE UNIQUE INDEX "IntegrationConnection_provider_key" ON "IntegrationConnection"("provider");
