import { describe, expect, it } from "vitest";

import {
  buildFeedbackItemWhereInput,
  parseFeedbackFilters,
  parseFeedbackFilterState,
  toFeedbackFilterSearchParams
} from "./search-filters";

describe("search filters", () => {
  it("parses and builds combined filters", () => {
    const searchParams = new URLSearchParams(
      "source=intercom&source=upload&dateFrom=2026-02-01&dateTo=2026-02-10&tag=security&sentiment=negative&severity=high&segment=enterprise"
    );
    const filters = parseFeedbackFilters(searchParams);
    const where = buildFeedbackItemWhereInput(filters) as {
      AND: Array<Record<string, unknown>>;
    };

    expect(filters.source).toEqual(["intercom", "upload"]);
    expect(filters.dateFrom?.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(filters.dateTo?.toISOString()).toBe("2026-02-10T23:59:59.999Z");
    expect(where.AND).toHaveLength(7);
    expect(where.AND[0]).toEqual({ deletedAt: null });
  });

  it("search matches raw text and summary", () => {
    const filters = parseFeedbackFilters(new URLSearchParams("q=okta"));
    const where = buildFeedbackItemWhereInput(filters) as {
      AND: Array<{ OR?: Array<Record<string, unknown>> }>;
    };

    expect(where.AND).toHaveLength(2);
    expect(where.AND[0]).toEqual({ deletedAt: null });
    expect(where.AND[1]?.OR).toHaveLength(2);
    expect(where.AND[1]?.OR?.[0]).toMatchObject({
      rawText: { contains: "okta", mode: "insensitive" }
    });
    expect(where.AND[1]?.OR?.[1]).toMatchObject({
      summary: { contains: "okta", mode: "insensitive" }
    });
  });

  it("restores filter state from query params and serializes back", () => {
    const input = new URLSearchParams(
      "q=single%20sign-on&source=intercom&sentiment=negative&severity=critical&dateFrom=2026-02-01&dateTo=2026-02-15&tag=auth&segment=enterprise"
    );
    const state = parseFeedbackFilterState(input);
    const output = toFeedbackFilterSearchParams(state);

    expect(state).toEqual({
      search: "single sign-on",
      source: ["intercom"],
      sentiment: "negative",
      severity: "critical",
      dateFrom: "2026-02-01",
      dateTo: "2026-02-15",
      tag: "auth",
      segment: "enterprise"
    });
    expect(output.toString()).toContain("q=single+sign-on");
    expect(output.getAll("source")).toEqual(["intercom"]);
    expect(output.get("tag")).toBe("auth");
  });
});
