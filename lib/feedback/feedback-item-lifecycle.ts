import { createAuditLog } from "../audit/audit-log";

const DEFAULT_RETENTION_DAYS = 30;

export class FeedbackItemLifecycleError extends Error {
  code: "NOT_FOUND" | "ALREADY_DELETED" | "NOT_DELETED" | "RETENTION_EXPIRED";

  constructor(
    code: "NOT_FOUND" | "ALREADY_DELETED" | "NOT_DELETED" | "RETENTION_EXPIRED",
    message: string
  ) {
    super(message);
    this.code = code;
    this.name = "FeedbackItemLifecycleError";
  }
}

type FeedbackItemLifecycleDb = {
  feedbackItem: {
    findUnique(args: {
      where: { id: string };
      select: {
        id: true;
        deletedAt: true;
      };
    }): Promise<{
      id: string;
      deletedAt: Date | null;
    } | null>;
    update(args: {
      where: { id: string };
      data: {
        deletedAt: Date | null;
      };
      select: {
        id: true;
        deletedAt: true;
      };
    }): Promise<{
      id: string;
      deletedAt: Date | null;
    }>;
  };
  auditLog: {
    create(args: unknown): Promise<unknown>;
  };
};

function normalizeActorId(actorId: string): string {
  const normalized = actorId.trim();
  if (!normalized) {
    throw new Error("actorId is required.");
  }
  return normalized;
}

function getRetentionDays(): number {
  const parsed = Number(process.env.SOFT_DELETE_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_RETENTION_DAYS;
  }
  return Math.floor(parsed);
}

export async function softDeleteFeedbackItem(
  db: FeedbackItemLifecycleDb,
  feedbackItemId: string,
  actorId: string
) {
  const normalizedActorId = normalizeActorId(actorId);
  const item = await db.feedbackItem.findUnique({
    where: { id: feedbackItemId },
    select: {
      id: true,
      deletedAt: true
    }
  });

  if (!item) {
    throw new FeedbackItemLifecycleError("NOT_FOUND", `Feedback item '${feedbackItemId}' not found.`);
  }

  if (item.deletedAt) {
    throw new FeedbackItemLifecycleError(
      "ALREADY_DELETED",
      `Feedback item '${feedbackItemId}' is already soft deleted.`
    );
  }

  const deletedAt = new Date();
  const updated = await db.feedbackItem.update({
    where: { id: feedbackItemId },
    data: { deletedAt },
    select: {
      id: true,
      deletedAt: true
    }
  });

  await createAuditLog(db, {
    action: "feedback_item.soft_delete",
    actorId: normalizedActorId,
    entityType: "feedback_item",
    entityId: feedbackItemId,
    metadataJson: {
      deletedAt: deletedAt.toISOString()
    }
  });

  return updated;
}

export async function restoreFeedbackItem(
  db: FeedbackItemLifecycleDb,
  feedbackItemId: string,
  actorId: string
) {
  const normalizedActorId = normalizeActorId(actorId);
  const item = await db.feedbackItem.findUnique({
    where: { id: feedbackItemId },
    select: {
      id: true,
      deletedAt: true
    }
  });

  if (!item) {
    throw new FeedbackItemLifecycleError("NOT_FOUND", `Feedback item '${feedbackItemId}' not found.`);
  }

  if (!item.deletedAt) {
    throw new FeedbackItemLifecycleError(
      "NOT_DELETED",
      `Feedback item '${feedbackItemId}' is not soft deleted.`
    );
  }

  const retentionDays = getRetentionDays();
  const retentionThreshold = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  if (item.deletedAt < retentionThreshold) {
    throw new FeedbackItemLifecycleError(
      "RETENTION_EXPIRED",
      `Feedback item '${feedbackItemId}' cannot be restored after the ${retentionDays}-day retention window.`
    );
  }

  const restored = await db.feedbackItem.update({
    where: { id: feedbackItemId },
    data: { deletedAt: null },
    select: {
      id: true,
      deletedAt: true
    }
  });

  await createAuditLog(db, {
    action: "feedback_item.restore",
    actorId: normalizedActorId,
    entityType: "feedback_item",
    entityId: feedbackItemId,
    metadataJson: {
      restoredAt: new Date().toISOString(),
      previousDeletedAt: item.deletedAt.toISOString(),
      retentionDays
    }
  });

  return restored;
}
