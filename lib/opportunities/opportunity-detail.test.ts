import { describe, expect, it } from "vitest";

import { getOpportunityDetail } from "./opportunity-detail";

describe("getOpportunityDetail", () => {
  it("returns evidence array with feedback item IDs", async () => {
    const db = {
      opportunity: {
        async findUnique() {
          return {
            id: "opp_1",
            title: "Improve SSO support",
            description: "Enterprise customers request SSO",
            status: "suggested" as const,
            scoreTotal: 2.4,
            scoreFrequency: 0.7,
            scoreRecency: 0.8,
            scoreSeverity: 0.6,
            scoreSegment: 0.3,
            evidenceCount: 2,
            lastEvidenceAt: new Date("2026-02-19T10:00:00.000Z"),
            opportunityItems: [
              {
                feedbackItemId: "fb_1",
                similarityScore: 0.91,
                createdAt: new Date("2026-02-19T10:00:00.000Z"),
                feedbackItem: {
                  id: "fb_1",
                  source: "intercom" as const,
                  sourceUrl: "https://app.intercom.com/a/apps/abc/inbox/inbox/conversation/42",
                  rawText: "Need SSO for Okta",
                  summary: "Customer asks for enterprise SSO.",
                  occurredAt: new Date("2026-02-18T09:00:00.000Z"),
                  externalId: "ic_42",
                  deletedAt: null
                }
              },
              {
                feedbackItemId: "fb_2",
                similarityScore: 0.87,
                createdAt: new Date("2026-02-19T09:00:00.000Z"),
                feedbackItem: {
                  id: "fb_2",
                  source: "upload" as const,
                  sourceUrl: null,
                  rawText: "A prospect asked for Azure AD integration",
                  summary: null,
                  occurredAt: new Date("2026-02-17T12:00:00.000Z"),
                  externalId: null,
                  deletedAt: null
                }
              }
            ]
          };
        }
      }
    };

    const result = await getOpportunityDetail("opp_1", db);

    expect(result).not.toBeNull();
    expect(result?.id).toBe("opp_1");
    expect(result?.score.total).toBe(2.4);
    expect(result?.score.recency).toBe(0.8);
    expect(result?.evidence.map((item) => item.feedbackItemId)).toEqual(["fb_1", "fb_2"]);
    expect(result?.evidence[0]?.sourceReference.href).toBeTruthy();
  });
});
