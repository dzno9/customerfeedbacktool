import { describe, expect, it } from "vitest";

import { generateWeeklyBrief, getWeeklyBriefById } from "./weekly-brief";

type OpportunityStatus = "suggested" | "approved" | "rejected";

type OpportunityRecord = {
  id: string;
  title: string;
  description: string | null;
  scoreTotal: number;
  evidenceCount: number;
  status: OpportunityStatus;
  updatedAt: Date;
};

type BriefRecord = {
  id: string;
  startDate: Date;
  endDate: Date;
  generatedAt: Date;
  generatedBy: string | null;
  snapshotJson: unknown;
};

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createFakeDb() {
  const opportunities = new Map<string, OpportunityRecord>();
  const evidenceByOpportunity = new Map<string, Date[]>();
  const briefs = new Map<string, BriefRecord>();
  let briefCounter = 0;

  return {
    opportunity: {
      async findMany(args: { where?: { status?: OpportunityStatus } }) {
        let rows = Array.from(opportunities.values());
        const status = args.where?.status;
        if (status) {
          rows = rows.filter((row) => row.status === status);
        }

        rows.sort((left, right) => {
          if (left.scoreTotal !== right.scoreTotal) {
            return right.scoreTotal - left.scoreTotal;
          }
          if (left.updatedAt.getTime() !== right.updatedAt.getTime()) {
            return right.updatedAt.getTime() - left.updatedAt.getTime();
          }
          return left.id.localeCompare(right.id);
        });

        return rows.map((row) => ({
          ...row,
          opportunityItems: (evidenceByOpportunity.get(row.id) ?? []).map((occurredAt) => ({
            feedbackItem: {
              occurredAt
            }
          }))
        }));
      }
    },
    weeklyBrief: {
      async create(args: { data: { startDate: Date; endDate: Date; generatedBy: string | null; snapshotJson: unknown } }) {
        briefCounter += 1;
        const id = `brief_${briefCounter}`;
        const row: BriefRecord = {
          id,
          startDate: args.data.startDate,
          endDate: args.data.endDate,
          generatedAt: new Date("2026-02-19T10:00:00.000Z"),
          generatedBy: args.data.generatedBy,
          snapshotJson: deepClone(args.data.snapshotJson)
        };
        briefs.set(id, row);
        return row;
      },
      async findUnique(args: { where: { id: string } }) {
        const row = briefs.get(args.where.id);
        if (!row) {
          return null;
        }
        return {
          ...row,
          snapshotJson: deepClone(row.snapshotJson)
        };
      }
    },
    __seed: {
      opportunity(record: Omit<OpportunityRecord, "updatedAt"> & { updatedAt?: string }) {
        opportunities.set(record.id, {
          ...record,
          updatedAt: record.updatedAt ? new Date(record.updatedAt) : new Date("2026-02-19T00:00:00.000Z")
        });
        evidenceByOpportunity.set(record.id, []);
      },
      addEvidence(opportunityId: string, occurredAt: string) {
        const existing = evidenceByOpportunity.get(opportunityId) ?? [];
        existing.push(new Date(occurredAt));
        evidenceByOpportunity.set(opportunityId, existing);
      }
    }
  };
}

describe("weekly brief generation", () => {
  it("generates snapshot for date range and stores retrievable brief", async () => {
    const db = createFakeDb();
    db.__seed.opportunity({
      id: "opp_approved_a",
      title: "Export API",
      description: null,
      scoreTotal: 8.2,
      evidenceCount: 3,
      status: "approved"
    });
    db.__seed.opportunity({
      id: "opp_approved_b",
      title: "SAML SSO",
      description: null,
      scoreTotal: 6.1,
      evidenceCount: 2,
      status: "approved"
    });
    db.__seed.opportunity({
      id: "opp_suggested",
      title: "Dark mode",
      description: null,
      scoreTotal: 9.9,
      evidenceCount: 10,
      status: "suggested"
    });

    db.__seed.addEvidence("opp_approved_a", "2026-02-09T12:00:00.000Z");
    db.__seed.addEvidence("opp_approved_a", "2026-02-12T12:00:00.000Z");
    db.__seed.addEvidence("opp_approved_a", "2026-02-14T12:00:00.000Z");
    db.__seed.addEvidence("opp_approved_b", "2026-02-06T12:00:00.000Z");
    db.__seed.addEvidence("opp_approved_b", "2026-02-13T12:00:00.000Z");
    db.__seed.addEvidence("opp_suggested", "2026-02-13T12:00:00.000Z");

    const generated = await generateWeeklyBrief(db, {
      startDate: "2026-02-10T00:00:00.000Z",
      endDate: "2026-02-16T23:59:59.999Z",
      generatedBy: "pm_1"
    });

    expect(generated.id).toBe("brief_1");
    expect(generated.generatedBy).toBe("pm_1");
    expect(generated.snapshot.opportunities.map((item) => item.id)).toEqual([
      "opp_approved_a",
      "opp_approved_b"
    ]);
    expect(generated.snapshot.opportunities[0]?.rangeEvidenceCount).toBe(2);
    expect(generated.snapshot.opportunities[0]?.previousRangeEvidenceCount).toBe(1);
    expect(generated.snapshot.summary.totalRangeEvidenceCount).toBe(3);

    const fetched = await getWeeklyBriefById(db, generated.id);
    expect(fetched?.id).toBe(generated.id);
    expect(fetched?.snapshot).toEqual(generated.snapshot);
  });

  it("keeps older snapshot immutable after later evidence changes", async () => {
    const db = createFakeDb();
    db.__seed.opportunity({
      id: "opp_approved",
      title: "Role provisioning",
      description: null,
      scoreTotal: 7.3,
      evidenceCount: 2,
      status: "approved"
    });
    db.__seed.addEvidence("opp_approved", "2026-02-11T12:00:00.000Z");

    const initial = await generateWeeklyBrief(db, {
      startDate: "2026-02-10T00:00:00.000Z",
      endDate: "2026-02-16T23:59:59.999Z"
    });

    db.__seed.addEvidence("opp_approved", "2026-02-15T12:00:00.000Z");

    const persistedInitial = await getWeeklyBriefById(db, initial.id);
    expect(persistedInitial?.snapshot.summary.totalRangeEvidenceCount).toBe(1);

    const regenerated = await generateWeeklyBrief(db, {
      startDate: "2026-02-10T00:00:00.000Z",
      endDate: "2026-02-16T23:59:59.999Z"
    });
    expect(regenerated.snapshot.summary.totalRangeEvidenceCount).toBe(2);
  });

  it("excludes non-approved opportunities by default", async () => {
    const db = createFakeDb();
    db.__seed.opportunity({
      id: "opp_approved",
      title: "Batch exports",
      description: null,
      scoreTotal: 3.2,
      evidenceCount: 1,
      status: "approved"
    });
    db.__seed.opportunity({
      id: "opp_rejected",
      title: "Deprecated sync",
      description: null,
      scoreTotal: 10.0,
      evidenceCount: 50,
      status: "rejected"
    });
    db.__seed.opportunity({
      id: "opp_suggested",
      title: "More themes",
      description: null,
      scoreTotal: 11.0,
      evidenceCount: 60,
      status: "suggested"
    });

    const generated = await generateWeeklyBrief(db, {
      startDate: "2026-02-10T00:00:00.000Z",
      endDate: "2026-02-16T23:59:59.999Z"
    });

    expect(generated.snapshot.opportunities.map((item) => item.id)).toEqual(["opp_approved"]);
  });
});
