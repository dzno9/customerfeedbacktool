import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import {
  InvalidReviewActionPayloadError,
  parseReviewActionPayload
} from "@/lib/opportunities/review-actions-config";
import { applyReviewAction, ReviewActionError } from "@/lib/opportunities/review-queue";
import { recomputeOpportunityScores } from "@/lib/opportunities/scoring";

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  try {
    const action = parseReviewActionPayload(payload);
    const result = await applyReviewAction(db, action);
    await recomputeOpportunityScores(db);

    return NextResponse.json({ result }, { status: 200 });
  } catch (error) {
    if (error instanceof InvalidReviewActionPayloadError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof ReviewActionError) {
      if (error.code === "NOT_FOUND") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }

      if (error.code === "CONFLICT") {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }

      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: "Unexpected error while applying review action." }, { status: 500 });
  }
}
