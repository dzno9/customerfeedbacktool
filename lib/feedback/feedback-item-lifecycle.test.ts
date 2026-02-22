import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FeedbackItemLifecycleError,
  restoreFeedbackItem,
  softDeleteFeedbackItem
} from "./feedback-item-lifecycle";

type ItemRecord = {
  id: string;
  deletedAt: Date | null;
};

function createFakeDb(initialItems: ItemRecord[]) {
  const items = new Map(initialItems.map((item) => [item.id, item]));
  const auditLogs: Array<{
    action: string;
    entityType: string;
    entityId: string;
    actorId: string;
    metadataJson?: Record<string, unknown> | null;
  }> = [];

  return {
    feedbackItem: {
      async findUnique(args: { where: { id: string } }) {
        return items.get(args.where.id) ?? null;
      },
      async update(args: { where: { id: string }; data: { deletedAt: Date | null } }) {
        const current = items.get(args.where.id);
        if (!current) {
          throw new Error("item not found");
        }

        const next = {
          ...current,
          deletedAt: args.data.deletedAt
        };
        items.set(next.id, next);
        return next;
      }
    },
    auditLog: {
      async create(args: {
        data: {
          action: string;
          entityType: string;
          entityId: string;
          actorId: string;
          metadataJson?: Record<string, unknown> | null;
        };
      }) {
        auditLogs.push(args.data);
      }
    },
    __state: {
      getItem(id: string) {
        return items.get(id) ?? null;
      },
      getAuditLogs() {
        return [...auditLogs];
      }
    }
  };
}

describe("feedback item lifecycle", () => {
  afterEach(() => {
    delete process.env.SOFT_DELETE_RETENTION_DAYS;
    vi.useRealTimers();
  });

  it("soft deletes and writes an audit log", async () => {
    const db = createFakeDb([{ id: "fb_1", deletedAt: null }]);

    const result = await softDeleteFeedbackItem(db, "fb_1", "pm_1");

    expect(result.deletedAt).toBeInstanceOf(Date);
    expect(db.__state.getItem("fb_1")?.deletedAt).toBeInstanceOf(Date);
    expect(db.__state.getAuditLogs()).toHaveLength(1);
    expect(db.__state.getAuditLogs()[0]).toMatchObject({
      action: "feedback_item.soft_delete",
      entityType: "feedback_item",
      entityId: "fb_1",
      actorId: "pm_1"
    });
  });

  it("restores within retention and writes audit log", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-21T12:00:00.000Z"));
    process.env.SOFT_DELETE_RETENTION_DAYS = "30";

    const db = createFakeDb([{ id: "fb_2", deletedAt: new Date("2026-02-10T00:00:00.000Z") }]);

    const result = await restoreFeedbackItem(db, "fb_2", "pm_2");

    expect(result.deletedAt).toBeNull();
    expect(db.__state.getItem("fb_2")?.deletedAt).toBeNull();
    expect(db.__state.getAuditLogs()).toHaveLength(1);
    expect(db.__state.getAuditLogs()[0]).toMatchObject({
      action: "feedback_item.restore",
      entityType: "feedback_item",
      entityId: "fb_2",
      actorId: "pm_2"
    });
  });

  it("blocks restore outside retention window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-21T12:00:00.000Z"));
    process.env.SOFT_DELETE_RETENTION_DAYS = "7";

    const db = createFakeDb([{ id: "fb_3", deletedAt: new Date("2026-02-01T00:00:00.000Z") }]);

    await expect(restoreFeedbackItem(db, "fb_3", "pm_3")).rejects.toMatchObject<FeedbackItemLifecycleError>({
      code: "RETENTION_EXPIRED"
    });

    expect(db.__state.getItem("fb_3")?.deletedAt?.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(db.__state.getAuditLogs()).toHaveLength(0);
  });
});
