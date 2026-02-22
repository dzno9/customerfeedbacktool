import { describe, expect, it } from "vitest";

import {
  calculateOpportunityScore,
  recomputeOpportunityScores,
  type ScoringWeights
} from "./scoring";

type FakeOpportunity = {
  id: string;
  title: string;
  description: string | null;
  status: "suggested" | "approved" | "rejected";
  evidenceCount: number;
  lastEvidenceAt: Date | null;
  opportunityItems: Array<{
    feedbackItem: {
      occurredAt: Date;
      accountId: string | null;
      severity: string | null;
      deletedAt: Date | null;
      feedbackSignal: { severity: "low" | "medium" | "high" | "critical" | "unclassified" } | null;
    };
  }>;
};

function createFakeDb(opportunitiesSeed: FakeOpportunity[]) {
  const opportunities = opportunitiesSeed.map((opportunity) => ({ ...opportunity }));
  const updates = new Map<
    string,
    {
      scoreTotal: number;
      scoreFrequency: number;
      scoreRecency: number;
      scoreSeverity: number;
      scoreSegment: number;
    }
  >();

  return {
    scoringConfig: {
      async findFirst() {
        return null;
      },
      async create() {
        throw new Error("not implemented in fake");
      },
      async update() {
        throw new Error("not implemented in fake");
      }
    },
    opportunity: {
      async findMany() {
        return opportunities;
      },
      async update(args: {
        where: { id: string };
        data: {
          scoreTotal: number;
          scoreFrequency: number;
          scoreRecency: number;
          scoreSeverity: number;
          scoreSegment: number;
        };
      }) {
        updates.set(args.where.id, args.data);
      }
    },
    __state: {
      getUpdate: (id: string) => updates.get(id)
    }
  };
}

describe("recomputeOpportunityScores", () => {
  it("reranks predictably when recency weight increases", async () => {
    const now = new Date("2026-02-19T12:00:00.000Z");
    const opportunities: FakeOpportunity[] = [
      {
        id: "opp_older",
        title: "Legacy opportunity",
        description: null,
        status: "suggested",
        evidenceCount: 4,
        lastEvidenceAt: new Date("2025-12-20T12:00:00.000Z"),
        opportunityItems: [
          {
            feedbackItem: {
              occurredAt: new Date("2025-12-20T12:00:00.000Z"),
              accountId: "acct_1",
              severity: "medium",
              deletedAt: null,
              feedbackSignal: null
            }
          },
          {
            feedbackItem: {
              occurredAt: new Date("2025-12-18T12:00:00.000Z"),
              accountId: "acct_2",
              severity: "medium",
              deletedAt: null,
              feedbackSignal: null
            }
          },
          {
            feedbackItem: {
              occurredAt: new Date("2025-12-16T12:00:00.000Z"),
              accountId: "acct_3",
              severity: "medium",
              deletedAt: null,
              feedbackSignal: null
            }
          },
          {
            feedbackItem: {
              occurredAt: new Date("2025-12-14T12:00:00.000Z"),
              accountId: "acct_4",
              severity: "medium",
              deletedAt: null,
              feedbackSignal: null
            }
          }
        ]
      },
      {
        id: "opp_newer",
        title: "Fresh opportunity",
        description: null,
        status: "suggested",
        evidenceCount: 2,
        lastEvidenceAt: new Date("2026-02-18T12:00:00.000Z"),
        opportunityItems: [
          {
            feedbackItem: {
              occurredAt: new Date("2026-02-18T12:00:00.000Z"),
              accountId: "acct_2",
              severity: "medium",
              deletedAt: null,
              feedbackSignal: null
            }
          },
          {
            feedbackItem: {
              occurredAt: new Date("2026-02-17T12:00:00.000Z"),
              accountId: "acct_5",
              severity: "medium",
              deletedAt: null,
              feedbackSignal: null
            }
          }
        ]
      }
    ];

    const db = createFakeDb(opportunities);
    const lowRecencyWeights: ScoringWeights = {
      frequencyWeight: 3,
      recencyWeight: 0.2,
      severityWeight: 0.1,
      segmentWeight: 0.1
    };
    const highRecencyWeights: ScoringWeights = {
      frequencyWeight: 0.5,
      recencyWeight: 3,
      severityWeight: 0.1,
      segmentWeight: 0.1
    };

    const baseline = await recomputeOpportunityScores(db, {
      now,
      weights: lowRecencyWeights
    });
    const afterWeightChange = await recomputeOpportunityScores(db, {
      now,
      weights: highRecencyWeights
    });

    expect(baseline[0]?.id).toBe("opp_older");
    expect(afterWeightChange[0]?.id).toBe("opp_newer");
    expect(db.__state.getUpdate("opp_newer")?.scoreRecency).toBeGreaterThan(
      db.__state.getUpdate("opp_older")?.scoreRecency ?? 0
    );
  });
});

describe("calculateOpportunityScore", () => {
  it("returns deterministic results for same input and weights", () => {
    const weights: ScoringWeights = {
      frequencyWeight: 1.2,
      recencyWeight: 0.8,
      severityWeight: 0.6,
      segmentWeight: 0.4
    };

    const input = {
      opportunityItems: [
        {
          feedbackItem: {
            occurredAt: new Date("2026-02-18T00:00:00.000Z"),
            accountId: "acct_1",
            severity: "high",
            deletedAt: null,
            feedbackSignal: null
          }
        },
        {
          feedbackItem: {
            occurredAt: new Date("2026-02-16T00:00:00.000Z"),
            accountId: "acct_2",
            severity: "medium",
            deletedAt: null,
            feedbackSignal: null
          }
        }
      ]
    };
    const now = new Date("2026-02-19T00:00:00.000Z");

    const first = calculateOpportunityScore(input, weights, now);
    const second = calculateOpportunityScore(input, weights, now);

    expect(first).toEqual(second);
  });
});
