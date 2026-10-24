"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Building2,
  ClipboardCheck,
  ScrollText,
  UserCog,
  Database,
  ShieldCheck,
} from "lucide-react";
import { AiBadge } from "@/components/ai-badge";
import { AuditModal } from "@/components/audit-modal";
import { ChatDrawer } from "@/components/chat-drawer";
import { KpiGrid } from "@/components/kpi-grid";
import { MyDashboard } from "@/components/my-dashboard";
import { SmartLeave } from "@/components/smart-leave";
import { SummaryPanel } from "@/components/summary-panel";
import {
  ROLE_BADGE_CLASSES,
  ROLE_LABELS,
  type DashboardKpis,
  type MySnapshot,
  type PublicUser,
  type SessionInfo,
} from "@/components/types";

const DEPARTMENT_FILTERS = ["All", "Engineering", "Sales", "HR"] as const;

export default function Home() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [department, setDepartment] = useState<string>("All");
  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [mySnapshot, setMySnapshot] = useState<MySnapshot | null>(null);
  const [aiEnabled, setAiEnabled] = useState<boolean>(true);
  const [aiModel, setAiModel] = useState<string>("");
  const [auditOpen, setAuditOpen] = useState(false);
  const [booting, setBooting] = useState(true);

  const loadDashboard = useCallback(async (dept: string) => {
    const query = dept === "All" ? "" : `?department=${encodeURIComponent(dept)}`;
    const res = await fetch(`/api/dashboard${query}`);
    if (!res.ok) return;
    const data = (await res.json()) as {
      role: string;
      kpis?: DashboardKpis;
      my?: MySnapshot;
      ai?: { enabled: boolean; model: string };
    };
    setKpis(data.kpis ?? null);
    setMySnapshot(data.my ?? null);
    if (data.ai) {
      setAiEnabled(data.ai.enabled);
      setAiModel(data.ai.model);
    }
  }, []);

  const loadSession = useCallback(async () => {
    const res = await fetch("/api/session");
    const data = (await res.json()) as { session: SessionInfo | null; users: PublicUser[] };
    setUsers(data.users ?? []);
    if (!data.session) {
      // Demo convenience: start as the Employee account.
      const created = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "EMP-001" }),
      });
      const createdData = (await created.json()) as { session: SessionInfo };
      setSession(createdData.session);
    } else {
      setSession(data.session);
    }
    setBooting(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch; setState runs after await
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (session) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- refetch on filters; setState runs after await
      loadDashboard(department);
    }
  }, [session, department, loadDashboard]);

  async function switchUser(userId: string) {
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { session: SessionInfo };
    setSession(data.session);
    setKpis(null);
    setMySnapshot(null);
  }

  const providerLabel = aiEnabled ? `Gemini (${aiModel})` : "Grounded mock · no API key";

  if (booting) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="flex items-center gap-3 text-slate-500">
          <Database className="h-5 w-5 animate-pulse" aria-hidden />
          <span className="text-sm font-medium">Loading HCM Lite…</span>
        </div>
      </main>
    );
  }

  const isEmployee = session?.role === "employee";
  const canSeeSummary = session?.role === "admin" || session?.role === "hr";

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
          {session?.role === "admin" && (
            <button
              type="button"
              onClick={() => setAuditOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700"
            >
              <ScrollText className="h-3.5 w-3.5" aria-hidden />
              Audit trail
            </button>
          )}
          <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1">
            <UserCog className="ml-1 h-4 w-4 text-slate-400" aria-hidden />
            <span className="sr-only">Switch active session</span>
            <select
              value={session?.userId ?? ""}
              onChange={(e) => switchUser(e.target.value)}
              className="bg-transparent py-0.5 pr-1 text-xs font-medium text-slate-700 outline-none"
              aria-label="Active session"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] ?? u.role} ({u.email})
                </option>
              ))}
            </select>
          </label>
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
          </>
        )}

        {isEmployee && mySnapshot && (
          <>
            <h2 className="text-sm font-semibold text-slate-900">My workspace</h2>
            <MyDashboard snapshot={mySnapshot} />
            <SmartLeave onSubmitted={() => loadDashboard(department)} />
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
        {session?.role !== "admin" && <AiBadge />}
      </footer>

      {session && (
        <ChatDrawer role={session.role} providerLabel={providerLabel} />
      )}
      <AuditModal open={auditOpen} onClose={() => setAuditOpen(false)} />
    </main>
  );
}
