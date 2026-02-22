-- CreateEnum
CREATE TYPE "SignalStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "SignalSentiment" AS ENUM ('positive', 'neutral', 'negative', 'unclassified');

-- CreateEnum
CREATE TYPE "SignalSeverity" AS ENUM ('low', 'medium', 'high', 'critical', 'unclassified');

-- CreateEnum
CREATE TYPE "CandidateOpportunityStatus" AS ENUM ('candidate', 'none');

-- AlterTable
ALTER TABLE "FeedbackItem"
ADD COLUMN "signalStatus" "SignalStatus" NOT NULL DEFAULT 'pending',
ADD COLUMN "signalError" TEXT;

-- CreateTable
CREATE TABLE "feedback_signals" (
  "id" TEXT NOT NULL,
  "feedbackItemId" TEXT NOT NULL,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "tagsUnclassified" BOOLEAN NOT NULL DEFAULT false,
  "sentiment" "SignalSentiment" NOT NULL,
  "severity" "SignalSeverity" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "feedback_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_opportunities" (
  "id" TEXT NOT NULL,
  "feedbackItemId" TEXT NOT NULL,
  "status" "CandidateOpportunityStatus" NOT NULL,
  "opportunityText" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "candidate_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "feedback_signals_feedbackItemId_key" ON "feedback_signals"("feedbackItemId");

-- CreateIndex
CREATE INDEX "feedback_signals_sentiment_idx" ON "feedback_signals"("sentiment");

-- CreateIndex
CREATE INDEX "feedback_signals_severity_idx" ON "feedback_signals"("severity");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_opportunities_feedbackItemId_key" ON "candidate_opportunities"("feedbackItemId");

-- CreateIndex
CREATE INDEX "candidate_opportunities_status_idx" ON "candidate_opportunities"("status");

-- AddForeignKey
ALTER TABLE "feedback_signals" ADD CONSTRAINT "feedback_signals_feedbackItemId_fkey" FOREIGN KEY ("feedbackItemId") REFERENCES "FeedbackItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_opportunities" ADD CONSTRAINT "candidate_opportunities_feedbackItemId_fkey" FOREIGN KEY ("feedbackItemId") REFERENCES "FeedbackItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
