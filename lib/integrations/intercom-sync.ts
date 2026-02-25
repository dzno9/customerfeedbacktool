import { z } from "zod";

import { toCanonicalFeedbackItem } from "../feedback/canonical-feedback";
import { decodeIntercomCredentials } from "./intercom-connection";

const INTERCOM_PROVIDER = "intercom";
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_API_ATTEMPTS = 3;
const DEFAULT_INCREMENTAL_LOOKBACK_MS = 15 * 60 * 1000;
const DEFAULT_BACKFILL_MAX_RECORDS = 500;
const DEFAULT_BACKFILL_MAX_PAGES = 20;

const backfillInputSchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    maxRecords: z.coerce.number().int().positive().max(10_000).optional(),
    maxPages: z.coerce.number().int().positive().max(200).optional()
  })
  .refine((value) => value.from <= value.to, {
    message: "`from` must be less than or equal to `to`.",
    path: ["from"]
  });

type ConversationRecord = Record<string, unknown>;

type IntercomPage = {
  conversations: ConversationRecord[];
  nextCursor: string | null;
};

type SyncJobRecord = {
  id: string;
  status: string;
  recordsProcessed: number;
  apiAttempts: number;
  error: string | null;
};

type IntercomClient = {
  fetchConversationsPage: (args: {
    accessToken: string;
    from?: Date;
    to?: Date;
    cursor?: string;
    pageSize: number;
    timeoutMs: number;
  }) => Promise<IntercomPage>;
};

type SyncDeps = {
  db: any;
  intercomClient?: IntercomClient;
  enqueueFeedbackSummaryJob?: (feedbackItemId: string) => Promise<void>;
  enqueueFeedbackSignalsJob?: (feedbackItemId: string) => Promise<void>;
  now?: () => Date;
  pageSize?: number;
  timeoutMs?: number;
  maxApiAttempts?: number;
};

function coerceDateValue(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === "number") {
    const millis = value > 1_000_000_000_000 ? value : value * 1_000;
    const candidate = new Date(millis);
    if (!Number.isNaN(candidate.getTime())) {
      return candidate;
    }
  }

  if (typeof value === "string") {
    const candidate = new Date(value);
    if (!Number.isNaN(candidate.getTime())) {
      return candidate;
    }
  }

  return undefined;
}

function toIntercomCanonicalPayload(conversation: ConversationRecord): Record<string, unknown> {
  const source =
    typeof conversation.source === "object" && conversation.source !== null
      ? (conversation.source as Record<string, unknown>)
      : undefined;

  const partsRaw =
    typeof conversation.conversation_parts === "object" &&
    conversation.conversation_parts !== null
      ? (conversation.conversation_parts as Record<string, unknown>).conversation_parts
      : undefined;

  const parts = Array.isArray(partsRaw)
    ? partsRaw
        .map((part) => {
          if (typeof part !== "object" || part === null) {
            return null;
          }

          const body = (part as Record<string, unknown>).body;
          return typeof body === "string" ? body : null;
        })
        .filter((value): value is string => Boolean(value))
    : [];

  const contactsRoot =
    typeof conversation.contacts === "object" && conversation.contacts !== null
      ? (conversation.contacts as Record<string, unknown>)
      : undefined;

  const contacts = Array.isArray(contactsRoot?.contacts)
    ? contactsRoot?.contacts
    : Array.isArray(conversation.contacts)
      ? conversation.contacts
      : [];

  const primaryContact = contacts.find(
    (contact): contact is Record<string, unknown> =>
      typeof contact === "object" && contact !== null
  );

  const createdAt = coerceDateValue(conversation.created_at ?? conversation.createdAt);

  const rawTextCandidate =
    (typeof source?.body === "string" ? source.body : undefined) ??
    (parts.length > 0 ? parts.join("\n") : undefined);

  const rawText = rawTextCandidate?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  return {
    id:
      typeof conversation.id === "string" || typeof conversation.id === "number"
        ? String(conversation.id)
        : undefined,
    createdAt: createdAt?.toISOString(),
    body: rawText,
    summary: typeof source?.subject === "string" ? source.subject : undefined,
    permalink: typeof conversation.link === "string" ? conversation.link : undefined,
    customer: {
      name: typeof primaryContact?.name === "string" ? primaryContact.name : undefined,
      email:
        typeof primaryContact?.email === "string" ? primaryContact.email : undefined
    },
    metadata: {
      intercomConversation: conversation
    }
  };
}

async function withRetries<T>(
  operation: () => Promise<T>,
  maxAttempts: number,
  onAttempt: () => void
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    onAttempt();

    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) {
        break;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Intercom sync failed after retries.");
}

function shouldIncludeByDateRange(createdAt: Date, from?: Date, to?: Date): boolean {
  if (from && createdAt < from) {
    return false;
  }

  if (to && createdAt > to) {
    return false;
  }

  return true;
}

function buildConversationsSearchParams(input: {
  from?: Date;
  to?: Date;
  cursor?: string;
  pageSize: number;
}): URLSearchParams {
  const searchParams = new URLSearchParams();
  searchParams.set("per_page", String(input.pageSize));

  if (input.cursor) {
    searchParams.set("starting_after", input.cursor);
  }

  if (input.from) {
    searchParams.set("updated_since", String(Math.floor(input.from.getTime() / 1000)));
  }

  // Intercom may ignore unsupported params, but we send this to bound backfill windows.
  if (input.to) {
    searchParams.set("updated_before", String(Math.floor(input.to.getTime() / 1000)));
  }

  return searchParams;
}

function getIntercomClient(): IntercomClient {
  return {
    async fetchConversationsPage({ accessToken, from, to, cursor, pageSize, timeoutMs }) {
      const searchParams = buildConversationsSearchParams({
        from,
        to,
        cursor,
        pageSize
      });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(
          `https://api.intercom.io/conversations?${searchParams.toString()}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json",
              "Intercom-Version": "2.11"
            },
            signal: controller.signal,
            cache: "no-store"
          }
        );

        if (!response.ok) {
          throw new Error(`Intercom API request failed with status ${response.status}.`);
        }

        const payload = (await response.json()) as Record<string, unknown>;
        const conversations = Array.isArray(payload.conversations)
          ? payload.conversations.filter(
              (value): value is ConversationRecord =>
                typeof value === "object" && value !== null
            )
          : [];

        const pages =
          typeof payload.pages === "object" && payload.pages !== null
            ? (payload.pages as Record<string, unknown>)
            : undefined;

        const next =
          typeof pages?.next === "object" && pages.next !== null
            ? (pages.next as Record<string, unknown>)
            : undefined;

        const nextCursor =
          typeof next?.starting_after === "string"
            ? next.starting_after
            : typeof payload.starting_after === "string"
              ? payload.starting_after
              : null;

        return {
          conversations,
          nextCursor
        };
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw new Error("Intercom API request timed out.");
        }

        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

async function runIntercomSync(
  mode: "intercom_backfill" | "intercom_incremental_sync",
  input: {
    from?: Date;
    to?: Date;
    maxRecords?: number;
    maxPages?: number;
  },
  deps: SyncDeps
): Promise<{ ok: true; job: SyncJobRecord } | { ok: false; error: string; job: SyncJobRecord }> {
  const now = deps.now?.() ?? new Date();

  const createdJob = await deps.db.syncJob.create({
    data: {
      provider: INTERCOM_PROVIDER,
      jobType: mode,
      status: "running",
      fromDate: input.from,
      toDate: input.to,
      startedAt: now
    }
  });

  let apiAttempts = 0;
  let recordsProcessed = 0;
  const intercomClient = deps.intercomClient ?? getIntercomClient();
  let hasConnection = false;

  try {
    const connection = await deps.db.integrationConnection.findUnique({
      where: {
        provider: INTERCOM_PROVIDER
      }
    });

    if (!connection || connection.status !== "connected" || !connection.encryptedCredentials) {
      throw new Error("Intercom is not connected. Configure integration credentials first.");
    }
    hasConnection = true;

    const { accessToken } = decodeIntercomCredentials(connection.encryptedCredentials);

    const from =
      mode === "intercom_incremental_sync"
        ? input.from ??
          connection.lastSyncAt ??
          new Date(now.getTime() - DEFAULT_INCREMENTAL_LOOKBACK_MS)
        : input.from;

    const to = input.to;
    const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
    const timeoutMs = deps.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const maxApiAttempts = deps.maxApiAttempts ?? DEFAULT_MAX_API_ATTEMPTS;
    const configuredBackfillMaxRecords = Number(process.env.INTERCOM_BACKFILL_MAX_RECORDS ?? "");
    const configuredBackfillMaxPages = Number(process.env.INTERCOM_BACKFILL_MAX_PAGES ?? "");
    const maxRecords =
      mode === "intercom_backfill"
        ? input.maxRecords ??
          (Number.isFinite(configuredBackfillMaxRecords) && configuredBackfillMaxRecords > 0
            ? Math.floor(configuredBackfillMaxRecords)
            : DEFAULT_BACKFILL_MAX_RECORDS)
        : Number.POSITIVE_INFINITY;
    const maxPages =
      mode === "intercom_backfill"
        ? input.maxPages ??
          (Number.isFinite(configuredBackfillMaxPages) && configuredBackfillMaxPages > 0
            ? Math.floor(configuredBackfillMaxPages)
            : DEFAULT_BACKFILL_MAX_PAGES)
        : Number.POSITIVE_INFINITY;

    let cursor: string | undefined;
    let pagesFetched = 0;

    while (true) {
      if (pagesFetched >= maxPages || recordsProcessed >= maxRecords) {
        break;
      }

      const page = await withRetries(
        async () =>
          intercomClient.fetchConversationsPage({
            accessToken,
            from,
            to,
            cursor,
            pageSize,
            timeoutMs
          }),
        maxApiAttempts,
        () => {
          apiAttempts += 1;
        }
      );
      pagesFetched += 1;

      let shouldStop = false;

      for (const conversation of page.conversations) {
        if (recordsProcessed >= maxRecords) {
          shouldStop = true;
          break;
        }

        let canonical;
        try {
          canonical = toCanonicalFeedbackItem(
            "intercom",
            toIntercomCanonicalPayload(conversation)
          );
        } catch (error) {
          // Intercom payloads can include conversation variants with no usable text/body.
          // Skip malformed records so one bad item does not fail the entire sync run.
          if (error instanceof Error) {
            const message = error.message.toLowerCase();
            if (
              message.includes("unable to map feedback item") ||
              message.includes("missing raw text") ||
              message.includes("missing or invalid occurredat")
            ) {
              continue;
            }
          }
          throw error;
        }

        if (!canonical.externalId) {
          continue;
        }

        if (mode === "intercom_backfill" && !shouldIncludeByDateRange(canonical.occurredAt, from, to)) {
          continue;
        }

        const feedbackItem = await deps.db.feedbackItem.upsert({
          where: {
            source_externalId: {
              source: "intercom",
              externalId: canonical.externalId
            }
          },
          create: canonical,
          update: {
            occurredAt: canonical.occurredAt,
            rawText: canonical.rawText,
            customerName: canonical.customerName,
            customerEmail: canonical.customerEmail,
            accountId: canonical.accountId,
            sentiment: canonical.sentiment,
            severity: canonical.severity,
            sourceUrl: canonical.sourceUrl,
            metadataJson: canonical.metadataJson,
            deletedAt: null
          }
        });

        if (typeof feedbackItem?.id === "string") {
          if (deps.enqueueFeedbackSummaryJob) {
            await deps.enqueueFeedbackSummaryJob(feedbackItem.id);
          }
          if (deps.enqueueFeedbackSignalsJob) {
            await deps.enqueueFeedbackSignalsJob(feedbackItem.id);
          }
        }

        recordsProcessed += 1;
      }

      if (shouldStop) {
        break;
      }

      if (!page.nextCursor) {
        break;
      }

      cursor = page.nextCursor;
      await deps.db.syncJob.update({
        where: { id: createdJob.id },
        data: {
          cursor,
          recordsProcessed,
          apiAttempts
        }
      });
    }

    await deps.db.integrationConnection.update({
      where: {
        provider: INTERCOM_PROVIDER
      },
      data: {
        lastSyncAt: now,
        lastError: null,
        status: "connected"
      }
    });

    const completedJob = await deps.db.syncJob.update({
      where: { id: createdJob.id },
      data: {
        status: "succeeded",
        completedAt: now,
        recordsProcessed,
        apiAttempts,
        error: null,
        cursor: null
      }
    });

    return {
      ok: true,
      job: completedJob
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Intercom sync failed.";

    if (hasConnection) {
      await deps.db.integrationConnection.update({
        where: {
          provider: INTERCOM_PROVIDER
        },
        data: {
          lastError: message
        }
      });
    }

    const failedJob = await deps.db.syncJob.update({
      where: { id: createdJob.id },
      data: {
        status: "failed",
        completedAt: now,
        recordsProcessed,
        apiAttempts,
        error: message
      }
    });

    return {
      ok: false,
      error: message,
      job: failedJob
    };
  }
}

export function parseIntercomBackfillInput(input: unknown): {
  from: Date;
  to: Date;
  maxRecords?: number;
  maxPages?: number;
} {
  return backfillInputSchema.parse(input);
}

export async function runIntercomBackfillSync(
  input: {
    from: Date;
    to: Date;
  },
  deps: SyncDeps
) {
  return runIntercomSync(
    "intercom_backfill",
    {
      from: input.from,
      to: input.to,
      maxRecords: input.maxRecords,
      maxPages: input.maxPages
    },
    deps
  );
}

export async function runIntercomIncrementalSync(deps: SyncDeps) {
  return runIntercomSync("intercom_incremental_sync", {}, deps);
}

export { buildConversationsSearchParams };
