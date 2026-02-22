import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { OpportunityApprovalError, approveOpportunity } from "../opportunities/approve-opportunity";
import { ReviewActionError, applyReviewAction } from "../opportunities/review-queue";

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

describe("system invariants", () => {
  it("enforces approve-with-evidence guard in approveOpportunity", async () => {
    const db = {
      opportunity: {
        async findUnique() {
          return { id: "opp_1", evidenceCount: 0 };
        },
        async update() {
          throw new Error("Should not update when evidence is missing.");
        }
      },
      reviewAction: {
        async create() {
          throw new Error("Should not create review action when evidence is missing.");
        }
      },
      auditLog: {
        async create() {
          throw new Error("Should not create audit log when evidence is missing.");
        }
      }
    };

    await expect(approveOpportunity("opp_1", "pm_1", db)).rejects.toMatchObject<OpportunityApprovalError>(
      {
        code: "ZERO_EVIDENCE"
      }
    );
  });

  it("enforces approve-with-evidence guard in review action path", async () => {
    const db = {
      opportunity: {
        async findUnique() {
          return {
            id: "opp_1",
            title: "Opportunity",
            description: null,
            status: "suggested" as const,
            evidenceCount: 0,
            lastEvidenceAt: null,
            scoreTotal: 0,
            updatedAt: new Date("2026-02-19T00:00:00.000Z"),
            opportunityItems: []
          };
        },
        async update() {
          throw new Error("Should not update when evidence is missing.");
        },
        async findMany() {
          return [];
        },
        async create() {
          return { id: "opp_created" };
        }
      },
      opportunityItem: {
        async findMany() {
          return [];
        },
        async createMany() {},
        async deleteMany() {}
      },
      reviewAction: {
        async create() {
          throw new Error("Should not create review action when evidence is missing.");
        }
      },
      auditLog: {
        async create() {
          throw new Error("Should not create audit log when evidence is missing.");
        }
      }
    };

    await expect(
      applyReviewAction(db, {
        action: "approve",
        actorId: "pm_1",
        opportunityId: "opp_1"
      })
    ).rejects.toMatchObject<ReviewActionError>({
      code: "CONFLICT"
    });
  });

  it("keeps score recomputation hooks in key mutation routes", () => {
    const reviewActionsRoute = readWorkspaceFile("app/api/review/actions/route.ts");
    const generateBriefRoute = readWorkspaceFile("app/api/briefs/generate/route.ts");

    expect(reviewActionsRoute).toContain("await recomputeOpportunityScores(db);");
    expect(generateBriefRoute).toContain("await recomputeOpportunityScores(db);");
  });

  it("keeps queue isolation between summary and signals workers", () => {
    const summaryQueueModule = readWorkspaceFile("lib/feedback/summary-queue.ts");
    const signalQueueModule = readWorkspaceFile("lib/feedback/signal-queue.ts");
    const clusterQueueModule = readWorkspaceFile("lib/feedback/opportunity-cluster-queue.ts");
    const summaryWorker = readWorkspaceFile("workers/feedback-summary.ts");
    const signalsWorker = readWorkspaceFile("workers/feedback-signals.ts");

    expect(summaryQueueModule).toContain("getSummaryQueue().add(");
    expect(summaryQueueModule).not.toContain("processingQueue.add(");

    expect(signalQueueModule).toContain("getSignalsQueue().add(");
    expect(signalQueueModule).not.toContain("processingQueue.add(");

    expect(clusterQueueModule).toContain("getSignalsQueue().add(");
    expect(clusterQueueModule).not.toContain("processingQueue.add(");

    expect(summaryWorker).toContain('"feedback-summary"');
    expect(signalsWorker).toContain('"feedback-signals"');
  });
});
