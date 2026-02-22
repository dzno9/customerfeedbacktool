import { describe, expect, it } from "vitest";

import { InvalidScoringWeightsError, parseScoringWeightsPatch } from "./scoring-config";

describe("parseScoringWeightsPatch", () => {
  it("parses valid partial updates", () => {
    const result = parseScoringWeightsPatch({
      recencyWeight: 2.5
    });

    expect(result).toEqual({
      recencyWeight: 2.5
    });
  });

  it("ignores updatedBy metadata in patch payload", () => {
    const result = parseScoringWeightsPatch({
      recencyWeight: 2.5,
      updatedBy: "pm_1"
    });

    expect(result).toEqual({
      recencyWeight: 2.5
    });
  });

  it("rejects non-object payloads", () => {
    expect(() => parseScoringWeightsPatch("bad")).toThrow(InvalidScoringWeightsError);
  });

  it("rejects unknown keys", () => {
    expect(() => parseScoringWeightsPatch({ nope: 2 })).toThrow(InvalidScoringWeightsError);
  });

  it("rejects invalid numeric values", () => {
    expect(() => parseScoringWeightsPatch({ recencyWeight: -1 })).toThrow(InvalidScoringWeightsError);
    expect(() => parseScoringWeightsPatch({ recencyWeight: Number.NaN })).toThrow(
      InvalidScoringWeightsError
    );
  });
});
