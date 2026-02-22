import { Queue } from "bullmq";
import IORedis from "ioredis";

let connection: any = null;
let ingestionQueue: Queue | null = null;
let summaryQueue: Queue | null = null;
let signalsQueue: Queue | null = null;
let intercomSyncQueue: Queue | null = null;

function getConnection(): any {
  if (!connection) {
    connection = new IORedis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
      maxRetriesPerRequest: null
    }) as any;
  }
  return connection;
}

export function getIngestionQueue(): Queue {
  if (!ingestionQueue) {
    ingestionQueue = new Queue("feedback-ingestion", { connection: getConnection() });
  }
  return ingestionQueue;
}

export function getSummaryQueue(): Queue {
  if (!summaryQueue) {
    summaryQueue = new Queue("feedback-summary", { connection: getConnection() });
  }
  return summaryQueue;
}

export function getSignalsQueue(): Queue {
  if (!signalsQueue) {
    signalsQueue = new Queue("feedback-signals", { connection: getConnection() });
  }
  return signalsQueue;
}

export function getIntercomSyncQueue(): Queue {
  if (!intercomSyncQueue) {
    intercomSyncQueue = new Queue("intercom-sync", { connection: getConnection() });
  }
  return intercomSyncQueue;
}

export const INTERCOM_INCREMENTAL_SYNC_JOB_NAME = "intercom_incremental_sync";

export async function ensureIntercomIncrementalSyncSchedule() {
  await getIntercomSyncQueue().add(
    INTERCOM_INCREMENTAL_SYNC_JOB_NAME,
    {},
    {
      jobId: INTERCOM_INCREMENTAL_SYNC_JOB_NAME,
      repeat: {
        every: 15 * 60 * 1000
      },
      removeOnComplete: 100,
      removeOnFail: 100
    }
  );
}
