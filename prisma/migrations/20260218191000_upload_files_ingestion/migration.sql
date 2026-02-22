-- Add upload file tracking for multi-file ingestion batches.

ALTER TABLE "UploadBatch"
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "UploadFile" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT,
  "sizeBytes" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "totalRows" INTEGER NOT NULL DEFAULT 0,
  "successRows" INTEGER NOT NULL DEFAULT 0,
  "failedRows" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UploadFile_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "UploadFile"
ADD CONSTRAINT "UploadFile_batchId_fkey"
FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "UploadFile_batchId_idx" ON "UploadFile"("batchId");
