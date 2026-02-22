export const EXTRACT_FEEDBACK_SIGNALS_JOB_NAME = "extract_feedback_signals";
export const DEFAULT_SIGNAL_JOB_ATTEMPTS = 3;

type SignalSentiment = "positive" | "neutral" | "negative" | "unclassified";
type SignalSeverity = "low" | "medium" | "high" | "critical" | "unclassified";
type CandidateOpportunityStatus = "candidate" | "none";

type FeedbackRecord = {
  id: string;
  rawText: string;
};

type ExtractedSignals = {
  tags: string[];
  sentiment: SignalSentiment;
  severity: SignalSeverity;
  candidateOpportunityText: string | null;
};

type SignalDb = {
  feedbackItem: {
    findUnique: (args: {
      where: { id: string };
      select: { id: true; rawText: true };
    }) => Promise<FeedbackRecord | null>;
    update: (args: {
      where: { id: string };
      data: {
        sentiment?: SignalSentiment;
        severity?: SignalSeverity;
        signalStatus?: "pending" | "processing" | "completed" | "failed";
        signalError?: string | null;
      };
    }) => Promise<unknown>;
  };
  feedbackSignal: {
    upsert: (args: {
      where: { feedbackItemId: string };
      create: {
        feedbackItemId: string;
        tags: string[];
        tagsUnclassified: boolean;
        sentiment: SignalSentiment;
        severity: SignalSeverity;
      };
      update: {
        tags: string[];
        tagsUnclassified: boolean;
        sentiment: SignalSentiment;
        severity: SignalSeverity;
      };
    }) => Promise<unknown>;
  };
  candidateOpportunity: {
    upsert: (args: {
      where: { feedbackItemId: string };
      create: {
        feedbackItemId: string;
        status: CandidateOpportunityStatus;
        opportunityText: string | null;
      };
      update: {
        status: CandidateOpportunityStatus;
        opportunityText: string | null;
      };
    }) => Promise<unknown>;
  };
};

type ProcessSignalDeps = {
  db: SignalDb;
  extractSignals?: (rawText: string) => Promise<ExtractedSignals>;
};

type ProcessSignalJobInput = {
  feedbackItemId: string;
  attemptsMade: number;
  maxAttempts: number;
};

function normalizeError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "Unexpected signal extraction failure.";
}

function normalizeSentiment(value: string | undefined): SignalSentiment {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "positive" || normalized === "neutral" || normalized === "negative") {
    return normalized;
  }

  return "unclassified";
}

function normalizeSeverity(value: string | undefined): SignalSeverity {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "low" ||
    normalized === "medium" ||
    normalized === "high" ||
    normalized === "critical"
  ) {
    return normalized;
  }

  return "unclassified";
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) {
    return [];
  }

  const seen = new Set<string>();
  const output: string[] = [];

  for (const rawTag of tags) {
    const tag = rawTag.trim().toLowerCase().replace(/\s+/g, " ");
    if (!tag || seen.has(tag)) {
      continue;
    }

    seen.add(tag);
    output.push(tag);
  }

  return output.slice(0, 8);
}

function normalizeCandidateOpportunity(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

export async function extractFeedbackSignals(rawText: string): Promise<ExtractedSignals> {
  const { openai } = await import("../openai");

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_SIGNAL_MODEL ?? "gpt-4o-mini",
    temperature: 0.1,
    response_format: {
      type: "json_object"
    },
    messages: [
      {
        role: "system",
        content:
          "You extract structured product feedback signals. Return strict JSON with keys tags (array of strings), sentiment (positive|neutral|negative|unclassified), severity (low|medium|high|critical|unclassified), candidateOpportunityText (string or null)."
      },
      {
        role: "user",
        content: `Extract signals from this feedback:\n\n${rawText}`
      }
    ]
  });

  const content = response.choices[0]?.message?.content;
  if (!content || !content.trim()) {
    throw new Error("Model returned empty signal payload.");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Model returned invalid JSON for signal extraction.");
  }

  const payload = (typeof parsed === "object" && parsed !== null
    ? parsed
    : {}) as {
    tags?: unknown;
    sentiment?: unknown;
    severity?: unknown;
    candidateOpportunityText?: unknown;
  };

  return {
    tags: Array.isArray(payload.tags)
      ? payload.tags.filter((value): value is string => typeof value === "string")
      : [],
    sentiment: normalizeSentiment(
      typeof payload.sentiment === "string" ? payload.sentiment : undefined
    ),
    severity: normalizeSeverity(
      typeof payload.severity === "string" ? payload.severity : undefined
    ),
    candidateOpportunityText:
      typeof payload.candidateOpportunityText === "string"
        ? payload.candidateOpportunityText
        : null
  };
}

export async function processFeedbackSignalsJob(
  input: ProcessSignalJobInput,
  deps: ProcessSignalDeps
): Promise<{ terminalFailure: boolean; shouldCluster: boolean }> {
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
      terminalFailure: false,
      shouldCluster: false
    };
  }

  await deps.db.feedbackItem.update({
    where: {
      id: feedback.id
    },
    data: {
      signalStatus: "processing",
      signalError: null
    }
  });

  const extractSignals = deps.extractSignals ?? extractFeedbackSignals;

  try {
    const extracted = await extractSignals(feedback.rawText);
    const tags = normalizeTags(extracted.tags);
    const tagsUnclassified = tags.length === 0;
    const sentiment = normalizeSentiment(extracted.sentiment);
    const severity = normalizeSeverity(extracted.severity);
    const candidateOpportunityText = normalizeCandidateOpportunity(
      extracted.candidateOpportunityText
    );

    await deps.db.feedbackSignal.upsert({
      where: {
        feedbackItemId: feedback.id
      },
      create: {
        feedbackItemId: feedback.id,
        tags,
        tagsUnclassified,
        sentiment,
        severity
      },
      update: {
        tags,
        tagsUnclassified,
        sentiment,
        severity
      }
    });

    await deps.db.candidateOpportunity.upsert({
      where: {
        feedbackItemId: feedback.id
      },
      create: {
        feedbackItemId: feedback.id,
        status: candidateOpportunityText ? "candidate" : "none",
        opportunityText: candidateOpportunityText
      },
      update: {
        status: candidateOpportunityText ? "candidate" : "none",
        opportunityText: candidateOpportunityText
      }
    });

    await deps.db.feedbackItem.update({
      where: {
        id: feedback.id
      },
      data: {
        sentiment,
        severity,
        signalStatus: "completed",
        signalError: null
      }
    });

    return {
      terminalFailure: false,
      shouldCluster: Boolean(candidateOpportunityText)
    };
  } catch (error) {
    const signalError = normalizeError(error);
    const currentAttempt = input.attemptsMade + 1;
    const terminalFailure = currentAttempt >= input.maxAttempts;

    await deps.db.feedbackItem.update({
      where: {
        id: feedback.id
      },
      data: {
        signalStatus: terminalFailure ? "failed" : "pending",
        signalError
      }
    });

    if (terminalFailure) {
      return {
        terminalFailure: true,
        shouldCluster: false
      };
    }

    throw error;
  }
}
