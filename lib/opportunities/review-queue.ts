import type { FeedbackFilters } from "../feedback/search-filters";
import { createAuditLog } from "../audit/audit-log";
import { buildFeedbackItemWhereInput, hasFeedbackFilters } from "../feedback/search-filters";

export type OpportunityStatus = "suggested" | "approved" | "rejected";
export type ReviewActionType = "approve" | "reject" | "merge" | "split" | "relabel";

export type ReviewQueueOpportunity = {
  id: string;
  title: string;
  description: string | null;
  status: OpportunityStatus;
  evidenceCount: number;
  lastEvidenceAt: string | null;
  scoreTotal: number;
  updatedAt: string;
};

type SplitInput = {
  title: string;
  description?: string | null;
  evidenceFeedbackItemIds: string[];
};

export type ApplyReviewActionInput =
  | {
      action: "approve";
      actorId: string;
      opportunityId: string;
      reason?: string;
    }
  | {
      action: "reject";
      actorId: string;
      opportunityId: string;
      reason?: string;
    }
  | {
      action: "merge";
      actorId: string;
      sourceOpportunityId: string;
      targetOpportunityId: string;
      reason?: string;
    }
  | {
      action: "split";
      actorId: string;
      opportunityId: string;
      splits: [SplitInput, SplitInput];
      reason?: string;
    }
  | {
      action: "relabel";
      actorId: string;
      opportunityId: string;
      title: string;
      description?: string | null;
      reason?: string;
    };

export class ReviewActionError extends Error {
  code: "NOT_FOUND" | "INVALID_INPUT" | "CONFLICT";

  constructor(code: "NOT_FOUND" | "INVALID_INPUT" | "CONFLICT", message: string) {
    super(message);
    this.code = code;
    this.name = "ReviewActionError";
  }
}

type OpportunityWithItems = {
  id: string;
  title: string;
  description: string | null;
  status: OpportunityStatus;
  evidenceCount: number;
  lastEvidenceAt: Date | null;
  scoreTotal: number;
  updatedAt: Date;
  opportunityItems: Array<{
    feedbackItemId: string;
    feedbackItem: {
      occurredAt: Date;
      deletedAt: Date | null;
    };
  }>;
};

type ReviewDb = {
  opportunity: {
    findMany(args: unknown): Promise<unknown>;
    findUnique(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
    create(args: unknown): Promise<unknown>;
  };
  opportunityItem: {
    findMany(args: unknown): Promise<unknown>;
    createMany(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<unknown>;
  };
  reviewAction: {
    create(args: unknown): Promise<unknown>;
  };
  auditLog: {
    create(args: unknown): Promise<unknown>;
  };
};

function toReviewQueueOpportunity(opportunity: OpportunityWithItems): ReviewQueueOpportunity {
  const activeItems = opportunity.opportunityItems.filter((item) => item.feedbackItem.deletedAt === null);
  let lastEvidenceAt: Date | null = null;
  for (const item of activeItems) {
    if (!lastEvidenceAt || item.feedbackItem.occurredAt > lastEvidenceAt) {
      lastEvidenceAt = item.feedbackItem.occurredAt;
    }
  }

  return {
    id: opportunity.id,
    title: opportunity.title,
    description: opportunity.description,
    status: opportunity.status,
    evidenceCount: activeItems.length,
    lastEvidenceAt: lastEvidenceAt ? lastEvidenceAt.toISOString() : null,
    scoreTotal: opportunity.scoreTotal,
    updatedAt: opportunity.updatedAt.toISOString()
  };
}

async function getOpportunityOrThrow(db: ReviewDb, opportunityId: string): Promise<OpportunityWithItems> {
  const opportunity = (await db.opportunity.findUnique({
    where: { id: opportunityId },
    include: {
      opportunityItems: {
        include: {
          feedbackItem: {
            select: {
              occurredAt: true,
              deletedAt: true
            }
          }
        }
      }
    }
  })) as OpportunityWithItems | null;

  if (!opportunity) {
    throw new ReviewActionError("NOT_FOUND", `Opportunity '${opportunityId}' not found.`);
  }

  return opportunity;
}

async function refreshOpportunityEvidence(db: ReviewDb, opportunityId: string): Promise<void> {
  const items = (await db.opportunityItem.findMany({
    where: { opportunityId },
    include: {
      feedbackItem: {
        select: {
          occurredAt: true,
          deletedAt: true
        }
      }
    }
  })) as Array<{ feedbackItemId: string; feedbackItem: { occurredAt: Date; deletedAt: Date | null } }>;

  const activeItems = items.filter((item) => item.feedbackItem.deletedAt === null);
  const evidenceCount = activeItems.length;
  let lastEvidenceAt: Date | null = null;

  for (const item of activeItems) {
    if (!lastEvidenceAt || item.feedbackItem.occurredAt > lastEvidenceAt) {
      lastEvidenceAt = item.feedbackItem.occurredAt;
    }
  }

  await db.opportunity.update({
    where: { id: opportunityId },
    data: {
      evidenceCount,
      lastEvidenceAt
    }
  });
}

function assertNonEmptyActorId(actorId: string): string {
  const normalized = actorId.trim();
  if (!normalized) {
    throw new ReviewActionError("INVALID_INPUT", "actorId is required.");
  }
  return normalized;
}

function validateSplitCoverage(allEvidenceIds: string[], splits: [SplitInput, SplitInput]) {
  const uniqueAll = new Set(allEvidenceIds);
  const combined = new Set<string>();

  for (const split of splits) {
    if (!split.title.trim()) {
      throw new ReviewActionError("INVALID_INPUT", "Each split opportunity must include a non-empty title.");
    }

    if (split.evidenceFeedbackItemIds.length === 0) {
      throw new ReviewActionError("INVALID_INPUT", "Each split opportunity must include at least one evidence link.");
    }

    const uniqueSplit = new Set(split.evidenceFeedbackItemIds);
    if (uniqueSplit.size !== split.evidenceFeedbackItemIds.length) {
      throw new ReviewActionError("INVALID_INPUT", "Split evidence IDs must not contain duplicates.");
    }

    for (const evidenceId of split.evidenceFeedbackItemIds) {
      if (!uniqueAll.has(evidenceId)) {
        throw new ReviewActionError("INVALID_INPUT", `Split references unknown evidence ID '${evidenceId}'.`);
      }

      if (combined.has(evidenceId)) {
        throw new ReviewActionError("INVALID_INPUT", "Split evidence IDs must be disjoint.");
      }

      combined.add(evidenceId);
    }
  }

  if (combined.size !== uniqueAll.size) {
    throw new ReviewActionError(
      "INVALID_INPUT",
      "Split evidence IDs must fully redistribute all source evidence across both split opportunities."
    );
  }
}

async function applyApproveOrReject(
  db: ReviewDb,
  action: "approve" | "reject",
  actorId: string,
  opportunityId: string,
  reason: string | undefined
) {
  const opportunity = await getOpportunityOrThrow(db, opportunityId);

  if (action === "approve" && opportunity.evidenceCount < 1) {
    throw new ReviewActionError(
      "CONFLICT",
      "Cannot approve opportunity without linked evidence snippets."
    );
  }

  const nextStatus: OpportunityStatus = action === "approve" ? "approved" : "rejected";
  await db.opportunity.update({
    where: { id: opportunityId },
    data: { status: nextStatus }
  });

  await db.reviewAction.create({
    data: {
      opportunityId,
      action,
      actorId,
      payloadJson: {
        reason: reason?.trim() || null,
        newStatus: nextStatus
      }
    }
  });
  await createAuditLog(db, {
    action: `review.${action}`,
    actorId,
    entityType: "opportunity",
    entityId: opportunityId,
    metadataJson: {
      reason: reason?.trim() || null,
      newStatus: nextStatus
    }
  });

  return {
    action,
    opportunityId,
    status: nextStatus
  };
}

async function applyRelabel(
  db: ReviewDb,
  actorId: string,
  opportunityId: string,
  title: string,
  description: string | null | undefined,
  reason: string | undefined
) {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    throw new ReviewActionError("INVALID_INPUT", "title is required for relabel action.");
  }

  const opportunity = await getOpportunityOrThrow(db, opportunityId);

  await db.opportunity.update({
    where: { id: opportunityId },
    data: {
      title: normalizedTitle,
      description: description === undefined ? opportunity.description : description
    }
  });

  await db.reviewAction.create({
    data: {
      opportunityId,
      action: "relabel",
      actorId,
      payloadJson: {
        reason: reason?.trim() || null,
        previousTitle: opportunity.title,
        title: normalizedTitle,
        description: description === undefined ? opportunity.description : description
      }
    }
  });
  await createAuditLog(db, {
    action: "review.relabel",
    actorId,
    entityType: "opportunity",
    entityId: opportunityId,
    metadataJson: {
      reason: reason?.trim() || null,
      previousTitle: opportunity.title,
      title: normalizedTitle,
      description: description === undefined ? opportunity.description : description
    }
  });

  return {
    action: "relabel" as const,
    opportunityId,
    title: normalizedTitle,
    description: description === undefined ? opportunity.description : description
  };
}

async function applyMerge(
  db: ReviewDb,
  actorId: string,
  sourceOpportunityId: string,
  targetOpportunityId: string,
  reason: string | undefined
) {
  if (sourceOpportunityId === targetOpportunityId) {
    throw new ReviewActionError("INVALID_INPUT", "Cannot merge an opportunity into itself.");
  }

  const source = await getOpportunityOrThrow(db, sourceOpportunityId);
  const target = await getOpportunityOrThrow(db, targetOpportunityId);

  const sourceEvidenceIds = source.opportunityItems.map((item) => item.feedbackItemId);
  const targetEvidenceIdSet = new Set(target.opportunityItems.map((item) => item.feedbackItemId));
  const evidenceToMove = sourceEvidenceIds.filter((feedbackItemId) => !targetEvidenceIdSet.has(feedbackItemId));

  if (evidenceToMove.length > 0) {
    await db.opportunityItem.createMany({
      data: evidenceToMove.map((feedbackItemId) => ({
        opportunityId: targetOpportunityId,
        feedbackItemId
      })),
      skipDuplicates: true
    });
  }

  await db.opportunityItem.deleteMany({
    where: {
      opportunityId: sourceOpportunityId
    }
  });

  await db.opportunity.update({
    where: { id: sourceOpportunityId },
    data: {
      status: "rejected"
    }
  });

  await refreshOpportunityEvidence(db, sourceOpportunityId);
  await refreshOpportunityEvidence(db, targetOpportunityId);

  await db.reviewAction.create({
    data: {
      opportunityId: sourceOpportunityId,
      action: "merge",
      actorId,
      payloadJson: {
        reason: reason?.trim() || null,
        role: "source",
        targetOpportunityId,
        movedEvidenceCount: evidenceToMove.length
      }
    }
  });
  await createAuditLog(db, {
    action: "review.merge_source",
    actorId,
    entityType: "opportunity",
    entityId: sourceOpportunityId,
    metadataJson: {
      reason: reason?.trim() || null,
      targetOpportunityId,
      movedEvidenceCount: evidenceToMove.length
    }
  });

  await db.reviewAction.create({
    data: {
      opportunityId: targetOpportunityId,
      action: "merge",
      actorId,
      payloadJson: {
        reason: reason?.trim() || null,
        role: "target",
        sourceOpportunityId,
        movedEvidenceCount: evidenceToMove.length
      }
    }
  });
  await createAuditLog(db, {
    action: "review.merge_target",
    actorId,
    entityType: "opportunity",
    entityId: targetOpportunityId,
    metadataJson: {
      reason: reason?.trim() || null,
      sourceOpportunityId,
      movedEvidenceCount: evidenceToMove.length
    }
  });

  return {
    action: "merge" as const,
    sourceOpportunityId,
    targetOpportunityId,
    movedEvidenceCount: evidenceToMove.length
  };
}

async function applySplit(
  db: ReviewDb,
  actorId: string,
  opportunityId: string,
  splits: [SplitInput, SplitInput],
  reason: string | undefined
) {
  const source = await getOpportunityOrThrow(db, opportunityId);
  const sourceEvidenceIds = source.opportunityItems.map((item) => item.feedbackItemId);

  if (sourceEvidenceIds.length < 2) {
    throw new ReviewActionError("CONFLICT", "Cannot split opportunity with fewer than 2 evidence links.");
  }

  validateSplitCoverage(sourceEvidenceIds, splits);

  const createdOpportunityIds: string[] = [];

  for (const split of splits) {
    const created = (await db.opportunity.create({
      data: {
        title: split.title.trim(),
        description: split.description ?? null,
        status: "suggested"
      }
    })) as { id: string };

    createdOpportunityIds.push(created.id);

    await db.opportunityItem.createMany({
      data: split.evidenceFeedbackItemIds.map((feedbackItemId) => ({
        opportunityId: created.id,
        feedbackItemId
      })),
      skipDuplicates: true
    });

    await refreshOpportunityEvidence(db, created.id);
  }

  await db.opportunityItem.deleteMany({
    where: {
      opportunityId
    }
  });

  await db.opportunity.update({
    where: { id: opportunityId },
    data: {
      status: "rejected"
    }
  });

  await refreshOpportunityEvidence(db, opportunityId);

  await db.reviewAction.create({
    data: {
      opportunityId,
      action: "split",
      actorId,
      payloadJson: {
        reason: reason?.trim() || null,
        createdOpportunityIds,
        sourceEvidenceCount: sourceEvidenceIds.length
      }
    }
  });
  await createAuditLog(db, {
    action: "review.split_source",
    actorId,
    entityType: "opportunity",
    entityId: opportunityId,
    metadataJson: {
      reason: reason?.trim() || null,
      createdOpportunityIds,
      sourceEvidenceCount: sourceEvidenceIds.length
    }
  });

  for (const createdOpportunityId of createdOpportunityIds) {
    await db.reviewAction.create({
      data: {
        opportunityId: createdOpportunityId,
        action: "split",
        actorId,
        payloadJson: {
          reason: reason?.trim() || null,
          sourceOpportunityId: opportunityId
        }
      }
    });
    await createAuditLog(db, {
      action: "review.split_created",
      actorId,
      entityType: "opportunity",
      entityId: createdOpportunityId,
      metadataJson: {
        reason: reason?.trim() || null,
        sourceOpportunityId: opportunityId
      }
    });
  }

  return {
    action: "split" as const,
    sourceOpportunityId: opportunityId,
    createdOpportunityIds
  };
}

export async function listReviewQueueOpportunities(db: ReviewDb): Promise<ReviewQueueOpportunity[]> {
  return listOpportunitiesByStatus(db, ["suggested"]);
}

export async function listFilteredReviewQueueOpportunities(
  db: ReviewDb,
  filters: FeedbackFilters
): Promise<ReviewQueueOpportunity[]> {
  return listOpportunitiesByStatus(db, ["suggested"], filters);
}

export async function listDefaultWeeklyBriefOpportunities(db: ReviewDb): Promise<ReviewQueueOpportunity[]> {
  return listOpportunitiesByStatus(db, ["approved"]);
}

export async function listFilteredOpportunities(
  db: ReviewDb,
  statuses: OpportunityStatus[],
  filters: FeedbackFilters
): Promise<ReviewQueueOpportunity[]> {
  return listOpportunitiesByStatus(db, statuses, filters);
}

async function listOpportunitiesByStatus(
  db: ReviewDb,
  statuses: OpportunityStatus[],
  filters?: FeedbackFilters
): Promise<ReviewQueueOpportunity[]> {
  const shouldApplyFeedbackFilters = filters ? hasFeedbackFilters(filters) : false;
  const feedbackItemWhere =
    shouldApplyFeedbackFilters && filters ? buildFeedbackItemWhereInput(filters) : {};
  const opportunities = (await db.opportunity.findMany({
    where: {
      status: statuses.length === 1 ? statuses[0] : { in: statuses },
      ...(shouldApplyFeedbackFilters
        ? {
            opportunityItems: {
              some: {
                feedbackItem: feedbackItemWhere
              }
            }
          }
        : {})
    },
    orderBy: [{ scoreTotal: "desc" }, { updatedAt: "desc" }, { id: "asc" }],
    include: {
      opportunityItems: {
        include: {
          feedbackItem: {
            select: {
              occurredAt: true,
              deletedAt: true
            }
          }
        }
      }
    }
  })) as OpportunityWithItems[];

  return opportunities.map(toReviewQueueOpportunity);
}

export async function applyReviewAction(db: ReviewDb, input: ApplyReviewActionInput) {
  const actorId = assertNonEmptyActorId(input.actorId);

  switch (input.action) {
    case "approve":
      return applyApproveOrReject(db, "approve", actorId, input.opportunityId, input.reason);
    case "reject":
      return applyApproveOrReject(db, "reject", actorId, input.opportunityId, input.reason);
    case "relabel":
      return applyRelabel(db, actorId, input.opportunityId, input.title, input.description, input.reason);
    case "merge":
      return applyMerge(db, actorId, input.sourceOpportunityId, input.targetOpportunityId, input.reason);
    case "split":
      return applySplit(db, actorId, input.opportunityId, input.splits, input.reason);
    default: {
      const neverInput: never = input;
      return neverInput;
    }
  }
}
