import { getSummaryQueue } from "../queue";
import {
  DEFAULT_SUMMARY_JOB_ATTEMPTS,
  SUMMARIZE_FEEDBACK_ITEM_JOB_NAME
} from "./summarize-feedback-item";

export async function enqueueFeedbackSummaryJob(feedbackItemId: string) {
  const safeJobId = `${SUMMARIZE_FEEDBACK_ITEM_JOB_NAME}__${feedbackItemId}`;

  await getSummaryQueue().add(
    SUMMARIZE_FEEDBACK_ITEM_JOB_NAME,
    {
      feedbackItemId
    },
    {
      attempts: DEFAULT_SUMMARY_JOB_ATTEMPTS,
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
