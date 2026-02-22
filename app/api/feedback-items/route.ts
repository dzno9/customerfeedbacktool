import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { buildFeedbackItemWhereInput, parseFeedbackFilters } from "@/lib/feedback/search-filters";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 100;
  }

  return Math.max(1, Math.min(200, Math.floor(parsed)));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = parseFeedbackFilters(url.searchParams);
  const limit = parseLimit(url.searchParams.get("limit"));
  const where = buildFeedbackItemWhereInput(filters);

  const items = await db.feedbackItem.findMany({
    where,
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }, { id: "asc" }],
    take: limit,
    include: {
      feedbackSignal: {
        select: {
          tags: true,
          sentiment: true,
          severity: true
        }
      }
    }
  });

  return NextResponse.json(
    {
      items: items.map((item) => ({
        id: item.id,
        source: item.source,
        occurredAt: item.occurredAt.toISOString(),
        summary: item.summary,
        rawText: item.rawText,
        customerName: item.customerName,
        customerEmail: item.customerEmail,
        accountId: item.accountId,
        sentiment: item.feedbackSignal?.sentiment ?? item.sentiment,
        severity: item.feedbackSignal?.severity ?? item.severity,
        tags: item.feedbackSignal?.tags ?? []
      }))
    },
    { status: 200 }
  );
}
