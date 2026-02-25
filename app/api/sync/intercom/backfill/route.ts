import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { db } from "@/lib/db";
import { enqueueFeedbackSignalsJob } from "@/lib/feedback/signal-queue";
import { enqueueFeedbackSummaryJob } from "@/lib/feedback/summary-queue";
import {
  parseIntercomBackfillInput,
  runIntercomBackfillSync
} from "@/lib/integrations/intercom-sync";

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  try {
    const input = parseIntercomBackfillInput(payload);
    const result = await runIntercomBackfillSync(
      {
        from: input.from,
        to: input.to
      },
      {
        db,
        enqueueFeedbackSummaryJob,
        enqueueFeedbackSignalsJob
      }
    );

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          job: result.job
        },
        { status: 500 }
      );
    }

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
    }

    return NextResponse.json({ error: "Unexpected error while running Intercom backfill." }, { status: 500 });
  }
}
