import { NextResponse } from "next/server";

import { db } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const opportunityId = searchParams.get("opportunityId")?.trim() || undefined;
    const limitRaw = Number(searchParams.get("limit") ?? "30");
    const take = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 30;

    const actions = await db.reviewAction.findMany({
      where: opportunityId ? { opportunityId } : undefined,
      orderBy: {
        createdAt: "desc"
      },
      take,
      select: {
        id: true,
        opportunityId: true,
        action: true,
        actorId: true,
        payloadJson: true,
        createdAt: true
      }
    });

    return NextResponse.json({ actions }, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "Unexpected error while loading review action history." },
      { status: 500 }
    );
  }
}
