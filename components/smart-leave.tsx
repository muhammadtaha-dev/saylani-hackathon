"use client";

import { useState } from "react";
import { Wand2, CheckCircle2, ShieldAlert, RotateCcw } from "lucide-react";
import { AiBadge } from "./ai-badge";
import type { LeaveSuggestionClient } from "./types";

/**
 * Smart Leave (LEAVE-01..LEAVE-07): plain language -> AI suggestion ->
 * pre-filled form marked "AI-suggested" -> the user confirms via the
 * standard leave endpoint. The AI never submits anything itself.
 */
export function SmartLeave({ onSubmitted }: { onSubmitted: () => void }) {
  const [description, setDescription] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [aiSuggested, setAiSuggested] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "info" | "success"; text: string } | null>(null);
  const [form, setForm] = useState({ type: "casual", start: "", end: "", reason: "" });
  const [submitting, setSubmitting] = useState(false);
  const [riskNote, setRiskNote] = useState<string | null>(null);

  function resetForm() {
    setAiSuggested(false);
    setRiskNote(null);
    setForm({ type: "casual", start: "", end: "", reason: "" });
  }

  async function suggest() {
    const text = description.trim();
    if (!text || suggesting) return;
    setSuggesting(true);
    setNotice(null);
    try {
      const res = await fetch("/api/ai/smart-leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = (await res.json()) as {
        suggestion?: LeaveSuggestionClient;
        fallback?: boolean;
        message?: string;
        error?: string;
      };
      if (!res.ok) {
        setNotice({ tone: "error", text: data.error ?? "Please try again." });
        return;
      }
      if (data.fallback || !data.suggestion) {
        // Manual-form fallback: brief message, blank form, no raw errors.
        resetForm();
        setNotice({ tone: "info", text: data.message ?? "Please fill the form manually below." });
        return;
      }
      const s = data.suggestion;
      setForm({ type: s.type, start: s.start, end: s.end, reason: s.reason });
      setAiSuggested(true);
      setRiskNote(null);
      setNotice(
        s.warnings && s.warnings.length > 0
          ? { tone: "info", text: s.warnings.join(" ") }
          : null
      );
    } catch {
      resetForm();
      setNotice({ tone: "info", text: "The AI helper is unavailable. Please fill the form manually below." });
    } finally {
      setSuggesting(false);
    }
  }

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const res = await fetch("/api/leaves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await res.json()) as {
        request?: { id: string };
        warnings?: string[];
        risk_note?: string;
        error?: string;
      };
      if (!res.ok) {
        setNotice({ tone: "error", text: data.error ?? "Could not submit the leave request." });
        return;
      }
      setNotice({
        tone: "success",
        text: `Leave request ${data.request?.id ?? ""} submitted — it is now pending approval by HR.`,
      });
      setRiskNote(data.risk_note ?? null);
      setDescription("");
      resetForm();
      onSubmitted();
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Smart Leave</h2>
        {aiSuggested && <AiBadge suggested />}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Describe your leave in plain words — the AI pre-fills the form, you confirm. Nothing is submitted without
        your explicit confirmation.
      </p>

      <div className="mt-3 flex gap-2">
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          placeholder={'e.g. "I need next Monday and Tuesday off for my sister\'s wedding"'}
          aria-label="Describe your leave in plain words"
          className="h-10 flex-1 rounded-lg border border-slate-200 px-3 text-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
        />
        <button
          type="button"
          onClick={suggest}
          disabled={suggesting || !description.trim()}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 px-3.5 text-sm font-medium text-white transition hover:from-violet-500 hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Wand2 className={`h-4 w-4 ${suggesting ? "animate-pulse" : ""}`} aria-hidden />
          {suggesting ? "Thinking…" : "Suggest with AI"}
        </button>
      </div>

      {notice && (
        <p
          className={`mt-3 flex items-start gap-2 rounded-lg p-3 text-sm ring-1 ${
            notice.tone === "error"
              ? "bg-rose-50 text-rose-800 ring-rose-200"
              : notice.tone === "success"
                ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                : "bg-amber-50 text-amber-800 ring-amber-200"
          }`}
        >
          {notice.tone === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          )}
          {notice.text}
        </p>
      )}

      {riskNote && !notice && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-sky-50 p-3 text-sm text-sky-800 ring-1 ring-sky-200" role="status">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            <strong>Approval outlook: </strong>
            {riskNote}
          </span>
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Leave type</span>
          <select
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
            className={inputClass}
            aria-label="Leave type"
          >
            <option value="casual">Casual</option>
            <option value="sick">Sick</option>
            <option value="annual">Annual</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Reason</span>
          <input
            value={form.reason}
            onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            maxLength={200}
            placeholder="Reason for leave"
            className={inputClass}
            aria-label="Reason for leave"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Start date</span>
          <input
            type="date"
            value={form.start}
            onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))}
            className={inputClass}
            aria-label="Leave start date"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">End date</span>
          <input
            type="date"
            value={form.end}
            onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))}
            className={inputClass}
            aria-label="Leave end date"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !form.start || !form.end || !form.reason.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          {submitting ? "Submitting…" : "Confirm & Submit"}
        </button>
        <button
          type="button"
          onClick={() => {
            resetForm();
            setNotice(null);
          }}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          Clear form
        </button>
      </div>
    </section>
  );
}
