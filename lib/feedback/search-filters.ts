type FeedbackSource = "intercom" | "upload";
type FeedbackSentiment = "positive" | "neutral" | "negative" | "unclassified";
type FeedbackSeverity = "low" | "medium" | "high" | "critical" | "unclassified";

const FEEDBACK_SOURCES = new Set<FeedbackSource>(["intercom", "upload"]);
const FEEDBACK_SENTIMENTS = new Set<FeedbackSentiment>([
  "positive",
  "neutral",
  "negative",
  "unclassified"
]);
const FEEDBACK_SEVERITIES = new Set<FeedbackSeverity>([
  "low",
  "medium",
  "high",
  "critical",
  "unclassified"
]);

export type FeedbackFilters = {
  search: string | null;
  source: FeedbackSource[];
  dateFrom: Date | null;
  dateTo: Date | null;
  tag: string | null;
  sentiment: FeedbackSentiment | null;
  severity: FeedbackSeverity | null;
  segment: string | null;
};

export type FeedbackFilterState = {
  search: string;
  source: string[];
  dateFrom: string;
  dateTo: string;
  tag: string;
  sentiment: string;
  severity: string;
  segment: string;
};

function readMany(searchParams: URLSearchParams, key: string): string[] {
  const values = searchParams
    .getAll(key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  return Array.from(new Set(values));
}

function parseDate(value: string | null, endOfDay: boolean): Date | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  // YYYY-MM-DD from date inputs should be interpreted as UTC boundaries.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const timeSuffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
    const parsed = new Date(`${trimmed}${timeSuffix}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function asText(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function parseFeedbackFilters(searchParams: URLSearchParams): FeedbackFilters {
  const source = readMany(searchParams, "source").filter((value): value is FeedbackSource =>
    FEEDBACK_SOURCES.has(value as FeedbackSource)
  );
  const sentimentRaw = searchParams.get("sentiment")?.trim().toLowerCase() ?? null;
  const severityRaw = searchParams.get("severity")?.trim().toLowerCase() ?? null;

  return {
    search: asText(searchParams.get("q")),
    source,
    dateFrom: parseDate(searchParams.get("dateFrom"), false),
    dateTo: parseDate(searchParams.get("dateTo"), true),
    tag: asText(searchParams.get("tag")),
    sentiment:
      sentimentRaw && FEEDBACK_SENTIMENTS.has(sentimentRaw as FeedbackSentiment)
        ? (sentimentRaw as FeedbackSentiment)
        : null,
    severity:
      severityRaw && FEEDBACK_SEVERITIES.has(severityRaw as FeedbackSeverity)
        ? (severityRaw as FeedbackSeverity)
        : null,
    segment: asText(searchParams.get("segment"))
  };
}

export function hasFeedbackFilters(filters: FeedbackFilters): boolean {
  return Boolean(
    filters.search ||
      filters.source.length > 0 ||
      filters.dateFrom ||
      filters.dateTo ||
      filters.tag ||
      filters.sentiment ||
      filters.severity ||
      filters.segment
  );
}

export function parseFeedbackFilterState(searchParams: URLSearchParams): FeedbackFilterState {
  const filters = parseFeedbackFilters(searchParams);
  return {
    search: filters.search ?? "",
    source: filters.source,
    dateFrom: filters.dateFrom ? filters.dateFrom.toISOString().slice(0, 10) : "",
    dateTo: filters.dateTo ? filters.dateTo.toISOString().slice(0, 10) : "",
    tag: filters.tag ?? "",
    sentiment: filters.sentiment ?? "",
    severity: filters.severity ?? "",
    segment: filters.segment ?? ""
  };
}

export function toFeedbackFilterSearchParams(state: FeedbackFilterState): URLSearchParams {
  const searchParams = new URLSearchParams();

  const q = state.search.trim();
  if (q) {
    searchParams.set("q", q);
  }

  const sources = Array.from(new Set(state.source.map((value) => value.trim()).filter(Boolean)));
  for (const source of sources) {
    searchParams.append("source", source);
  }

  const dateFrom = state.dateFrom.trim();
  if (dateFrom) {
    searchParams.set("dateFrom", dateFrom);
  }

  const dateTo = state.dateTo.trim();
  if (dateTo) {
    searchParams.set("dateTo", dateTo);
  }

  const tag = state.tag.trim();
  if (tag) {
    searchParams.set("tag", tag);
  }

  const sentiment = state.sentiment.trim();
  if (sentiment) {
    searchParams.set("sentiment", sentiment);
  }

  const severity = state.severity.trim();
  if (severity) {
    searchParams.set("severity", severity);
  }

  const segment = state.segment.trim();
  if (segment) {
    searchParams.set("segment", segment);
  }

  return searchParams;
}

export function buildFeedbackItemWhereInput(filters: FeedbackFilters) {
  const andConditions: Record<string, unknown>[] = [
    {
      deletedAt: null
    }
  ];

  if (filters.source.length > 0) {
    andConditions.push({
      source: {
        in: filters.source
      }
    });
  }

  if (filters.dateFrom || filters.dateTo) {
    andConditions.push({
      occurredAt: {
        ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
        ...(filters.dateTo ? { lte: filters.dateTo } : {})
      }
    });
  }

  if (filters.tag) {
    andConditions.push({
      feedbackSignal: {
        is: {
          tags: {
            has: filters.tag
          }
        }
      }
    });
  }

  if (filters.sentiment) {
    andConditions.push({
      OR: [
        {
          feedbackSignal: {
            is: {
              sentiment: filters.sentiment
            }
          }
        },
        {
          sentiment: {
            equals: filters.sentiment,
            mode: "insensitive"
          }
        }
      ]
    });
  }

  if (filters.severity) {
    andConditions.push({
      OR: [
        {
          feedbackSignal: {
            is: {
              severity: filters.severity
            }
          }
        },
        {
          severity: {
            equals: filters.severity,
            mode: "insensitive"
          }
        }
      ]
    });
  }

  if (filters.segment) {
    andConditions.push({
      accountId: {
        contains: filters.segment,
        mode: "insensitive"
      }
    });
  }

  if (filters.search) {
    andConditions.push({
      OR: [
        {
          rawText: {
            contains: filters.search,
            mode: "insensitive"
          }
        },
        {
          summary: {
            contains: filters.search,
            mode: "insensitive"
          }
        }
      ]
    });
  }

  return {
    AND: andConditions
  };
}
