import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getUploadBatchStatus } from "@/lib/uploads/feedback-upload";

export async function GET(_request: Request, context: { params: Promise<{ batchId: string }> }) {
  const params = await context.params;

  const batch = await getUploadBatchStatus(params.batchId, db);
  if (!batch) {
    return NextResponse.json({ error: "Upload batch not found." }, { status: 404 });
  }

  return NextResponse.json(
    {
      batch
    },
    { status: 200 }
  );
}
