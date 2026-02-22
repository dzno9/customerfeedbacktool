import { NextResponse } from "next/server";

import { getWeeklyBriefById, WeeklyBriefError } from "@/lib/briefs/weekly-brief";
import { db } from "@/lib/db";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;

  try {
    const brief = await getWeeklyBriefById(db, params.id);

    if (!brief) {
      return NextResponse.json({ error: "Brief not found." }, { status: 404 });
    }

    return NextResponse.json({ brief }, { status: 200 });
  } catch (error) {
    if (error instanceof WeeklyBriefError && error.code === "INVALID_INPUT") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: "Unexpected error while loading weekly brief." }, { status: 500 });
  }
}
