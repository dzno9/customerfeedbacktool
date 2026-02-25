import { getSignalsQueue } from "../queue";
import {
  CLUSTER_FEEDBACK_ITEMS_JOB_NAME,
  DEFAULT_CLUSTER_JOB_ATTEMPTS
} from "./cluster-feedback-items";

export async function enqueueOpportunityClusterJob(feedbackItemId: string) {
  const safeJobId = `${CLUSTER_FEEDBACK_ITEMS_JOB_NAME}__${feedbackItemId}`;

  await getSignalsQueue().add(
    CLUSTER_FEEDBACK_ITEMS_JOB_NAME,
    {
      feedbackItemId
    },
    {
      attempts: DEFAULT_CLUSTER_JOB_ATTEMPTS,
      backoff: {
        type: "exponential",
        delay: 30_000
      },
      removeOnComplete: 100,
      removeOnFail: 100,
      jobId: safeJobId
    }
  );
}
