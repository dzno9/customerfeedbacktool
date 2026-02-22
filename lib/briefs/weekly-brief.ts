type WeeklyBriefTrend = "up" | "down" | "flat";

export type WeeklyBriefOpportunitySnapshot = {
  id: string;
  title: string;
  description: string | null;
  scoreTotal: number;
  evidenceCount: number;
  rangeEvidenceCount: number;
  previousRangeEvidenceCount: number;
  trendDelta: number;
  trend: WeeklyBriefTrend;
};

export type WeeklyBriefSnapshot = {
  version: 1;
  generatedAt: string;
  filters: {
    status: "approved";
  };
  range: {
    startDate: string;
    endDate: string;
    previousStartDate: string;
    previousEndDate: string;
  };
  summary: {
    opportunityCount: number;
    totalRangeEvidenceCount: number;
    totalPreviousRangeEvidenceCount: number;
    trendDelta: number;
    trend: WeeklyBriefTrend;
  };
  opportunities: WeeklyBriefOpportunitySnapshot[];
};

export type WeeklyBriefRecord = {
  id: string;
  startDate: string;
  endDate: string;
  generatedAt: string;
  generatedBy: string | null;
  snapshot: WeeklyBriefSnapshot;
};

type ApprovedOpportunity = {
  id: string;
  title: string;
  description: string | null;
  scoreTotal: number;
  evidenceCount: number;
  opportunityItems: Array<{
    feedbackItem: {
      occurredAt: Date;
    };
  }>;
};

type WeeklyBriefDb = {
  opportunity: {
    findMany(args: unknown): Promise<unknown>;
  };
  weeklyBrief: {
    create(args: unknown): Promise<unknown>;
    findUnique(args: unknown): Promise<unknown>;
  };
};

type WeeklyBriefRow = {
  id: string;
  startDate: Date;
  endDate: Date;
  generatedAt: Date;
  generatedBy: string | null;
  snapshotJson: unknown;
};

export class WeeklyBriefError extends Error {
  code: "INVALID_INPUT" | "NOT_FOUND";

  constructor(code: "INVALID_INPUT" | "NOT_FOUND", message: string) {
    super(message);
    this.code = code;
    this.name = "WeeklyBriefError";
  }
}

function toTrend(delta: number): WeeklyBriefTrend {
  if (delta > 0) {
    return "up";
  }
  if (delta < 0) {
    return "down";
  }
  return "flat";
}

function parseDateOrThrow(input: string, fieldName: "startDate" | "endDate"): Date {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    throw new WeeklyBriefError("INVALID_INPUT", `${fieldName} must be a valid date.`);
  }
  return parsed;
}

function normalizeGeneratedBy(generatedBy: string | undefined): string | null {
  if (generatedBy === undefined) {
    return null;
  }
  const trimmed = generatedBy.trim();
  return trimmed ? trimmed : null;
}

function derivePreviousWindow(startDate: Date, endDate: Date) {
  if (startDate > endDate) {
    throw new WeeklyBriefError("INVALID_INPUT", "startDate must be less than or equal to endDate.");
  }

  const durationMs = endDate.getTime() - startDate.getTime();
  const previousEndDate = new Date(startDate.getTime() - 1);
  const previousStartDate = new Date(previousEndDate.getTime() - durationMs);

  return {
    previousStartDate,
    previousEndDate
  };
}

function isWithinRange(value: Date, startDate: Date, endDate: Date): boolean {
  const time = value.getTime();
  return time >= startDate.getTime() && time <= endDate.getTime();
}

function deepCloneSnapshot(snapshot: WeeklyBriefSnapshot): WeeklyBriefSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as WeeklyBriefSnapshot;
}

function buildSnapshot(
  opportunities: ApprovedOpportunity[],
  generatedAt: Date,
  startDate: Date,
  endDate: Date,
  previousStartDate: Date,
  previousEndDate: Date
): WeeklyBriefSnapshot {
  const rankedOpportunities = opportunities.map((opportunity) => {
    let rangeEvidenceCount = 0;
    let previousRangeEvidenceCount = 0;

    for (const item of opportunity.opportunityItems) {
      const occurredAt = item.feedbackItem.occurredAt;
      if (isWithinRange(occurredAt, startDate, endDate)) {
        rangeEvidenceCount += 1;
        continue;
      }
      if (isWithinRange(occurredAt, previousStartDate, previousEndDate)) {
        previousRangeEvidenceCount += 1;
      }
    }

    const trendDelta = rangeEvidenceCount - previousRangeEvidenceCount;

    return {
      id: opportunity.id,
      title: opportunity.title,
      description: opportunity.description,
      scoreTotal: opportunity.scoreTotal,
      evidenceCount: opportunity.evidenceCount,
      rangeEvidenceCount,
      previousRangeEvidenceCount,
      trendDelta,
      trend: toTrend(trendDelta)
    };
  });

  const totalRangeEvidenceCount = rankedOpportunities.reduce((sum, item) => sum + item.rangeEvidenceCount, 0);
  const totalPreviousRangeEvidenceCount = rankedOpportunities.reduce(
    (sum, item) => sum + item.previousRangeEvidenceCount,
    0
  );
  const totalTrendDelta = totalRangeEvidenceCount - totalPreviousRangeEvidenceCount;

  return {
    version: 1,
    generatedAt: generatedAt.toISOString(),
    filters: {
      status: "approved"
    },
    range: {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      previousStartDate: previousStartDate.toISOString(),
      previousEndDate: previousEndDate.toISOString()
    },
    summary: {
      opportunityCount: rankedOpportunities.length,
      totalRangeEvidenceCount,
      totalPreviousRangeEvidenceCount,
      trendDelta: totalTrendDelta,
      trend: toTrend(totalTrendDelta)
    },
    opportunities: rankedOpportunities
  };
}

function toWeeklyBriefRecord(row: WeeklyBriefRow): WeeklyBriefRecord {
  return {
    id: row.id,
    startDate: row.startDate.toISOString(),
    endDate: row.endDate.toISOString(),
    generatedAt: row.generatedAt.toISOString(),
    generatedBy: row.generatedBy,
    snapshot: deepCloneSnapshot(row.snapshotJson as WeeklyBriefSnapshot)
  };
}

export async function generateWeeklyBrief(
  db: WeeklyBriefDb,
  input: { startDate: string; endDate: string; generatedBy?: string }
): Promise<WeeklyBriefRecord> {
  const startDate = parseDateOrThrow(input.startDate, "startDate");
  const endDate = parseDateOrThrow(input.endDate, "endDate");
  const generatedBy = normalizeGeneratedBy(input.generatedBy);

  const { previousStartDate, previousEndDate } = derivePreviousWindow(startDate, endDate);

  const approvedOpportunities = (await db.opportunity.findMany({
    where: {
      status: "approved"
    },
    orderBy: [{ scoreTotal: "desc" }, { updatedAt: "desc" }, { id: "asc" }],
    include: {
      opportunityItems: {
        where: {
          feedbackItem: {
            occurredAt: {
              gte: previousStartDate,
              lte: endDate
            }
          }
        },
        include: {
          feedbackItem: {
            select: {
              occurredAt: true
            }
          }
        }
      }
    }
  })) as ApprovedOpportunity[];

  const generatedAt = new Date();
  const snapshot = buildSnapshot(
    approvedOpportunities,
    generatedAt,
    startDate,
    endDate,
    previousStartDate,
    previousEndDate
  );

  const created = (await db.weeklyBrief.create({
    data: {
      startDate,
      endDate,
      generatedBy,
      snapshotJson: deepCloneSnapshot(snapshot)
    }
  })) as WeeklyBriefRow;

  return toWeeklyBriefRecord(created);
}

export async function getWeeklyBriefById(db: WeeklyBriefDb, id: string): Promise<WeeklyBriefRecord | null> {
  const normalizedId = id.trim();
  if (!normalizedId) {
    throw new WeeklyBriefError("INVALID_INPUT", "Brief id is required.");
  }

  const brief = (await db.weeklyBrief.findUnique({
    where: {
      id: normalizedId
    }
  })) as WeeklyBriefRow | null;

  if (!brief) {
    return null;
  }

  return toWeeklyBriefRecord(brief);
}
