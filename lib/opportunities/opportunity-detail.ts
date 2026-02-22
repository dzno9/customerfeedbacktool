import { getEvidenceSourceDisplay } from "./evidence-links";

type OpportunityDetailDb = {
  opportunity: {
    findUnique(args: {
      where: { id: string };
      include: {
        opportunityItems: {
          orderBy: { createdAt: "asc" | "desc" };
          include: {
            feedbackItem: {
              select: {
                id: true;
                source: true;
                sourceUrl: true;
                rawText: true;
                summary: true;
                occurredAt: true;
                externalId: true;
                deletedAt: true;
              };
            };
          };
        };
      };
    }): Promise<{
      id: string;
      title: string;
      description: string | null;
      status: "suggested" | "approved" | "rejected";
      scoreTotal: number;
      scoreFrequency: number;
      scoreRecency: number;
      scoreSeverity: number;
      scoreSegment: number;
      evidenceCount: number;
      lastEvidenceAt: Date | null;
      opportunityItems: Array<{
        feedbackItemId: string;
        similarityScore: number | null;
        createdAt: Date;
        feedbackItem: {
          id: string;
          source: "intercom" | "upload";
          sourceUrl: string | null;
          rawText: string;
          summary: string | null;
          occurredAt: Date;
          externalId: string | null;
          deletedAt: Date | null;
        };
      }>;
    } | null>;
  };
};

export type OpportunityEvidenceSnippet = {
  feedbackItemId: string;
  occurredAt: string;
  source: "intercom" | "upload";
  snippet: string;
  similarityScore: number | null;
  sourceReference: {
    externalId: string | null;
    href: string | null;
    text: string;
  };
};

export type OpportunityDetail = {
  id: string;
  title: string;
  description: string | null;
  status: "suggested" | "approved" | "rejected";
  score: {
    total: number;
    frequency: number;
    recency: number;
    severity: number;
    segment: number;
  };
  evidenceCount: number;
  lastEvidenceAt: string | null;
  evidence: OpportunityEvidenceSnippet[];
};

function toSnippet(rawText: string, summary: string | null): string {
  const text = (summary && summary.trim()) || rawText.trim();
  if (text.length <= 280) {
    return text;
  }

  return `${text.slice(0, 277)}...`;
}

export async function getOpportunityDetail(
  opportunityId: string,
  db: OpportunityDetailDb
): Promise<OpportunityDetail | null> {
  const opportunity = await db.opportunity.findUnique({
    where: { id: opportunityId },
    include: {
      opportunityItems: {
        orderBy: { createdAt: "desc" },
        include: {
          feedbackItem: {
            select: {
              id: true,
              source: true,
              sourceUrl: true,
              rawText: true,
              summary: true,
              occurredAt: true,
              externalId: true,
              deletedAt: true
            }
          }
        }
      }
    }
  });

  if (!opportunity) {
    return null;
  }

  const evidence = opportunity.opportunityItems
    .filter((item) => item.feedbackItem.deletedAt === null)
    .map((item) => {
    const sourceReference = getEvidenceSourceDisplay(item.feedbackItem.source, item.feedbackItem.sourceUrl);

    return {
      feedbackItemId: item.feedbackItemId,
      occurredAt: item.feedbackItem.occurredAt.toISOString(),
      source: item.feedbackItem.source,
      snippet: toSnippet(item.feedbackItem.rawText, item.feedbackItem.summary),
      similarityScore: item.similarityScore,
      sourceReference: {
        externalId: item.feedbackItem.externalId,
        href: sourceReference.href,
        text: sourceReference.text
      }
    };
  });

  let lastEvidenceAt: string | null = null;
  for (const item of evidence) {
    if (!lastEvidenceAt || item.occurredAt > lastEvidenceAt) {
      lastEvidenceAt = item.occurredAt;
    }
  }

  return {
    id: opportunity.id,
    title: opportunity.title,
    description: opportunity.description,
    status: opportunity.status,
    score: {
      total: opportunity.scoreTotal,
      frequency: opportunity.scoreFrequency,
      recency: opportunity.scoreRecency,
      severity: opportunity.scoreSeverity,
      segment: opportunity.scoreSegment
    },
    evidenceCount: evidence.length,
    lastEvidenceAt,
    evidence
  };
}
