import { NextResponse } from "next/server";

import { db } from "@/lib/db";

function parseDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 100;
  }

  return Math.max(1, Math.min(200, Math.floor(parsed)));
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const entityType = searchParams.get("entityType")?.trim();
    const entityId = searchParams.get("entityId")?.trim();
    const actorId = searchParams.get("actorId")?.trim();
    const dateFrom = parseDate(searchParams.get("dateFrom"));
    const dateTo = parseDate(searchParams.get("dateTo"));
    const take = parseLimit(searchParams.get("limit"));

    const where = {
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
      ...(actorId ? { actorId } : {}),
      ...(dateFrom || dateTo
        ? {
            createdAt: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {})
            }
          }
        : {})
    };

    const logs = await db.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take
    });

    return NextResponse.json(
      {
        logs: logs.map((log) => ({
          id: log.id,
          action: log.action,
          entityType: log.entityType,
          entityId: log.entityId,
          actorId: log.actorId,
          metadataJson: log.metadataJson,
          createdAt: log.createdAt.toISOString()
        }))
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json({ error: "Unexpected error while loading audit logs." }, { status: 500 });
  }
}
