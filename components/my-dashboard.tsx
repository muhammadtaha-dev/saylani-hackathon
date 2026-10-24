"use client";

import { CalendarCheck, AlarmClock, ClipboardList } from "lucide-react";
import type { MySnapshot } from "./types";

const TYPE_LABELS: Record<string, string> = { annual: "Annual", sick: "Sick", casual: "Casual" };
const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
};

/** Employee's own dashboard — org-wide KPIs stay hidden (one permission system). */
export function MyDashboard({ snapshot }: { snapshot: MySnapshot }) {
  const statusLabel = snapshot.today_status === "present"
    ? "Present"
    : snapshot.today_status === "late"
      ? "Late"
      : snapshot.today_status === "leave"
        ? "On approved leave"
        : snapshot.today_status === "absent"
          ? "Absent"
          : "No record";

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

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <ClipboardList className="h-4 w-4 text-slate-400" aria-hidden />
          My leave requests
        </h2>
        {snapshot.my_requests.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No leave requests yet — try Smart Leave below.</p>
        ) : (
          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                <th className="py-2 font-medium">Type</th>
                <th className="py-2 font-medium">Dates</th>
                <th className="py-2 font-medium">Days</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.my_requests.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 text-slate-700">
                  <td className="py-2 capitalize">{r.type}</td>
                  <td className="py-2 font-mono text-xs">{r.start} → {r.end}</td>
                  <td className="py-2">{r.days}</td>
                  <td className="py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[r.status] ?? "bg-slate-100"}`}>{r.status}</span>
                  </td>
                  <td className="py-2 text-slate-500">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
