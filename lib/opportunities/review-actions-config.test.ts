import { describe, expect, it } from "vitest";

import { InvalidReviewActionPayloadError, parseReviewActionPayload } from "./review-actions-config";

describe("parseReviewActionPayload", () => {
  it("parses approve payload", () => {
    const parsed = parseReviewActionPayload({
      action: "approve",
      actorId: "pm_1",
      opportunityId: "opp_1"
    });

    expect(parsed).toEqual({
      action: "approve",
      actorId: "pm_1",
      opportunityId: "opp_1",
      reason: undefined
    });
  });

  it("parses split payload with two splits", () => {
    const parsed = parseReviewActionPayload({
      action: "split",
      actorId: "pm_1",
      opportunityId: "opp_1",
      splits: [
        {
          title: "A",
          evidenceFeedbackItemIds: ["fb_1", "fb_2"]
        },
        {
          title: "B",
          evidenceFeedbackItemIds: ["fb_3"]
        }
      ]
    });

    expect(parsed.action).toBe("split");
    if (parsed.action !== "split") {
      throw new Error("Expected split action");
    }

    expect(parsed.splits[0].evidenceFeedbackItemIds).toEqual(["fb_1", "fb_2"]);
    expect(parsed.splits[1].evidenceFeedbackItemIds).toEqual(["fb_3"]);
  });

  it("rejects unknown action", () => {
    expect(() =>
      parseReviewActionPayload({
        action: "archive",
        actorId: "pm_1"
      })
    ).toThrowError(InvalidReviewActionPayloadError);
  });

  it("rejects split payload with wrong number of split definitions", () => {
    expect(() =>
      parseReviewActionPayload({
        action: "split",
        actorId: "pm_1",
        opportunityId: "opp_1",
        splits: [
          {
            title: "A",
            evidenceFeedbackItemIds: ["fb_1"]
          }
        ]
      })
    ).toThrowError(InvalidReviewActionPayloadError);
  });
});
