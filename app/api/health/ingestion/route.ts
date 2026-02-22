import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getIngestionHealth } from "@/lib/health/reliability-health";

export async function GET() {
  try {
    const health = await getIngestionHealth(db);
    return NextResponse.json(health, { status: 200 });
  } catch {
    return NextResponse.json(
      {
        error: "Unexpected error while loading ingestion health."
      },
      { status: 500 }
    );
  }
}
