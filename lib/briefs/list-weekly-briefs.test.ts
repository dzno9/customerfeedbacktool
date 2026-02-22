import { describe, expect, it } from "vitest";

import { listWeeklyBriefs } from "./list-weekly-briefs";

function createFakeSnapshot(opportunityCount: number) {
  return {
    version: 1 as const,
    generatedAt: "2026-02-19T10:00:00.000Z",
    filters: {
      status: "approved" as const
    },
    range: {
      startDate: "2026-02-10T00:00:00.000Z",
      endDate: "2026-02-16T23:59:59.999Z",
      previousStartDate: "2026-02-03T00:00:00.000Z",
      previousEndDate: "2026-02-09T23:59:59.999Z"
    },
    summary: {
      opportunityCount,
      totalRangeEvidenceCount: 3,
      totalPreviousRangeEvidenceCount: 2,
      trendDelta: 1,
      trend: "up" as const
    },
    opportunities: []
  };
}

describe("listWeeklyBriefs", () => {
  it("returns most recent briefs first and applies limit", async () => {
    const rows = [
      {
        id: "brief_1",
        startDate: new Date("2026-02-03T00:00:00.000Z"),
        endDate: new Date("2026-02-09T23:59:59.999Z"),
        generatedAt: new Date("2026-02-10T08:00:00.000Z"),
        generatedBy: "pm_1",
        snapshotJson: createFakeSnapshot(1)
      },
      {
        id: "brief_2",
        startDate: new Date("2026-02-10T00:00:00.000Z"),
        endDate: new Date("2026-02-16T23:59:59.999Z"),
        generatedAt: new Date("2026-02-17T08:00:00.000Z"),
        generatedBy: "pm_2",
        snapshotJson: createFakeSnapshot(2)
      }
    ];

    const db = {
      weeklyBrief: {
        async findMany(args: { take: number }) {
          return [...rows]
            .sort((left, right) => right.generatedAt.getTime() - left.generatedAt.getTime())
            .slice(0, args.take);
        }
      }
    };

    const result = await listWeeklyBriefs(db, { limit: 1 });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("brief_2");
    expect(result[0]?.snapshot.summary.opportunityCount).toBe(2);
  });
});
