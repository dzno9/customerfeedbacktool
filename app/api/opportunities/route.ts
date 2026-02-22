import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { parseFeedbackFilters } from "@/lib/feedback/search-filters";
import { listFilteredOpportunities, type OpportunityStatus } from "@/lib/opportunities/review-queue";
import { recomputeOpportunityScores } from "@/lib/opportunities/scoring";

const OPPORTUNITY_STATUSES = new Set<OpportunityStatus>(["suggested", "approved", "rejected"]);

function parseStatuses(searchParams: URLSearchParams): OpportunityStatus[] {
  const requested = searchParams
    .getAll("status")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value): value is OpportunityStatus => OPPORTUNITY_STATUSES.has(value as OpportunityStatus));

  if (requested.length === 0) {
    return ["suggested", "approved", "rejected"];
  }

  return Array.from(new Set(requested));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = parseFeedbackFilters(url.searchParams);
  const statuses = parseStatuses(url.searchParams);

  const scored = await recomputeOpportunityScores(db);
  const filtered = await listFilteredOpportunities(db, statuses, filters);
  const filteredIdSet = new Set(filtered.map((item) => item.id));
  const opportunities = scored.filter((item) => filteredIdSet.has(item.id));

  return NextResponse.json(
    {
      opportunities
    },
    { status: 200 }
  );
}
