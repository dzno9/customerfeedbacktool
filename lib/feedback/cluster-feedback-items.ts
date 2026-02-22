export const CLUSTER_FEEDBACK_ITEMS_JOB_NAME = "cluster_feedback_items";
export const DEFAULT_CLUSTER_JOB_ATTEMPTS = 3;
export const DEFAULT_CLUSTER_SIMILARITY_THRESHOLD = 0.84;

type CandidateOpportunityRecord = {
  feedbackItemId: string;
  status: "candidate" | "none";
  opportunityText: string | null;
  feedbackItem: {
    occurredAt: Date;
  };
};

type OpportunityRecord = {
  id: string;
  title: string;
  description: string | null;
};

type OpportunityItemRecord = {
  opportunityId: string;
};

type ClusterDb = {
  candidateOpportunity: {
    findUnique: (args: {
      where: { feedbackItemId: string };
      select: {
        feedbackItemId: true;
        status: true;
        opportunityText: true;
        feedbackItem: {
          select: {
            occurredAt: true;
          };
        };
      };
    }) => Promise<CandidateOpportunityRecord | null>;
  };
  opportunity: {
    findMany: (args: {
      select: {
        id: true;
        title: true;
        description: true;
      };
    }) => Promise<OpportunityRecord[]>;
    create: (args: {
      data: {
        title: string;
        description: string;
        status: "suggested";
      };
      select: {
        id: true;
      };
    }) => Promise<{ id: string }>;
    update: (args: {
      where: { id: string };
      data: {
        evidenceCount: number;
        lastEvidenceAt: Date | null;
      };
    }) => Promise<unknown>;
  };
  opportunityItem: {
    findFirst: (args: {
      where: {
        feedbackItemId: string;
      };
      select: {
        opportunityId: true;
      };
    }) => Promise<OpportunityItemRecord | null>;
    upsert: (args: {
      where: {
        opportunityId_feedbackItemId: {
          opportunityId: string;
          feedbackItemId: string;
        };
      };
      create: {
        opportunityId: string;
        feedbackItemId: string;
        similarityScore: number;
      };
      update: {
        similarityScore: number;
      };
    }) => Promise<unknown>;
    findMany: (args: {
      where: {
        opportunityId: string;
      };
      select: {
        feedbackItem: {
          select: {
            occurredAt: true;
          };
        };
      };
    }) => Promise<
      Array<{
        feedbackItem: {
          occurredAt: Date;
        };
      }>
    >;
  };
};

type ClusterFeedbackDeps = {
  db: ClusterDb;
  embedText?: (text: string) => Promise<number[]>;
  similarityThreshold?: number;
  recomputeScores?: () => Promise<void>;
};

type ClusterFeedbackJobInput = {
  feedbackItemId: string;
  attemptsMade: number;
  maxAttempts: number;
};

function normalizeText(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function dot(left: number[], right: number[]): number {
  const size = Math.min(left.length, right.length);
  let result = 0;

  for (let index = 0; index < size; index += 1) {
    result += left[index] * right[index];
  }

  return result;
}

function magnitude(vector: number[]): number {
  let sum = 0;

  for (const value of vector) {
    sum += value * value;
  }

  return Math.sqrt(sum);
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const leftMagnitude = magnitude(left);
  const rightMagnitude = magnitude(right);
  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot(left, right) / (leftMagnitude * rightMagnitude);
}

function toOpportunityTitle(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= 96) {
    return collapsed;
  }

  return `${collapsed.slice(0, 93)}...`;
}

export async function embedOpportunityText(text: string): Promise<number[]> {
  const { openai } = await import("../openai");
  const response = await openai.embeddings.create({
    model: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
    input: text
  });

  const embedding = response.data[0]?.embedding;
  if (!embedding || embedding.length === 0) {
    throw new Error("Model returned an empty embedding.");
  }

  return embedding;
}

async function refreshOpportunityEvidence(opportunityId: string, db: ClusterDb) {
  const items = await db.opportunityItem.findMany({
    where: {
      opportunityId
    },
    select: {
      feedbackItem: {
        select: {
          occurredAt: true
        }
      }
    }
  });

  let lastEvidenceAt: Date | null = null;

  for (const item of items) {
    if (!lastEvidenceAt || item.feedbackItem.occurredAt > lastEvidenceAt) {
      lastEvidenceAt = item.feedbackItem.occurredAt;
    }
  }

  await db.opportunity.update({
    where: {
      id: opportunityId
    },
    data: {
      evidenceCount: items.length,
      lastEvidenceAt
    }
  });
}

export async function processClusterFeedbackItemsJob(
  input: ClusterFeedbackJobInput,
  deps: ClusterFeedbackDeps
): Promise<{ terminalFailure: boolean }> {
  try {
    const candidate = await deps.db.candidateOpportunity.findUnique({
      where: {
        feedbackItemId: input.feedbackItemId
      },
      select: {
        feedbackItemId: true,
        status: true,
        opportunityText: true,
        feedbackItem: {
          select: {
            occurredAt: true
          }
        }
      }
    });

    const candidateText = normalizeText(candidate?.opportunityText);
    if (!candidate || candidate.status !== "candidate" || !candidateText) {
      return { terminalFailure: false };
    }

    const existing = await deps.db.opportunityItem.findFirst({
      where: {
        feedbackItemId: input.feedbackItemId
      },
      select: {
        opportunityId: true
      }
    });

    if (existing) {
      await refreshOpportunityEvidence(existing.opportunityId, deps.db);
      if (deps.recomputeScores) {
        await deps.recomputeScores();
      }
      return { terminalFailure: false };
    }

    const embedText = deps.embedText ?? embedOpportunityText;
    const threshold = deps.similarityThreshold ?? DEFAULT_CLUSTER_SIMILARITY_THRESHOLD;
    const targetEmbedding = await embedText(candidateText);
    const opportunities = await deps.db.opportunity.findMany({
      select: {
        id: true,
        title: true,
        description: true
      }
    });

    let matchedOpportunityId: string | null = null;
    let matchedSimilarity = 0;

    for (const opportunity of opportunities) {
      const baseText = normalizeText(opportunity.description) ?? opportunity.title;
      const comparisonEmbedding = await embedText(baseText);
      const similarity = cosineSimilarity(targetEmbedding, comparisonEmbedding);

      if (similarity > matchedSimilarity) {
        matchedSimilarity = similarity;
        matchedOpportunityId = opportunity.id;
      }
    }

    let opportunityId = matchedOpportunityId;
    let similarityScore = matchedSimilarity;

    if (!opportunityId || similarityScore < threshold) {
      const created = await deps.db.opportunity.create({
        data: {
          title: toOpportunityTitle(candidateText),
          description: candidateText,
          status: "suggested"
        },
        select: {
          id: true
        }
      });

      opportunityId = created.id;
      similarityScore = 1;
    }

    await deps.db.opportunityItem.upsert({
      where: {
        opportunityId_feedbackItemId: {
          opportunityId,
          feedbackItemId: input.feedbackItemId
        }
      },
      create: {
        opportunityId,
        feedbackItemId: input.feedbackItemId,
        similarityScore
      },
      update: {
        similarityScore
      }
    });

    await refreshOpportunityEvidence(opportunityId, deps.db);
    if (deps.recomputeScores) {
      await deps.recomputeScores();
    }

    return {
      terminalFailure: false
    };
  } catch (error) {
    const currentAttempt = input.attemptsMade + 1;
    const terminalFailure = currentAttempt >= input.maxAttempts;

    if (terminalFailure) {
      return {
        terminalFailure: true
      };
    }

    throw error;
  }
}
