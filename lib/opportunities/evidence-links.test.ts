import { describe, expect, it } from "vitest";

import { getEvidenceSourceDisplay } from "./evidence-links";

describe("getEvidenceSourceDisplay", () => {
  it("handles broken source URL gracefully", () => {
    const source = getEvidenceSourceDisplay("intercom", "ht@tp://broken-url");

    expect(source.href).toBeNull();
    expect(source.text).toBe("Intercom conversation link unavailable");
  });

  it("returns valid links when URL is well-formed", () => {
    const source = getEvidenceSourceDisplay("upload", "https://example.com/context/123");

    expect(source.href).toBe("https://example.com/context/123");
    expect(source.text).toBe("Open source reference");
  });
});
