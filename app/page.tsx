import Link from "next/link";

import { IntercomStatusBadge } from "@/app/components/intercom-status-badge";
import { ReliabilityHealthPanel } from "@/app/components/reliability-health-panel";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold">Customer Feedback Consolidation MVP</h1>
      <p className="mt-4 text-slate-700">US-014 reliability/health panel is now available.</p>

      <div className="mt-5 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">
        <p>Open an opportunity detail page:</p>
        <Link href="/opportunities/replace-with-opportunity-id" className="mt-2 inline-block text-sky-700 underline">
          /opportunities/&lt;id&gt;
        </Link>
        <p className="mt-3">Open review queue:</p>
        <Link href="/review" className="mt-2 inline-block text-sky-700 underline">
          /review
        </Link>
        <p className="mt-3">Generate weekly brief:</p>
        <Link href="/briefs" className="mt-2 inline-block text-sky-700 underline">
          /briefs
        </Link>
      </div>

      <IntercomStatusBadge />
      <ReliabilityHealthPanel />
    </main>
  );
}
