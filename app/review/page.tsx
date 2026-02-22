import { Suspense } from "react";

import { ReviewQueueClient } from "@/app/components/review-queue-client";

export default function ReviewQueuePage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-7xl px-6 py-10 text-sm text-slate-600">Loading review queue...</main>}>
      <ReviewQueueClient />
    </Suspense>
  );
}
