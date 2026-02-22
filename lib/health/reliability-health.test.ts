import { describe, expect, it } from "vitest";

import {
  evaluateIngestionHealth,
  evaluateProcessingHealth,
  type IngestionHealthMetrics,
  type ProcessingHealthMetrics
} from "./reliability-health";

const NOW = new Date("2026-02-21T12:00:00.000Z");

function buildIngestionMetrics(
  overrides: Partial<IngestionHealthMetrics> = {}
): IngestionHealthMetrics {
  return {
    intercomConnected: true,
    connectionStatus: "connected",
    lastSyncAt: "2026-02-21T11:55:00.000Z",
    lastRunStartedAt: "2026-02-21T11:55:00.000Z",
    lastRunCompletedAt: "2026-02-21T11:56:00.000Z",
    runningJobs: 0,
    failedRunsLast24Hours: 0,
    recordsProcessedLast24Hours: 100,
    backlogItems: 0,
    ...overrides
  };
}

function buildProcessingMetrics(
  overrides: Partial<ProcessingHealthMetrics> = {}
): ProcessingHealthMetrics {
  return {
    summaryBacklog: 0,
    signalBacklog: 0,
    summaryFailures: 0,
    signalFailures: 0,
    uploadFailedRowsLast24Hours: 0,
    uploadFailedBatchesLast24Hours: 0,
    lastUploadAt: "2026-02-21T11:45:00.000Z",
    ...overrides
  };
}

describe("reliability health", () => {
  it("simulated job failures increase failure counters", () => {
    const ingestion = evaluateIngestionHealth(
      buildIngestionMetrics({
        failedRunsLast24Hours: 3
      }),
      NOW
    );
    const processing = evaluateProcessingHealth(
      buildProcessingMetrics({
        summaryFailures: 4,
        signalFailures: 8
      }),
      NOW
    );

    expect(ingestion.metrics.failedRunsLast24Hours).toBe(3);
    expect(ingestion.warnings.some((warning) => warning.code === "sync_failures")).toBe(true);
    expect(processing.metrics.summaryFailures).toBe(4);
    expect(processing.metrics.signalFailures).toBe(8);
    expect(processing.status).toBe("critical");
    expect(processing.warnings.some((warning) => warning.code === "pipeline_failures")).toBe(true);
  });

  it("backlog growth is reflected in health payloads", () => {
    const ingestion = evaluateIngestionHealth(
      buildIngestionMetrics({
        backlogItems: 30
      }),
      NOW
    );
    const processing = evaluateProcessingHealth(
      buildProcessingMetrics({
        summaryBacklog: 65,
        signalBacklog: 62
      }),
      NOW
    );

    expect(ingestion.metrics.backlogItems).toBe(30);
    expect(ingestion.warnings.some((warning) => warning.code === "ingestion_backlog")).toBe(true);
    expect(ingestion.status).toBe("warning");
    expect(processing.metrics.summaryBacklog).toBe(65);
    expect(processing.metrics.signalBacklog).toBe(62);
    expect(processing.warnings.some((warning) => warning.code === "summary_backlog")).toBe(true);
    expect(processing.warnings.some((warning) => warning.code === "signal_backlog")).toBe(true);
  });

  it("healthy state appears after successful recovery runs", () => {
    const ingestion = evaluateIngestionHealth(
      buildIngestionMetrics({
        failedRunsLast24Hours: 0,
        backlogItems: 0,
        lastSyncAt: "2026-02-21T11:58:00.000Z"
      }),
      NOW
    );
    const processing = evaluateProcessingHealth(
      buildProcessingMetrics({
        summaryBacklog: 0,
        signalBacklog: 0,
        summaryFailures: 0,
        signalFailures: 0,
        uploadFailedRowsLast24Hours: 0
      }),
      NOW
    );

    expect(ingestion.status).toBe("healthy");
    expect(ingestion.warnings).toHaveLength(0);
    expect(processing.status).toBe("healthy");
    expect(processing.warnings).toHaveLength(0);
  });
});
