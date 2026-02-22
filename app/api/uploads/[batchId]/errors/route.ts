import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getUploadBatchErrors } from "@/lib/uploads/feedback-upload";

export async function GET(_request: Request, context: { params: Promise<{ batchId: string }> }) {
  const params = await context.params;

  const batch = await getUploadBatchErrors(params.batchId, db);
  if (!batch) {
    return NextResponse.json({ error: "Upload batch not found." }, { status: 404 });
  }

  const errors = Array.isArray(batch.errors) ? batch.errors : [];

  return NextResponse.json(
    {
      batchId: params.batchId,
      errorCount: errors.length,
      errors
    },
    { status: 200 }
  );
}
