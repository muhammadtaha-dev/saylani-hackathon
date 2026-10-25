/**
 * POST /api/ai/dashboard-summary — 3–5 KPI insight bullets (Spec 7.2, SUM).
 * Admin/HR/Manager (403 otherwise). The server RECOMPUTES the KPI JSON via
 * the shared services running with the caller's JWT (RLS scopes a manager's
 * numbers to their team), then applies the post-generation number check:
 * every number in every bullet must exist in the KPI input or be a trivially
 * derived percentage/difference (SUM-04). Fewer than 3 grounded bullets after
 * one regeneration => no summary (SUM-05).
 */

import { AI_ENABLED, generateWithTimeout, getJsonModel, AiTimeoutError } from "@/lib/gemini";
import { appendAuditEvent } from "@/lib/audit";
import { checkFeaturePermission } from "@/lib/permissions";
import { buildSummarySystemPrompt, buildSummaryUserPrompt, POLICY_VERSION } from "@/lib/prompt";
import { checkRateLimit, RATE_LIMIT } from "@/lib/rateLimit";
import { requireSession } from "@/lib/session";
import { supabaseServer, supabaseConfigured } from "@/lib/supabase/server";
import { getDashboardKpis, type DashboardKpis } from "@/lib/services";

const FALLBACK =
  "The AI summary is unavailable right now. The dashboard itself is unaffected — please try again in a moment.";

function collectNumbers(value: unknown, sink: number[]): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    sink.push(value);
  } else if (typeof value === "string") {
    for (const m of value.match(/\d+(?:\.\d+)?/g) ?? []) sink.push(Number(m));
  } else if (Array.isArray(value)) {
    for (const item of value) collectNumbers(item, sink);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectNumbers(item, sink);
  }
}

function extractNumbersFromText(text: string): number[] {
  const matches = text.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? [];
  return matches.map((m) => Number(m.replace(/,/g, ""))).filter(Number.isFinite);
}

function bulletIsGrounded(bullet: string, kpis: DashboardKpis): boolean {
  const inputNumbers: number[] = [];
  collectNumbers(kpis, inputNumbers);
  const allowed = new Set<number>(inputNumbers);
  for (const a of inputNumbers) {
    for (const b of inputNumbers) {
      allowed.add(Math.round((a - b) * 10) / 10);
      allowed.add(Math.round((a + b) * 10) / 10);
      if (b !== 0) allowed.add(Math.round((a / b) * 1000) / 10);
    }
  }
  const numbersInBullet = extractNumbersFromText(bullet);
  if (numbersInBullet.length === 0) return false;
  return numbersInBullet.every((n) => [...allowed].some((v) => Math.abs(v - n) < 0.05));
}

function parseBullets(raw: string): string[] {
  const parsed = JSON.parse(raw) as { bullets?: unknown };
  if (!Array.isArray(parsed.bullets)) return [];
  return parsed.bullets
    .filter((b): b is string => typeof b === "string" && b.trim().length > 0)
    .map((b) => b.trim());
}

function pkr(amount: number): string {
  return `PKR ${amount.toLocaleString("en-US")}`;
}

function mockSummaryBullets(kpis: DashboardKpis): string[] {
  const scope = kpis.scope_note;
  const bullets = [
    `Headcount: ${kpis.headcount_active} active employees ${scope} as of ${kpis.as_of_date}.`,
    `Attendance in ${kpis.attendance_this_month.label}: ${kpis.attendance_this_month.attendance_rate}% over ${kpis.attendance_this_month.working_days} recorded working days (${kpis.attendance_this_month.present} present + ${kpis.attendance_this_month.late} late, ${kpis.attendance_this_month.absent} absent).`,
    `Today (${kpis.today.date}): ${kpis.today.present} present, ${kpis.today.late} late and ${kpis.today.on_leave} on leave.`,
  ];
  if (kpis.latecomers_top.length > 0) {
    bullets.push(
      `Top latecomer in ${kpis.attendance_this_month.label}: ${kpis.latecomers_top[0].name} with ${kpis.latecomers_top[0].late_count} late arrivals.`
    );
  }
  if (kpis.payroll) {
    bullets.push(
      `Payroll for ${kpis.payroll.label}: ${pkr(kpis.payroll.total)} monthly total for ${kpis.payroll.headcount} active employees (average ${pkr(kpis.payroll.average)}).`
    );
  }
  return bullets.slice(0, 5);
}

export async function POST(request: Request) {
  if (!supabaseConfigured()) {
    return Response.json({ configured: false, error: "The database is not configured yet." }, { status: 503 });
  }
  const auth = await requireSession();
  if ("response" in auth) return auth.response;
  const started = Date.now();
  const supabase = await supabaseServer();

  if (!checkFeaturePermission(auth.session.role, "summary")) {
    appendAuditEvent({
      action: "ai_permission_denied",
      actor: { userId: auth.session.userId, name: auth.session.name, role: auth.session.role },
      targetType: "ai_request",
      targetId: "dashboard-summary",
      details: { feature: "summary", guard: "forbidden_role" },
    });
    return Response.json(
      { error: "The AI summary is restricted to Admin, HR and managers." },
      { status: 403 }
    );
  }

  const rate = checkRateLimit(auth.session.userId);
  if (!rate.allowed) {
    appendAuditEvent({
      action: "ai_call",
      actor: { userId: auth.session.userId, name: auth.session.name, role: auth.session.role },
      targetType: "ai_request",
      targetId: "dashboard-summary",
      details: { feature: "summary", outcome: "rate_limited", error_code: "rate_limited" },
    });
    return Response.json(
      { error: `You've reached the limit of ${RATE_LIMIT} assistant requests per hour. Please try again later.` },
      { status: 429 }
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { filters?: { department?: unknown } }
    | null;
  const departmentParam = typeof body?.filters?.department === "string" ? body.filters.department : undefined;
  const department =
    departmentParam && departmentParam !== "All" ? departmentParam : undefined;

  // The server recomputes the KPI JSON itself (Spec 7.2), scoped by RLS.
  const kpis = await getDashboardKpis(supabase, auth.session, department);
  const kpisJson = JSON.stringify(kpis, null, 2);

  let provider: "gemini" | "mock" = "mock";
  let promptTokens = 0;
  let completionTokens = 0;
  let errorCode: string | null = null;
  let bullets: string[] | null = null;

  try {
    if (!AI_ENABLED) {
      const candidates = mockSummaryBullets(kpis);
      const grounded = candidates.filter((b) => bulletIsGrounded(b, kpis));
      bullets = grounded.length >= 3 ? grounded : null;
      if (!bullets) errorCode = "number_check_failed";
      provider = "mock";
      completionTokens = (bullets ?? []).join(" ").length / 4;
    } else {
      provider = "gemini";
      const model = getJsonModel(buildSummarySystemPrompt());
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await generateWithTimeout(model, buildSummaryUserPrompt(kpisJson));
        promptTokens += result.response.usageMetadata?.promptTokenCount ?? 0;
        completionTokens += result.response.usageMetadata?.candidatesTokenCount ?? 0;
        const raw = result.response.text?.() ?? "";
        let candidates: string[] = [];
        try {
          candidates = parseBullets(raw);
        } catch {
          errorCode = "malformed_json";
          continue; // one retry for malformed structured output (NFR-08)
        }
        const grounded = candidates.filter((b) => bulletIsGrounded(b, kpis));
        if (grounded.length >= 3) {
          bullets = grounded.slice(0, 5);
          break;
        }
        errorCode = "number_check_failed";
      }
    }
  } catch (err) {
    // Fail soft: provider down/timeout -> deterministic grounded bullets.
    errorCode = err instanceof AiTimeoutError ? "ai_timeout" : "provider_error";
    console.error(`[hcm] AI summary provider failure for ${auth.session.userId}:`, err);
    const candidates = mockSummaryBullets(kpis);
    const grounded = candidates.filter((b) => bulletIsGrounded(b, kpis));
    if (grounded.length >= 3) {
      bullets = grounded;
      provider = "mock";
    }
  }

  appendAuditEvent({
    action: "ai_call",
    actor: { userId: auth.session.userId, name: auth.session.name, role: auth.session.role },
    targetType: "ai_request",
    targetId: "dashboard-summary",
    details: {
      feature: "summary",
      outcome: bullets ? "answered" : "validation_failed",
      latency_ms: Date.now() - started,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      provider,
      error_code: errorCode,
    },
  });

  if (!bullets) {
    return Response.json({
      bullets: null,
      message: FALLBACK,
      ai_generated: false,
      kpis,
      meta: { policy_version: POLICY_VERSION, provider: AI_ENABLED ? "gemini" : "mock" },
    });
  }

  return Response.json({
    bullets,
    ai_generated: true,
    kpis,
    meta: { policy_version: POLICY_VERSION, provider: AI_ENABLED ? "gemini" : "mock" },
  });
}
