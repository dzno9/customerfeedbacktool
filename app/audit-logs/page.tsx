import Link from "next/link";

import { db } from "@/lib/db";

function asText(value: string | string[] | undefined): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return (value[0] ?? "").trim();
  }

  return "";
}

function parseDate(value: string): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

export default async function AuditLogsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = await searchParams;
  const entityType = asText(resolved.entityType);
  const entityId = asText(resolved.entityId);
  const actorId = asText(resolved.actorId);
  const dateFromRaw = asText(resolved.dateFrom);
  const dateToRaw = asText(resolved.dateTo);
  const dateFrom = parseDate(dateFromRaw);
  const dateTo = parseDate(dateToRaw);

  const logs = await db.auditLog.findMany({
    where: {
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
      ...(actorId ? { actorId } : {}),
      ...(dateFrom || dateTo
        ? {
            createdAt: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {})
            }
          }
        : {})
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 200
  });

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Audit Logs</h1>
          <p className="mt-2 text-sm text-slate-700">Query audit events by entity, actor, and date range.</p>
        </div>
        <Link href="/review" className="text-sm text-sky-700 underline-offset-2 hover:underline">
          Back to review queue
        </Link>
      </div>

      <form method="GET" className="mb-5 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-5">
        <label className="text-sm">
          <span className="mb-1 block text-slate-700">Entity type</span>
          <input
            name="entityType"
            defaultValue={entityType}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder="feedback_item"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-700">Entity id</span>
          <input
            name="entityId"
            defaultValue={entityId}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder="fb_123"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-700">Actor</span>
          <input
            name="actorId"
            defaultValue={actorId}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder="pm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-700">Date from</span>
          <input
            type="datetime-local"
            name="dateFrom"
            defaultValue={dateFromRaw}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-700">Date to</span>
          <input
            type="datetime-local"
            name="dateTo"
            defaultValue={dateToRaw}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <div className="md:col-span-5">
          <button type="submit" className="rounded bg-sky-700 px-4 py-2 text-sm font-medium text-white">
            Apply filters
          </button>
        </div>
      </form>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-700">
            <tr>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Entity</th>
              <th className="px-3 py-2">Actor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {logs.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-slate-600" colSpan={4}>
                  No audit logs found for current filters.
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id}>
                  <td className="px-3 py-2 text-slate-700">{log.createdAt.toISOString()}</td>
                  <td className="px-3 py-2 font-medium text-slate-900">{log.action}</td>
                  <td className="px-3 py-2 text-slate-700">
                    {log.entityType}:{log.entityId}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{log.actorId}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
