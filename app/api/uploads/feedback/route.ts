import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { enqueueFeedbackSignalsJob } from "@/lib/feedback/signal-queue";
import { enqueueFeedbackSummaryJob } from "@/lib/feedback/summary-queue";
import { ingestFeedbackUpload } from "@/lib/uploads/feedback-upload";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData
      .getAll("files")
      .filter((value): value is File => value instanceof File);

    const uploadedByRaw = formData.get("uploadedBy");
    const uploadedBy = typeof uploadedByRaw === "string" && uploadedByRaw.trim() ? uploadedByRaw.trim() : undefined;

    if (files.length === 0) {
      return NextResponse.json({ error: "At least one file is required." }, { status: 400 });
    }

    const result = await ingestFeedbackUpload(
      {
        files,
        uploadedBy
      },
      {
        db,
        enqueueFeedbackSummaryJob,
        enqueueFeedbackSignalsJob
      }
    );

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unexpected error while processing upload."
      },
      { status: 400 }
    );
  }
}
