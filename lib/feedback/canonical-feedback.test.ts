import { describe, expect, it } from "vitest";

import { toCanonicalFeedbackItem } from "./canonical-feedback";

describe("toCanonicalFeedbackItem", () => {
  it("maps an Intercom item with full fields", () => {
    const occurredAt = "2026-02-15T10:00:00.000Z";

    const canonical = toCanonicalFeedbackItem("intercom", {
      id: "conv_123",
      createdAt: occurredAt,
      body: "Feature X is hard to discover",
      summary: "Navigation pain",
      customer: {
        name: "Taylor",
        email: "taylor@example.com"
      },
      company: {
        id: "acct_42"
      },
      sentiment: "negative",
      severity: "high",
      permalink: "https://intercom.example/conv_123",
      metadata: {
        conversationTag: "navigation",
        adminId: "admin_1"
      }
    });

    expect(canonical).toMatchObject({
      source: "intercom",
      externalId: "conv_123",
      rawText: "Feature X is hard to discover",
      summary: "Navigation pain",
      customerName: "Taylor",
      customerEmail: "taylor@example.com",
      accountId: "acct_42",
      sentiment: "negative",
      severity: "high",
      sourceUrl: "https://intercom.example/conv_123"
    });

    expect(canonical.occurredAt.toISOString()).toBe(occurredAt);
    expect(canonical.metadataJson).toMatchObject({
      sourceMetadata: {
        conversationTag: "navigation",
        adminId: "admin_1"
      }
    });
  });

  it("ingests upload item when optional customer/account fields are missing", () => {
    const canonical = toCanonicalFeedbackItem("upload", {
      external_id: "row-12",
      occurred_at: "2026-02-16T08:00:00.000Z",
      feedback: "Bulk upload: users want SSO support",
      summary: "SSO request",
      severity: "medium"
    });

    expect(canonical).toMatchObject({
      source: "upload",
      externalId: "row-12",
      rawText: "Bulk upload: users want SSO support",
      summary: "SSO request",
      severity: "medium"
    });
    expect(canonical.customerName).toBeUndefined();
    expect(canonical.customerEmail).toBeUndefined();
    expect(canonical.accountId).toBeUndefined();
  });

  it("retains unknown fields in metadata", () => {
    const canonical = toCanonicalFeedbackItem("upload", {
      external_id: "row-99",
      occurred_at: "2026-02-16T09:00:00.000Z",
      message: "Need better analytics exports",
      upload_file_name: "feedback.csv",
      csv_row_number: 99,
      custom_field_a: "alpha"
    });

    expect(canonical.metadataJson).toMatchObject({
      extraFields: {
        upload_file_name: "feedback.csv",
        csv_row_number: 99,
        custom_field_a: "alpha"
      }
    });
  });

  it("rejects payloads missing occurredAt", () => {
    expect(() =>
      toCanonicalFeedbackItem("upload", {
        external_id: "row-100",
        message: "Need better export tooling"
      })
    ).toThrow("missing or invalid occurredAt");
  });
});
