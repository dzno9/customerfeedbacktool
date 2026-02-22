import { describe, expect, it } from "vitest";

import {
  enforceSummaryWordCap,
  processFeedbackSummaryJob
} from "./summarize-feedback-item";

type StoredFeedback = {
  id: string;
  rawText: string;
  summary: string | null;
  summaryStatus: "pending" | "processing" | "completed" | "failed";
  summaryError: string | null;
};

function createFakeDb(initial: StoredFeedback) {
  let feedback = { ...initial };

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
          summaryStatus?: "pending" | "processing" | "completed" | "failed";
          summary?: string;
          summaryError?: string | null;
        };
      }) {
        if (args.where.id !== feedback.id) {
          throw new Error("feedback not found");
        }

        feedback = {
          ...feedback,
          ...args.data,
          summary: args.data.summary ?? feedback.summary,
          summaryStatus: args.data.summaryStatus ?? feedback.summaryStatus,
          summaryError:
            args.data.summaryError === undefined
              ? feedback.summaryError
              : args.data.summaryError
        };

        return feedback;
      }
    },
    __state: {
      getFeedback: () => feedback
    }
  };
}

describe("processFeedbackSummaryJob", () => {
  it("writes summary for a new feedback item", async () => {
    const db = createFakeDb({
      id: "feedback_1",
      rawText: "Customers keep asking for SSO and better audit logs.",
      summary: null,
      summaryStatus: "pending",
      summaryError: null
    });

    const result = await processFeedbackSummaryJob(
      {
        feedbackItemId: "feedback_1",
        attemptsMade: 0,
        maxAttempts: 3
      },
      {
        db,
        summarizeText: async () => "Customers are requesting SSO and improved audit logging.",
        summaryWordCap: 60
      }
    );

    expect(result.terminalFailure).toBe(false);
    expect(db.__state.getFeedback().summaryStatus).toBe("completed");
    expect(db.__state.getFeedback().summary).toBe(
      "Customers are requesting SSO and improved audit logging."
    );
    expect(db.__state.getFeedback().summaryError).toBeNull();
  });

  it("trims oversized model output to configured word cap", async () => {
    const db = createFakeDb({
      id: "feedback_2",
      rawText: "The billing experience is confusing.",
      summary: null,
      summaryStatus: "pending",
      summaryError: null
    });

    await processFeedbackSummaryJob(
      {
        feedbackItemId: "feedback_2",
        attemptsMade: 0,
        maxAttempts: 3
      },
      {
        db,
        summarizeText: async () =>
          "one two three four five six seven eight nine ten eleven twelve",
        summaryWordCap: 6
      }
    );

    expect(db.__state.getFeedback().summary).toBe("one two three four five six");
    expect(enforceSummaryWordCap("one two three", 2)).toBe("one two");
  });

  it("retries failures then marks terminal failure with error reason", async () => {
    const db = createFakeDb({
      id: "feedback_3",
      rawText: "Search returns irrelevant results.",
      summary: null,
      summaryStatus: "pending",
      summaryError: null
    });

    const failingSummarizer = async () => {
      throw new Error("LLM timeout");
    };

    await expect(
      processFeedbackSummaryJob(
        {
          feedbackItemId: "feedback_3",
          attemptsMade: 0,
          maxAttempts: 3
        },
        {
          db,
          summarizeText: failingSummarizer
        }
      )
    ).rejects.toThrow("LLM timeout");

    expect(db.__state.getFeedback().summaryStatus).toBe("pending");
    expect(db.__state.getFeedback().summaryError).toBe("LLM timeout");

    await expect(
      processFeedbackSummaryJob(
        {
          feedbackItemId: "feedback_3",
          attemptsMade: 1,
          maxAttempts: 3
        },
        {
          db,
          summarizeText: failingSummarizer
        }
      )
    ).rejects.toThrow("LLM timeout");

    const terminal = await processFeedbackSummaryJob(
      {
        feedbackItemId: "feedback_3",
        attemptsMade: 2,
        maxAttempts: 3
      },
      {
        db,
        summarizeText: failingSummarizer
      }
    );

    expect(terminal.terminalFailure).toBe(true);
    expect(db.__state.getFeedback().summaryStatus).toBe("failed");
    expect(db.__state.getFeedback().summaryError).toBe("LLM timeout");
  });
});
