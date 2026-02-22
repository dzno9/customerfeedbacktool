import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { listWeeklyBriefs } from "@/lib/briefs/list-weekly-briefs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawLimit = Number(searchParams.get("limit") ?? "20");
    const limit = Number.isFinite(rawLimit) ? rawLimit : 20;

    const briefs = await listWeeklyBriefs(db, { limit });

    return NextResponse.json({ briefs }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Unexpected error while loading weekly briefs." }, { status: 500 });
  }
}
