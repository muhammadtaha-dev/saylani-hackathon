/**
 * POST /api/ai/dashboard-summary — 3–5 KPI insight bullets (Spec 7.2, SUM).
 * Admin/HR only (403 for employees). The server RECOMPUTES the KPI JSON from
 * the shared services rather than trusting the client payload, then applies
 * the post-generation number check: every number in every bullet must exist
 * in the KPI input or be a trivially derived percentage/difference (SUM-04).
 * Fewer than 3 grounded bullets after one regeneration => no summary (SUM-05).
 */

import { AI_ENABLED, generateWithTimeout, getJsonModel, AiTimeoutError } from "@/lib/gemini";
import { appendAiLog, type AiOutcome } from "@/lib/aiLogs";
import { checkFeaturePermission } from "@/lib/permissions";
import { buildSummarySystemPrompt, buildSummaryUserPrompt, POLICY_VERSION } from "@/lib/prompt";
import { checkRateLimit, RATE_LIMIT } from "@/lib/rateLimit";
import { getSession } from "@/lib/session";
import { getDashboardKpis, type DashboardKpis } from "@/lib/services";
import { DEPARTMENTS, type DepartmentName } from "@/lib/hcmData";

const FALLBACK =
  "The AI summary is unavailable right now. The dashboard itself is unaffected — please try again in a moment.";

function collectNumbers(value: unknown, sink: number[]): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    sink.push(value);
  } else if (typeof value === "string") {
    // Numbers inside input strings (dates, period keys) are also grounded.
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

/**
 * Every number in a bullet must exist in the KPI input or be a trivially
 * derived percentage or difference of two input numbers.
 */
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
  if (numbersInBullet.length === 0) return false; // a bullet without a figure adds nothing
  return numbersInBullet.every((n) =>
    [...allowed].some((v) => Math.abs(v - n) < 0.05)
  );
}

function parseBullets(raw: string): string[] {
  const parsed = JSON.parse(raw) as { bullets?: unknown };
  if (!Array.isArray(parsed.bullets)) return [];
  return parsed.bullets
    .filter((b): b is string => typeof b === "string" && b.trim().length > 0)
    .map((b) => b.trim());
}

function mockSummaryBullets(kpis: DashboardKpis): string[] {
  const dept = kpis.filters.department;
  const scope = dept === "All departments" ? "across all departments" : `in ${dept}`;
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
  bullets.push(
    `Payroll for ${kpis.payroll.label}: ${pkr(kpis.payroll.total)} monthly total for ${kpis.payroll.headcount} active employees (average ${pkr(kpis.payroll.average)}).`
  );
  return bullets.slice(0, 5);
}

function pkr(amount: number): string {
  return `PKR ${amount.toLocaleString("en-US")}`;
}

export async function POST(request: Request) {
  const started = Date.now();
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  if (!checkFeaturePermission(session.role, "summary")) {
    appendAiLog(session, {
      feature: "summary",
      outcome: "refused",
      latency_ms: Date.now() - started,
      provider: "none",
      error_code: "forbidden_role",
    });
    return Response.json(
      { error: "The AI summary is restricted to Admin and HR." },
      { status: 403 }
    );
  }

  const rate = checkRateLimit(session.userId);
  if (!rate.allowed) {
    appendAiLog(session, {
      feature: "summary",
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

  const body = (await request.json().catch(() => null)) as
    | { filters?: { department?: unknown } }
    | null;
  const departmentParam = typeof body?.filters?.department === "string" ? body.filters.department : undefined;
  const department =
    departmentParam && (DEPARTMENTS as string[]).includes(departmentParam)
      ? (departmentParam as DepartmentName)
      : undefined;

  // The server recomputes the KPI JSON itself (Spec 7.2).
  const kpis = getDashboardKpis(department);
  const kpisJson = JSON.stringify(kpis, null, 2);

  let outcome: AiOutcome = "answered";
  let provider: "gemini" | "mock" = "mock";
  let promptTokens = 0;
  let completionTokens = 0;
  let errorCode: string | null = null;
  let bullets: string[] | null = null;

  try {
    if (!AI_ENABLED) {
      // Deterministic bullets are built from the KPI values themselves, but
      // they still go through the same post-generation number check.
      const candidates = mockSummaryBullets(kpis);
      const grounded = candidates.filter((b) => bulletIsGrounded(b, kpis));
      bullets = grounded.length >= 3 ? grounded : null;
      if (!bullets) {
        outcome = "validation_failed";
        errorCode = "number_check_failed";
      }
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
        outcome = "validation_failed";
      }
      if (!bullets) outcome = "validation_failed";
    }
  } catch (err) {
    // Fail soft: provider down/timeout -> deterministic grounded bullets.
    outcome = err instanceof AiTimeoutError ? "timeout" : "fallback";
    errorCode = err instanceof AiTimeoutError ? "ai_timeout" : "provider_error";
    const candidates = mockSummaryBullets(kpis);
    const grounded = candidates.filter((b) => bulletIsGrounded(b, kpis));
    if (grounded.length >= 3) {
      bullets = grounded;
      provider = "mock";
    }
  }

  appendAiLog(session, {
    feature: "summary",
    outcome,
    latency_ms: Date.now() - started,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    provider,
    error_code: errorCode,
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
