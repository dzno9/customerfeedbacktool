"use client";

import { useEffect, useMemo, useState } from "react";

import type { IngestionHealth, ProcessingHealth } from "@/lib/health/reliability-health";

type HealthPayload = {
  ingestion: IngestionHealth | null;
  processing: ProcessingHealth | null;
};

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "N/A";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "N/A";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(parsed);
}

function statusPill(status: "healthy" | "warning" | "critical") {
  if (status === "healthy") {
    return "bg-emerald-100 text-emerald-800";
  }

  if (status === "critical") {
    return "bg-rose-100 text-rose-800";
  }

  return "bg-amber-100 text-amber-800";
}

export function ReliabilityHealthPanel() {
  const [data, setData] = useState<HealthPayload>({
    ingestion: null,
    processing: null
  });
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadHealth() {
      try {
        const [ingestionResponse, processingResponse] = await Promise.all([
          fetch("/api/health/ingestion", { cache: "no-store" }),
          fetch("/api/health/processing", { cache: "no-store" })
        ]);

        if (!ingestionResponse.ok || !processingResponse.ok) {
          throw new Error("Failed to load health data.");
        }

        const [ingestion, processing] = (await Promise.all([
          ingestionResponse.json(),
          processingResponse.json()
        ])) as [IngestionHealth, ProcessingHealth];

        if (mounted) {
          setData({
            ingestion,
            processing
          });
          setLoadError(null);
        }
      } catch {
        if (mounted) {
          setLoadError("Unable to load reliability panel.");
        }
      }
    }

    void loadHealth();

    return () => {
      mounted = false;
    };
  }, []);

  const overallStatus = useMemo(() => {
    if (data.ingestion?.status === "critical" || data.processing?.status === "critical") {
      return "critical";
    }
    if (data.ingestion?.status === "warning" || data.processing?.status === "warning") {
      return "warning";
    }
    return "healthy";
  }, [data.ingestion?.status, data.processing?.status]);

  return (
    <section className="mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          Reliability / Health
        </h2>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase ${statusPill(overallStatus)}`}>
          {overallStatus}
        </span>
      </div>

      {loadError ? <p className="mt-3 text-sm text-rose-700">{loadError}</p> : null}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <article className="rounded-lg border border-slate-200 p-4 text-sm text-slate-700">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-800">Ingestion</h3>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${
                data.ingestion ? statusPill(data.ingestion.status) : "bg-slate-100 text-slate-700"
              }`}
            >
              {data.ingestion?.status ?? "loading"}
            </span>
          </div>
          {data.ingestion ? (
            <div className="mt-2 space-y-1">
              <p>Connection: {data.ingestion.metrics.connectionStatus}</p>
              <p>Last sync: {formatTimestamp(data.ingestion.metrics.lastSyncAt)}</p>
              <p>Running jobs: {data.ingestion.metrics.runningJobs}</p>
              <p>Failed runs (24h): {data.ingestion.metrics.failedRunsLast24Hours}</p>
              <p>Backlog items: {data.ingestion.metrics.backlogItems}</p>
              {data.ingestion.warnings.length > 0 ? (
                <ul className="mt-2 list-disc pl-5 text-amber-800">
                  {data.ingestion.warnings.map((warning) => (
                    <li key={warning.code}>{warning.message}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </article>

        <article className="rounded-lg border border-slate-200 p-4 text-sm text-slate-700">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-800">Processing</h3>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${
                data.processing ? statusPill(data.processing.status) : "bg-slate-100 text-slate-700"
              }`}
            >
              {data.processing?.status ?? "loading"}
            </span>
          </div>
          {data.processing ? (
            <div className="mt-2 space-y-1">
              <p>Summary backlog: {data.processing.metrics.summaryBacklog}</p>
              <p>Signal backlog: {data.processing.metrics.signalBacklog}</p>
              <p>Summary failures: {data.processing.metrics.summaryFailures}</p>
              <p>Signal failures: {data.processing.metrics.signalFailures}</p>
              <p>Upload failed rows (24h): {data.processing.metrics.uploadFailedRowsLast24Hours}</p>
              <p>Last upload: {formatTimestamp(data.processing.metrics.lastUploadAt)}</p>
              {data.processing.warnings.length > 0 ? (
                <ul className="mt-2 list-disc pl-5 text-amber-800">
                  {data.processing.warnings.map((warning) => (
                    <li key={warning.code}>{warning.message}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </article>
      </div>
    </section>
  );
}
