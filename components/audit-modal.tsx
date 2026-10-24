"use client";

import { useCallback, useEffect, useState } from "react";
import { X, RefreshCw, ShieldCheck } from "lucide-react";
import type { AiLogRowClient } from "./types";

const STATUS_STYLES: Record<string, string> = {
  ok: "bg-emerald-100 text-emerald-700",
  forbidden: "bg-amber-100 text-amber-700",
  error: "bg-rose-100 text-rose-700",
};

const OUTCOME_STYLES: Record<string, string> = {
  answered: "bg-emerald-100 text-emerald-700",
  refused: "bg-amber-100 text-amber-700",
  fallback: "bg-slate-200 text-slate-600",
  rate_limited: "bg-rose-100 text-rose-700",
  timeout: "bg-rose-100 text-rose-700",
  validation_failed: "bg-amber-100 text-amber-700",
};

/**
 * Admin audit viewer (Art. IX, T4.3): live ai_logs rows with status,
 * latency, and visible proof of redaction — sensitive tool arguments show
 * up already sanitised (e.g. "[REDACTED]").
 */
export function AuditModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [logs, setLogs] = useState<AiLogRowClient[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/logs");
      const data = (await res.json()) as { logs?: AiLogRowClient[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not load logs.");
        setLogs(null);
        return;
      }
      setLogs(data.logs ?? []);
    } catch {
      setError("Could not load logs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on open; setState runs after await
      load();
    }
  }, [open, load]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true" aria-label="AI audit trail">
      <div className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">AI Audit Trail — ai_logs</h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
              Append-only · Admin-only · salary values and personal identifiers redacted
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={load}
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
          {!error && logs && logs.length === 0 && (
            <p className="rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-500">
              No AI calls recorded yet. Use the assistant, the summary button or Smart Leave — every call lands here.
            </p>
          )}
          {!error && logs && logs.length > 0 && (
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="px-2 py-2 font-medium">Time</th>
                  <th className="px-2 py-2 font-medium">User</th>
                  <th className="px-2 py-2 font-medium">Role</th>
                  <th className="px-2 py-2 font-medium">Feature</th>
                  <th className="px-2 py-2 font-medium">Tool</th>
                  <th className="px-2 py-2 font-medium">Args (sanitised)</th>
                  <th className="px-2 py-2 font-medium">Tool status</th>
                  <th className="px-2 py-2 font-medium">Outcome</th>
                  <th className="px-2 py-2 font-medium">Latency</th>
                  <th className="px-2 py-2 font-medium">Provider</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-slate-50 align-top text-slate-700">
                    <td className="whitespace-nowrap px-2 py-2 font-mono text-[11px] text-slate-500">
                      {new Date(log.created_at).toLocaleTimeString()}
                    </td>
                    <td className="px-2 py-2">{log.user_name}</td>
                    <td className="px-2 py-2 capitalize">{log.role}</td>
                    <td className="px-2 py-2">{log.feature}</td>
                    <td className="px-2 py-2 font-mono text-[11px]">{log.tool_name ?? "—"}</td>
                    <td className="max-w-[220px] truncate px-2 py-2 font-mono text-[11px] text-slate-500" title={log.tool_args ? JSON.stringify(log.tool_args) : ""}>
                      {log.tool_args ? JSON.stringify(log.tool_args) : "—"}
                    </td>
                    <td className="px-2 py-2">
                      {log.tool_status ? (
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[log.tool_status] ?? "bg-slate-100 text-slate-600"}`}>
                          {log.tool_status}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${OUTCOME_STYLES[log.outcome] ?? "bg-slate-100 text-slate-600"}`}>
                        {log.outcome}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 font-mono text-[11px]">{log.latency_ms} ms</td>
                    <td className="px-2 py-2">{log.provider}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
