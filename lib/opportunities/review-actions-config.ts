import type { ApplyReviewActionInput } from "./review-queue";

export class InvalidReviewActionPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidReviewActionPayloadError";
  }
}

type ObjectRecord = Record<string, unknown>;

function asObject(payload: unknown): ObjectRecord {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new InvalidReviewActionPayloadError("Payload must be a JSON object.");
  }

  return payload as ObjectRecord;
}

function parseNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new InvalidReviewActionPayloadError(`${fieldName} must be a non-empty string.`);
  }

  return value.trim();
}

function parseOptionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new InvalidReviewActionPayloadError(`${fieldName} must be a string when provided.`);
  }

  return value;
}

function parseSplit(record: ObjectRecord): [SplitActionInput["splits"][0], SplitActionInput["splits"][1]] {
  const splits = record.splits;
  if (!Array.isArray(splits) || splits.length !== 2) {
    throw new InvalidReviewActionPayloadError("split action requires exactly two split definitions.");
  }

  const parsed = splits.map((split, index) => {
    const splitRecord = asObject(split);
    const title = parseNonEmptyString(splitRecord.title, `splits[${index}].title`);

    if (!Array.isArray(splitRecord.evidenceFeedbackItemIds) || splitRecord.evidenceFeedbackItemIds.length === 0) {
      throw new InvalidReviewActionPayloadError(
        `splits[${index}].evidenceFeedbackItemIds must be a non-empty string array.`
      );
    }

    const evidenceFeedbackItemIds = splitRecord.evidenceFeedbackItemIds.map((id, idIndex) =>
      parseNonEmptyString(id, `splits[${index}].evidenceFeedbackItemIds[${idIndex}]`)
    );

    const description =
      splitRecord.description === undefined || splitRecord.description === null
        ? splitRecord.description
        : parseOptionalString(splitRecord.description, `splits[${index}].description`);

    return {
      title,
      description: description ?? undefined,
      evidenceFeedbackItemIds
    };
  });

  return [parsed[0], parsed[1]];
}

export function parseReviewActionPayload(payload: unknown): ApplyReviewActionInput {
  const record = asObject(payload);

  const action = parseNonEmptyString(record.action, "action");
  const actorId = parseNonEmptyString(record.actorId, "actorId");
  const reason = parseOptionalString(record.reason, "reason");

  switch (action) {
    case "approve":
      return {
        action,
        actorId,
        opportunityId: parseNonEmptyString(record.opportunityId, "opportunityId"),
        reason
      };
    case "reject":
      return {
        action,
        actorId,
        opportunityId: parseNonEmptyString(record.opportunityId, "opportunityId"),
        reason
      };
    case "merge":
      return {
        action,
        actorId,
        sourceOpportunityId: parseNonEmptyString(record.sourceOpportunityId, "sourceOpportunityId"),
        targetOpportunityId: parseNonEmptyString(record.targetOpportunityId, "targetOpportunityId"),
        reason
      };
    case "split":
      return {
        action,
        actorId,
        opportunityId: parseNonEmptyString(record.opportunityId, "opportunityId"),
        splits: parseSplit(record),
        reason
      };
    case "relabel": {
      const description =
        record.description === undefined || record.description === null
          ? record.description
          : parseOptionalString(record.description, "description");

      return {
        action,
        actorId,
        opportunityId: parseNonEmptyString(record.opportunityId, "opportunityId"),
        title: parseNonEmptyString(record.title, "title"),
        description: description ?? undefined,
        reason
      };
    }
    default:
      throw new InvalidReviewActionPayloadError(
        "action must be one of: approve, reject, merge, split, relabel."
      );
  }
}
type SplitActionInput = Extract<ApplyReviewActionInput, { action: "split" }>;
