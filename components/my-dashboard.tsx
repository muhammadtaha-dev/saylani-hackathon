"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarCheck, AlarmClock, ClipboardList, CalendarClock, History, ShieldCheck } from "lucide-react";
import type { AuditEventClient, MySnapshot } from "./types";

const TYPE_LABELS: Record<string, string> = { annual: "Annual", sick: "Sick", casual: "Casual" };
const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
  cancelled: "bg-slate-200 text-slate-600",
};

/**
 * Employee's own dashboard — org-wide KPIs stay hidden (one permission system).
 * Includes leave cancellation (Checklist D.19) and the upcoming-leave card.
 */
export function MyDashboard({
  snapshot,
  onRequestsChanged,
}: {
  snapshot: MySnapshot;
  onRequestsChanged?: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const statusLabel = snapshot.today_status === "present"
    ? "Present"
    : snapshot.today_status === "late"
      ? "Late"
      : snapshot.today_status === "leave"
        ? "On approved leave"
        : snapshot.today_status === "absent"
          ? "Absent"
          : "No record";

  const today = snapshot.as_of_date;
  const upcoming = snapshot.my_requests.find(
    (r) => (r.status === "pending" || r.status === "approved") && r.end >= today
  );

  async function cancel(id: string) {
    if (busyId) return;
    if (!window.confirm("Cancel this leave request?")) return;
    setBusyId(id);
    setNotice(null);
    try {
      const res = await fetch("/api/leaves/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = (await res.json()) as { error?: string; note?: string };
      if (!res.ok) {
        setNotice({ tone: "error", text: data.error ?? "Could not cancel the request." });
        return;
      }
      setNotice({ tone: "success", text: data.note ?? "Request cancelled." });
      onRequestsChanged?.();
    } catch {
      setNotice({ tone: "error", text: "Could not reach the server. Please try again." });
    } finally {
      setBusyId(null);
    }
  }

  const canCancel = (r: MySnapshot["my_requests"][number]) =>
    r.status === "pending" || (r.status === "approved" && r.start > today);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">My status · {snapshot.latest_working_day}</span>
            <CalendarCheck className="h-4 w-4 text-emerald-600" aria-hidden />
          </div>
          <p className="mt-2 text-xl font-semibold text-slate-900">{statusLabel}</p>
          <p className="mt-1 text-xs text-slate-500">{snapshot.today_check_in ? `Checked in at ${snapshot.today_check_in}` : "Latest working day"}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Late this month</span>
            <AlarmClock className="h-4 w-4 text-amber-600" aria-hidden />
          </div>
          <p className="mt-2 text-xl font-semibold text-slate-900">{snapshot.late_days_this_month} day{snapshot.late_days_this_month === 1 ? "" : "s"}</p>
          <p className="mt-1 text-xs text-slate-500">check-in after 09:15 counts as late</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Upcoming leave</span>
            <CalendarClock className="h-4 w-4 text-sky-600" aria-hidden />
          </div>
          {upcoming ? (
            <>
              <p className="mt-2 text-xl font-semibold text-slate-900">{TYPE_LABELS[upcoming.type] ?? upcoming.type}</p>
              <p className="mt-1 text-xs text-slate-500">
                {upcoming.start} → {upcoming.end} · <span className="capitalize">{upcoming.status}</span>
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 text-xl font-semibold text-slate-900">None</p>
              <p className="mt-1 text-xs text-slate-500">No pending or approved leave ahead</p>
            </>
          )}
        </div>
        {snapshot.leave_balance.balances.map((b) => (
          <div key={b.type} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{TYPE_LABELS[b.type] ?? b.type} balance {snapshot.leave_balance.year}</p>
            <p className="mt-2 text-xl font-semibold text-slate-900">
              {b.remaining} <span className="text-sm font-normal text-slate-400">/ {b.entitled} left</span>
            </p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${Math.max(0, Math.min(100, (b.remaining / b.entitled) * 100))}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-slate-500">{b.used_approved} approved used · {b.pending} pending (excluded)</p>
          </div>
        ))}
      </div>

      {notice && (
        <p
          className={`rounded-lg p-3 text-sm ring-1 ${notice.tone === "error" ? "bg-rose-50 text-rose-800 ring-rose-200" : "bg-emerald-50 text-emerald-800 ring-emerald-200"}`}
          role="status"
        >
          {notice.text}
        </p>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <ClipboardList className="h-4 w-4 text-slate-400" aria-hidden />
          My leave requests
        </h2>
        {snapshot.my_requests.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No leave requests yet — try Smart Leave below.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 font-medium">Dates</th>
                  <th className="py-2 pr-3 font-medium">Days</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Reason</th>
                  <th className="py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.my_requests.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50 text-slate-700">
                    <td className="py-2 pr-3 capitalize">{r.type}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{r.start} → {r.end}</td>
                    <td className="py-2 pr-3">{r.days}</td>
                    <td className="py-2 pr-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[r.status] ?? "bg-slate-100"}`}>{r.status}</span>
                    </td>
                    <td className="py-2 pr-3 text-slate-500">{r.reason}</td>
                    <td className="py-2 text-right">
                      {canCancel(r) && (
                        <button
                          type="button"
                          onClick={() => cancel(r.id)}
                          disabled={busyId === r.id}
                          className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                        >
                          {busyId === r.id ? "Cancelling…" : "Cancel"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11px] text-slate-400">
          Pending requests can be cancelled any time; approved leave can be cancelled up to the day before it starts.
        </p>
      </div>
    </div>
  );
}

/** Employee's own slice of the audit trail (Checklist E.23). */
export function MyActivity() {
  const [events, setEvents] = useState<AuditEventClient[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/audit");
      const data = (await res.json()) as { events?: AuditEventClient[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not load your activity.");
        return;
      }
      setEvents(data.events ?? []);
    } catch {
      setError("Could not load your activity.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; setState runs after await
    load();
  }, [load]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <History className="h-4 w-4 text-slate-400" aria-hidden />
        My activity
        <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
          <ShieldCheck className="h-3 w-3 text-emerald-500" aria-hidden /> append-only log
        </span>
      </h2>
      {error && <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700 ring-1 ring-rose-200">{error}</p>}
      {!error && events && events.length === 0 && (
        <p className="mt-3 text-sm text-slate-500">Nothing recorded yet — sign-ins and leave actions will appear here.</p>
      )}
      {!error && events && events.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-50 text-sm">
          {events.slice(0, 8).map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="capitalize text-slate-700">{e.action.replaceAll("_", " ")}</span>
              <span className="text-xs text-slate-400">
                {new Date(e.ts).toLocaleString()} · {e.target_id}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
