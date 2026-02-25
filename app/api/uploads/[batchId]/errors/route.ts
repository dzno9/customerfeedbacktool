import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getUploadBatchErrors } from "@/lib/uploads/feedback-upload";

export async function GET(_request: Request, context: { params: Promise<{ batchId: string }> }) {
  const params = await context.params;

  try {
    const batch = await getUploadBatchErrors(params.batchId, db);

    if (!batch) {
      return NextResponse.json({ error: "Upload batch not found." }, { status: 404 });
    }

    return NextResponse.json(
      {
        batchId: params.batchId,
        errors: batch.errors ?? []
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json({ error: "Unexpected error while loading upload errors." }, { status: 500 });
  }
}
