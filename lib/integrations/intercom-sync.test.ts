import { describe, expect, it } from "vitest";

import { connectIntercom } from "./intercom-connection";
import {
  buildConversationsSearchParams,
  parseIntercomBackfillInput,
  runIntercomBackfillSync,
  runIntercomIncrementalSync
} from "./intercom-sync";

type StoredConnection = {
  provider: string;
  status: string;
  encryptedCredentials: string;
  lastError: string | null;
  lastCheckedAt: Date | null;
  lastSyncAt: Date | null;
  updatedAt: Date;
};

type StoredFeedbackItem = {
  id: string;
  source: "intercom";
  externalId: string;
  occurredAt: Date;
  rawText: string;
  summary?: string;
  customerName?: string;
  customerEmail?: string;
  accountId?: string;
  sentiment?: string;
  severity?: string;
  sourceUrl?: string;
  metadataJson?: Record<string, unknown>;
  deletedAt?: Date | null;
};

type StoredSyncJob = {
  id: string;
  provider: string;
  jobType: string;
  status: string;
  fromDate?: Date;
  toDate?: Date;
  cursor?: string | null;
  recordsProcessed: number;
  apiAttempts: number;
  error: string | null;
  startedAt: Date;
  completedAt: Date | null;
};

function createFakeDb() {
  let connection: StoredConnection | null = null;
  const feedbackItems = new Map<string, StoredFeedbackItem>();
  const syncJobs = new Map<string, StoredSyncJob>();
  let syncJobSeq = 1;
  let feedbackSeq = 1;

  return {
    integrationConnection: {
      async findFirst() {
        return connection;
      },
      async findUnique() {
        return connection;
      },
      async upsert(args: {
        create: Omit<StoredConnection, "updatedAt" | "lastSyncAt">;
        update: Omit<StoredConnection, "provider" | "updatedAt" | "lastSyncAt">;
      }) {
        const updatedAt = new Date("2026-02-18T00:00:00.000Z");

        if (!connection) {
          connection = {
            ...args.create,
            updatedAt,
            lastSyncAt: null
          };
          return connection;
        }

        connection = {
          ...connection,
          ...args.update,
          updatedAt
        };

        return connection;
      },
      async update(args: {
        data: Partial<StoredConnection>;
      }) {
        if (!connection) {
          throw new Error("No connection record");
        }

        connection = {
          ...connection,
          ...args.data,
          updatedAt: new Date("2026-02-18T00:00:00.000Z")
        };

        return connection;
      }
    },
    syncJob: {
      async create(args: {
        data: Omit<StoredSyncJob, "id" | "recordsProcessed" | "apiAttempts" | "error" | "completedAt"> & {
          recordsProcessed?: number;
          apiAttempts?: number;
          error?: string | null;
          completedAt?: Date | null;
        };
      }) {
        const id = `job_${syncJobSeq++}`;
        const job: StoredSyncJob = {
          id,
          provider: args.data.provider,
          jobType: args.data.jobType,
          status: args.data.status,
          fromDate: args.data.fromDate,
          toDate: args.data.toDate,
          cursor: args.data.cursor,
          recordsProcessed: args.data.recordsProcessed ?? 0,
          apiAttempts: args.data.apiAttempts ?? 0,
          error: args.data.error ?? null,
          startedAt: args.data.startedAt,
          completedAt: args.data.completedAt ?? null
        };

        syncJobs.set(id, job);
        return { id };
      },
      async update(args: {
        where: { id: string };
        data: Partial<StoredSyncJob>;
      }) {
        const current = syncJobs.get(args.where.id);
        if (!current) {
          throw new Error("Sync job not found");
        }

        const next = {
          ...current,
          ...args.data
        };

        syncJobs.set(args.where.id, next);
        return {
          id: next.id,
          status: next.status,
          recordsProcessed: next.recordsProcessed,
          apiAttempts: next.apiAttempts,
          error: next.error
        };
      }
    },
    feedbackItem: {
      async upsert(args: {
        where: { source_externalId: { source: "intercom"; externalId: string } };
        create: Omit<StoredFeedbackItem, "id">;
        update: Partial<StoredFeedbackItem>;
      }) {
        const key = `${args.where.source_externalId.source}:${args.where.source_externalId.externalId}`;
        const existing = feedbackItems.get(key);

        if (!existing) {
          const created: StoredFeedbackItem = {
            id: `feedback_${feedbackSeq++}`,
            ...args.create
          };
          feedbackItems.set(key, created);
          return created;
        }

        const next = {
          ...existing,
          ...args.update
        };

        feedbackItems.set(key, next);
        return next;
      },
      async count() {
        return feedbackItems.size;
      }
    },
    __state: {
      getConnection: () => connection,
      getSyncJobs: () => Array.from(syncJobs.values()),
      getFeedbackItems: () => Array.from(feedbackItems.values())
    }
  };
}

async function seedConnectedIntercom(db: ReturnType<typeof createFakeDb>) {
  process.env.INTERCOM_CREDENTIALS_ENCRYPTION_KEY = "12345678901234567890123456789012";

  const result = await connectIntercom(
    { accessToken: "token_123" },
    {
      db,
      validateCredentials: async () => ({ ok: true })
    }
  );

  if (!result.ok) {
    throw new Error(`Failed to seed intercom connection: ${result.error}`);
  }
}

describe("intercom sync", () => {
  it("backfill is idempotent when run twice for the same range", async () => {
    const db = createFakeDb();
    await seedConnectedIntercom(db);

    const intercomClient = {
      async fetchConversationsPage() {
        return {
          conversations: [
            {
              id: "conv_1",
              created_at: "2026-02-18T09:00:00.000Z",
              source: {
                body: "Need better reporting",
                subject: "Reporting gap"
              },
              contacts: {
                contacts: [
                  {
                    name: "Ari",
                    email: "ari@example.com"
                  }
                ]
              }
            }
          ],
          nextCursor: null
        };
      }
    };

    const range = parseIntercomBackfillInput({
      from: "2026-02-18T00:00:00.000Z",
      to: "2026-02-18T23:59:59.000Z"
    });

    const first = await runIntercomBackfillSync(range, {
      db,
      intercomClient
    });
    const second = await runIntercomBackfillSync(range, {
      db,
      intercomClient
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(await db.feedbackItem.count()).toBe(1);
  });

  it("incremental sync imports new conversations after previous runs", async () => {
    const db = createFakeDb();
    await seedConnectedIntercom(db);

    const seen = new Set<string>();
    const intercomClient = {
      async fetchConversationsPage() {
        const batch = [
          {
            id: "conv_1",
            created_at: "2026-02-18T09:00:00.000Z",
            source: { body: "Need better reporting" }
          },
          ...(seen.has("conv_2")
            ? [
                {
                  id: "conv_2",
                  created_at: "2026-02-18T09:10:00.000Z",
                  source: { body: "Please add export API" }
                }
              ]
            : [])
        ];

        return {
          conversations: batch,
          nextCursor: null
        };
      }
    };

    const firstRun = await runIntercomIncrementalSync({
      db,
      intercomClient,
      now: () => new Date("2026-02-18T09:05:00.000Z")
    });
    seen.add("conv_2");
    const secondRun = await runIntercomIncrementalSync({
      db,
      intercomClient,
      now: () => new Date("2026-02-18T09:20:00.000Z")
    });

    expect(firstRun.ok).toBe(true);
    expect(secondRun.ok).toBe(true);
    expect(await db.feedbackItem.count()).toBe(2);

    const ids = db
      .__state
      .getFeedbackItems()
      .map((item) => item.externalId)
      .sort();

    expect(ids).toEqual(["conv_1", "conv_2"]);
  });

  it("enqueues summary and signal jobs for imported feedback items", async () => {
    const db = createFakeDb();
    await seedConnectedIntercom(db);
    const summaryEnqueued: string[] = [];
    const signalEnqueued: string[] = [];

    const result = await runIntercomBackfillSync(
      {
        from: new Date("2026-02-18T00:00:00.000Z"),
        to: new Date("2026-02-18T23:59:59.000Z")
      },
      {
        db,
        enqueueFeedbackSummaryJob: async (feedbackItemId) => {
          summaryEnqueued.push(feedbackItemId);
        },
        enqueueFeedbackSignalsJob: async (feedbackItemId) => {
          signalEnqueued.push(feedbackItemId);
        },
        intercomClient: {
          async fetchConversationsPage() {
            return {
              conversations: [
                {
                  id: "conv_queued",
                  created_at: "2026-02-18T10:00:00.000Z",
                  source: {
                    body: "Need SOC2 report exports."
                  }
                }
              ],
              nextCursor: null
            };
          }
        }
      }
    );

    expect(result.ok).toBe(true);
    expect(summaryEnqueued).toHaveLength(1);
    expect(signalEnqueued).toHaveLength(1);
    expect(summaryEnqueued[0]).toBe(signalEnqueued[0]);
  });

  it("records failed status when intercom retries exhaust on timeout", async () => {
    const db = createFakeDb();
    await seedConnectedIntercom(db);

    const result = await runIntercomBackfillSync(
      {
        from: new Date("2026-02-18T00:00:00.000Z"),
        to: new Date("2026-02-18T23:59:59.000Z")
      },
      {
        db,
        maxApiAttempts: 2,
        intercomClient: {
          async fetchConversationsPage() {
            throw new Error("Intercom API request timed out.");
          }
        }
      }
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected failed sync result");
    }

    expect(result.error).toContain("timed out");
    expect(result.job.status).toBe("failed");
    expect(result.job.apiAttempts).toBe(2);

    const connection = db.__state.getConnection();
    expect(connection?.lastError).toContain("timed out");

    const jobs = db.__state.getSyncJobs();
    expect(jobs.at(-1)?.status).toBe("failed");
  });

  it("incremental sync does not drop old conversations that were recently updated", async () => {
    const db = createFakeDb();
    await seedConnectedIntercom(db);

    const result = await runIntercomIncrementalSync({
      db,
      now: () => new Date("2026-02-18T09:20:00.000Z"),
      intercomClient: {
        async fetchConversationsPage() {
          return {
            conversations: [
              {
                id: "conv_legacy",
                created_at: "2025-01-01T09:00:00.000Z",
                updated_at: "2026-02-18T09:19:00.000Z",
                source: { body: "Legacy account still requests SSO improvements." }
              }
            ],
            nextCursor: null
          };
        }
      }
    });

    expect(result.ok).toBe(true);
    const ids = db.__state
      .getFeedbackItems()
      .map((item) => item.externalId)
      .sort();
    expect(ids).toContain("conv_legacy");
  });

  it("builds backfill query params with both from and to bounds", () => {
    const from = new Date("2026-02-18T00:00:00.000Z");
    const to = new Date("2026-02-18T23:59:59.000Z");

    const params = buildConversationsSearchParams({
      from,
      to,
      cursor: "abc",
      pageSize: 50
    });

    expect(params.get("updated_since")).toBe(String(Math.floor(from.getTime() / 1000)));
    expect(params.get("updated_before")).toBe(String(Math.floor(to.getTime() / 1000)));
    expect(params.get("starting_after")).toBe("abc");
    expect(params.get("per_page")).toBe("50");
  });
});
