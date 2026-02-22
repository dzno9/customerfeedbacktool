type HealthStatus = "healthy" | "warning" | "critical";

type WarningFlag = {
  code: string;
  message: string;
};

type IngestionThresholds = {
  maxMinutesSinceLastSync: number;
  maxFailedRunsLast24Hours: number;
  maxBacklogItems: number;
};

type ProcessingThresholds = {
  maxSummaryBacklog: number;
  maxSignalBacklog: number;
  maxFailedItems: number;
  maxUploadFailedRowsLast24Hours: number;
};

export type IngestionHealthMetrics = {
  intercomConnected: boolean;
  connectionStatus: string;
  lastSyncAt: string | null;
  lastRunStartedAt: string | null;
  lastRunCompletedAt: string | null;
  runningJobs: number;
  failedRunsLast24Hours: number;
  recordsProcessedLast24Hours: number;
  backlogItems: number;
};

export type ProcessingHealthMetrics = {
  summaryBacklog: number;
  signalBacklog: number;
  summaryFailures: number;
  signalFailures: number;
  uploadFailedRowsLast24Hours: number;
  uploadFailedBatchesLast24Hours: number;
  lastUploadAt: string | null;
};

export type IngestionHealth = {
  area: "ingestion";
  status: HealthStatus;
  checkedAt: string;
  metrics: IngestionHealthMetrics;
  warnings: WarningFlag[];
};

export type ProcessingHealth = {
  area: "processing";
  status: HealthStatus;
  checkedAt: string;
  metrics: ProcessingHealthMetrics;
  warnings: WarningFlag[];
};

export const DEFAULT_INGESTION_THRESHOLDS: IngestionThresholds = {
  maxMinutesSinceLastSync: 60,
  maxFailedRunsLast24Hours: 1,
  maxBacklogItems: 25
};

export const DEFAULT_PROCESSING_THRESHOLDS: ProcessingThresholds = {
  maxSummaryBacklog: 50,
  maxSignalBacklog: 50,
  maxFailedItems: 10,
  maxUploadFailedRowsLast24Hours: 25
};

function minutesSince(timestamp: string, now: Date): number {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.floor((now.getTime() - parsed.getTime()) / 60_000);
}

function deriveStatus(warnings: WarningFlag[], criticalCodes: Set<string>): HealthStatus {
  if (warnings.some((warning) => criticalCodes.has(warning.code))) {
    return "critical";
  }

  return warnings.length > 0 ? "warning" : "healthy";
}

export function evaluateIngestionHealth(
  metrics: IngestionHealthMetrics,
  now: Date,
  thresholds: IngestionThresholds = DEFAULT_INGESTION_THRESHOLDS
): IngestionHealth {
  const warnings: WarningFlag[] = [];
  const criticalCodes = new Set<string>();

  if (!metrics.intercomConnected) {
    warnings.push({
      code: "intercom_disconnected",
      message: "Intercom connection is not healthy."
    });
    criticalCodes.add("intercom_disconnected");
  }

  if (metrics.lastSyncAt) {
    const ageMinutes = minutesSince(metrics.lastSyncAt, now);
    if (ageMinutes > thresholds.maxMinutesSinceLastSync) {
      warnings.push({
        code: "sync_stale",
        message: `Last successful sync is stale (${ageMinutes} minutes ago).`
      });
    }
  } else if (metrics.intercomConnected) {
    warnings.push({
      code: "sync_missing",
      message: "No successful Intercom sync has been recorded."
    });
  }

  if (metrics.failedRunsLast24Hours > thresholds.maxFailedRunsLast24Hours) {
    warnings.push({
      code: "sync_failures",
      message: `Intercom sync failures in the last 24h: ${metrics.failedRunsLast24Hours}.`
    });
  }

  if (metrics.backlogItems > thresholds.maxBacklogItems) {
    warnings.push({
      code: "ingestion_backlog",
      message: `Intercom backlog exceeds threshold (${metrics.backlogItems} items).`
    });
  }

  return {
    area: "ingestion",
    status: deriveStatus(warnings, criticalCodes),
    checkedAt: now.toISOString(),
    metrics,
    warnings
  };
}

export function evaluateProcessingHealth(
  metrics: ProcessingHealthMetrics,
  now: Date,
  thresholds: ProcessingThresholds = DEFAULT_PROCESSING_THRESHOLDS
): ProcessingHealth {
  const warnings: WarningFlag[] = [];
  const criticalCodes = new Set<string>();

  if (metrics.summaryBacklog > thresholds.maxSummaryBacklog) {
    warnings.push({
      code: "summary_backlog",
      message: `Summary backlog exceeds threshold (${metrics.summaryBacklog} items).`
    });
  }

  if (metrics.signalBacklog > thresholds.maxSignalBacklog) {
    warnings.push({
      code: "signal_backlog",
      message: `Signal backlog exceeds threshold (${metrics.signalBacklog} items).`
    });
  }

  const failedItems = metrics.summaryFailures + metrics.signalFailures;
  if (failedItems > thresholds.maxFailedItems) {
    warnings.push({
      code: "pipeline_failures",
      message: `Pipeline failures exceed threshold (${failedItems} items).`
    });
    criticalCodes.add("pipeline_failures");
  }

  if (metrics.uploadFailedRowsLast24Hours > thresholds.maxUploadFailedRowsLast24Hours) {
    warnings.push({
      code: "upload_failures",
      message: `Upload failures in the last 24h exceed threshold (${metrics.uploadFailedRowsLast24Hours} rows).`
    });
  }

  return {
    area: "processing",
    status: deriveStatus(warnings, criticalCodes),
    checkedAt: now.toISOString(),
    metrics,
    warnings
  };
}

export async function getIngestionHealth(
  db: any,
  nowInput?: Date
): Promise<IngestionHealth> {
  const now = nowInput ?? new Date();
  const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [connection, lastRun, runningJobs, failedRunsLast24Hours, processedRuns, backlogItems] =
    await Promise.all([
      db.integrationConnection.findUnique({
        where: {
          provider: "intercom"
        },
        select: {
          status: true,
          lastSyncAt: true
        }
      }),
      db.syncJob.findFirst({
        where: {
          provider: "intercom"
        },
        orderBy: {
          startedAt: "desc"
        },
        select: {
          startedAt: true,
          completedAt: true
        }
      }),
      db.syncJob.count({
        where: {
          provider: "intercom",
          status: "running"
        }
      }),
      db.syncJob.count({
        where: {
          provider: "intercom",
          status: "failed",
          startedAt: {
            gte: last24Hours
          }
        }
      }),
      db.syncJob.findMany({
        where: {
          provider: "intercom",
          startedAt: {
            gte: last24Hours
          }
        },
        select: {
          recordsProcessed: true
        }
      }),
      db.feedbackItem.count({
        where: {
          source: "intercom",
          deletedAt: null,
          OR: [
            {
              summaryStatus: {
                in: ["pending", "processing", "failed"]
              }
            },
            {
              signalStatus: {
                in: ["pending", "processing", "failed"]
              }
            }
          ]
        }
      })
    ]);

  const metrics: IngestionHealthMetrics = {
    intercomConnected: connection?.status === "connected",
    connectionStatus: connection?.status ?? "disconnected",
    lastSyncAt: connection?.lastSyncAt?.toISOString() ?? null,
    lastRunStartedAt: lastRun?.startedAt?.toISOString() ?? null,
    lastRunCompletedAt: lastRun?.completedAt?.toISOString() ?? null,
    runningJobs,
    failedRunsLast24Hours,
    recordsProcessedLast24Hours: processedRuns.reduce(
      (sum: number, run: { recordsProcessed: number }) => sum + (run.recordsProcessed ?? 0),
      0
    ),
    backlogItems
  };

  return evaluateIngestionHealth(metrics, now);
}

export async function getProcessingHealth(
  db: any,
  nowInput?: Date
): Promise<ProcessingHealth> {
  const now = nowInput ?? new Date();
  const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [
    summaryBacklog,
    signalBacklog,
    summaryFailures,
    signalFailures,
    recentUploadBatches,
    lastUpload
  ] = await Promise.all([
    db.feedbackItem.count({
      where: {
        deletedAt: null,
        summaryStatus: {
          in: ["pending", "processing"]
        }
      }
    }),
    db.feedbackItem.count({
      where: {
        deletedAt: null,
        signalStatus: {
          in: ["pending", "processing"]
        }
      }
    }),
    db.feedbackItem.count({
      where: {
        deletedAt: null,
        summaryStatus: "failed"
      }
    }),
    db.feedbackItem.count({
      where: {
        deletedAt: null,
        signalStatus: "failed"
      }
    }),
    db.uploadBatch.findMany({
      where: {
        createdAt: {
          gte: last24Hours
        }
      },
      select: {
        status: true,
        failedRows: true
      }
    }),
    db.uploadBatch.findFirst({
      orderBy: {
        createdAt: "desc"
      },
      select: {
        createdAt: true
      }
    })
  ]);

  const uploadFailedRowsLast24Hours = recentUploadBatches.reduce(
    (sum: number, batch: { failedRows: number }) => sum + (batch.failedRows ?? 0),
    0
  );
  const uploadFailedBatchesLast24Hours = recentUploadBatches.filter((batch: { status: string }) =>
    batch.status === "failed" || batch.status === "partial_failed"
  ).length;

  const metrics: ProcessingHealthMetrics = {
    summaryBacklog,
    signalBacklog,
    summaryFailures,
    signalFailures,
    uploadFailedRowsLast24Hours,
    uploadFailedBatchesLast24Hours,
    lastUploadAt: lastUpload?.createdAt?.toISOString() ?? null
  };

  return evaluateProcessingHealth(metrics, now);
}
