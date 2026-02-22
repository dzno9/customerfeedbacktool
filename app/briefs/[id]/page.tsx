import Link from "next/link";
import { notFound } from "next/navigation";

import { getWeeklyBriefById } from "@/lib/briefs/weekly-brief";
import { db } from "@/lib/db";

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

export default async function WeeklyBriefPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const brief = await getWeeklyBriefById(db, params.id);

  if (!brief) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Weekly Brief Snapshot</h1>
          <p className="mt-1 text-sm text-slate-700">Brief ID: {brief.id}</p>
          <p className="mt-1 text-sm text-slate-700">
            Range: {formatDateTime(brief.startDate)} - {formatDateTime(brief.endDate)}
          </p>
          <p className="mt-1 text-sm text-slate-700">Generated: {formatDateTime(brief.generatedAt)}</p>
        </div>
        <Link href="/briefs" className="text-sm text-sky-700 underline">
          Back to generator
        </Link>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Summary</h2>
        <div className="mt-3 grid gap-2 text-sm text-slate-800 sm:grid-cols-2">
          <p>Approved opportunities: {brief.snapshot.summary.opportunityCount}</p>
          <p>Evidence in range: {brief.snapshot.summary.totalRangeEvidenceCount}</p>
          <p>Evidence in previous range: {brief.snapshot.summary.totalPreviousRangeEvidenceCount}</p>
          <p>
            Trend: {brief.snapshot.summary.trend} ({brief.snapshot.summary.trendDelta >= 0 ? "+" : ""}
            {brief.snapshot.summary.trendDelta})
          </p>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          Ranked Approved Opportunities
        </h2>

        {brief.snapshot.opportunities.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">No approved opportunities in this snapshot.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {brief.snapshot.opportunities.map((item) => (
              <li key={item.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-900">
                    {item.title} <span className="text-slate-500">({item.id})</span>
                  </p>
                  <p className="text-xs text-slate-600">Score: {item.scoreTotal.toFixed(3)}</p>
                </div>
                <div className="mt-2 grid gap-2 text-xs text-slate-700 sm:grid-cols-2">
                  <p>Total evidence: {item.evidenceCount}</p>
                  <p>Evidence in range: {item.rangeEvidenceCount}</p>
                  <p>Previous range evidence: {item.previousRangeEvidenceCount}</p>
                  <p>
                    Trend: {item.trend} ({item.trendDelta >= 0 ? "+" : ""}
                    {item.trendDelta})
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
