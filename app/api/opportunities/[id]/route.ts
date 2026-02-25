import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getOpportunityDetail } from "@/lib/opportunities/opportunity-detail";
import { recomputeOpportunityScores } from "@/lib/opportunities/scoring";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  await recomputeOpportunityScores(db);

  const opportunity = await getOpportunityDetail(params.id, db);

  if (!opportunity) {
    return NextResponse.json({ error: "Opportunity not found." }, { status: 404 });
  }

  return NextResponse.json({ opportunity }, { status: 200 });
}
