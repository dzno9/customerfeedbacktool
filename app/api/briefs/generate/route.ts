import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { generateWeeklyBrief, WeeklyBriefError } from "@/lib/briefs/weekly-brief";
import { recomputeOpportunityScores } from "@/lib/opportunities/scoring";

type GenerateBriefPayload = {
  startDate?: unknown;
  endDate?: unknown;
  generatedBy?: unknown;
};

function parsePayload(payload: GenerateBriefPayload): { startDate: string; endDate: string; generatedBy?: string } {
  if (typeof payload.startDate !== "string" || typeof payload.endDate !== "string") {
    throw new WeeklyBriefError("INVALID_INPUT", "startDate and endDate are required string fields.");
  }

  if (payload.generatedBy !== undefined && typeof payload.generatedBy !== "string") {
    throw new WeeklyBriefError("INVALID_INPUT", "generatedBy must be a string when provided.");
  }

  return {
    startDate: payload.startDate,
    endDate: payload.endDate,
    generatedBy: payload.generatedBy
  };
}

export async function POST(request: Request) {
  let payload: GenerateBriefPayload;

  try {
    payload = (await request.json()) as GenerateBriefPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  try {
    const input = parsePayload(payload);
    await recomputeOpportunityScores(db);
    const brief = await generateWeeklyBrief(db, input);
    return NextResponse.json({ brief }, { status: 201 });
  } catch (error) {
    if (error instanceof WeeklyBriefError && error.code === "INVALID_INPUT") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: "Unexpected error while generating weekly brief." }, { status: 500 });
  }
}
