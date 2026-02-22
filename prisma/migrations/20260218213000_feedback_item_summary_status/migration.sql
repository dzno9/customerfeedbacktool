-- CreateEnum
CREATE TYPE "SummaryStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- AlterTable
ALTER TABLE "FeedbackItem"
ADD COLUMN "summaryStatus" "SummaryStatus" NOT NULL DEFAULT 'pending',
ADD COLUMN "summaryError" TEXT;
