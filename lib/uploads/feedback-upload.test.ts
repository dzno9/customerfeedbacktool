import { describe, expect, it } from "vitest";

import {
  BATCH_STATUS,
  MAX_FILE_SIZE_BYTES,
  getUploadBatchErrors,
  ingestFeedbackUpload
} from "./feedback-upload";

type StoredFeedbackItem = {
  id: string;
  source: "upload";
  externalId?: string;
  rawText: string;
  occurredAt: Date;
};

type StoredUploadBatch = {
  id: string;
  filename: string;
  status: string;
  totalRows: number;
  successRows: number;
  failedRows: number;
  uploadedBy?: string;
};

type StoredUploadFile = {
  id: string;
  batchId: string;
  filename: string;
  status: string;
  totalRows: number;
  successRows: number;
  failedRows: number;
  errorMessage?: string;
  createdAt: Date;
};

type StoredUploadError = {
  id: string;
  batchId: string;
  rowRef?: string;
  errorCode: string;
  errorMessage: string;
  createdAt: Date;
};

function makeUploadFile(name: string, content: string, type: string) {
  const buffer = Buffer.from(content, "utf8");

  return {
    name,
    size: buffer.byteLength,
    type,
    async arrayBuffer() {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
  };
}

function createFakeDb() {
  let batchSeq = 1;
  let fileSeq = 1;
  let feedbackSeq = 1;

  const batches = new Map<string, StoredUploadBatch>();
  const files = new Map<string, StoredUploadFile>();
  const feedbackItems: StoredFeedbackItem[] = [];
  const errors: StoredUploadError[] = [];

  return {
    uploadBatch: {
      async create(args: { data: { filename: string; status: string; uploadedBy?: string } }) {
        const id = `batch_${batchSeq++}`;
        batches.set(id, {
          id,
          filename: args.data.filename,
          status: args.data.status,
          uploadedBy: args.data.uploadedBy,
          totalRows: 0,
          successRows: 0,
          failedRows: 0
        });

        return { id };
      },
      async update(args: {
        where: { id: string };
        data: { status: string; totalRows: number; successRows: number; failedRows: number };
      }) {
        const current = batches.get(args.where.id);
        if (!current) {
          throw new Error("batch not found");
        }

        const next = {
          ...current,
          ...args.data
        };

        batches.set(args.where.id, next);
        return next;
      },
      async findUnique(args: {
        where: { id: string };
        include?: {
          files?: {
            orderBy?: { createdAt: "asc" | "desc" };
          };
          errors?: {
            orderBy?: { createdAt: "asc" | "desc" };
          };
        };
      }) {
        const batch = batches.get(args.where.id);
        if (!batch) {
          return null;
        }

        const includeFiles = !!args.include?.files;
        const includeErrors = !!args.include?.errors;

        const sortedFiles = includeFiles
          ? Array.from(files.values())
              .filter((file) => file.batchId === batch.id)
              .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
          : undefined;

        const sortedErrors = includeErrors
          ? errors
              .filter((error) => error.batchId === batch.id)
              .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
          : undefined;

        return {
          ...batch,
          ...(sortedFiles ? { files: sortedFiles } : {}),
          ...(sortedErrors ? { errors: sortedErrors } : {})
        };
      }
    },
    uploadFile: {
      async create(args: {
        data: { batchId: string; filename: string; status: string; mimeType?: string; sizeBytes: number };
      }) {
        const id = `file_${fileSeq++}`;
        files.set(id, {
          id,
          batchId: args.data.batchId,
          filename: args.data.filename,
          status: args.data.status,
          totalRows: 0,
          successRows: 0,
          failedRows: 0,
          createdAt: new Date()
        });

        return { id };
      },
      async update(args: {
        where: { id: string };
        data: {
          status: string;
          totalRows: number;
          successRows: number;
          failedRows: number;
          errorMessage?: string;
        };
      }) {
        const current = files.get(args.where.id);
        if (!current) {
          throw new Error("file not found");
        }

        files.set(args.where.id, {
          ...current,
          ...args.data
        });
      }
    },
    uploadError: {
      async create(args: {
        data: {
          batchId: string;
          rowRef?: string;
          errorCode: string;
          errorMessage: string;
        };
      }) {
        errors.push({
          id: `error_${errors.length + 1}`,
          createdAt: new Date(),
          ...args.data
        });
      }
    },
    feedbackItem: {
      async create(args: { data: Omit<StoredFeedbackItem, "id">; select?: { id: true } }) {
        const id = `feedback_${feedbackSeq++}`;
        feedbackItems.push({
          id,
          ...args.data
        });
        return { id };
      }
    },
    __state: {
      getBatches: () => Array.from(batches.values()),
      getFiles: () => Array.from(files.values()),
      getFeedbackItems: () => feedbackItems,
      getErrors: () => errors
    }
  };
}

describe("ingestFeedbackUpload", () => {
  it("ingests expected row count from valid CSV upload", async () => {
    const db = createFakeDb();

    const file = makeUploadFile(
      "feedback.csv",
      "occurred_at,feedback,customer_email\n2026-02-18T10:00:00.000Z,Need SSO,sso@example.com\n2026-02-18T11:00:00.000Z,Improve onboarding,onboarding@example.com",
      "text/csv"
    );

    const result = await ingestFeedbackUpload(
      {
        files: [file],
        uploadedBy: "pm@example.com"
      },
      {
        db,
        now: () => new Date("2026-02-18T12:00:00.000Z")
      }
    );

    expect(result.status).toBe(BATCH_STATUS.success);
    expect(result.totalRows).toBe(2);
    expect(result.successRows).toBe(2);
    expect(result.failedRows).toBe(0);
    expect(db.__state.getFeedbackItems()).toHaveLength(2);
  });

  it("enqueues summary and signal jobs for newly created feedback items", async () => {
    const db = createFakeDb();
    const summaryEnqueued: string[] = [];
    const signalEnqueued: string[] = [];

    const file = makeUploadFile(
      "feedback.csv",
      "occurred_at,feedback\n2026-02-18T10:00:00.000Z,Need SSO",
      "text/csv"
    );

    await ingestFeedbackUpload(
      {
        files: [file]
      },
      {
        db,
        enqueueFeedbackSummaryJob: async (feedbackItemId) => {
          summaryEnqueued.push(feedbackItemId);
        },
        enqueueFeedbackSignalsJob: async (feedbackItemId) => {
          signalEnqueued.push(feedbackItemId);
        }
      }
    );

    expect(summaryEnqueued).toHaveLength(1);
    expect(signalEnqueued).toHaveLength(1);
    expect(summaryEnqueued[0]).toBe(db.__state.getFeedbackItems()[0]?.id);
    expect(signalEnqueued[0]).toBe(db.__state.getFeedbackItems()[0]?.id);
  });

  it("ingests extracted text items from DOCX and PDF uploads", async () => {
    const db = createFakeDb();

    const docx = makeUploadFile("notes.docx", "fake-docx-binary", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const pdf = makeUploadFile("transcript.pdf", "fake-pdf-binary", "application/pdf");

    const result = await ingestFeedbackUpload(
      {
        files: [docx, pdf]
      },
      {
        db,
        now: () => new Date("2026-02-18T12:00:00.000Z"),
        extractDocxText: async () => "Customers ask for dark mode\n\nNeed usage analytics",
        extractPdfText: async () => "Missing webhooks for events"
      }
    );

    expect(result.status).toBe(BATCH_STATUS.success);
    expect(result.totalRows).toBe(3);
    expect(result.successRows).toBe(3);
    expect(result.failedRows).toBe(0);

    const feedback = db.__state.getFeedbackItems().map((item) => item.rawText);
    expect(feedback).toEqual([
      "Customers ask for dark mode",
      "Need usage analytics",
      "Missing webhooks for events"
    ]);
  });

  it("processes a large TXT file within size limit", async () => {
    const db = createFakeDb();

    const paragraphs = Array.from({ length: 800 }, (_, idx) => `Feedback paragraph ${idx + 1}`).join("\n\n");
    const file = makeUploadFile("bulk.txt", paragraphs, "text/plain");

    expect(file.size).toBeLessThan(MAX_FILE_SIZE_BYTES);

    const result = await ingestFeedbackUpload(
      {
        files: [file]
      },
      {
        db,
        now: () => new Date("2026-02-18T12:00:00.000Z")
      }
    );

    expect(result.status).toBe(BATCH_STATUS.success);
    expect(result.totalRows).toBe(800);
    expect(result.successRows).toBe(800);
    expect(result.failedRows).toBe(0);
    expect(db.__state.getErrors()).toHaveLength(0);
  });

  it("rejects unsupported file extensions before batch processing", async () => {
    const db = createFakeDb();
    const file = makeUploadFile("feedback.json", '{"feedback":"Need SSO"}', "application/json");

    await expect(
      ingestFeedbackUpload(
        {
          files: [file]
        },
        { db }
      )
    ).rejects.toThrow("Unsupported file type");

    expect(db.__state.getBatches()).toHaveLength(0);
    expect(db.__state.getFiles()).toHaveLength(0);
    expect(db.__state.getFeedbackItems()).toHaveLength(0);
    expect(db.__state.getErrors()).toHaveLength(0);
  });

  it("supports partial success when CSV rows include validation errors", async () => {
    const db = createFakeDb();
    const file = makeUploadFile(
      "mixed.csv",
      "occurred_at,feedback\n2026-02-18T10:00:00.000Z,Need SSO\n2026-02-18T11:00:00.000Z,\nnot-a-date,Need usage dashboard",
      "text/csv"
    );

    const result = await ingestFeedbackUpload(
      {
        files: [file]
      },
      {
        db,
        now: () => new Date("2026-02-18T12:00:00.000Z")
      }
    );

    expect(result.status).toBe(BATCH_STATUS.partialFailed);
    expect(result.totalRows).toBe(3);
    expect(result.successRows).toBe(1);
    expect(result.failedRows).toBe(2);
    expect(db.__state.getFeedbackItems()).toHaveLength(1);

    const errors = db.__state.getErrors();
    expect(errors).toHaveLength(2);
    expect(errors[0]?.rowRef).toBe("mixed.csv:2");
    expect(errors[1]?.rowRef).toBe("mixed.csv:3");
  });

  it("returns structured failures for a batch", async () => {
    const db = createFakeDb();
    const file = makeUploadFile(
      "errors.csv",
      "occurred_at,feedback\n2026-02-18T10:00:00.000Z,\ninvalid-date,Still invalid",
      "text/csv"
    );

    const ingestion = await ingestFeedbackUpload(
      {
        files: [file]
      },
      {
        db,
        now: () => new Date("2026-02-18T12:00:00.000Z")
      }
    );

    const report = await getUploadBatchErrors(ingestion.batchId, db);

    expect(report).not.toBeNull();
    expect(Array.isArray(report?.errors)).toBe(true);
    expect(report?.errors).toHaveLength(2);
    expect(report?.errors?.[0]).toMatchObject({
      rowRef: "errors.csv:1",
      errorCode: "row_parse_error"
    });
    expect(report?.errors?.[1]).toMatchObject({
      rowRef: "errors.csv:2",
      errorCode: "row_parse_error"
    });
  });

  it("rejects when file count exceeds configured limit", async () => {
    const db = createFakeDb();
    const files = [
      makeUploadFile("f1.txt", "a", "text/plain"),
      makeUploadFile("f2.txt", "b", "text/plain")
    ];

    await expect(
      ingestFeedbackUpload(
        { files },
        {
          db,
          maxFilesPerBatch: 1
        }
      )
    ).rejects.toThrow("File count exceeds limit");

    expect(db.__state.getBatches()).toHaveLength(0);
  });

  it("marks file as failed when row count exceeds per-file limit", async () => {
    const db = createFakeDb();
    const file = makeUploadFile("many.txt", "row1\n\nrow2\n\nrow3", "text/plain");

    const result = await ingestFeedbackUpload(
      { files: [file] },
      {
        db,
        maxRowsPerFile: 2
      }
    );

    expect(result.status).toBe(BATCH_STATUS.failed);
    expect(result.successRows).toBe(0);
    expect(result.failedRows).toBe(1);
    expect(db.__state.getErrors()[0]?.errorMessage).toContain("Row count exceeds limit");
  });

  it("marks file as failed when batch row limit would be exceeded", async () => {
    const db = createFakeDb();
    const fileA = makeUploadFile("a.txt", "a1\n\na2", "text/plain");
    const fileB = makeUploadFile("b.txt", "b1\n\nb2", "text/plain");

    const result = await ingestFeedbackUpload(
      { files: [fileA, fileB] },
      {
        db,
        maxRowsPerBatch: 3
      }
    );

    expect(result.status).toBe(BATCH_STATUS.partialFailed);
    expect(result.successRows).toBe(2);
    expect(result.failedRows).toBe(1);
    expect(db.__state.getErrors().at(-1)?.errorMessage).toContain("Batch row count exceeds limit");
  });
});
