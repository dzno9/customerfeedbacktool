import type { WeeklyBriefRecord, WeeklyBriefSnapshot } from "./weekly-brief";

type WeeklyBriefListRow = {
  id: string;
  startDate: Date;
  endDate: Date;
  generatedAt: Date;
  generatedBy: string | null;
  snapshotJson: unknown;
};

type WeeklyBriefListDb = {
  weeklyBrief: {
    findMany(args: unknown): Promise<unknown>;
  };
};

function toWeeklyBriefRecord(row: WeeklyBriefListRow): WeeklyBriefRecord {
  return {
    id: row.id,
    startDate: row.startDate.toISOString(),
    endDate: row.endDate.toISOString(),
    generatedAt: row.generatedAt.toISOString(),
    generatedBy: row.generatedBy,
    snapshot: JSON.parse(JSON.stringify(row.snapshotJson)) as WeeklyBriefSnapshot
  };
}

export async function listWeeklyBriefs(
  db: WeeklyBriefListDb,
  options?: { limit?: number }
): Promise<WeeklyBriefRecord[]> {
  const limit = options?.limit ?? 20;
  const take = Math.max(1, Math.min(100, Math.floor(limit)));

  const rows = (await db.weeklyBrief.findMany({
    orderBy: {
      generatedAt: "desc"
    },
    take
  })) as WeeklyBriefListRow[];

  return rows.map(toWeeklyBriefRecord);
}
