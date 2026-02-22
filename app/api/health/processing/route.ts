import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getProcessingHealth } from "@/lib/health/reliability-health";

export async function GET() {
  try {
    const health = await getProcessingHealth(db);
    return NextResponse.json(health, { status: 200 });
  } catch {
    return NextResponse.json(
      {
        error: "Unexpected error while loading processing health."
      },
      { status: 500 }
    );
  }
}
