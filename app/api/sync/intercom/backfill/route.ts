import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { db } from "@/lib/db";
import { enqueueFeedbackSignalsJob } from "@/lib/feedback/signal-queue";
import { enqueueFeedbackSummaryJob } from "@/lib/feedback/summary-queue";
import { parseIntercomBackfillInput, runIntercomBackfillSync } from "@/lib/integrations/intercom-sync";

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  try {
    const parsed = parseIntercomBackfillInput(payload);
    const result = await runIntercomBackfillSync(parsed, {
      db,
      enqueueFeedbackSummaryJob,
      enqueueFeedbackSignalsJob
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          job: result.job
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      {
        message: "Intercom backfill sync completed.",
        job: result.job
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: error.issues[0]?.message ?? "Invalid backfill payload."
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: "Unexpected error while running Intercom backfill sync."
      },
      { status: 500 }
    );
  }
}
