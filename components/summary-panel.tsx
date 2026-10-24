"use client";

import { useState } from "react";
import { Sparkles, RefreshCw, ShieldAlert } from "lucide-react";
import { AiBadge } from "./ai-badge";
import type { DashboardKpis } from "./types";

interface SummaryState {
  bullets: string[] | null;
  message?: string;
  loading: boolean;
}

/**
 * Dashboard summary panel (SUM-01..SUM-07): sends the current filters to the
 * backend, which recomputes the KPI JSON server-side; renders 3–5 grounded
 * bullets with the mandatory AI-generated label. Failure leaves the
 * dashboard unchanged (SUM-07).
 */
export function SummaryPanel({
  department,
  onSummary,
}: {
  department: string;
  onSummary?: (kpis: DashboardKpis) => void;
}) {
  const [state, setState] = useState<SummaryState>({ bullets: null, loading: false });

  async function summarize() {
    setState({ bullets: null, loading: true });
    try {
      const res = await fetch("/api/ai/dashboard-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters: { department: department === "All" ? undefined : department } }),
      });
      const data = (await res.json()) as {
        bullets?: string[] | null;
        message?: string;
        kpis?: DashboardKpis;
        error?: string;
      };
      if (res.status === 403) {
        setState({ bullets: null, message: data.error ?? "Not allowed.", loading: false });
        return;
      }
      if (data.kpis && onSummary) onSummary(data.kpis);
      setState(
        {
          bullets: data.bullets ?? null,
          message: data.message ?? data.error,
          loading: false,
        },
      );
    } catch {
      setState({
        bullets: null,
        message: "The AI summary is unavailable. The dashboard itself is unaffected.",
        loading: false,
      });
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-900">AI Summary</h2>
          {state.bullets && <AiBadge />}
        </div>
        <button
          type="button"
          onClick={summarize}
          disabled={state.loading}
          className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition hover:from-violet-500 hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {state.loading ? (
            <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="h-4 w-4" aria-hidden />
          )}
          {state.loading ? "Summarizing…" : state.bullets ? "Regenerate summary" : "Summarize with AI"}
        </button>
      </div>

      {state.loading && (
        <div className="mt-4 space-y-2" aria-live="polite">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-4 w-full animate-pulse rounded bg-slate-100" style={{ width: `${90 - i * 15}%` }} />
          ))}
        </div>
      )}

      {!state.loading && state.bullets && (
        <ul className="mt-4 space-y-2.5">
          {state.bullets.map((bullet, i) => (
            <li key={i} className="flex gap-2 text-sm leading-6 text-slate-700">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" aria-hidden />
              {bullet}
            </li>
          ))}
        </ul>
      )}

      {!state.loading && !state.bullets && state.message && (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-200">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {state.message}
        </p>
      )}

      {!state.loading && !state.bullets && !state.message && (
        <p className="mt-4 text-sm text-slate-500">
          Generate 3–5 insight bullets grounded strictly in the dashboard KPI JSON for the current filters.
        </p>
      )}
    </section>
  );
}
