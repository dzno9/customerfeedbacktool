import { describe, expect, it } from "vitest";

import { processFeedbackSignalsJob } from "./extract-feedback-signals";

type StoredFeedback = {
  id: string;
  rawText: string;
  sentiment: "positive" | "neutral" | "negative" | "unclassified" | null;
  severity: "low" | "medium" | "high" | "critical" | "unclassified" | null;
  signalStatus: "pending" | "processing" | "completed" | "failed";
  signalError: string | null;
};

type StoredFeedbackSignal = {
  feedbackItemId: string;
  tags: string[];
  tagsUnclassified: boolean;
  sentiment: "positive" | "neutral" | "negative" | "unclassified";
  severity: "low" | "medium" | "high" | "critical" | "unclassified";
};

type StoredCandidateOpportunity = {
  feedbackItemId: string;
  status: "candidate" | "none";
  opportunityText: string | null;
};

function createFakeDb(initial: StoredFeedback) {
  let feedback = { ...initial };
  let signal: StoredFeedbackSignal | null = null;
  let candidate: StoredCandidateOpportunity | null = null;

  return {
    feedbackItem: {
      async findUnique(args: {
        where: { id: string };
        select: { id: true; rawText: true };
      }) {
        if (args.where.id !== feedback.id) {
          return null;
        }

        return {
          id: feedback.id,
          rawText: feedback.rawText
        };
      },
      async update(args: {
        where: { id: string };
        data: {
          sentiment?: "positive" | "neutral" | "negative" | "unclassified";
          severity?: "low" | "medium" | "high" | "critical" | "unclassified";
          signalStatus?: "pending" | "processing" | "completed" | "failed";
          signalError?: string | null;
        };
      }) {
        if (args.where.id !== feedback.id) {
          throw new Error("feedback not found");
        }

        feedback = {
          ...feedback,
          sentiment: args.data.sentiment ?? feedback.sentiment,
          severity: args.data.severity ?? feedback.severity,
          signalStatus: args.data.signalStatus ?? feedback.signalStatus,
          signalError:
            args.data.signalError === undefined ? feedback.signalError : args.data.signalError
        };

        return feedback;
      }
    },
    feedbackSignal: {
      async upsert(args: {
        where: { feedbackItemId: string };
        create: StoredFeedbackSignal;
        update: Omit<StoredFeedbackSignal, "feedbackItemId">;
      }) {
        if (args.where.feedbackItemId !== feedback.id) {
          throw new Error("feedback not found");
        }

        signal = signal
          ? {
              ...signal,
              ...args.update
            }
          : args.create;

        return signal;
      }
    },
    candidateOpportunity: {
      async upsert(args: {
        where: { feedbackItemId: string };
        create: StoredCandidateOpportunity;
        update: Omit<StoredCandidateOpportunity, "feedbackItemId">;
      }) {
        if (args.where.feedbackItemId !== feedback.id) {
          throw new Error("feedback not found");
        }

        candidate = candidate
          ? {
              ...candidate,
              ...args.update
            }
          : args.create;

        return candidate;
      }
    },
    __state: {
      getFeedback: () => feedback,
      getSignal: () => signal,
      getCandidateOpportunity: () => candidate
    }
  };
}

describe("processFeedbackSignalsJob", () => {
  it("stores high-severity path for negative complaints with candidate idea", async () => {
    const db = createFakeDb({
      id: "feedback_1",
      rawText: "Billing failed for enterprise invoices twice this month and support is too slow.",
      sentiment: null,
      severity: null,
      signalStatus: "pending",
      signalError: null
    });

    const result = await processFeedbackSignalsJob(
      {
        feedbackItemId: "feedback_1",
        attemptsMade: 0,
        maxAttempts: 3
      },
      {
        db,
        extractSignals: async () => ({
          tags: ["billing", "invoice failure"],
          sentiment: "negative",
          severity: "high",
          candidateOpportunityText: "Add proactive failed-payment alerts with guided recovery steps."
        })
      }
    );

    expect(result.terminalFailure).toBe(false);
    expect(result.shouldCluster).toBe(true);
    expect(db.__state.getFeedback().signalStatus).toBe("completed");
    expect(db.__state.getFeedback().sentiment).toBe("negative");
    expect(db.__state.getFeedback().severity).toBe("high");
    expect(db.__state.getSignal()).toEqual({
      feedbackItemId: "feedback_1",
      tags: ["billing", "invoice failure"],
      tagsUnclassified: false,
      sentiment: "negative",
      severity: "high"
    });
    expect(db.__state.getCandidateOpportunity()).toEqual({
      feedbackItemId: "feedback_1",
      status: "candidate",
      opportunityText: "Add proactive failed-payment alerts with guided recovery steps."
    });
  });

  it("falls back to unclassified tags/sentiment/severity and explicit none candidate", async () => {
    const db = createFakeDb({
      id: "feedback_2",
      rawText: "Not sure, this feels off but I cannot pinpoint the issue.",
      sentiment: null,
      severity: null,
      signalStatus: "pending",
      signalError: null
    });

    const result = await processFeedbackSignalsJob(
      {
        feedbackItemId: "feedback_2",
        attemptsMade: 0,
        maxAttempts: 3
      },
      {
        db,
        extractSignals: async () => ({
          tags: [],
          sentiment: "unclassified",
          severity: "unclassified",
          candidateOpportunityText: null
        })
      }
    );

    expect(result.shouldCluster).toBe(false);

    expect(db.__state.getSignal()).toEqual({
      feedbackItemId: "feedback_2",
      tags: [],
      tagsUnclassified: true,
      sentiment: "unclassified",
      severity: "unclassified"
    });
    expect(db.__state.getCandidateOpportunity()).toEqual({
      feedbackItemId: "feedback_2",
      status: "none",
      opportunityText: null
    });
  });

  it("retries failures then marks terminal failure", async () => {
    const db = createFakeDb({
      id: "feedback_3",
      rawText: "Search relevance is terrible after the latest update.",
      sentiment: null,
      severity: null,
      signalStatus: "pending",
      signalError: null
    });

    const failingExtractor = async () => {
      throw new Error("Signal extraction timeout");
    };

    await expect(
      processFeedbackSignalsJob(
        {
          feedbackItemId: "feedback_3",
          attemptsMade: 0,
          maxAttempts: 3
        },
        {
          db,
          extractSignals: failingExtractor
        }
      )
    ).rejects.toThrow("Signal extraction timeout");

    expect(db.__state.getFeedback().signalStatus).toBe("pending");

    const terminal = await processFeedbackSignalsJob(
      {
        feedbackItemId: "feedback_3",
        attemptsMade: 2,
        maxAttempts: 3
      },
      {
        db,
        extractSignals: failingExtractor
      }
    );

    expect(terminal.terminalFailure).toBe(true);
    expect(terminal.shouldCluster).toBe(false);
    expect(db.__state.getFeedback().signalStatus).toBe("failed");
    expect(db.__state.getFeedback().signalError).toBe("Signal extraction timeout");
  });
});
