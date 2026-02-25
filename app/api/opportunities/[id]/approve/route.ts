import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { approveOpportunity, OpportunityApprovalError } from "@/lib/opportunities/approve-opportunity";
import { recomputeOpportunityScores } from "@/lib/opportunities/scoring";

type ApprovePayload = {
  actorId?: unknown;
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let payload: ApprovePayload = {};

  try {
    payload = (await request.json()) as ApprovePayload;
  } catch {
    payload = {};
  }

  const actorId = typeof payload.actorId === "string" && payload.actorId.trim() ? payload.actorId.trim() : "pm";
  const params = await context.params;

  try {
    const opportunity = await approveOpportunity(params.id, actorId, db);
    await recomputeOpportunityScores(db);
    return NextResponse.json({ opportunity }, { status: 200 });
  } catch (error) {
    if (error instanceof OpportunityApprovalError) {
      if (error.code === "NOT_FOUND") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }

      if (error.code === "ZERO_EVIDENCE") {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
    }

    return NextResponse.json({ error: "Unexpected error while approving opportunity." }, { status: 500 });
  }
}
