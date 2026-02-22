import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { readRequiredActorId, requireInternalApiKey } from "@/lib/api/internal-auth";
import {
  FeedbackItemLifecycleError,
  softDeleteFeedbackItem
} from "@/lib/feedback/feedback-item-lifecycle";
import { recomputeOpportunityScores } from "@/lib/opportunities/scoring";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const authError = requireInternalApiKey(request);
  if (authError) {
    return authError;
  }

  const actorId = readRequiredActorId(request);
  if (!actorId) {
    return NextResponse.json({ error: "x-actor-id header is required." }, { status: 400 });
  }

  const { id } = await context.params;

  try {
    const item = await softDeleteFeedbackItem(db, id, actorId);
    await recomputeOpportunityScores(db);
    return NextResponse.json(
      {
        item: {
          id: item.id,
          deletedAt: item.deletedAt?.toISOString() ?? null
        }
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof FeedbackItemLifecycleError) {
      if (error.code === "NOT_FOUND") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }

      if (error.code === "ALREADY_DELETED") {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }

      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: "Unexpected error while soft deleting feedback item." }, { status: 500 });
  }
}
