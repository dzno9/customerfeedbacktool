import { getSignalsQueue } from "../queue";
import {
  DEFAULT_SIGNAL_JOB_ATTEMPTS,
  EXTRACT_FEEDBACK_SIGNALS_JOB_NAME
} from "./extract-feedback-signals";

export async function enqueueFeedbackSignalsJob(feedbackItemId: string) {
  await getSignalsQueue().add(
    EXTRACT_FEEDBACK_SIGNALS_JOB_NAME,
    {
      feedbackItemId
    },
    {
      attempts: DEFAULT_SIGNAL_JOB_ATTEMPTS,
      backoff: {
        type: "exponential",
        delay: 30_000
      },
      removeOnComplete: 100,
      removeOnFail: 100,
      jobId: `${EXTRACT_FEEDBACK_SIGNALS_JOB_NAME}:${feedbackItemId}`
    }
  );
}
