"use client";

import { useCallback, useEffect, useState } from "react";
import { X, RefreshCw, ShieldCheck, ShieldX, Download } from "lucide-react";
import type {
  AuditEventClient,
  ChainVerificationClient,
  Role,
} from "./types";

const STATUS_STYLES: Record<string, string> = {
  ok: "bg-emerald-100 text-emerald-700",
  forbidden: "bg-amber-100 text-amber-700",
  error: "bg-rose-100 text-rose-700",
};


const ACTION_STYLES: Record<string, string> = {
  login_success: "bg-emerald-100 text-emerald-700",
  login_failed: "bg-rose-100 text-rose-700",
  logout: "bg-slate-200 text-slate-600",
  user_created: "bg-sky-100 text-sky-700",
  user_removed: "bg-rose-100 text-rose-700",
  leave_submitted: "bg-indigo-100 text-indigo-700",
  leave_approved: "bg-emerald-100 text-emerald-700",
  leave_rejected: "bg-rose-100 text-rose-700",
  leave_cancelled: "bg-slate-200 text-slate-600",
  ai_permission_denied: "bg-amber-100 text-amber-700",
};

const ACTION_LABELS: Record<string, string> = {
  login_success: "Login",
  login_failed: "Login failed",
  logout: "Logout",
  user_created: "User created",
  user_removed: "User removed",
  leave_submitted: "Leave submitted",
  leave_approved: "Leave approved",
  leave_rejected: "Leave rejected",
  leave_cancelled: "Leave cancelled",
  ai_permission_denied: "AI permission denied",
};

function detailText(before: Record<string, unknown> | null, after: Record<string, unknown> | null, details: Record<string, unknown> | null): string {
  const parts: string[] = [];
  if (details?.comment) parts.push(`comment: "${details.comment}"`);
  if (details?.guard) parts.push(`guard: ${details.guard}`);
  if (before && after) {
    const changes: string[] = [];
    for (const key of Object.keys(after)) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        changes.push(`${key}: ${JSON.stringify(before[key])} → ${JSON.stringify(after[key])}`);
      }
    }
    if (changes.length) parts.push(changes.join(", "));
  } else if (after) {
    const keys = Object.keys(after).filter((k) => k !== "id");
    if (keys.length) parts.push(keys.map((k) => `${k}: ${JSON.stringify(after[k])}`).join(", "));
  }
  return parts.join(" · ") || "—";
}

/**
 * Audit trail viewer (Checklist E.22–E.24). Admin/HR see the unified
 * hash-chained event log (filterable, CSV-exportable, with an integrity
 * verifier) plus the AI call log; an employee sees only their own events.
 */
export function AuditModal({
  open,
  onClose,
  role,
}: {
  open: boolean;
  onClose: () => void;
  role: Role;
}) {
  const isPrivileged = role === "admin" || role === "hr";
  const [tab, setTab] = useState<"events" | "ai">("events");
  const [events, setEvents] = useState<AuditEventClient[] | null>(null);
  const [actions, setActions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ user: "", action: "all", from: "", to: "" });
  const [verification, setVerification] = useState<ChainVerificationClient | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [aiCalls, setAiCalls] = useState<AuditEventClient[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.user.trim()) params.set("user", filters.user.trim());
      if (filters.action !== "all") params.set("action", filters.action);
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      const res = await fetch(`/api/audit?${params.toString()}`);
      const data = (await res.json()) as { events?: AuditEventClient[]; actions?: string[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not load the audit trail.");
        setEvents(null);
        return;
      }
      setEvents(data.events ?? []);
      setActions(data.actions ?? []);
    } catch {
      setError("Could not load the audit trail.");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const loadAiLogs = useCallback(async () => {
    if (role !== "admin") return;
    try {
      const res = await fetch("/api/audit?action=ai_call&limit=150");
      const data = (await res.json()) as { events?: AuditEventClient[] };
      setAiCalls(data.events ?? []);
    } catch {
      setAiCalls([]);
    }
  }, [role]);

  const verify = useCallback(async () => {
    setVerifying(true);
    setVerification(null);
    try {
      const res = await fetch("/api/audit?verify=1");
      const data = (await res.json()) as { verification?: ChainVerificationClient; error?: string };
      setVerification(
        data.verification ?? { ok: false, checked: 0, total_rows: 0, reason: data.error ?? "verification unavailable" }
      );
    } catch {
      setVerification({ ok: false, checked: 0, total_rows: 0, reason: "verification request failed" });
    } finally {
      setVerifying(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on open; setState runs after await
      load();
      loadAiLogs();
    }
  }, [open, load, loadAiLogs]);

  function exportCsv() {
    const params = new URLSearchParams();
    if (filters.user.trim()) params.set("user", filters.user.trim());
    if (filters.action !== "all") params.set("action", filters.action);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    params.set("format", "csv");
    window.open(`/api/audit?${params.toString()}`, "_blank");
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true" aria-label="Audit trail">
      <div className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {isPrivileged ? "Audit Trail" : "My Activity"}
            </h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
              {isPrivileged
                ? "Append-only · hash-chained · who, what, when, IP, before/after"
                : "Your own entries from the append-only, hash-chained audit log"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isPrivileged && (
              <div className="flex rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Audit views">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "events"}
                  onClick={() => setTab("events")}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${tab === "events" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                >
                  Events
                </button>
                {role === "admin" && (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === "ai"}
                    onClick={() => setTab("ai")}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${tab === "ai" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                  >
                    AI calls
                  </button>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={isPrivileged && tab === "events" ? load : loadAiLogs}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
              Refresh
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close audit trail"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-4">
          {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 ring-1 ring-rose-200">{error}</p>}

          {/* Unified event log (or the employee's own slice of it) */}
          {(!isPrivileged || tab === "events") && (
            <>
              {isPrivileged && (
                <div className="mb-3 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <label className="text-xs font-medium text-slate-600">
                    User
                    <input
                      value={filters.user}
                      onChange={(e) => setFilters((f) => ({ ...f, user: e.target.value }))}
                      placeholder="name contains…"
                      className="mt-0.5 block h-8 w-40 rounded-lg border border-slate-200 px-2 text-xs outline-none focus:border-emerald-400"
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    Action
                    <select
                      value={filters.action}
                      onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
                      className="mt-0.5 block h-8 w-44 rounded-lg border border-slate-200 px-2 text-xs font-medium text-slate-700 outline-none focus:border-emerald-400"
                    >
                      <option value="all">All actions</option>
                      {actions.map((a) => (
                        <option key={a} value={a}>{ACTION_LABELS[a] ?? a}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    From
                    <input
                      type="date"
                      value={filters.from}
                      onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
                      className="mt-0.5 block h-8 w-36 rounded-lg border border-slate-200 px-2 text-xs outline-none focus:border-emerald-400"
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    To
                    <input
                      type="date"
                      value={filters.to}
                      onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
                      className="mt-0.5 block h-8 w-36 rounded-lg border border-slate-200 px-2 text-xs outline-none focus:border-emerald-400"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={load}
                    className="h-8 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white transition hover:bg-slate-700"
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={exportCsv}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden />
                    Export CSV
                  </button>
                  <button
                    type="button"
                    onClick={verify}
                    disabled={verifying}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
                  >
                    <ShieldCheck className={`h-3.5 w-3.5 ${verifying ? "animate-pulse" : ""}`} aria-hidden />
                    Verify integrity
                  </button>
                </div>
              )}

              {verification && (
                <p
                  className={`mb-3 flex items-center gap-2 rounded-lg p-3 text-sm ring-1 ${
                    verification.ok
                      ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                      : "bg-rose-50 text-rose-800 ring-rose-200"
                  }`}
                  role="status"
                >
                  {verification.ok ? (
                    <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
                  ) : (
                    <ShieldX className="h-4 w-4 shrink-0" aria-hidden />
                  )}
                  {verification.ok
                    ? `Integrity verified: ${verification.checked} row${verification.checked === 1 ? "" : "s"} checked, the hash chain is unbroken.`
                    : `CHAIN BROKEN at row ${verification.broken_at_seq}: ${verification.reason}.`}
                </p>
              )}

              {!error && events && events.length === 0 && (
                <p className="rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-500">
                  No audit events match. Log in, process leave or use the assistant — every security-relevant action lands here.
                </p>
              )}
              {!error && events && events.length > 0 && (
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-400">
                      <th className="px-2 py-2 font-medium">#</th>
                      <th className="px-2 py-2 font-medium">Time</th>
                      <th className="px-2 py-2 font-medium">Who</th>
                      <th className="px-2 py-2 font-medium">Action</th>
                      <th className="px-2 py-2 font-medium">Target</th>
                      <th className="px-2 py-2 font-medium">IP</th>
                      <th className="px-2 py-2 font-medium">Before → After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e) => (
                      <tr key={e.id} className="border-b border-slate-50 align-top text-slate-700">
                        <td className="px-2 py-2 font-mono text-[11px] text-slate-400">{e.seq}</td>
                        <td className="whitespace-nowrap px-2 py-2 font-mono text-[11px] text-slate-500">
                          {new Date(e.ts).toLocaleString()}
                        </td>
                        <td className="px-2 py-2">
                          {e.actor_name}
                          <span className="block text-[10px] capitalize text-slate-400">{e.actor_role}</span>
                        </td>
                        <td className="px-2 py-2">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${ACTION_STYLES[e.action] ?? "bg-slate-100 text-slate-600"}`}>
                            {ACTION_LABELS[e.action] ?? e.action}
                          </span>
                        </td>
                        <td className="px-2 py-2 font-mono text-[11px]">{e.target_id || "—"}</td>
                        <td className="px-2 py-2 font-mono text-[11px] text-slate-500">{e.ip}</td>
                        <td className="max-w-[340px] px-2 py-2 text-[11px] text-slate-600">
                          {detailText(e.before, e.after, e.details)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}

          {/* AI call log (admin diagnostics — audit_log rows with action = ai_call) */}
          {isPrivileged && tab === "ai" && role === "admin" && (
            <>
              {!aiCalls && <p className="py-3 text-sm text-slate-400">Loading AI calls…</p>}
              {aiCalls && aiCalls.length === 0 && (
                <p className="rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-500">
                  No AI calls recorded yet. Use the assistant, the summary button or Smart Leave — every call lands here.
                </p>
              )}
              {aiCalls && aiCalls.length > 0 && (
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-400">
                      <th className="px-2 py-2 font-medium">Time</th>
                      <th className="px-2 py-2 font-medium">User</th>
                      <th className="px-2 py-2 font-medium">Feature</th>
                      <th className="px-2 py-2 font-medium">Tool / target</th>
                      <th className="px-2 py-2 font-medium">Status</th>
                      <th className="px-2 py-2 font-medium">Latency</th>
                      <th className="px-2 py-2 font-medium">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aiCalls.map((log) => {
                      const d = (log.details ?? {}) as Record<string, unknown>;
                      return (
                        <tr key={log.id} className="border-b border-slate-50 align-top text-slate-700">
                          <td className="whitespace-nowrap px-2 py-2 font-mono text-[11px] text-slate-500">
                            {new Date(log.ts).toLocaleTimeString()}
                          </td>
                          <td className="px-2 py-2">{log.actor_name}</td>
                          <td className="px-2 py-2">{String(d.feature ?? "—")}</td>
                          <td className="px-2 py-2 font-mono text-[11px]">
                            {String(d.tool_name ?? log.target_id ?? "—")}
                          </td>
                          <td className="px-2 py-2">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[String(d.tool_status ?? "ok")] ?? "bg-slate-100 text-slate-600"}`}>
                              {String(d.tool_status ?? d.outcome ?? "ok")}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 font-mono text-[11px]">
                            {d.latency_ms != null ? `${d.latency_ms} ms` : "—"}
                          </td>
                          <td className="px-2 py-2 font-mono text-[11px] text-slate-500">
                            {d.error_code ? String(d.error_code) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
