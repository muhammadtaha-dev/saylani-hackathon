/**
 * POST /api/ai/smart-leave — natural language -> pre-filled leave suggestion
 * (Spec 7.3, LEAVE). Employees and managers (403 otherwise). The server
 * independently resolves relative dates, validates against the DB's holiday
 * calendar, balance and team overlap; on retryable failure the model is
 * retried ONCE, then the manual form fallback is returned. The AI never
 * submits — the user confirms in the UI (LEAVE-07).
 */

import { AI_ENABLED, generateWithTimeout, getJsonModel, AiTimeoutError } from "@/lib/gemini";
import { appendAuditEvent } from "@/lib/audit";
import { checkFeaturePermission } from "@/lib/permissions";
import { buildSmartLeaveSystemPrompt, buildSmartLeaveUserPrompt, POLICY_VERSION } from "@/lib/prompt";
import { checkRateLimit, RATE_LIMIT } from "@/lib/rateLimit";
import { requireSession } from "@/lib/session";
import { supabaseServer, supabaseConfigured } from "@/lib/supabase/server";
import {
  getHolidaysBetween,
  getMyLeaveBalanceService,
  getTeamOverlapService,
  TIMEZONE,
  todayIso,
} from "@/lib/services";
import {
  inferLeaveType,
  inferReason,
  resolveRelativeDates,
  validateSuggestion,
  workingDaysBetween,
  type LeaveSuggestion,
} from "@/lib/smartLeave";

const MANUAL_FORM_MESSAGE =
  "I couldn't work out the exact details from that sentence. The manual leave form below is ready for you — nothing has been submitted.";

interface SuggestionResponse {
  suggestion?: LeaveSuggestion & { warnings: string[] };
  fallback?: boolean;
  message?: string;
  ai_suggested?: boolean;
  meta: { policy_version: string; provider: string; timezone: string };
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  if (!supabaseConfigured()) {
    return Response.json({ configured: false, error: "The database is not configured yet." }, { status: 503 });
  }
  const auth = await requireSession();
  if ("response" in auth) return auth.response;
  const started = Date.now();
  const supabase = await supabaseServer();

  if (!checkFeaturePermission(auth.session.role, "smart_leave")) {
    appendAuditEvent({
      action: "ai_permission_denied",
      actor: { userId: auth.session.userId, name: auth.session.name, role: auth.session.role },
      targetType: "ai_request",
      targetId: "smart-leave",
      details: { feature: "smart_leave", guard: "forbidden_role" },
    });
    return Response.json(
      { error: "Smart Leave is available to employees and managers." },
      { status: 403 }
    );
  }

  const rate = checkRateLimit(auth.session.userId);
  if (!rate.allowed) {
    appendAuditEvent({
      action: "ai_call",
      actor: { userId: auth.session.userId, name: auth.session.name, role: auth.session.role },
      targetType: "ai_request",
      targetId: "smart-leave",
      details: { feature: "smart_leave", outcome: "rate_limited", error_code: "rate_limited" },
    });
    return Response.json(
      { error: `You've reached the limit of ${RATE_LIMIT} assistant requests per hour. Please try again later.` },
      { status: 429 }
    );
  }

  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > 500) {
    return Response.json(
      { error: "Please describe your leave in 1 to 500 characters." },
      { status: 400 }
    );
  }

  const today = todayIso();
  // Holidays for the next ~15 months cover any reasonable requested range.
  const holidays = await getHolidaysBetween(
    supabase,
    today,
    addDaysIso(today, 460)
  );
  const warnings: string[] = [];
  let provider: "gemini" | "mock" = "mock";
  let errorCode: string | null = null;

  let suggestion: (LeaveSuggestion & { warnings: string[] }) | null = null;
  let providerFailed = false;

  const finishWithFallback = (message: string, code: string) => {
    appendAuditEvent({
      action: "ai_call",
      actor: { userId: auth.session.userId, name: auth.session.name, role: auth.session.role },
      targetType: "ai_request",
      targetId: "smart-leave",
      details: { feature: "smart_leave", outcome: "fallback", provider, error_code: code, latency_ms: Date.now() - started },
    });
    const response: SuggestionResponse = {
      fallback: true,
      message,
      meta: { policy_version: POLICY_VERSION, provider: AI_ENABLED ? "gemini" : "mock", timezone: TIMEZONE },
    };
    return Response.json(response);
  };

  // Server-side relative-date resolution happens FIRST and is authoritative.
  const serverDates = resolveRelativeDates(text, today);

  const applyDates = (candidate: LeaveSuggestion): LeaveSuggestion => {
    if (serverDates) {
      if (candidate.start !== serverDates.start || candidate.end !== serverDates.end) {
        warnings.push(
          `Dates verified server-side for "${serverDates.matched.join(", ")}": ${serverDates.start} to ${serverDates.end}.`
        );
      }
      return { ...candidate, start: serverDates.start, end: serverDates.end };
    }
    return candidate;
  };

  if (AI_ENABLED) {
    provider = "gemini";
    try {
      const model = getJsonModel(buildSmartLeaveSystemPrompt(), 300);
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await generateWithTimeout(model, buildSmartLeaveUserPrompt(text));
        const raw = result.response.text?.() ?? "";
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          errorCode = "malformed_json";
          continue; // retry once
        }
        const validation = validateSuggestion(parsed, today, holidays);
        if (!validation.ok) {
          errorCode = `validation_${validation.stage}`;
          if (validation.severity === "manual") break;
          continue; // retry once
        }
        const candidate = parsed as LeaveSuggestion;
        suggestion = { ...applyDates(candidate), warnings };
        break;
      }
    } catch (err) {
      providerFailed = true;
      errorCode = err instanceof AiTimeoutError ? "ai_timeout" : "provider_error";
      console.error(`[hcm] smart-leave provider failure for ${auth.session.userId}:`, err);
    }
  }

  // Deterministic fallback parser (no key, or the model failed after retry).
  if (!suggestion) {
    const type = inferLeaveType(text);
    if (serverDates) {
      const validation = validateSuggestion(
        { type, start: serverDates.start, end: serverDates.end, reason: "" },
        today,
        holidays
      );
      if (validation.ok) {
        suggestion = {
          type,
          start: serverDates.start,
          end: serverDates.end,
          reason: inferReason(text),
          warnings: [...warnings, ...validation.warnings],
        };
        if (AI_ENABLED) errorCode = errorCode ?? "model_fell_back_to_parser";
      }
    }
    if (!suggestion) {
      return finishWithFallback(
        MANUAL_FORM_MESSAGE,
        providerFailed ? errorCode ?? "provider_error" : "unresolved_dates"
      );
    }
    provider = providerFailed ? "mock" : AI_ENABLED ? "gemini" : "mock";
  }

  // Balance check -> pre-fill with a warning (Spec §8.8).
  const year = Number(suggestion.start.slice(0, 4));
  const balance = (await getMyLeaveBalanceService(supabase, auth.session.userId, year)).balances.find(
    (b) => b.type === suggestion!.type
  );
  const requestedWorkingDays = workingDaysBetween(
    suggestion.start,
    suggestion.end,
    new Set(holidays.keys())
  );
  if (balance && requestedWorkingDays > balance.remaining) {
    suggestion.warnings.push(
      `This request needs ${requestedWorkingDays} working day(s) but only ${balance.remaining} ${suggestion.type} day(s) remain after approved leaves (${balance.pending} pending are not deducted). HR will see this when reviewing.`
    );
  }

  // Team overlap (D.17) via the DB RPC (directory-level info only).
  try {
    const overlap = await getTeamOverlapService(supabase, suggestion.start, suggestion.end);
    if (overlap.offCount > 0) {
      suggestion.warnings.push(
        `${overlap.offCount} of your ${overlap.teamSize} teammates are already approved off during those dates (${overlap.offNames.map((o) => o.name).join(", ")}).`
      );
    }
  } catch {
    // overlap info is advisory; never fail the suggestion on it
  }

  appendAuditEvent({
    action: "ai_call",
    actor: { userId: auth.session.userId, name: auth.session.name, role: auth.session.role },
    targetType: "ai_request",
    targetId: "smart-leave",
    details: {
      feature: "smart_leave",
      outcome: "answered",
      provider,
      error_code: errorCode,
      latency_ms: Date.now() - started,
    },
  });

  return Response.json({
    suggestion: { ...suggestion, warnings: suggestion.warnings },
    ai_suggested: true,
    meta: {
      policy_version: POLICY_VERSION,
      provider: AI_ENABLED ? "gemini" : "mock",
      timezone: TIMEZONE,
    },
  });
}
