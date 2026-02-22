import { describe, expect, it } from "vitest";

import { processClusterFeedbackItemsJob } from "./cluster-feedback-items";

type StoredFeedback = {
  id: string;
  occurredAt: Date;
};

type StoredCandidate = {
  feedbackItemId: string;
  status: "candidate" | "none";
  opportunityText: string | null;
};

type StoredOpportunity = {
  id: string;
  title: string;
  description: string | null;
  status: "suggested";
  evidenceCount: number;
  lastEvidenceAt: Date | null;
};

type StoredOpportunityItem = {
  opportunityId: string;
  feedbackItemId: string;
  similarityScore: number;
};

function createFakeDb(seed: {
  feedback: StoredFeedback[];
  candidates: StoredCandidate[];
}) {
  let opportunitySeq = 1;
  const feedback = new Map(seed.feedback.map((item) => [item.id, item]));
  const candidates = new Map(seed.candidates.map((item) => [item.feedbackItemId, item]));
  const opportunities = new Map<string, StoredOpportunity>();
  const opportunityItems: StoredOpportunityItem[] = [];

  return {
    candidateOpportunity: {
      async findUnique(args: {
        where: { feedbackItemId: string };
      }) {
        const candidate = candidates.get(args.where.feedbackItemId);
        if (!candidate) {
          return null;
        }

        const item = feedback.get(candidate.feedbackItemId);
        if (!item) {
          return null;
        }

        return {
          ...candidate,
          feedbackItem: {
            occurredAt: item.occurredAt
          }
        };
      }
    },
    opportunity: {
      async findMany() {
        return Array.from(opportunities.values()).map((opportunity) => ({
          id: opportunity.id,
          title: opportunity.title,
          description: opportunity.description
        }));
      },
      async create(args: {
        data: {
          title: string;
          description: string;
          status: "suggested";
        };
      }) {
        const id = `opp_${opportunitySeq++}`;
        opportunities.set(id, {
          id,
          ...args.data,
          evidenceCount: 0,
          lastEvidenceAt: null
        });
        return { id };
      },
      async update(args: {
        where: { id: string };
        data: {
          evidenceCount: number;
          lastEvidenceAt: Date | null;
        };
      }) {
        const current = opportunities.get(args.where.id);
        if (!current) {
          throw new Error("opportunity not found");
        }

        opportunities.set(args.where.id, {
          ...current,
          evidenceCount: args.data.evidenceCount,
          lastEvidenceAt: args.data.lastEvidenceAt
        });
      }
    },
    opportunityItem: {
      async findFirst(args: { where: { feedbackItemId: string } }) {
        return (
          opportunityItems.find((item) => item.feedbackItemId === args.where.feedbackItemId) ?? null
        );
      },
      async upsert(args: {
        where: {
          opportunityId_feedbackItemId: {
            opportunityId: string;
            feedbackItemId: string;
          };
        };
        create: StoredOpportunityItem;
        update: {
          similarityScore: number;
        };
      }) {
        const key = args.where.opportunityId_feedbackItemId;
        const existing = opportunityItems.find(
          (item) =>
            item.opportunityId === key.opportunityId && item.feedbackItemId === key.feedbackItemId
        );

        if (!existing) {
          opportunityItems.push(args.create);
          return;
        }

        existing.similarityScore = args.update.similarityScore;
      },
      async findMany(args: { where: { opportunityId: string } }) {
        return opportunityItems
          .filter((item) => item.opportunityId === args.where.opportunityId)
          .map((item) => {
            const feedbackItem = feedback.get(item.feedbackItemId);
            if (!feedbackItem) {
              throw new Error("feedback item not found");
            }
            return {
              feedbackItem: {
                occurredAt: feedbackItem.occurredAt
              }
            };
          });
      }
    },
    __state: {
      getOpportunities: () => Array.from(opportunities.values()),
      getOpportunityItems: () => opportunityItems
    }
  };
}

describe("processClusterFeedbackItemsJob", () => {
  it("groups semantically similar feedback into one opportunity and updates evidence stats", async () => {
    const db = createFakeDb({
      feedback: [
        { id: "fb_1", occurredAt: new Date("2026-02-18T08:00:00.000Z") },
        { id: "fb_2", occurredAt: new Date("2026-02-18T10:00:00.000Z") }
      ],
      candidates: [
        {
          feedbackItemId: "fb_1",
          status: "candidate",
          opportunityText: "Add enterprise SSO support for account login."
        },
        {
          feedbackItemId: "fb_2",
          status: "candidate",
          opportunityText: "Customers need single sign-on for enterprise access."
        }
      ]
    });

    const vectors = new Map<string, number[]>([
      ["Add enterprise SSO support for account login.", [1, 0]],
      ["Customers need single sign-on for enterprise access.", [0.97, 0.03]]
    ]);

    const embedText = async (text: string) => {
      const vector = vectors.get(text);
      if (!vector) {
        throw new Error(`Missing embedding for text: ${text}`);
      }
      return vector;
    };

    await processClusterFeedbackItemsJob(
      {
        feedbackItemId: "fb_1",
        attemptsMade: 0,
        maxAttempts: 3
      },
      { db, embedText, similarityThreshold: 0.8 }
    );

    await processClusterFeedbackItemsJob(
      {
        feedbackItemId: "fb_2",
        attemptsMade: 0,
        maxAttempts: 3
      },
      { db, embedText, similarityThreshold: 0.8 }
    );

    const opportunities = db.__state.getOpportunities();
    const opportunityItems = db.__state.getOpportunityItems();

    expect(opportunities).toHaveLength(1);
    expect(opportunityItems).toHaveLength(2);
    expect(opportunities[0].evidenceCount).toBe(2);
    expect(opportunities[0].lastEvidenceAt?.toISOString()).toBe("2026-02-18T10:00:00.000Z");
  });

  it("keeps distinct topics in separate opportunities", async () => {
    const db = createFakeDb({
      feedback: [
        { id: "fb_1", occurredAt: new Date("2026-02-18T08:00:00.000Z") },
        { id: "fb_2", occurredAt: new Date("2026-02-18T10:00:00.000Z") }
      ],
      candidates: [
        {
          feedbackItemId: "fb_1",
          status: "candidate",
          opportunityText: "Improve analytics dashboard filters."
        },
        {
          feedbackItemId: "fb_2",
          status: "candidate",
          opportunityText: "Fix failed invoice payment recovery flow."
        }
      ]
    });

    const vectors = new Map<string, number[]>([
      ["Improve analytics dashboard filters.", [1, 0]],
      ["Fix failed invoice payment recovery flow.", [0, 1]]
    ]);

    const embedText = async (text: string) => {
      const vector = vectors.get(text);
      if (!vector) {
        throw new Error(`Missing embedding for text: ${text}`);
      }
      return vector;
    };

    await processClusterFeedbackItemsJob(
      {
        feedbackItemId: "fb_1",
        attemptsMade: 0,
        maxAttempts: 3
      },
      { db, embedText, similarityThreshold: 0.8 }
    );

    await processClusterFeedbackItemsJob(
      {
        feedbackItemId: "fb_2",
        attemptsMade: 0,
        maxAttempts: 3
      },
      { db, embedText, similarityThreshold: 0.8 }
    );

    expect(db.__state.getOpportunities()).toHaveLength(2);
  });

  it("is idempotent when the same feedback item is reprocessed", async () => {
    const db = createFakeDb({
      feedback: [{ id: "fb_1", occurredAt: new Date("2026-02-18T08:00:00.000Z") }],
      candidates: [
        {
          feedbackItemId: "fb_1",
          status: "candidate",
          opportunityText: "Add dark mode preferences."
        }
      ]
    });

    const embedText = async () => [1, 0];

    await processClusterFeedbackItemsJob(
      {
        feedbackItemId: "fb_1",
        attemptsMade: 0,
        maxAttempts: 3
      },
      { db, embedText, similarityThreshold: 0.8 }
    );

    await processClusterFeedbackItemsJob(
      {
        feedbackItemId: "fb_1",
        attemptsMade: 0,
        maxAttempts: 3
      },
      { db, embedText, similarityThreshold: 0.8 }
    );

    expect(db.__state.getOpportunities()).toHaveLength(1);
    expect(db.__state.getOpportunityItems()).toHaveLength(1);
  });

  it("recomputes scores after evidence links change", async () => {
    const db = createFakeDb({
      feedback: [{ id: "fb_1", occurredAt: new Date("2026-02-18T08:00:00.000Z") }],
      candidates: [
        {
          feedbackItemId: "fb_1",
          status: "candidate",
          opportunityText: "Add dark mode preferences."
        }
      ]
    });

    let recomputeCount = 0;

    await processClusterFeedbackItemsJob(
      {
        feedbackItemId: "fb_1",
        attemptsMade: 0,
        maxAttempts: 3
      },
      {
        db,
        embedText: async () => [1, 0],
        similarityThreshold: 0.8,
        recomputeScores: async () => {
          recomputeCount += 1;
        }
      }
    );

    expect(recomputeCount).toBe(1);
  });
});
