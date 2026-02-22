"use client";

import { useEffect, useMemo, useState } from "react";

type IntercomStatus = {
  provider: "intercom";
  status: "connected" | "disconnected" | "error";
  connected: boolean;
  lastCheckedAt: string | null;
  error: string | null;
};

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "Never checked";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

export function IntercomStatusBadge() {
  const [status, setStatus] = useState<IntercomStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadStatus() {
      try {
        const response = await fetch("/api/integrations/intercom/status", {
          method: "GET",
          cache: "no-store"
        });

        if (!response.ok) {
          throw new Error("Failed to fetch Intercom status");
        }

        const payload = (await response.json()) as IntercomStatus;
        if (isMounted) {
          setStatus(payload);
          setLoadError(null);
        }
      } catch {
        if (isMounted) {
          setLoadError("Unable to load integration status.");
        }
      }
    }

    void loadStatus();

    return () => {
      isMounted = false;
    };
  }, []);

  const badgeClassName = useMemo(() => {
    if (!status) {
      return "bg-slate-100 text-slate-700";
    }

    if (status.status === "connected") {
      return "bg-emerald-100 text-emerald-800";
    }

    if (status.status === "error") {
      return "bg-rose-100 text-rose-800";
    }

    return "bg-amber-100 text-amber-800";
  }, [status]);

  const badgeText = status ? status.status : "loading";

  return (
    <section className="mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Intercom</h2>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase ${badgeClassName}`}>
          {badgeText}
        </span>
      </div>

      {loadError ? <p className="mt-3 text-sm text-rose-700">{loadError}</p> : null}

      {status ? (
        <div className="mt-3 space-y-1 text-sm text-slate-700">
          <p>Last checked: {formatTimestamp(status.lastCheckedAt)}</p>
          {status.error ? <p className="text-rose-700">{status.error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
