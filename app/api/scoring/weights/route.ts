import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { InvalidScoringWeightsError, parseScoringWeightsPatch } from "@/lib/opportunities/scoring-config";
import { recomputeOpportunityScores, updateScoringWeights } from "@/lib/opportunities/scoring";

export async function PATCH(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  try {
    const updates = parseScoringWeightsPatch(payload);
    const maybeUpdatedBy = (payload as { updatedBy?: unknown }).updatedBy;
    const updatedBy = typeof maybeUpdatedBy === "string" ? maybeUpdatedBy.trim() || null : null;

    const weights = await updateScoringWeights(db, updates, updatedBy);
    const opportunities = await recomputeOpportunityScores(db, { weights });

    return NextResponse.json(
      {
        weights,
        opportunities
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof InvalidScoringWeightsError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: "Unexpected error while updating scoring weights." }, { status: 500 });
  }
}
