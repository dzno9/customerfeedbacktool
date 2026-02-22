import { Worker } from "bullmq";
import IORedis from "ioredis";

import { db } from "../lib/db";
import {
  CLUSTER_FEEDBACK_ITEMS_JOB_NAME,
  DEFAULT_CLUSTER_JOB_ATTEMPTS,
  processClusterFeedbackItemsJob
} from "../lib/feedback/cluster-feedback-items";
import {
  DEFAULT_SIGNAL_JOB_ATTEMPTS,
  EXTRACT_FEEDBACK_SIGNALS_JOB_NAME,
  processFeedbackSignalsJob
} from "../lib/feedback/extract-feedback-signals";
import { enqueueOpportunityClusterJob } from "../lib/feedback/opportunity-cluster-queue";
import { recomputeOpportunityScores } from "../lib/opportunities/scoring";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: null
}) as any;

async function start() {
  const worker = new Worker(
    "feedback-signals",
    async (job) => {
      const feedbackItemId =
        typeof job.data?.feedbackItemId === "string" ? job.data.feedbackItemId : undefined;

      if (!feedbackItemId) {
        throw new Error("Missing feedbackItemId for feedback processing job.");
      }

      if (job.name === EXTRACT_FEEDBACK_SIGNALS_JOB_NAME) {
        const result = await processFeedbackSignalsJob(
          {
            feedbackItemId,
            attemptsMade: job.attemptsMade,
            maxAttempts: job.opts.attempts ?? DEFAULT_SIGNAL_JOB_ATTEMPTS
          },
          { db }
        );

        if (result.shouldCluster) {
          await enqueueOpportunityClusterJob(feedbackItemId);
        }

        if (result.terminalFailure) {
          console.error(
            `[feedback-signals] terminal failure for feedback item ${feedbackItemId} after ${job.attemptsMade + 1} attempts`
          );
        }
        return;
      }

      if (job.name === CLUSTER_FEEDBACK_ITEMS_JOB_NAME) {
        const result = await processClusterFeedbackItemsJob(
          {
            feedbackItemId,
            attemptsMade: job.attemptsMade,
            maxAttempts: job.opts.attempts ?? DEFAULT_CLUSTER_JOB_ATTEMPTS
          },
          {
            db,
            recomputeScores: async () => {
              await recomputeOpportunityScores(db);
            }
          }
        );

        if (result.terminalFailure) {
          console.error(
            `[feedback-clustering] terminal failure for feedback item ${feedbackItemId} after ${job.attemptsMade + 1} attempts`
          );
        }
        return;
      }
    },
    {
      connection
    }
  );

  worker.on("failed", (job, error) => {
    console.error(`[feedback-signals] job ${job?.id ?? "unknown"} failed: ${error.message}`);
  });

  worker.on("completed", (job) => {
    console.info(`[feedback-signals] job ${job.id} completed`);
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
  console.error("Failed to start feedback signal worker", error);
  process.exit(1);
});
