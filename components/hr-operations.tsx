"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, AlarmClock, Gauge, CheckCircle2, XCircle } from "lucide-react";

interface LeaveRow {
  id: string;
  employeeId: string;
  employee_name?: string;
  department?: string;
  type: string;
  start: string;
  end: string;
  days: number;
  status: string;
  reason: string;
  appliedOn: string;
}

interface LateComerRow {
  employee_id: string;
  name: string;
  department: string;
  late_count: number;
}

interface AttendanceRow {
  employee_id: string;
  name: string;
  department: string;
  designation: string;
  present: number;
  late: number;
  absent: number;
  on_leave: number;
  attendance_rate: number;
}

interface Overview {
  period: { label: string };
  late_cutoff: string;
  timezone: string;
  late_comers: LateComerRow[];
  attendance: AttendanceRow[];
}

const TYPE_LABELS: Record<string, string> = { annual: "Annual", sick: "Sick", casual: "Casual" };
const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
};

/**
 * HR Operations (Admin/HR): process leave requests like a real company HR
 * desk, and inspect latecomer and per-employee attendance reports. All data
 * comes from the shared service layer, so it reconciles with the dashboard
 * and the AI tools.
 */
export function HrOperations({
  department,
  onDataChanged,
}: {
  department: string;
  onDataChanged?: () => void;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"leaves" | "late" | "attendance">("leaves");
  const [leaves, setLeaves] = useState<LeaveRow[] | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const query = department === "All" ? "" : `?department=${encodeURIComponent(department)}`;
    const [leavesRes, overviewRes] = await Promise.all([
      fetch("/api/leaves"),
      fetch(`/api/hr/overview${query}`),
    ]);
    if (leavesRes.status === 401 || overviewRes.status === 401) {
      router.replace("/login");
      return;
    }
    const leavesData = (await leavesRes.json()) as { requests?: LeaveRow[] };
    const overviewData = (await overviewRes.json()) as Overview;
    setLeaves(leavesData.requests ?? []);
    setOverview(overviewData);
  }, [department, router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount/filter change; setState after await
    load();
  }, [load]);

  async function process(id: string, status: "approved" | "rejected") {
    setBusyId(id);
    setNotice(null);
    try {
      const res = await fetch("/api/leaves", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const data = (await res.json()) as { error?: string; request?: LeaveRow; note?: string };
      if (!res.ok) {
        setNotice({ tone: "error", text: data.error ?? "Could not process the request." });
        return;
      }
      setNotice({
        tone: "success",
        text: `${data.request?.employee_name ?? "Request"}'s ${TYPE_LABELS[data.request?.type ?? ""] ?? data.request?.type} leave ${status}. ${data.note ?? ""}`,
      });
      await load();
      onDataChanged?.();
    } finally {
      setBusyId(null);
    }
  }

  const scopedLeaves = (leaves ?? []).filter(
    (l) => department === "All" || l.department === department
  );
  const pending = scopedLeaves.filter((l) => l.status === "pending");
  const processed = scopedLeaves
    .filter((l) => l.status !== "pending")
    .sort((a, b) => b.appliedOn.localeCompare(a.appliedOn))
    .slice(0, 8);

  const tabs = [
    { id: "leaves" as const, label: `Leave Requests${pending.length ? ` (${pending.length})` : ""}`, icon: CalendarClock },
    { id: "late" as const, label: "Late Comers", icon: AlarmClock },
    { id: "attendance" as const, label: "Attendance Report", icon: Gauge },
  ];

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">HR Operations</h2>
        <div className="flex gap-1.5 rounded-lg bg-slate-100 p-1">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                tab === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
              aria-pressed={tab === id}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <p
          className={`mt-3 flex items-start gap-2 rounded-lg p-3 text-sm ring-1 ${
            notice.tone === "error"
              ? "bg-rose-50 text-rose-800 ring-rose-200"
              : "bg-emerald-50 text-emerald-800 ring-emerald-200"
          }`}
          role="status"
        >
          {notice.tone === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          )}
          {notice.text}
        </p>
      )}

      {/* Leave requests */}
      {tab === "leaves" && (
        <div className="mt-4 space-y-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Pending approval
            </p>
            {pending.length === 0 ? (
              <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">
                No pending leave requests{department === "All" ? "" : ` in ${department}`}.
              </p>
            ) : (
              <ul className="space-y-2">
                {pending.map((l) => (
                  <li
                    key={l.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3"
                  >
                    <div className="text-sm">
                      <span className="font-medium text-slate-800">{l.employee_name ?? l.employeeId}</span>
                      <span className="text-slate-400"> · </span>
                      <span className="capitalize">{l.type}</span>
                      <span className="text-slate-400"> · </span>
                      <span className="font-mono text-xs">{l.start} → {l.end}</span>
                      <span className="text-slate-400"> · </span>
                      <span className="text-xs text-slate-500">{l.days} day(s)</span>
                      <p className="mt-0.5 text-xs text-slate-500">&ldquo;{l.reason}&rdquo;</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => process(l.id, "approved")}
                        disabled={busyId === l.id}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => process(l.id, "rejected")}
                        disabled={busyId === l.id}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
                      >
                        <XCircle className="h-3.5 w-3.5" aria-hidden />
                        Reject
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {processed.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Recently processed
              </p>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                    <th className="py-2 pr-3 font-medium">Employee</th>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pr-3 font-medium">Dates</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {processed.map((l) => (
                    <tr key={l.id} className="border-b border-slate-50 text-slate-700">
                      <td className="py-2 pr-3 font-medium text-slate-800">{l.employee_name ?? l.employeeId}</td>
                      <td className="py-2 pr-3 capitalize">{TYPE_LABELS[l.type] ?? l.type}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{l.start} → {l.end}</td>
                      <td className="py-2 pr-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[l.status] ?? "bg-slate-100"}`}>
                          {l.status}
                        </span>
                      </td>
                      <td className="py-2 text-slate-500">{l.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Late comers */}
      {tab === "late" && (
        <div className="mt-4">
          <p className="text-xs text-slate-500">
            {overview ? `${overview.period.label} · late = check-in after ${overview.late_cutoff} (${overview.timezone})` : "Loading…"}
          </p>
          {overview && overview.late_comers.length === 0 ? (
            <p className="mt-3 rounded-lg bg-slate-50 p-4 text-sm text-slate-500">
              No late arrivals recorded this month{department === "All" ? "" : ` in ${department}`} — sab parhaye likhaye hain!
            </p>
          ) : (
            <table className="mt-3 w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3 font-medium">Rank</th>
                  <th className="py-2 pr-3 font-medium">Employee</th>
                  <th className="py-2 pr-3 font-medium">Department</th>
                  <th className="py-2 font-medium">Late days</th>
                </tr>
              </thead>
              <tbody>
                {(overview?.late_comers ?? []).map((l, i) => (
                  <tr key={l.employee_id} className="border-b border-slate-50 text-slate-700">
                    <td className="py-2 pr-3 font-mono text-xs text-slate-400">#{i + 1}</td>
                    <td className="py-2 pr-3 font-medium text-slate-800">{l.name}</td>
                    <td className="py-2 pr-3">{l.department}</td>
                    <td className="py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${i === 0 ? "bg-rose-100 text-rose-700" : "bg-amber-50 text-amber-700"}`}>
                        {l.late_count}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Attendance report */}
      {tab === "attendance" && (
        <div className="mt-4">
          <p className="text-xs text-slate-500">
            {overview
              ? `${overview.period.label} · rate = (present + late) / (present + late + absent), approved-leave days excluded`
              : "Loading…"}
          </p>
          <div className="mt-3 max-h-[420px] overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3 font-medium">Employee</th>
                  <th className="py-2 pr-3 font-medium">Department</th>
                  <th className="py-2 pr-3 font-medium text-center">Present</th>
                  <th className="py-2 pr-3 font-medium text-center">Late</th>
                  <th className="py-2 pr-3 font-medium text-center">Absent</th>
                  <th className="py-2 pr-3 font-medium text-center">On leave</th>
                  <th className="py-2 font-medium text-right">Rate</th>
                </tr>
              </thead>
              <tbody>
                {(overview?.attendance ?? []).map((r) => (
                  <tr key={r.employee_id} className="border-b border-slate-50 text-slate-700">
                    <td className="py-2 pr-3">
                      <span className="font-medium text-slate-800">{r.name}</span>
                      <span className="block text-[11px] text-slate-400">{r.designation}</span>
                    </td>
                    <td className="py-2 pr-3">{r.department}</td>
                    <td className="py-2 pr-3 text-center">{r.present}</td>
                    <td className={`py-2 pr-3 text-center ${r.late > 0 ? "font-semibold text-amber-600" : ""}`}>{r.late}</td>
                    <td className={`py-2 pr-3 text-center ${r.absent > 0 ? "font-semibold text-rose-600" : ""}`}>{r.absent}</td>
                    <td className="py-2 pr-3 text-center">{r.on_leave}</td>
                    <td className="py-2 text-right font-medium">{r.attendance_rate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
