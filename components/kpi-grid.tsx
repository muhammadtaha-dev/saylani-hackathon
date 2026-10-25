"use client";

import { Users, UserCheck, AlarmClock, CalendarOff, Wallet, Gauge } from "lucide-react";
import type { DashboardKpis } from "./types";

function pkr(amount: number): string {
  return `PKR ${amount.toLocaleString("en-US")}`;
}

function compactPkr(amount: number): string {
  if (amount >= 1000000) return `PKR ${(amount / 1000000).toFixed(2)}M`;
  return pkr(amount);
}

interface CardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: string;
}

function KpiCard({ icon, label, value, sub, tone }: CardProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tone}`}>{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{sub}</p>
    </div>
  );
}

export function KpiGrid({ kpis }: { kpis: DashboardKpis }) {
  const t = kpis.today;
  const a = kpis.attendance_this_month;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <KpiCard
        icon={<Users className="h-4 w-4 text-emerald-600" />}
        label={kpis.scope_note.includes("direct reports") ? "Team Headcount" : "Active Headcount"}
        value={String(kpis.headcount_active)}
        sub={`${kpis.scope_note} · as of ${kpis.as_of_date}`}
        tone="bg-emerald-50"
      />
      <KpiCard
        icon={<UserCheck className="h-4 w-4 text-sky-600" />}
        label={`Present · ${t.date}`}
        value={String(t.present)}
        sub="latest recorded working day"
        tone="bg-sky-50"
      />
      <KpiCard
        icon={<AlarmClock className="h-4 w-4 text-amber-600" />}
        label={`Late · ${t.date}`}
        value={String(t.late)}
        sub={`check-in after 09:15 ${kpis.timezone}`}
        tone="bg-amber-50"
      />
      <KpiCard
        icon={<CalendarOff className="h-4 w-4 text-rose-600" />}
        label={`On Leave · ${t.date}`}
        value={String(t.on_leave)}
        sub={`${kpis.leave_this_month.pending_requests} pending requests this month`}
        tone="bg-rose-50"
      />
      <KpiCard
        icon={<Gauge className="h-4 w-4 text-indigo-600" />}
        label={`Attendance · ${a.label}`}
        value={`${a.attendance_rate}%`}
        sub={`${a.working_days} working days recorded`}
        tone="bg-indigo-50"
      />
      {kpis.payroll ? (
        <KpiCard
          icon={<Wallet className="h-4 w-4 text-violet-600" />}
          label={`Payroll · ${kpis.payroll.label}`}
          value={compactPkr(kpis.payroll.total)}
          sub={`avg ${compactPkr(kpis.payroll.average)} · ${kpis.payroll.headcount} staff`}
          tone="bg-violet-50"
        />
      ) : null}
    </div>
  );
}
