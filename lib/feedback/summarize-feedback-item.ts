export const SUMMARIZE_FEEDBACK_ITEM_JOB_NAME = "summarize_feedback_item";
export const DEFAULT_SUMMARY_WORD_CAP = 60;
export const DEFAULT_SUMMARY_JOB_ATTEMPTS = 3;

type FeedbackRecord = {
  id: string;
  rawText: string;
};

type FeedbackDb = {
  feedbackItem: {
    findUnique: (args: {
      where: { id: string };
      select: { id: true; rawText: true };
    }) => Promise<FeedbackRecord | null>;
    update: (args: {
      where: { id: string };
      data: {
        summaryStatus?: "pending" | "processing" | "completed" | "failed";
        summary?: string;
        summaryError?: string | null;
      };
    }) => Promise<unknown>;
  };
};

type ProcessSummaryDeps = {
  db: FeedbackDb;
  summarizeText?: (rawText: string) => Promise<string>;
  summaryWordCap?: number;
};

type ProcessSummaryJobInput = {
  feedbackItemId: string;
  attemptsMade: number;
  maxAttempts: number;
};

function normalizeError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "Unexpected summarization failure.";
}

export function enforceSummaryWordCap(summary: string, cap: number): string {
  if (cap <= 0) {
    return "";
  }

  const words = summary.trim().split(/\s+/).filter(Boolean);
  if (words.length <= cap) {
    return words.join(" ");
  }

  return words.slice(0, cap).join(" ");
}

export async function summarizeFeedbackText(rawText: string): Promise<string> {
  const { openai } = await import("../openai");
  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_SUMMARY_MODEL ?? "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "You summarize customer feedback in plain language for product managers. Return one concise paragraph with no preamble."
      },
      {
        role: "user",
        content: `Summarize this customer feedback:\n\n${rawText}`
      }
    ]
  });

  const content = response.choices[0]?.message?.content;
  if (!content || !content.trim()) {
    throw new Error("Model returned an empty summary.");
  }

  return content.trim();
}

export async function processFeedbackSummaryJob(
  input: ProcessSummaryJobInput,
  deps: ProcessSummaryDeps
): Promise<{ terminalFailure: boolean }> {
  const feedback = await deps.db.feedbackItem.findUnique({
    where: {
      id: input.feedbackItemId
    },
    select: {
      id: true,
      rawText: true
    }
  });

  if (!feedback) {
    return {
      terminalFailure: false
    };
  }

  await deps.db.feedbackItem.update({
    where: {
      id: feedback.id
    },
    data: {
      summaryStatus: "processing",
      summaryError: null
    }
  });

  const summarizeText = deps.summarizeText ?? summarizeFeedbackText;
  const summaryWordCap = deps.summaryWordCap ?? DEFAULT_SUMMARY_WORD_CAP;

  try {
    const generated = await summarizeText(feedback.rawText);
    const trimmed = enforceSummaryWordCap(generated, summaryWordCap);

    if (!trimmed) {
      throw new Error("Model returned an empty summary after enforcing word cap.");
    }

    await deps.db.feedbackItem.update({
      where: {
        id: feedback.id
      },
      data: {
        summary: trimmed,
        summaryStatus: "completed",
        summaryError: null
      }
    });

    return {
      terminalFailure: false
    };
  } catch (error) {
    const summaryError = normalizeError(error);
    const currentAttempt = input.attemptsMade + 1;
    const terminalFailure = currentAttempt >= input.maxAttempts;

    await deps.db.feedbackItem.update({
      where: {
        id: feedback.id
      },
      data: {
        summaryStatus: terminalFailure ? "failed" : "pending",
        summaryError
      }
    });

    if (terminalFailure) {
      return {
        terminalFailure: true
      };
    }

    throw error;
  }
}
