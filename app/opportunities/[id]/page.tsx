import Link from "next/link";
import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { getOpportunityDetail } from "@/lib/opportunities/opportunity-detail";
import { recomputeOpportunityScores } from "@/lib/opportunities/scoring";

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

export default async function OpportunityDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  await recomputeOpportunityScores(db);
  const detail = await getOpportunityDetail(params.id, db);

  if (!detail) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{detail.title}</h1>
          <p className="mt-1 text-sm text-slate-600">Status: {detail.status}</p>
        </div>
        <Link href="/" className="text-sm text-slate-700 underline">
          Back to home
        </Link>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Opportunity</h2>
        <p className="mt-3 text-sm text-slate-800">{detail.description ?? "No description provided."}</p>
        <div className="mt-4 grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
          <p>Evidence count: {detail.evidenceCount}</p>
          <p>Last evidence: {formatDate(detail.lastEvidenceAt)}</p>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Evidence snippets</h2>

        {detail.evidence.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">No evidence snippets linked yet.</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {detail.evidence.map((item) => (
              <li key={item.feedbackItemId} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm text-slate-800">{item.snippet}</p>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-600">
                  <span>Item ID: {item.feedbackItemId}</span>
                  <span>Occurred: {formatDate(item.occurredAt)}</span>
                  <span>Source: {item.source}</span>
                  {item.sourceReference.externalId ? <span>External ID: {item.sourceReference.externalId}</span> : null}
                </div>
                <div className="mt-3 text-xs">
                  {item.sourceReference.href ? (
                    <a
                      href={item.sourceReference.href}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sky-700 underline"
                    >
                      {item.sourceReference.text}
                    </a>
                  ) : (
                    <span className="text-slate-500">{item.sourceReference.text}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
