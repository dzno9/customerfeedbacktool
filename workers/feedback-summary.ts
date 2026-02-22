import { Worker } from "bullmq";
import IORedis from "ioredis";

import { db } from "../lib/db";
import {
  DEFAULT_SUMMARY_JOB_ATTEMPTS,
  processFeedbackSummaryJob,
  SUMMARIZE_FEEDBACK_ITEM_JOB_NAME
} from "../lib/feedback/summarize-feedback-item";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: null
}) as any;

async function start() {
  const worker = new Worker(
    "feedback-summary",
    async (job) => {
      if (job.name !== SUMMARIZE_FEEDBACK_ITEM_JOB_NAME) {
        return;
      }

      const feedbackItemId =
        typeof job.data?.feedbackItemId === "string" ? job.data.feedbackItemId : undefined;

      if (!feedbackItemId) {
        throw new Error("Missing feedbackItemId for summary job.");
      }

      const result = await processFeedbackSummaryJob(
        {
          feedbackItemId,
          attemptsMade: job.attemptsMade,
          maxAttempts: job.opts.attempts ?? DEFAULT_SUMMARY_JOB_ATTEMPTS
        },
        { db }
      );

      if (result.terminalFailure) {
        console.error(
          `[feedback-summary] terminal failure for feedback item ${feedbackItemId} after ${job.attemptsMade + 1} attempts`
        );
      }
    },
    {
      connection
    }
  );

  worker.on("failed", (job, error) => {
    console.error(
      `[feedback-summary] job ${job?.id ?? "unknown"} failed: ${error.message}`
    );
  });

  worker.on("completed", (job) => {
    console.info(`[feedback-summary] job ${job.id} completed`);
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
  console.error("Failed to start feedback summary worker", error);
  process.exit(1);
});
