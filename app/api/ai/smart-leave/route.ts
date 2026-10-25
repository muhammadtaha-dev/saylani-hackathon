/**
 * POST /api/ai/smart-leave — natural language -> pre-filled leave suggestion
 * (Spec 7.3, LEAVE). Employee-only (403 otherwise). The server independently
 * resolves relative dates from the current date/timezone and overrides any
 * mismatch; the validation pipeline runs in the spec's fixed order; on
 * retryable failure the model is retried ONCE, then the manual form fallback
 * is returned. The AI never submits — the user confirms in the UI (LEAVE-07).
 */

import { AI_ENABLED, generateWithTimeout, getJsonModel, AiTimeoutError } from "@/lib/gemini";
import { appendAiLog, type AiOutcome } from "@/lib/aiLogs";
import { checkFeaturePermission } from "@/lib/permissions";
import { buildSmartLeaveSystemPrompt, buildSmartLeaveUserPrompt, POLICY_VERSION } from "@/lib/prompt";
import { checkRateLimit, RATE_LIMIT } from "@/lib/rateLimit";
import { getSession } from "@/lib/session";
import {
  getMyLeaveBalanceService,
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

export async function POST(request: Request) {
  const started = Date.now();
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  if (!checkFeaturePermission(session.role, "smart_leave")) {
    appendAiLog(session, {
      feature: "smart_leave",
      outcome: "refused",
      latency_ms: Date.now() - started,
      provider: "none",
      error_code: "forbidden_role",
    });
    return Response.json(
      { error: "Smart Leave is available to employees only." },
      { status: 403 }
    );
  }

  const rate = checkRateLimit(session.userId);
  if (!rate.allowed) {
    appendAiLog(session, {
      feature: "smart_leave",
      outcome: "rate_limited",
      latency_ms: Date.now() - started,
      provider: "none",
      error_code: "rate_limited",
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
  const warnings: string[] = [];
  let outcome: AiOutcome = "answered";
  let provider: "gemini" | "mock" = "mock";
  let promptTokens = 0;
  let completionTokens = 0;
  let errorCode: string | null = null;

  let suggestion: (LeaveSuggestion & { warnings: string[] }) | null = null;
  let providerFailed = false;

  const finishWithFallback = (message: string, code: string, kind: AiOutcome) => {
    outcome = kind;
    errorCode = code;
    appendAiLog(session, {
      feature: "smart_leave",
      outcome,
      latency_ms: Date.now() - started,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      provider,
      error_code: errorCode,
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
        promptTokens += result.response.usageMetadata?.promptTokenCount ?? 0;
        completionTokens += result.response.usageMetadata?.candidatesTokenCount ?? 0;
        const raw = result.response.text?.() ?? "";
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          errorCode = "malformed_json";
          continue; // retry once
        }
        const validation = validateSuggestion(parsed, today);
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
      // Fail soft: record the failure and let the deterministic parser below
      // produce the suggestion instead of showing the user an error.
      providerFailed = true;
      outcome = err instanceof AiTimeoutError ? "timeout" : "fallback";
      errorCode = err instanceof AiTimeoutError ? "ai_timeout" : "provider_error";
    }
  }

  // Deterministic fallback parser (no key, or the model failed after retry).
  if (!suggestion) {
    const type = inferLeaveType(text);
    if (serverDates) {
      const validation = validateSuggestion(
        { type, start: serverDates.start, end: serverDates.end, reason: "" },
        today
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
        providerFailed ? errorCode ?? "provider_error" : "unresolved_dates",
        providerFailed ? outcome === "timeout" ? "timeout" : "fallback" : "validation_failed"
      );
    }
    provider = providerFailed ? "mock" : AI_ENABLED ? "gemini" : "mock";
  }

  // Balance check where applicable -> pre-fill with a warning (Spec §8.8).
  const year = Number(suggestion.start.slice(0, 4));
  const balance = getMyLeaveBalanceService(session.userId, year).balances.find(
    (b) => b.type === suggestion!.type
  );
  const requestedWorkingDays = workingDaysBetween(suggestion.start, suggestion.end);
  if (balance && requestedWorkingDays > balance.remaining) {
    suggestion.warnings.push(
      `This request needs ${requestedWorkingDays} working day(s) but only ${balance.remaining} ${suggestion.type} day(s) remain after approved leaves (${balance.pending} pending are not deducted). HR will see this when reviewing.`
    );
  }

  outcome = "answered";
  appendAiLog(session, {
    feature: "smart_leave",
    outcome,
    latency_ms: Date.now() - started,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    provider,
    error_code: errorCode,
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
