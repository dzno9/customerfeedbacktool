import { Worker } from "bullmq";
import IORedis from "ioredis";

import { db } from "../lib/db";
import {
  ensureIntercomIncrementalSyncSchedule,
  INTERCOM_INCREMENTAL_SYNC_JOB_NAME
} from "../lib/queue";
import { enqueueFeedbackSignalsJob } from "../lib/feedback/signal-queue";
import { enqueueFeedbackSummaryJob } from "../lib/feedback/summary-queue";
import { runIntercomIncrementalSync } from "../lib/integrations/intercom-sync";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: null
}) as any;

async function start() {
  await ensureIntercomIncrementalSyncSchedule();

  const worker = new Worker(
    "intercom-sync",
    async (job) => {
      if (job.name !== INTERCOM_INCREMENTAL_SYNC_JOB_NAME) {
        return;
      }

      const result = await runIntercomIncrementalSync({
        db,
        enqueueFeedbackSummaryJob,
        enqueueFeedbackSignalsJob
      });
      if (!result.ok) {
        throw new Error(result.error);
      }
    },
    {
      connection
    }
  );

  worker.on("failed", (job, error) => {
    console.error(
      `[intercom-sync] job ${job?.id ?? "unknown"} failed: ${error.message}`
    );
  });

  worker.on("completed", (job) => {
    console.info(`[intercom-sync] job ${job.id} completed`);
  });

  const shutdown = async () => {
    await worker.close();
    await connection.quit();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((error) => {
  console.error("Failed to start intercom sync worker", error);
  process.exit(1);
});
