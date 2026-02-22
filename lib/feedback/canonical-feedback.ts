export type CanonicalFeedbackSource = "intercom" | "upload";

export const REQUIRED_CANONICAL_FIELDS = ["source", "occurredAt", "rawText"] as const;
export const OPTIONAL_CANONICAL_FIELDS = [
  "externalId",
  "summary",
  "customerName",
  "customerEmail",
  "accountId",
  "sentiment",
  "severity",
  "sourceUrl",
  "metadataJson"
] as const;

type CanonicalFeedbackItem = {
  source: CanonicalFeedbackSource;
  externalId?: string;
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
};

type ValueLookup = {
  value?: string;
  key?: string;
};

const RAW_TEXT_KEYS = ["rawText", "raw_text", "body", "message", "content", "feedback"] as const;
const OCCURRED_AT_KEYS = [
  "occurredAt",
  "occurred_at",
  "createdAt",
  "created_at",
  "timestamp",
  "date"
] as const;
const EXTERNAL_ID_KEYS = ["externalId", "external_id", "id"] as const;
const SUMMARY_KEYS = ["summary", "subject", "title"] as const;
const CUSTOMER_NAME_KEYS = ["customerName", "customer_name", "name"] as const;
const CUSTOMER_EMAIL_KEYS = ["customerEmail", "customer_email", "email"] as const;
const ACCOUNT_ID_KEYS = ["accountId", "account_id", "companyId", "workspaceId"] as const;
const SENTIMENT_KEYS = ["sentiment"] as const;
const SEVERITY_KEYS = ["severity", "priority"] as const;
const SOURCE_URL_KEYS = ["sourceUrl", "source_url", "url", "permalink", "link"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
  payload: Record<string, unknown>,
  keys: readonly string[],
  consumedKeys: Set<string>
): ValueLookup {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim().length > 0) {
      consumedKeys.add(key);
      return { value: value.trim(), key };
    }
  }

  return {};
}

function readDate(
  payload: Record<string, unknown>,
  keys: readonly string[],
  consumedKeys: Set<string>
): ValueLookup & { dateValue?: Date } {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value !== "string" && !(value instanceof Date)) {
      continue;
    }

    const candidate = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(candidate.getTime())) {
      consumedKeys.add(key);
      return { dateValue: candidate, key };
    }
  }

  return {};
}

function readNestedString(
  payload: Record<string, unknown>,
  parentKey: string,
  nestedKey: string,
  consumedKeys: Set<string>
): string | undefined {
  const parent = payload[parentKey];
  if (!isRecord(parent)) {
    return undefined;
  }

  const value = parent[nestedKey];
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  consumedKeys.add(parentKey);
  return value.trim();
}

function createMetadataJson(
  payload: Record<string, unknown>,
  consumedKeys: Set<string>
): Record<string, unknown> | undefined {
  const extraFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!consumedKeys.has(key)) {
      extraFields[key] = value;
    }
  }

  const metadataValue = payload.metadata;
  const sourceMetadata = isRecord(metadataValue) ? metadataValue : undefined;

  if (Object.keys(extraFields).length === 0 && !sourceMetadata) {
    return undefined;
  }

  return {
    ...(sourceMetadata ? { sourceMetadata } : {}),
    ...(Object.keys(extraFields).length > 0 ? { extraFields } : {})
  };
}

export function toCanonicalFeedbackItem(
  source: CanonicalFeedbackSource,
  payload: Record<string, unknown>
): CanonicalFeedbackItem {
  const consumedKeys = new Set<string>();

  const rawTextLookup = readString(payload, RAW_TEXT_KEYS, consumedKeys);
  if (!rawTextLookup.value) {
    throw new Error("Unable to map feedback item: missing raw text.");
  }

  const occurredAtLookup = readDate(payload, OCCURRED_AT_KEYS, consumedKeys);
  if (!occurredAtLookup.dateValue) {
    throw new Error("Unable to map feedback item: missing or invalid occurredAt.");
  }
  const externalIdLookup = readString(payload, EXTERNAL_ID_KEYS, consumedKeys);
  const summaryLookup = readString(payload, SUMMARY_KEYS, consumedKeys);
  const sentimentLookup = readString(payload, SENTIMENT_KEYS, consumedKeys);
  const severityLookup = readString(payload, SEVERITY_KEYS, consumedKeys);
  const sourceUrlLookup = readString(payload, SOURCE_URL_KEYS, consumedKeys);

  const customerName =
    readString(payload, CUSTOMER_NAME_KEYS, consumedKeys).value ??
    readNestedString(payload, "customer", "name", consumedKeys) ??
    readNestedString(payload, "user", "name", consumedKeys);

  const customerEmail =
    readString(payload, CUSTOMER_EMAIL_KEYS, consumedKeys).value ??
    readNestedString(payload, "customer", "email", consumedKeys) ??
    readNestedString(payload, "user", "email", consumedKeys);

  const accountId =
    readString(payload, ACCOUNT_ID_KEYS, consumedKeys).value ??
    readNestedString(payload, "company", "id", consumedKeys);

  const metadataJson = createMetadataJson(payload, consumedKeys);

  return {
    source,
    externalId: externalIdLookup.value,
    occurredAt: occurredAtLookup.dateValue,
    rawText: rawTextLookup.value,
    summary: summaryLookup.value,
    customerName,
    customerEmail,
    accountId,
    sentiment: sentimentLookup.value,
    severity: severityLookup.value,
    sourceUrl: sourceUrlLookup.value,
    metadataJson
  };
}
