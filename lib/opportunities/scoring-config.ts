import type { ScoringWeights } from "./scoring";

export class InvalidScoringWeightsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidScoringWeightsError";
  }
}

const allowedKeys = [
  "frequencyWeight",
  "recencyWeight",
  "severityWeight",
  "segmentWeight"
] as const satisfies ReadonlyArray<keyof ScoringWeights>;

export function parseScoringWeightsPatch(payload: unknown): Partial<ScoringWeights> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new InvalidScoringWeightsError("Payload must be an object.");
  }

  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0) {
    throw new InvalidScoringWeightsError("At least one weight must be provided.");
  }

  for (const key of keys) {
    if (key === "updatedBy") {
      continue;
    }

    if (!allowedKeys.includes(key as keyof ScoringWeights)) {
      throw new InvalidScoringWeightsError(`Unknown weight key: ${key}.`);
    }
  }

  const updates: Partial<ScoringWeights> = {};
  for (const key of allowedKeys) {
    const value = record[key];
    if (value === undefined) {
      continue;
    }

    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new InvalidScoringWeightsError(`Weight '${key}' must be a finite number >= 0.`);
    }

    updates[key] = value;
  }

  if (Object.keys(updates).length === 0) {
    throw new InvalidScoringWeightsError("At least one weight must be provided.");
  }

  return updates;
}
