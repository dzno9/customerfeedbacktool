"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  parseFeedbackFilterState,
  toFeedbackFilterSearchParams,
  type FeedbackFilterState
} from "@/lib/feedback/search-filters";

type QueueOpportunity = {
  id: string;
  title: string;
  description: string | null;
  status: "suggested" | "approved" | "rejected";
  evidenceCount: number;
  lastEvidenceAt: string | null;
  scoreTotal: number;
  updatedAt: string;
};

type OpportunityDetail = {
  id: string;
  title: string;
  description: string | null;
  status: "suggested" | "approved" | "rejected";
  evidenceCount: number;
  lastEvidenceAt: string | null;
  evidence: Array<{
    feedbackItemId: string;
    occurredAt: string;
    source: "intercom" | "upload";
    snippet: string;
    sourceReference: {
      externalId: string | null;
      href: string | null;
      text: string;
    };
  }>;
};

type ReviewActionHistory = {
  id: string;
  opportunityId: string;
  action: "approve" | "reject" | "merge" | "split" | "relabel";
  actorId: string;
  payloadJson: Record<string, unknown> | null;
  createdAt: string;
};

type ActionMode = "approve" | "reject" | "relabel" | "merge" | "split";

function isSameFilterState(left: FeedbackFilterState, right: FeedbackFilterState): boolean {
  return (
    left.search === right.search &&
    left.dateFrom === right.dateFrom &&
    left.dateTo === right.dateTo &&
    left.tag === right.tag &&
    left.sentiment === right.sentiment &&
    left.severity === right.severity &&
    left.segment === right.segment &&
    left.source.length === right.source.length &&
    left.source.every((value, index) => value === right.source[index])
  );
}

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(parsed);
}

async function readJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed.");
  }
  return payload;
}

export function ReviewQueueClient() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialFilters = useMemo(() => parseFeedbackFilterState(searchParams), [searchParams]);
  const [filters, setFilters] = useState<FeedbackFilterState>(initialFilters);

  const [queue, setQueue] = useState<QueueOpportunity[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OpportunityDetail | null>(null);
  const [history, setHistory] = useState<ReviewActionHistory[]>([]);
  const [isLoadingQueue, setIsLoadingQueue] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [actorId, setActorId] = useState("pm");
  const [reason, setReason] = useState("");
  const [actionMode, setActionMode] = useState<ActionMode>("approve");
  const [relabelTitle, setRelabelTitle] = useState("");
  const [relabelDescription, setRelabelDescription] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [splitTitleA, setSplitTitleA] = useState("Split A");
  const [splitTitleB, setSplitTitleB] = useState("Split B");
  const [splitSelection, setSplitSelection] = useState<Record<string, boolean>>({});

  const mergeTargetOptions = useMemo(
    () => queue.filter((item) => item.id !== selectedId),
    [queue, selectedId]
  );

  function resetActionInputs() {
    setReason("");
    setRelabelTitle("");
    setRelabelDescription("");
    setMergeTargetId("");
  }

  async function loadQueue(nextFilters: FeedbackFilterState) {
    setIsLoadingQueue(true);
    try {
      const query = toFeedbackFilterSearchParams(nextFilters).toString();
      const payload = await readJson<{ opportunities: QueueOpportunity[] }>(
        query ? `/api/review/opportunities?${query}` : "/api/review/opportunities",
        {
          cache: "no-store"
        }
      );
      setQueue(payload.opportunities);
      setSelectedId((current) => {
        if (current && payload.opportunities.some((item) => item.id === current)) {
          return current;
        }
        return payload.opportunities[0]?.id ?? null;
      });
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load review queue.");
    } finally {
      setIsLoadingQueue(false);
    }
  }

  async function loadDetailAndHistory(opportunityId: string) {
    setIsLoadingDetail(true);
    try {
      const [detailPayload, historyPayload] = await Promise.all([
        readJson<{ opportunity: OpportunityDetail }>(`/api/opportunities/${opportunityId}`, {
          cache: "no-store"
        }),
        readJson<{ actions: ReviewActionHistory[] }>(
          `/api/review/history?opportunityId=${encodeURIComponent(opportunityId)}`,
          { cache: "no-store" }
        )
      ]);
      setDetail(detailPayload.opportunity);
      setHistory(historyPayload.actions);
      setSplitSelection((current) => {
        const next: Record<string, boolean> = {};
        for (const item of detailPayload.opportunity.evidence) {
          next[item.feedbackItemId] = current[item.feedbackItemId] ?? true;
        }
        return next;
      });
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Failed to load opportunity detail."
      );
    } finally {
      setIsLoadingDetail(false);
    }
  }

  useEffect(() => {
    const next = parseFeedbackFilterState(searchParams);
    setFilters((current) => (isSameFilterState(current, next) ? current : next));
  }, [searchParams]);

  useEffect(() => {
    const query = toFeedbackFilterSearchParams(filters).toString();
    const nextUrl = query ? `${pathname}?${query}` : pathname;
    router.replace(nextUrl, { scroll: false });
    void loadQueue(filters);
  }, [filters, pathname, router]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setHistory([]);
      return;
    }
    void loadDetailAndHistory(selectedId);
  }, [selectedId]);

  async function submitReviewAction(payload: Record<string, unknown>) {
    setIsSubmitting(true);
    try {
      await readJson<{ result: unknown }>("/api/review/actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      await loadQueue(filters);
      if (selectedId) {
        await loadDetailAndHistory(selectedId);
      }
      resetActionInputs();
      setError(null);
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Failed to apply review action."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function onSubmitAction() {
    if (!selectedId) {
      return;
    }

    const normalizedActorId = actorId.trim();
    if (!normalizedActorId) {
      setError("actorId is required.");
      return;
    }

    if (actionMode === "approve" || actionMode === "reject") {
      await submitReviewAction({
        action: actionMode,
        actorId: normalizedActorId,
        opportunityId: selectedId,
        reason
      });
      return;
    }

    if (actionMode === "relabel") {
      if (!relabelTitle.trim()) {
        setError("Relabel title is required.");
        return;
      }
      await submitReviewAction({
        action: "relabel",
        actorId: normalizedActorId,
        opportunityId: selectedId,
        title: relabelTitle.trim(),
        description: relabelDescription.trim() || undefined,
        reason
      });
      return;
    }

    if (actionMode === "merge") {
      if (!mergeTargetId) {
        setError("Merge target is required.");
        return;
      }
      await submitReviewAction({
        action: "merge",
        actorId: normalizedActorId,
        sourceOpportunityId: selectedId,
        targetOpportunityId: mergeTargetId,
        reason
      });
      return;
    }

    if (!detail || detail.evidence.length < 2) {
      setError("Split requires at least two evidence items.");
      return;
    }

    const splitAIds = detail.evidence
      .filter((item) => splitSelection[item.feedbackItemId] ?? true)
      .map((item) => item.feedbackItemId);
    const splitBIds = detail.evidence
      .filter((item) => !(splitSelection[item.feedbackItemId] ?? true))
      .map((item) => item.feedbackItemId);

    if (!splitTitleA.trim() || !splitTitleB.trim()) {
      setError("Split titles are required.");
      return;
    }

    if (splitAIds.length === 0 || splitBIds.length === 0) {
      setError("Split requires evidence in both groups.");
      return;
    }

    await submitReviewAction({
      action: "split",
      actorId: normalizedActorId,
      opportunityId: selectedId,
      reason,
      splits: [
        {
          title: splitTitleA.trim(),
          evidenceFeedbackItemIds: splitAIds
        },
        {
          title: splitTitleB.trim(),
          evidenceFeedbackItemIds: splitBIds
        }
      ]
    });
  }

  const selectedQueueItem = queue.find((item) => item.id === selectedId) ?? null;

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-slate-900">Review Queue</h1>
          <Link href="/audit-logs" className="text-sm text-sky-700 underline-offset-2 hover:underline">
            Open audit logs
          </Link>
        </div>
        <p className="mt-2 text-sm text-slate-700">
          Review suggested opportunities and apply approve/reject/merge/split/relabel actions.
        </p>
      </div>

      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Search + Filters</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-sm">
            <span className="mb-1 block text-slate-700">Search</span>
            <input
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              placeholder="Search raw text or summary"
              value={filters.search}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  search: event.target.value
                }))
              }
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-slate-700">Source</span>
            <select
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              value={filters.source[0] ?? ""}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  source: event.target.value ? [event.target.value] : []
                }))
              }
            >
              <option value="">All sources</option>
              <option value="intercom">intercom</option>
              <option value="upload">upload</option>
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-slate-700">Date from</span>
            <input
              type="date"
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              value={filters.dateFrom}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  dateFrom: event.target.value
                }))
              }
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-slate-700">Date to</span>
            <input
              type="date"
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              value={filters.dateTo}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  dateTo: event.target.value
                }))
              }
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-slate-700">Tag</span>
            <input
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              value={filters.tag}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  tag: event.target.value
                }))
              }
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-slate-700">Sentiment</span>
            <select
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              value={filters.sentiment}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  sentiment: event.target.value
                }))
              }
            >
              <option value="">All sentiments</option>
              <option value="positive">positive</option>
              <option value="neutral">neutral</option>
              <option value="negative">negative</option>
              <option value="unclassified">unclassified</option>
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-slate-700">Severity</span>
            <select
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              value={filters.severity}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  severity: event.target.value
                }))
              }
            >
              <option value="">All severities</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="critical">critical</option>
              <option value="unclassified">unclassified</option>
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-slate-700">Segment</span>
            <input
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              placeholder="Account segment or account id"
              value={filters.segment}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  segment: event.target.value
                }))
              }
            />
          </label>
        </div>
      </section>

      {error ? (
        <p className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Queue</h2>
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
              onClick={() => {
                void loadQueue(filters);
              }}
              disabled={isLoadingQueue}
            >
              Refresh
            </button>
          </div>

          {isLoadingQueue ? <p className="text-sm text-slate-600">Loading queue...</p> : null}

          {!isLoadingQueue && queue.length === 0 ? (
            <p className="text-sm text-slate-600">No suggested opportunities in queue.</p>
          ) : null}

          <ul className="space-y-2">
            {queue.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`w-full rounded-md border p-3 text-left ${
                    item.id === selectedId
                      ? "border-sky-300 bg-sky-50"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                  onClick={() => {
                    setSelectedId(item.id);
                    setActionMode("approve");
                    resetActionInputs();
                  }}
                >
                  <p className="text-sm font-medium text-slate-900">{item.title}</p>
                  <p className="mt-1 text-xs text-slate-600">
                    Score: {item.scoreTotal.toFixed(3)} | Evidence: {item.evidenceCount}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">Updated: {formatDate(item.updatedAt)}</p>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
              Selected Opportunity
            </h2>

            {!selectedQueueItem ? (
              <p className="mt-3 text-sm text-slate-600">Select an opportunity from the queue.</p>
            ) : (
              <div className="mt-3 space-y-2 text-sm text-slate-800">
                <p>
                  <span className="font-medium">Title:</span> {selectedQueueItem.title}
                </p>
                <p>
                  <span className="font-medium">Status:</span> {selectedQueueItem.status}
                </p>
                <p>
                  <span className="font-medium">Score:</span> {selectedQueueItem.scoreTotal.toFixed(3)}
                </p>
                <p>
                  <span className="font-medium">Evidence count:</span> {selectedQueueItem.evidenceCount}
                </p>
                <p>
                  <span className="font-medium">Last evidence:</span>{" "}
                  {formatDate(selectedQueueItem.lastEvidenceAt)}
                </p>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
              Action Controls
            </h2>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-slate-700">Actor ID</span>
                <input
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  value={actorId}
                  onChange={(event) => setActorId(event.target.value)}
                />
              </label>

              <label className="text-sm">
                <span className="mb-1 block text-slate-700">Action</span>
                <select
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  value={actionMode}
                  onChange={(event) => setActionMode(event.target.value as ActionMode)}
                >
                  <option value="approve">approve</option>
                  <option value="reject">reject</option>
                  <option value="relabel">relabel</option>
                  <option value="merge">merge</option>
                  <option value="split">split</option>
                </select>
              </label>
            </div>

            <label className="mt-3 block text-sm">
              <span className="mb-1 block text-slate-700">Reason (optional)</span>
              <input
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>

            {actionMode === "relabel" ? (
              <div className="mt-3 grid gap-3">
                <label className="text-sm">
                  <span className="mb-1 block text-slate-700">New title</span>
                  <input
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    value={relabelTitle}
                    onChange={(event) => setRelabelTitle(event.target.value)}
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-slate-700">New description (optional)</span>
                  <textarea
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    rows={3}
                    value={relabelDescription}
                    onChange={(event) => setRelabelDescription(event.target.value)}
                  />
                </label>
              </div>
            ) : null}

            {actionMode === "merge" ? (
              <div className="mt-3">
                <label className="text-sm">
                  <span className="mb-1 block text-slate-700">Target opportunity</span>
                  <select
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    value={mergeTargetId}
                    onChange={(event) => setMergeTargetId(event.target.value)}
                  >
                    <option value="">Select target</option>
                    {mergeTargetOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.title} ({option.id})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}

            {actionMode === "split" ? (
              <div className="mt-3 space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm">
                    <span className="mb-1 block text-slate-700">Split A title</span>
                    <input
                      className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                      value={splitTitleA}
                      onChange={(event) => setSplitTitleA(event.target.value)}
                    />
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-slate-700">Split B title</span>
                    <input
                      className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                      value={splitTitleB}
                      onChange={(event) => setSplitTitleB(event.target.value)}
                    />
                  </label>
                </div>
                <div className="rounded border border-slate-200 p-3">
                  <p className="mb-2 text-xs text-slate-600">
                    Assign evidence to Split A using checkboxes. Unchecked items go to Split B.
                  </p>
                  {!detail || detail.evidence.length === 0 ? (
                    <p className="text-sm text-slate-600">No evidence available for split.</p>
                  ) : (
                    <ul className="space-y-2">
                      {detail.evidence.map((item) => (
                        <li key={item.feedbackItemId} className="rounded border border-slate-200 p-2">
                          <label className="flex items-start gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={splitSelection[item.feedbackItemId] ?? true}
                              onChange={(event) =>
                                setSplitSelection((current) => ({
                                  ...current,
                                  [item.feedbackItemId]: event.target.checked
                                }))
                              }
                            />
                            <span>
                              <span className="block font-medium text-slate-800">
                                {item.feedbackItemId}
                              </span>
                              <span className="text-slate-600">{item.snippet}</span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : null}

            <div className="mt-4">
              <button
                type="button"
                onClick={() => {
                  void onSubmitAction();
                }}
                disabled={!selectedId || isSubmitting || isLoadingDetail}
                className="rounded bg-sky-700 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {isSubmitting ? "Applying..." : "Apply action"}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Evidence</h2>

            {isLoadingDetail ? <p className="mt-3 text-sm text-slate-600">Loading detail...</p> : null}
            {!isLoadingDetail && detail?.evidence.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">No evidence snippets linked yet.</p>
            ) : null}

            <ul className="mt-3 space-y-2">
              {detail?.evidence.map((item) => (
                <li key={item.feedbackItemId} className="rounded border border-slate-200 p-3">
                  <p className="text-sm text-slate-800">{item.snippet}</p>
                  <p className="mt-1 text-xs text-slate-600">
                    {item.feedbackItemId} | {item.source} | {formatDate(item.occurredAt)}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
              Action History
            </h2>

            {history.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">No actions logged yet for this opportunity.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {history.map((item) => (
                  <li key={item.id} className="rounded border border-slate-200 p-3 text-sm">
                    <p className="font-medium text-slate-800">
                      {item.action} by {item.actorId}
                    </p>
                    <p className="text-xs text-slate-600">{formatDate(item.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
