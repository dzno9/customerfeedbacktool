import { NextResponse } from "next/server";

import { approveOpportunity, OpportunityApprovalError } from "@/lib/opportunities/approve-opportunity";
import { db } from "@/lib/db";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;

  let actorId = "system";

  try {
    const payload = (await request.json()) as { actorId?: string };
    if (typeof payload.actorId === "string" && payload.actorId.trim()) {
      actorId = payload.actorId.trim();
    }
  } catch {
    // Keep default actor for empty/invalid JSON bodies.
  }

  try {
    const opportunity = await approveOpportunity(params.id, actorId, db);
    return NextResponse.json({ opportunity }, { status: 200 });
  } catch (error) {
    if (error instanceof OpportunityApprovalError) {
      if (error.code === "NOT_FOUND") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }

      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    return NextResponse.json({ error: "Unexpected error while approving opportunity." }, { status: 500 });
  }
}
