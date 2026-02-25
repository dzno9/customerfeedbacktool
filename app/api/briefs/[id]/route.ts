import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getWeeklyBriefById, WeeklyBriefError } from "@/lib/briefs/weekly-brief";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  try {
    const brief = await getWeeklyBriefById(db, id);

    if (!brief) {
      return NextResponse.json({ error: "Weekly brief not found." }, { status: 404 });
    }

    return NextResponse.json({ brief }, { status: 200 });
  } catch (error) {
    if (error instanceof WeeklyBriefError && error.code === "INVALID_INPUT") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: "Unexpected error while loading weekly brief." }, { status: 500 });
  }
}
