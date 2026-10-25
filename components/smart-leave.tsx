"use client";

import { useRef, useState } from "react";
import { Wand2, CheckCircle2, ShieldAlert, RotateCcw, Paperclip } from "lucide-react";
import { AiBadge } from "./ai-badge";
import { supabaseBrowser, supabaseBrowserConfigured } from "@/lib/supabase/client";
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
  const [attachment, setAttachment] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetForm() {
    setAiSuggested(false);
    setRiskNote(null);
    setForm({ type: "casual", start: "", end: "", reason: "" });
    setAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  /**
   * Optional supporting document (Checklist D.15). Uploaded straight to the
   * private `leave-attachments` storage bucket under the caller's own folder
   * (per-user storage policy); the leave request stores only the path.
   */
  async function uploadAttachment(leaveId: string): Promise<string | null> {
    if (!attachment) return null;
    if (!supabaseBrowserConfigured()) {
      setNotice({ tone: "error", text: "Attachments need the database connection — submitting without the file." });
      return null;
    }
    const supabase = supabaseBrowser();
    if (!supabase) return null;
    setUploading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return null;
      const path = `${uid}/${leaveId}/${attachment.name.replace(/[^\w.\-() ]+/g, "_")}`;
      const { error } = await supabase.storage
        .from("leave-attachments")
        .upload(path, attachment, { upsert: true });
      if (error) {
        setNotice({ tone: "error", text: `Attachment upload failed (${error.message}) — submitting without the file.` });
        return null;
      }
      return `leave-attachments/${path}`;
    } finally {
      setUploading(false);
    }
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
      // A client-generated id lets the attachment land in the request's own
      // folder before the request row exists.
      const leaveId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `lr-${Date.now()}`;
      const attachmentPath = await uploadAttachment(leaveId);
      const res = await fetch("/api/leaves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: leaveId, ...form, attachment_path: attachmentPath }),
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
        text: `Leave request submitted — it is now pending approval by HR.${attachmentPath ? " Your attachment is linked." : ""}`,
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

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={submitting || uploading || !form.start || !form.end || !form.reason.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          {submitting || uploading ? "Submitting…" : "Confirm & Submit"}
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
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50">
          <Paperclip className="h-3.5 w-3.5" aria-hidden />
          {attachment ? attachment.name.slice(0, 24) : "Attach document (optional)"}
          <input
            ref={fileInputRef}
            type="file"
            className="sr-only"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
            onChange={(e) => setAttachment(e.target.files?.[0] ?? null)}
            aria-label="Attach a supporting document (PDF or image, max 5 MB)"
          />
        </label>
      </div>
    </section>
  );
}
