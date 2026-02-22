import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { enqueueFeedbackSignalsJob } from "@/lib/feedback/signal-queue";
import { enqueueFeedbackSummaryJob } from "@/lib/feedback/summary-queue";
import { ingestFeedbackUpload } from "@/lib/uploads/feedback-upload";

export async function POST(request: Request) {
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form data." }, { status: 400 });
  }

  const files = [
    ...formData
      .getAll("files")
      .filter((entry): entry is File => typeof File !== "undefined" && entry instanceof File),
    ...formData
      .getAll("file")
      .filter((entry): entry is File => typeof File !== "undefined" && entry instanceof File)
  ];

  const uploadedBy = formData.get("uploadedBy");

  try {
    const result = await ingestFeedbackUpload(
      {
        files,
        uploadedBy: typeof uploadedBy === "string" && uploadedBy.trim() ? uploadedBy.trim() : undefined
      },
      {
        db,
        enqueueFeedbackSummaryJob,
        enqueueFeedbackSignalsJob
      }
    );

    return NextResponse.json(
      {
        message: "Upload ingestion completed.",
        batch: result
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected upload ingestion error.";
    const status =
      message.includes("required") ||
      message.includes("Unsupported") ||
      message.includes("upload limit") ||
      message.includes("exceeds limit")
        ? 400
        : 500;

    return NextResponse.json(
      {
        error: message
      },
      { status }
    );
  }
}
