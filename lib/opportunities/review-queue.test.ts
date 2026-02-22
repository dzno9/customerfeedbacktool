import { describe, expect, it } from "vitest";

import {
  applyReviewAction,
  listDefaultWeeklyBriefOpportunities,
  listReviewQueueOpportunities,
  ReviewActionError,
  type OpportunityStatus
} from "./review-queue";

type OpportunityRecord = {
  id: string;
  title: string;
  description: string | null;
  status: OpportunityStatus;
  evidenceCount: number;
  lastEvidenceAt: Date | null;
  scoreTotal: number;
  updatedAt: Date;
};

type ReviewActionRecord = {
  opportunityId: string;
  action: "approve" | "reject" | "merge" | "split" | "relabel";
  actorId: string;
  payloadJson: Record<string, unknown>;
  createdAt: Date;
};

type AuditLogRecord = {
  action: string;
  entityType: string;
  entityId: string;
  actorId: string;
  metadataJson: Record<string, unknown> | null | undefined;
  createdAt: Date;
};

function createFakeDb() {
  const opportunities = new Map<string, OpportunityRecord>();
  const opportunityItems: Array<{ opportunityId: string; feedbackItemId: string }> = [];
  const feedbackItemOccurredAt = new Map<string, Date>();
  const reviewActions: ReviewActionRecord[] = [];
  const auditLogs: AuditLogRecord[] = [];
  let idCounter = 100;

  function buildOpportunityWithItems(opportunity: OpportunityRecord) {
    return {
      ...opportunity,
      opportunityItems: opportunityItems
        .filter((item) => item.opportunityId === opportunity.id)
        .map((item) => ({
          feedbackItemId: item.feedbackItemId,
          feedbackItem: {
            occurredAt: feedbackItemOccurredAt.get(item.feedbackItemId) ?? new Date("2026-02-01T00:00:00.000Z"),
            deletedAt: null
          }
        }))
    };
  }

  const db = {
    opportunity: {
      async findMany(args: {
        where?: { status?: OpportunityStatus | { in: OpportunityStatus[] } };
        orderBy?: Array<{ scoreTotal: "asc" | "desc" } | { updatedAt: "asc" | "desc" } | { id: "asc" | "desc" }>;
      }) {
        let values = Array.from(opportunities.values());

        const statusFilter = args.where?.status;
        if (typeof statusFilter === "string") {
          values = values.filter((opportunity) => opportunity.status === statusFilter);
        } else if (statusFilter && "in" in statusFilter) {
          values = values.filter((opportunity) => statusFilter.in.includes(opportunity.status));
        }

        const orderBy = args.orderBy ?? [];
        values.sort((left, right) => {
          for (const order of orderBy) {
            if ("scoreTotal" in order && left.scoreTotal !== right.scoreTotal) {
              return order.scoreTotal === "desc" ? right.scoreTotal - left.scoreTotal : left.scoreTotal - right.scoreTotal;
            }

            if ("updatedAt" in order && left.updatedAt.getTime() !== right.updatedAt.getTime()) {
              return order.updatedAt === "desc"
                ? right.updatedAt.getTime() - left.updatedAt.getTime()
                : left.updatedAt.getTime() - right.updatedAt.getTime();
            }

            if ("id" in order && left.id !== right.id) {
              return order.id === "desc" ? right.id.localeCompare(left.id) : left.id.localeCompare(right.id);
            }
          }

          return 0;
        });

        return values.map(buildOpportunityWithItems);
      },
      async findUnique(args: { where: { id: string } }) {
        const opportunity = opportunities.get(args.where.id);
        if (!opportunity) {
          return null;
        }

        return buildOpportunityWithItems(opportunity);
      },
      async update(args: {
        where: { id: string };
        data: {
          status?: OpportunityStatus;
          title?: string;
          description?: string | null;
          evidenceCount?: number;
          lastEvidenceAt?: Date | null;
        };
      }) {
        const current = opportunities.get(args.where.id);
        if (!current) {
          throw new Error(`Opportunity ${args.where.id} not found`);
        }

        const next: OpportunityRecord = {
          ...current,
          ...args.data,
          updatedAt: new Date(current.updatedAt.getTime() + 1000)
        };

        opportunities.set(next.id, next);
        return next;
      },
      async create(args: {
        data: {
          title: string;
          description?: string | null;
          status: OpportunityStatus;
        };
      }) {
        idCounter += 1;
        const id = `opp_${idCounter}`;
        opportunities.set(id, {
          id,
          title: args.data.title,
          description: args.data.description ?? null,
          status: args.data.status,
          evidenceCount: 0,
          lastEvidenceAt: null,
          scoreTotal: 0,
          updatedAt: new Date("2026-02-19T00:00:00.000Z")
        });

        return { id };
      }
    },
    opportunityItem: {
      async findMany(args: { where: { opportunityId: string } }) {
        return opportunityItems
          .filter((item) => item.opportunityId === args.where.opportunityId)
          .map((item) => ({
            feedbackItemId: item.feedbackItemId,
            feedbackItem: {
              occurredAt: feedbackItemOccurredAt.get(item.feedbackItemId) ?? new Date("2026-02-01T00:00:00.000Z"),
              deletedAt: null
            }
          }));
      },
      async createMany(args: { data: Array<{ opportunityId: string; feedbackItemId: string }> }) {
        for (const row of args.data) {
          const exists = opportunityItems.some(
            (item) => item.opportunityId === row.opportunityId && item.feedbackItemId === row.feedbackItemId
          );

          if (!exists) {
            opportunityItems.push({ opportunityId: row.opportunityId, feedbackItemId: row.feedbackItemId });
          }
        }
      },
      async deleteMany(args: {
        where: {
          opportunityId: string;
          feedbackItemId?: { in: string[] };
        };
      }) {
        for (let index = opportunityItems.length - 1; index >= 0; index -= 1) {
          const item = opportunityItems[index];
          if (!item || item.opportunityId !== args.where.opportunityId) {
            continue;
          }

          if (args.where.feedbackItemId && !args.where.feedbackItemId.in.includes(item.feedbackItemId)) {
            continue;
          }

          opportunityItems.splice(index, 1);
        }
      }
    },
    reviewAction: {
      async create(args: {
        data: {
          opportunityId: string;
          action: "approve" | "reject" | "merge" | "split" | "relabel";
          actorId: string;
          payloadJson: Record<string, unknown>;
        };
      }) {
        reviewActions.push({
          ...args.data,
          createdAt: new Date()
        });
      }
    },
    auditLog: {
      async create(args: {
        data: {
          action: string;
          entityType: string;
          entityId: string;
          actorId: string;
          metadataJson?: Record<string, unknown> | null;
        };
      }) {
        auditLogs.push({
          ...args.data,
          createdAt: new Date()
        });
      }
    },
    __seed: {
      opportunity(record: Omit<OpportunityRecord, "updatedAt"> & { updatedAt?: Date }) {
        opportunities.set(record.id, {
          ...record,
          updatedAt: record.updatedAt ?? new Date("2026-02-19T00:00:00.000Z")
        });
      },
      feedbackItem(feedbackItemId: string, occurredAt: string) {
        feedbackItemOccurredAt.set(feedbackItemId, new Date(occurredAt));
      },
      link(opportunityId: string, feedbackItemId: string) {
        opportunityItems.push({ opportunityId, feedbackItemId });
      }
    },
    __state: {
      opportunity(id: string) {
        return opportunities.get(id);
      },
      links(opportunityId: string) {
        return opportunityItems
          .filter((item) => item.opportunityId === opportunityId)
          .map((item) => item.feedbackItemId)
          .sort();
      },
      reviewActions() {
        return [...reviewActions];
      },
      auditLogs() {
        return [...auditLogs];
      },
      opportunities() {
        return Array.from(opportunities.values());
      }
    }
  };

  return db;
}

describe("review queue actions", () => {
  it("blocks approve action when opportunity has zero evidence", async () => {
    const db = createFakeDb();
    db.__seed.opportunity({
      id: "opp_1",
      title: "SSO",
      description: null,
      status: "suggested",
      evidenceCount: 0,
      lastEvidenceAt: null,
      scoreTotal: 3
    });

    await expect(
      applyReviewAction(db, {
        action: "approve",
        actorId: "pm_1",
        opportunityId: "opp_1"
      })
    ).rejects.toMatchObject<ReviewActionError>({
      code: "CONFLICT"
    });

    expect(db.__state.opportunity("opp_1")?.status).toBe("suggested");
    expect(db.__state.reviewActions()).toHaveLength(0);
  });

  it("approve/reject transitions status and logs actor + timestamp", async () => {
    const db = createFakeDb();
    db.__seed.opportunity({
      id: "opp_1",
      title: "SSO",
      description: null,
      status: "suggested",
      evidenceCount: 2,
      lastEvidenceAt: new Date("2026-02-18T00:00:00.000Z"),
      scoreTotal: 3
    });

    await applyReviewAction(db, {
      action: "approve",
      actorId: "pm_1",
      opportunityId: "opp_1"
    });

    expect(db.__state.opportunity("opp_1")?.status).toBe("approved");

    await applyReviewAction(db, {
      action: "reject",
      actorId: "pm_2",
      opportunityId: "opp_1"
    });

    expect(db.__state.opportunity("opp_1")?.status).toBe("rejected");

    const actions = db.__state.reviewActions();
    expect(actions).toHaveLength(2);
    expect(db.__state.auditLogs()).toHaveLength(2);
    expect(actions[0]?.actorId).toBe("pm_1");
    expect(actions[1]?.actorId).toBe("pm_2");
    expect(db.__state.auditLogs()[0]).toMatchObject({
      action: "review.approve",
      actorId: "pm_1",
      entityType: "opportunity",
      entityId: "opp_1"
    });
    expect(db.__state.auditLogs()[1]).toMatchObject({
      action: "review.reject",
      actorId: "pm_2",
      entityType: "opportunity",
      entityId: "opp_1"
    });
    expect(actions[0]?.createdAt).toBeInstanceOf(Date);
    expect(actions[1]?.createdAt).toBeInstanceOf(Date);
  });

  it("merge combines evidence without loss", async () => {
    const db = createFakeDb();

    db.__seed.feedbackItem("fb_1", "2026-02-10T00:00:00.000Z");
    db.__seed.feedbackItem("fb_2", "2026-02-11T00:00:00.000Z");
    db.__seed.feedbackItem("fb_3", "2026-02-12T00:00:00.000Z");

    db.__seed.opportunity({
      id: "opp_source",
      title: "Source",
      description: null,
      status: "suggested",
      evidenceCount: 2,
      lastEvidenceAt: new Date("2026-02-11T00:00:00.000Z"),
      scoreTotal: 1
    });
    db.__seed.opportunity({
      id: "opp_target",
      title: "Target",
      description: null,
      status: "suggested",
      evidenceCount: 2,
      lastEvidenceAt: new Date("2026-02-12T00:00:00.000Z"),
      scoreTotal: 2
    });

    db.__seed.link("opp_source", "fb_1");
    db.__seed.link("opp_source", "fb_2");
    db.__seed.link("opp_target", "fb_2");
    db.__seed.link("opp_target", "fb_3");

    await applyReviewAction(db, {
      action: "merge",
      actorId: "pm_1",
      sourceOpportunityId: "opp_source",
      targetOpportunityId: "opp_target"
    });

    expect(db.__state.links("opp_source")).toEqual([]);
    expect(db.__state.links("opp_target")).toEqual(["fb_1", "fb_2", "fb_3"]);
    expect(db.__state.opportunity("opp_target")?.evidenceCount).toBe(3);
    expect(db.__state.opportunity("opp_source")?.status).toBe("rejected");
  });

  it("split creates two valid opportunities with redistributed evidence", async () => {
    const db = createFakeDb();

    db.__seed.feedbackItem("fb_1", "2026-02-10T00:00:00.000Z");
    db.__seed.feedbackItem("fb_2", "2026-02-11T00:00:00.000Z");
    db.__seed.feedbackItem("fb_3", "2026-02-12T00:00:00.000Z");

    db.__seed.opportunity({
      id: "opp_split",
      title: "Overloaded",
      description: null,
      status: "suggested",
      evidenceCount: 3,
      lastEvidenceAt: new Date("2026-02-12T00:00:00.000Z"),
      scoreTotal: 2
    });

    db.__seed.link("opp_split", "fb_1");
    db.__seed.link("opp_split", "fb_2");
    db.__seed.link("opp_split", "fb_3");

    const result = await applyReviewAction(db, {
      action: "split",
      actorId: "pm_1",
      opportunityId: "opp_split",
      splits: [
        {
          title: "Split A",
          evidenceFeedbackItemIds: ["fb_1", "fb_2"]
        },
        {
          title: "Split B",
          evidenceFeedbackItemIds: ["fb_3"]
        }
      ]
    });

    expect(result.action).toBe("split");
    expect(result.createdOpportunityIds).toHaveLength(2);
    expect(db.__state.links("opp_split")).toEqual([]);
    expect(db.__state.opportunity("opp_split")?.status).toBe("rejected");

    const created = result.createdOpportunityIds.map((id) => ({
      id,
      links: db.__state.links(id),
      status: db.__state.opportunity(id)?.status,
      evidenceCount: db.__state.opportunity(id)?.evidenceCount
    }));

    expect(created[0]?.status).toBe("suggested");
    expect(created[1]?.status).toBe("suggested");
    expect(created[0]?.links.length).toBe(2);
    expect(created[1]?.links.length).toBe(1);

    const mergedLinks = [...created[0]!.links, ...created[1]!.links].sort();
    expect(mergedLinks).toEqual(["fb_1", "fb_2", "fb_3"]);
    expect(created[0]?.evidenceCount).toBe(2);
    expect(created[1]?.evidenceCount).toBe(1);
  });

  it("weekly brief default set only includes approved opportunities", async () => {
    const db = createFakeDb();

    db.__seed.opportunity({
      id: "opp_approved",
      title: "Approved",
      description: null,
      status: "approved",
      evidenceCount: 2,
      lastEvidenceAt: new Date("2026-02-12T00:00:00.000Z"),
      scoreTotal: 2.8
    });
    db.__seed.opportunity({
      id: "opp_suggested",
      title: "Suggested",
      description: null,
      status: "suggested",
      evidenceCount: 2,
      lastEvidenceAt: new Date("2026-02-12T00:00:00.000Z"),
      scoreTotal: 3.1
    });
    db.__seed.opportunity({
      id: "opp_rejected",
      title: "Rejected",
      description: null,
      status: "rejected",
      evidenceCount: 1,
      lastEvidenceAt: new Date("2026-02-12T00:00:00.000Z"),
      scoreTotal: 4.1
    });

    const defaultSet = await listDefaultWeeklyBriefOpportunities(db);
    const queueSet = await listReviewQueueOpportunities(db);

    expect(defaultSet.map((item) => item.id)).toEqual(["opp_approved"]);
    expect(queueSet.map((item) => item.id)).toEqual(["opp_suggested"]);
  });
});
