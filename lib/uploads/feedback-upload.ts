import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { toCanonicalFeedbackItem } from "../feedback/canonical-feedback";

const execFileAsync = promisify(execFile);

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_BATCH = 10;
const MAX_ROWS_PER_FILE = 5_000;
const MAX_ROWS_PER_BATCH = 20_000;

const CSV_MIME_TYPES = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel"
]);
const TEXT_MIME_TYPES = new Set(["text/plain"]);
const DOCX_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);
const PDF_MIME_TYPES = new Set(["application/pdf"]);

const BATCH_STATUS = {
  processing: "processing",
  success: "success",
  partialFailed: "partial_failed",
  failed: "failed"
} as const;

type UploadFileLike = {
  name: string;
  size: number;
  type: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

type UploadIngestionInput = {
  files: UploadFileLike[];
  uploadedBy?: string;
};

type ParsedUploadRow = Record<string, unknown>;

type UploadDb = {
  uploadBatch: {
    create: (args: any) => Promise<{ id: string }>;
    update: (args: any) => Promise<{ id: string; status: string; totalRows: number; successRows: number; failedRows: number }>;
    findUnique: (args: {
      where: { id: string };
      include?: {
        files?: {
          orderBy?: { createdAt: "asc" | "desc" };
        };
        errors?: {
          orderBy?: { createdAt: "asc" | "desc" };
        };
      };
    }) => Promise<
      | (Record<string, unknown> & {
          files?: Record<string, unknown>[];
          errors?: Record<string, unknown>[];
        })
      | null
    >;
  };
  uploadFile: {
    create: (args: any) => Promise<{ id: string }>;
    update: (args: any) => Promise<unknown>;
  };
  uploadError: {
    create: (args: any) => Promise<unknown>;
  };
  feedbackItem: {
    create: (args: any) => Promise<{ id: string } | unknown>;
  };
};

type UploadIngestionDeps = {
  db: UploadDb;
  now?: () => Date;
  maxFileSizeBytes?: number;
  maxFilesPerBatch?: number;
  maxRowsPerFile?: number;
  maxRowsPerBatch?: number;
  extractDocxText?: (buffer: Buffer) => Promise<string>;
  extractPdfText?: (buffer: Buffer) => Promise<string>;
  enqueueFeedbackSummaryJob?: (feedbackItemId: string) => Promise<void>;
  enqueueFeedbackSignalsJob?: (feedbackItemId: string) => Promise<void>;
};

type UploadIngestionResult = {
  batchId: string;
  status: string;
  totalRows: number;
  successRows: number;
  failedRows: number;
};

function toExtension(filename: string): string {
  const index = filename.lastIndexOf(".");
  return index >= 0 ? filename.slice(index).toLowerCase() : "";
}

function inferFormat(file: UploadFileLike): "csv" | "txt" | "docx" | "pdf" | undefined {
  const extension = toExtension(file.name);
  const mimeType = file.type.trim().toLowerCase();

  if (extension === ".csv" || CSV_MIME_TYPES.has(mimeType)) {
    return "csv";
  }

  if (extension === ".txt" || TEXT_MIME_TYPES.has(mimeType)) {
    return "txt";
  }

  if (extension === ".docx" || DOCX_MIME_TYPES.has(mimeType)) {
    return "docx";
  }

  if (extension === ".pdf" || PDF_MIME_TYPES.has(mimeType)) {
    return "pdf";
  }

  return undefined;
}

function stripBom(value: string): string {
  return value.replace(/^\uFEFF/, "");
}

function parseCsv(text: string): ParsedUploadRow[] {
  const content = stripBom(text).trim();
  if (!content) {
    return [];
  }

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        currentCell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }

      currentRow.push(currentCell.trim());
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
      continue;
    }

    currentCell += char;
  }

  currentRow.push(currentCell.trim());
  rows.push(currentRow);

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((header, idx) => header || `column_${idx + 1}`);
  return rows.slice(1).map((row) => {
    const payload: ParsedUploadRow = {};
    headers.forEach((header, idx) => {
      const value = row[idx];
      if (value !== undefined && value.length > 0) {
        payload[header] = value;
      }
    });
    return payload;
  });
}

function textToRows(text: string): ParsedUploadRow[] {
  return stripBom(text)
    .split(/\n\s*\n|\r\n\s*\r\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => ({ rawText: line }));
}

async function withTempFile<T>(extension: string, buffer: Buffer, task: (filePath: string) => Promise<T>) {
  const tempDir = await mkdtemp(join(tmpdir(), "feedback-upload-"));
  const filePath = join(tempDir, `input${extension}`);

  try {
    await writeFile(filePath, buffer);
    return await task(filePath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function defaultExtractDocxText(buffer: Buffer): Promise<string> {
  return withTempFile(".docx", buffer, async (filePath) => {
    const { stdout } = await execFileAsync("textutil", ["-convert", "txt", "-stdout", filePath]);
    return stdout;
  });
}

async function defaultExtractPdfText(buffer: Buffer): Promise<string> {
  return withTempFile(".pdf", buffer, async (filePath) => {
    const { stdout } = await execFileAsync("pdftotext", ["-layout", filePath, "-"]);
    return stdout;
  });
}

function normalizeUploadRow(
  row: ParsedUploadRow,
  now: Date,
  fileName: string,
  rowIndex: number
): ParsedUploadRow {
  const normalized: ParsedUploadRow = {
    ...row,
    occurred_at:
      typeof row.occurred_at === "string" || typeof row.occurredAt === "string"
        ? row.occurred_at ?? row.occurredAt
        : now.toISOString(),
    external_id:
      typeof row.external_id === "string" || typeof row.externalId === "string"
        ? row.external_id ?? row.externalId
        : `${fileName}:${rowIndex + 1}`
  };

  if (
    typeof normalized.rawText !== "string" &&
    typeof normalized.raw_text !== "string" &&
    typeof normalized.message !== "string" &&
    typeof normalized.body !== "string" &&
    typeof normalized.feedback !== "string" &&
    typeof normalized.content !== "string"
  ) {
    throw new Error("Missing raw text fields for row.");
  }

  return normalized;
}

async function parseFileIntoRows(
  file: UploadFileLike,
  deps: UploadIngestionDeps
): Promise<ParsedUploadRow[]> {
  const format = inferFormat(file);
  if (!format) {
    throw new Error(`Unsupported file type for ${file.name}.`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  if (format === "csv") {
    return parseCsv(buffer.toString("utf8"));
  }

  if (format === "txt") {
    return textToRows(buffer.toString("utf8"));
  }

  if (format === "docx") {
    const extract = deps.extractDocxText ?? defaultExtractDocxText;
    const text = await extract(buffer);
    return textToRows(text);
  }

  const extract = deps.extractPdfText ?? defaultExtractPdfText;
  const text = await extract(buffer);
  return textToRows(text);
}

function toBatchStatus(successRows: number, failedRows: number): string {
  if (successRows === 0) {
    return BATCH_STATUS.failed;
  }

  if (failedRows > 0) {
    return BATCH_STATUS.partialFailed;
  }

  return BATCH_STATUS.success;
}

export async function ingestFeedbackUpload(
  input: UploadIngestionInput,
  deps: UploadIngestionDeps
): Promise<UploadIngestionResult> {
  if (!input.files || input.files.length === 0) {
    throw new Error("At least one file is required.");
  }

  const maxFileSizeBytes = deps.maxFileSizeBytes ?? MAX_FILE_SIZE_BYTES;
  const maxFilesPerBatch = deps.maxFilesPerBatch ?? MAX_FILES_PER_BATCH;
  const maxRowsPerFile = deps.maxRowsPerFile ?? MAX_ROWS_PER_FILE;
  const maxRowsPerBatch = deps.maxRowsPerBatch ?? MAX_ROWS_PER_BATCH;

  if (input.files.length > maxFilesPerBatch) {
    throw new Error(`File count exceeds limit of ${maxFilesPerBatch} files per upload batch.`);
  }

  for (const file of input.files) {
    if (file.size > maxFileSizeBytes) {
      throw new Error(`File ${file.name} exceeds the upload limit of ${maxFileSizeBytes} bytes.`);
    }

    if (!inferFormat(file)) {
      throw new Error(`Unsupported file type for ${file.name}. Supported types: .csv, .txt, .docx, .pdf.`);
    }
  }

  const batch = await deps.db.uploadBatch.create({
    data: {
      filename: input.files.length === 1 ? input.files[0].name : `${input.files.length} files`,
      status: BATCH_STATUS.processing,
      uploadedBy: input.uploadedBy
    }
  });

  let totalRows = 0;
  let successRows = 0;
  let failedRows = 0;

  for (const file of input.files) {
    const uploadFile = await deps.db.uploadFile.create({
      data: {
        batchId: batch.id,
        filename: file.name,
        mimeType: file.type || undefined,
        sizeBytes: file.size,
        status: BATCH_STATUS.processing
      }
    });

    let fileTotalRows = 0;
    let fileSuccessRows = 0;
    let fileFailedRows = 0;

    try {
      const rows = await parseFileIntoRows(file, deps);
      if (rows.length > maxRowsPerFile) {
        throw new Error(
          `Row count exceeds limit of ${maxRowsPerFile} rows per file for ${file.name}.`
        );
      }

      if (totalRows + rows.length > maxRowsPerBatch) {
        throw new Error(
          `Batch row count exceeds limit of ${maxRowsPerBatch} rows across uploaded files.`
        );
      }

      fileTotalRows = rows.length;

      for (let index = 0; index < rows.length; index += 1) {
        totalRows += 1;

        try {
          const normalized = normalizeUploadRow(rows[index], deps.now?.() ?? new Date(), file.name, index);
          const canonical = toCanonicalFeedbackItem("upload", normalized);

          const created = await deps.db.feedbackItem.create({
            data: canonical,
            select: {
              id: true
            }
          });

          if (typeof created === "object" && created !== null && "id" in created) {
            const feedbackItemId = (created as { id?: unknown }).id;
            if (typeof feedbackItemId === "string") {
              if (deps.enqueueFeedbackSummaryJob) {
                await deps.enqueueFeedbackSummaryJob(feedbackItemId);
              }
              if (deps.enqueueFeedbackSignalsJob) {
                await deps.enqueueFeedbackSignalsJob(feedbackItemId);
              }
            }
          }

          successRows += 1;
          fileSuccessRows += 1;
        } catch (error) {
          failedRows += 1;
          fileFailedRows += 1;

          await deps.db.uploadError.create({
            data: {
              batchId: batch.id,
              rowRef: `${file.name}:${index + 1}`,
              errorCode: "row_parse_error",
              errorMessage: error instanceof Error ? error.message : "Unexpected row parsing error."
            }
          });
        }
      }

      await deps.db.uploadFile.update({
        where: {
          id: uploadFile.id
        },
        data: {
          status: toBatchStatus(fileSuccessRows, fileFailedRows),
          totalRows: fileTotalRows,
          successRows: fileSuccessRows,
          failedRows: fileFailedRows
        }
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unexpected file parsing error.";

      failedRows += 1;
      totalRows += 1;
      fileTotalRows += 1;
      fileFailedRows += 1;

      await deps.db.uploadError.create({
        data: {
          batchId: batch.id,
          rowRef: file.name,
          errorCode: "file_parse_error",
          errorMessage
        }
      });

      await deps.db.uploadFile.update({
        where: {
          id: uploadFile.id
        },
        data: {
          status: BATCH_STATUS.failed,
          totalRows: fileTotalRows,
          successRows: fileSuccessRows,
          failedRows: fileFailedRows,
          errorMessage
        }
      });
    }
  }

  const batchStatus = toBatchStatus(successRows, failedRows);
  const updated = await deps.db.uploadBatch.update({
    where: {
      id: batch.id
    },
    data: {
      status: batchStatus,
      totalRows,
      successRows,
      failedRows
    }
  });

  return {
    batchId: updated.id,
    status: updated.status,
    totalRows: updated.totalRows,
    successRows: updated.successRows,
    failedRows: updated.failedRows
  };
}

export async function getUploadBatchStatus(batchId: string, db: UploadDb) {
  return db.uploadBatch.findUnique({
    where: {
      id: batchId
    },
    include: {
      files: {
        orderBy: {
          createdAt: "asc"
        }
      },
      errors: {
        orderBy: {
          createdAt: "asc"
        }
      }
    }
  });
}

export async function getUploadBatchErrors(batchId: string, db: UploadDb) {
  return db.uploadBatch.findUnique({
    where: {
      id: batchId
    },
    include: {
      errors: {
        orderBy: {
          createdAt: "asc"
        }
      }
    }
  });
}

export { BATCH_STATUS, MAX_FILE_SIZE_BYTES };
export { MAX_FILES_PER_BATCH, MAX_ROWS_PER_BATCH, MAX_ROWS_PER_FILE };
