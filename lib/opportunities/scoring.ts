export type ScoringWeights = {
  frequencyWeight: number;
  recencyWeight: number;
  severityWeight: number;
  segmentWeight: number;
};

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  frequencyWeight: 1,
  recencyWeight: 1,
  severityWeight: 1,
  segmentWeight: 1
};

type SeverityLevel = "low" | "medium" | "high" | "critical" | "unclassified";

type OpportunityEvidenceRecord = {
  feedbackItem: {
    occurredAt: Date;
    accountId: string | null;
    severity: string | null;
    deletedAt: Date | null;
    feedbackSignal: {
      severity: SeverityLevel;
    } | null;
  };
};

type OpportunityRecord = {
  id: string;
  title: string;
  description: string | null;
  status: "suggested" | "approved" | "rejected";
  evidenceCount: number;
  lastEvidenceAt: Date | null;
  opportunityItems: OpportunityEvidenceRecord[];
};

export type OpportunityScoreBreakdown = {
  total: number;
  frequency: number;
  recency: number;
  severity: number;
  segment: number;
};

export type ScoredOpportunity = {
  id: string;
  title: string;
  description: string | null;
  status: "suggested" | "approved" | "rejected";
  evidenceCount: number;
  lastEvidenceAt: string | null;
  score: OpportunityScoreBreakdown;
};

type ScoringDb = {
  scoringConfig: {
    findFirst(args: {
      orderBy: {
        updatedAt: "asc" | "desc";
      };
    }): Promise<
      | {
          id: string;
          frequencyWeight: number;
          recencyWeight: number;
          severityWeight: number;
          segmentWeight: number;
        }
      | null
    >;
    create(args: {
      data: {
        frequencyWeight: number;
        recencyWeight: number;
        severityWeight: number;
        segmentWeight: number;
        updatedBy: string | null;
      };
      select: {
        frequencyWeight: true;
        recencyWeight: true;
        severityWeight: true;
        segmentWeight: true;
      };
    }): Promise<ScoringWeights>;
    update(args: {
      where: {
        id: string;
      };
      data: {
        frequencyWeight?: number;
        recencyWeight?: number;
        severityWeight?: number;
        segmentWeight?: number;
        updatedBy?: string | null;
      };
      select: {
        frequencyWeight: true;
        recencyWeight: true;
        severityWeight: true;
        segmentWeight: true;
      };
    }): Promise<ScoringWeights>;
  };
  opportunity: {
    findMany(args: {
      include: {
        opportunityItems: {
          include: {
            feedbackItem: {
              select: {
                occurredAt: true;
                accountId: true;
                severity: true;
                deletedAt: true;
                feedbackSignal: {
                  select: {
                    severity: true;
                  };
                };
              };
            };
          };
        };
      };
    }): Promise<OpportunityRecord[]>;
    update(args: {
      where: { id: string };
      data: {
        evidenceCount: number;
        lastEvidenceAt: Date | null;
        scoreTotal: number;
        scoreFrequency: number;
        scoreRecency: number;
        scoreSeverity: number;
        scoreSegment: number;
      };
    }): Promise<unknown>;
  };
};

export function parseSeverityLevel(raw: string | null | undefined): SeverityLevel {
  if (!raw) {
    return "unclassified";
  }

  const value = raw.toLowerCase();
  if (value === "low" || value === "medium" || value === "high" || value === "critical") {
    return value;
  }

  return "unclassified";
}

function severityToNumber(severity: SeverityLevel): number {
  switch (severity) {
    case "low":
      return 0.25;
    case "medium":
      return 0.5;
    case "high":
      return 0.75;
    case "critical":
      return 1;
    default:
      return 0.1;
  }
}

function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function frequencyBase(evidenceCount: number): number {
  if (evidenceCount <= 0) {
    return 0;
  }
  return Math.min(Math.log1p(evidenceCount) / Math.log(11), 1);
}

function recencyBase(lastEvidenceAt: Date | null, now: Date): number {
  if (!lastEvidenceAt) {
    return 0;
  }

  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const ageInDays = Math.max(0, (now.getTime() - lastEvidenceAt.getTime()) / millisecondsPerDay);
  return Math.max(0, 1 - ageInDays / 90);
}

function severityBase(items: OpportunityEvidenceRecord[]): number {
  if (items.length === 0) {
    return 0;
  }

  let total = 0;
  for (const item of items) {
    const signalSeverity = item.feedbackItem.feedbackSignal?.severity;
    const fallbackSeverity = parseSeverityLevel(item.feedbackItem.severity);
    total += severityToNumber(signalSeverity ?? fallbackSeverity);
  }

  return total / items.length;
}

function segmentBase(items: OpportunityEvidenceRecord[]): number {
  if (items.length === 0) {
    return 0;
  }

  const uniqueAccounts = new Set(
    items.map((item) => item.feedbackItem.accountId?.trim()).filter((value): value is string => Boolean(value))
  );

  if (uniqueAccounts.size === 0) {
    return 0.2;
  }

  return Math.min(uniqueAccounts.size / items.length, 1);
}

function getActiveOpportunityItems(items: OpportunityEvidenceRecord[]): OpportunityEvidenceRecord[] {
  return items.filter((item) => item.feedbackItem.deletedAt === null);
}

function deriveLastEvidenceAt(items: OpportunityEvidenceRecord[]): Date | null {
  let lastEvidenceAt: Date | null = null;
  for (const item of items) {
    if (!lastEvidenceAt || item.feedbackItem.occurredAt > lastEvidenceAt) {
      lastEvidenceAt = item.feedbackItem.occurredAt;
    }
  }
  return lastEvidenceAt;
}

export function calculateOpportunityScore(
  opportunity: Pick<OpportunityRecord, "opportunityItems">,
  weights: ScoringWeights,
  now: Date
): OpportunityScoreBreakdown {
  const activeItems = getActiveOpportunityItems(opportunity.opportunityItems);
  const evidenceCount = activeItems.length;
  const lastEvidenceAt = deriveLastEvidenceAt(activeItems);
  const frequency = frequencyBase(evidenceCount) * weights.frequencyWeight;
  const recency = recencyBase(lastEvidenceAt, now) * weights.recencyWeight;
  const severity = severityBase(activeItems) * weights.severityWeight;
  const segment = segmentBase(activeItems) * weights.segmentWeight;

  const total = frequency + recency + severity + segment;

  return {
    total: roundScore(total),
    frequency: roundScore(frequency),
    recency: roundScore(recency),
    severity: roundScore(severity),
    segment: roundScore(segment)
  };
}

function toScoredOpportunity(
  opportunity: OpportunityRecord,
  score: OpportunityScoreBreakdown
): ScoredOpportunity {
  const activeItems = getActiveOpportunityItems(opportunity.opportunityItems);
  const evidenceCount = activeItems.length;
  const lastEvidenceAt = deriveLastEvidenceAt(activeItems);

  return {
    id: opportunity.id,
    title: opportunity.title,
    description: opportunity.description,
    status: opportunity.status,
    evidenceCount,
    lastEvidenceAt: lastEvidenceAt ? lastEvidenceAt.toISOString() : null,
    score
  };
}

function sortScoredOpportunities(left: ScoredOpportunity, right: ScoredOpportunity): number {
  if (left.score.total !== right.score.total) {
    return right.score.total - left.score.total;
  }

  return left.id.localeCompare(right.id);
}

export async function getScoringWeights(db: ScoringDb): Promise<ScoringWeights> {
  const config = await db.scoringConfig.findFirst({
    orderBy: {
      updatedAt: "desc"
    }
  });

  if (!config) {
    return DEFAULT_SCORING_WEIGHTS;
  }

  return {
    frequencyWeight: config.frequencyWeight,
    recencyWeight: config.recencyWeight,
    severityWeight: config.severityWeight,
    segmentWeight: config.segmentWeight
  };
}

export async function updateScoringWeights(
  db: ScoringDb,
  updates: Partial<ScoringWeights>,
  updatedBy: string | null
): Promise<ScoringWeights> {
  const existing = await db.scoringConfig.findFirst({
    orderBy: {
      updatedAt: "desc"
    }
  });

  if (!existing) {
    return db.scoringConfig.create({
      data: {
        ...DEFAULT_SCORING_WEIGHTS,
        ...updates,
        updatedBy
      },
      select: {
        frequencyWeight: true,
        recencyWeight: true,
        severityWeight: true,
        segmentWeight: true
      }
    });
  }

  return db.scoringConfig.update({
    where: {
      id: existing.id
    },
    data: {
      ...updates,
      updatedBy
    },
    select: {
      frequencyWeight: true,
      recencyWeight: true,
      severityWeight: true,
      segmentWeight: true
    }
  });
}

export async function recomputeOpportunityScores(
  db: ScoringDb,
  options?: { now?: Date; weights?: ScoringWeights }
): Promise<ScoredOpportunity[]> {
  const weights = options?.weights ?? (await getScoringWeights(db));
  const now = options?.now ?? new Date();

  const opportunities = await db.opportunity.findMany({
    include: {
      opportunityItems: {
        include: {
          feedbackItem: {
            select: {
              occurredAt: true,
              accountId: true,
              severity: true,
              deletedAt: true,
              feedbackSignal: {
                select: {
                  severity: true
                }
              }
            }
          }
        }
      }
    }
  });

  const scored: ScoredOpportunity[] = [];

  for (const opportunity of opportunities) {
    const score = calculateOpportunityScore(opportunity, weights, now);
    const activeItems = getActiveOpportunityItems(opportunity.opportunityItems);
    const evidenceCount = activeItems.length;
    const lastEvidenceAt = deriveLastEvidenceAt(activeItems);

    await db.opportunity.update({
      where: {
        id: opportunity.id
      },
      data: {
        evidenceCount,
        lastEvidenceAt,
        scoreTotal: score.total,
        scoreFrequency: score.frequency,
        scoreRecency: score.recency,
        scoreSeverity: score.severity,
        scoreSegment: score.segment
      }
    });

    scored.push(toScoredOpportunity(opportunity, score));
  }

  scored.sort(sortScoredOpportunities);
  return scored;
}
