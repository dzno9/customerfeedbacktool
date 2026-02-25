import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { InvalidScoringWeightsError, parseScoringWeightsPatch } from "@/lib/opportunities/scoring-config";
import { getScoringWeights, recomputeOpportunityScores, updateScoringWeights } from "@/lib/opportunities/scoring";

type WeightPatchPayload = {
  updatedBy?: unknown;
} & Record<string, unknown>;

export async function GET() {
  try {
    const weights = await getScoringWeights(db);
    return NextResponse.json({ weights }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Unexpected error while loading scoring weights." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  let payload: WeightPatchPayload;

  try {
    payload = (await request.json()) as WeightPatchPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  try {
    const updates = parseScoringWeightsPatch(payload);
    const updatedBy =
      typeof payload.updatedBy === "string" && payload.updatedBy.trim() ? payload.updatedBy.trim() : null;

    const weights = await updateScoringWeights(db, updates, updatedBy);
    await recomputeOpportunityScores(db, { weights });
    return NextResponse.json({ weights }, { status: 200 });
  } catch (error) {
    if (error instanceof InvalidScoringWeightsError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: "Unexpected error while updating scoring weights." }, { status: 500 });
  }
}
