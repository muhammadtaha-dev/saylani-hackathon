"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  ClipboardCheck,
  LogOut,
  ScrollText,
  ShieldCheck,
  Database,
} from "lucide-react";
import { AuditModal } from "@/components/audit-modal";
import { ChatDrawer } from "@/components/chat-drawer";
import { HrOperations } from "@/components/hr-operations";
import { KpiGrid } from "@/components/kpi-grid";
import { MyActivity, MyDashboard } from "@/components/my-dashboard";
import { SmartLeave } from "@/components/smart-leave";
import { SummaryPanel } from "@/components/summary-panel";
import { TeamManagement } from "@/components/team-management";
import {
  ROLE_BADGE_CLASSES,
  ROLE_LABELS,
  type DashboardKpis,
  type MySnapshot,
  type SessionInfo,
} from "@/components/types";

const DEPARTMENT_FILTERS = ["All", "Engineering", "Sales", "HR"] as const;

export default function Home() {
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [department, setDepartment] = useState<string>("All");
  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [mySnapshot, setMySnapshot] = useState<MySnapshot | null>(null);
  const [aiEnabled, setAiEnabled] = useState<boolean>(true);
  const [aiModel, setAiModel] = useState<string>("");
  const [auditOpen, setAuditOpen] = useState(false);
  const [booting, setBooting] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  const goToLogin = useCallback(() => router.replace("/login"), [router]);

  const loadDashboard = useCallback(async (dept: string) => {
    const query = dept === "All" ? "" : `?department=${encodeURIComponent(dept)}`;
    const res = await fetch(`/api/dashboard${query}`);
    if (res.status === 401) {
      goToLogin();
      return;
    }
    if (!res.ok) {
      // Surface the failure instead of silently keeping stale numbers (B.5).
      setDashboardError("Could not refresh the dashboard. Your last loaded figures may be stale — please retry.");
      return;
    }
    const data = (await res.json()) as {
      role: string;
      kpis?: DashboardKpis;
      my?: MySnapshot;
      ai?: { enabled: boolean; model: string };
    };
    setDashboardError(null);
    setKpis(data.kpis ?? null);
    setMySnapshot(data.my ?? null);
    if (data.ai) {
      setAiEnabled(data.ai.enabled);
      setAiModel(data.ai.model);
    }
  }, [goToLogin]);

  useEffect(() => {
    async function boot() {
      const res = await fetch("/api/session");
      const data = (await res.json()) as { session: SessionInfo | null };
      if (!data.session) {
        goToLogin();
        return;
      }
      setSession(data.session);
      setBooting(false);
    }
    boot();
  }, [goToLogin]);

  useEffect(() => {
    if (session) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- refetch on filters; setState runs after await
      loadDashboard(department);
    }
  }, [session, department, loadDashboard]);

  async function logOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    goToLogin();
  }

  function reloadAll() {
    void loadDashboard(department);
  }

  const providerLabel = aiEnabled ? `Gemini (${aiModel})` : "Grounded mock · no API key";

  if (booting || !session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="flex items-center gap-3 text-slate-500">
          <Database className="h-5 w-5 animate-pulse" aria-hidden />
          <span className="text-sm font-medium">Loading HCM Lite…</span>
        </div>
      </main>
    );
  }

  const isEmployee = session.role === "employee";
  const canSeeSummary = session.role === "admin" || session.role === "hr";

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-4 pb-24 pt-5 sm:px-6">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm sm:px-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-sm">
            <Building2 className="h-5 w-5 text-white" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-slate-900">HCM Lite</h1>
            <p className="text-xs text-slate-500">AI Assistant Module (M8) · Saylani Hackathon</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <span className="hidden items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200 md:inline-flex">
            <Database className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
            {providerLabel}
          </span>
          {session.role === "admin" || session.role === "hr" ? (
            <button
              type="button"
              onClick={() => setAuditOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700"
            >
              <ScrollText className="h-3.5 w-3.5" aria-hidden />
              Audit trail
            </button>
          ) : null}
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${ROLE_BADGE_CLASSES[session.role]}`}>
              {ROLE_LABELS[session.role]}
            </span>
            {session.name}
          </span>
          <button
            type="button"
            onClick={logOut}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden />
            Log out
          </button>
        </div>
      </header>

      {/* Session strip */}
      {session && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-600 shadow-sm">
          <span className="inline-flex items-center gap-1.5 font-medium text-slate-800">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
            Active session: {session.name}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ${ROLE_BADGE_CLASSES[session.role]}`}>
            {ROLE_LABELS[session.role]}
          </span>
          <span>Department scope: <strong>{isEmployee ? session.department : "All departments"}</strong></span>
          <span className="hidden sm:inline">Identity injected server-side from the signed session cookie — never from the request body or the model.</span>
        </div>
      )}

      {/* Dashboard */}
      <div className="mt-4 space-y-4">
        {dashboardError && (
          <p className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" role="alert">
            {dashboardError}
            <button
              type="button"
              onClick={reloadAll}
              className="shrink-0 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
            >
              Retry
            </button>
          </p>
        )}
        {canSeeSummary && kpis && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">
                Organization dashboard · {kpis.attendance_this_month.label}
              </h2>
              <label className="inline-flex items-center gap-2 text-xs text-slate-500">
                Department filter
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="h-8 rounded-lg border border-slate-200 px-2 text-xs font-medium text-slate-700 outline-none focus:border-emerald-400"
                  aria-label="Department filter"
                >
                  {DEPARTMENT_FILTERS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </label>
            </div>
            <KpiGrid kpis={kpis} />
            <SummaryPanel department={department} />
            <HrOperations department={department} onDataChanged={() => loadDashboard(department)} />
            <TeamManagement role={session.role} selfId={session.userId} />
          </>
        )}

        {isEmployee && mySnapshot && (
          <>
            <h2 className="text-sm font-semibold text-slate-900">My workspace</h2>
            <MyDashboard snapshot={mySnapshot} onRequestsChanged={reloadAll} />
            <SmartLeave onSubmitted={reloadAll} />
            <MyActivity />
          </>
        )}

        {/* Shared definitions card — parity guarantee */}
        <section className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-xs leading-6 text-slate-500">
          <p className="font-semibold text-slate-600">Shared definitions (dashboard &amp; AI use the same service layer)</p>
          <p>
            Active = employment status &quot;active&quot; · Late = check-in after 09:15 PKT · Attendance rate = (present + late) /
            (present + late + absent) × 100, approved-leave days excluded · Leave quotas: Annual 14, Sick 8, Casual 10 ·
            Only approved leaves consume quota; pending requests are excluded.
          </p>
        </section>
      </div>

      {/* Footer note */}
      <footer className="mt-6 flex flex-wrap items-center justify-center gap-2 text-[11px] text-slate-400">
        <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />
        Every AI answer is labelled, logged to ai_logs, permission-checked server-side, and grounded in the database.
      </footer>

      {session && (
        <ChatDrawer userId={session.userId} role={session.role} providerLabel={providerLabel} />
      )}
      <AuditModal open={auditOpen} onClose={() => setAuditOpen(false)} role={session.role} />
    </main>
  );
}
