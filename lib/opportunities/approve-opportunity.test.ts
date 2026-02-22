import { describe, expect, it } from "vitest";

import { approveOpportunity, OpportunityApprovalError } from "./approve-opportunity";

function createFakeDb(evidenceCount: number) {
  const actions: Array<{ opportunityId: string; actorId: string }> = [];
  const auditLogs: Array<{ action: string; entityId: string; actorId: string }> = [];
  let status: "suggested" | "approved" = "suggested";

  return {
    opportunity: {
      async findUnique() {
        return {
          id: "opp_1",
          evidenceCount
        };
      },
      async update() {
        status = "approved";
        return {
          id: "opp_1",
          status: "approved" as const,
          evidenceCount
        };
      }
    },
    reviewAction: {
      async create(args: {
        data: {
          opportunityId: string;
          actorId: string;
        };
      }) {
        actions.push(args.data);
      }
    },
    auditLog: {
      async create(args: {
        data: {
          action: string;
          entityId: string;
          actorId: string;
        };
      }) {
        auditLogs.push(args.data);
      }
    },
    __state: {
      getActions: () => actions,
      getStatus: () => status,
      getAuditLogs: () => auditLogs
    }
  };
}

describe("approveOpportunity", () => {
  it("enforces zero-evidence guard condition", async () => {
    const db = createFakeDb(0);

    await expect(approveOpportunity("opp_1", "pm_1", db)).rejects.toMatchObject<OpportunityApprovalError>({
      code: "ZERO_EVIDENCE"
    });

    expect(db.__state.getActions()).toHaveLength(0);
    expect(db.__state.getStatus()).toBe("suggested");
  });

  it("approves and logs review action when evidence exists", async () => {
    const db = createFakeDb(2);

    const result = await approveOpportunity("opp_1", "pm_2", db);

    expect(result.status).toBe("approved");
    expect(db.__state.getActions()).toHaveLength(1);
    expect(db.__state.getAuditLogs()).toHaveLength(1);
    expect(db.__state.getActions()[0]).toMatchObject({
      opportunityId: "opp_1",
      actorId: "pm_2"
    });
    expect(db.__state.getAuditLogs()[0]).toMatchObject({
      action: "review.approve",
      entityId: "opp_1",
      actorId: "pm_2"
    });
  });
});
