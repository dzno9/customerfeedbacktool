import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { parseFeedbackFilters } from "@/lib/feedback/search-filters";
import { listFilteredReviewQueueOpportunities } from "@/lib/opportunities/review-queue";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filters = parseFeedbackFilters(url.searchParams);
    const opportunities = await listFilteredReviewQueueOpportunities(db, filters);
    return NextResponse.json({ opportunities }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Unexpected error while loading review queue." }, { status: 500 });
  }
}
