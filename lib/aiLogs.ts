/**
 * HCM Lite — ai_logs: the append-only audit trail (Art. IX, Spec §10).
 *
 * One row is written for EVERY AI call — successful or not. Logs never
 * contain the API key; sensitive values (salary, personal identifiers) are
 * redacted or omitted from logged payloads. Read access is Admin-only and is
 * enforced in the logs API route, not here.
 */

import type { Role } from "./hcmData";
import { POLICY_VERSION } from "./services";

export type AiFeature = "chat" | "summary" | "smart_leave" | "policy";
export type AiToolStatus = "ok" | "forbidden" | "error";
export type AiOutcome =
  | "answered"
  | "refused"
  | "fallback"
  | "rate_limited"
  | "timeout"
  | "validation_failed";

export interface AiLogRow {
  id: string;
  created_at: string;
  user_id: string;
  user_name: string;
  role: Role;
  feature: AiFeature;
  tool_name: string | null;
  tool_args: Record<string, unknown> | null;
  tool_status: AiToolStatus | null;
  outcome: AiOutcome;
  latency_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  policy_version: string;
  provider: "gemini" | "mock" | "none";
  error_code: string | null;
}

export interface AiLogInput {
  feature: AiFeature;
  tool_name?: string | null;
  tool_args?: unknown;
  tool_status?: AiToolStatus | null;
  outcome: AiOutcome;
  latency_ms?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  provider?: "gemini" | "mock" | "none";
  error_code?: string | null;
}

/** Keys that are safe to record. Everything else is dropped from tool_args. */
const SAFE_ARG_KEYS = new Set([
  "department",
  "status",
  "period",
  "limit",
  "query",
  "type",
  "year",
]);

const SENSITIVE_TEXT = /\b(salary|salaries|wage|wages|earnings|compensation|cnic|bank\s*account|bank\s*details)\b/i;

function redactString(value: string): string {
  return SENSITIVE_TEXT.test(value) ? "[REDACTED]" : value;
}

/** Sanitise tool arguments before they touch the log. */
export function sanitizeToolArgs(args: unknown): Record<string, unknown> | null {
  if (!args || typeof args !== "object") return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (!SAFE_ARG_KEYS.has(key)) continue; // omit, never log unknown fields
    if (typeof value === "string") out[key] = redactString(value);
    else if (typeof value === "number" || typeof value === "boolean") out[key] = value;
    else out[key] = "[OMITTED]";
  }
  return Object.keys(out).length ? out : null;
}

const MAX_ROWS = 500;
const rows: AiLogRow[] = [];

export function appendAiLog(
  session: { userId: string; name: string; role: Role },
  input: AiLogInput
): AiLogRow {
  const row: AiLogRow = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    user_id: session.userId,
    user_name: session.name,
    role: session.role,
    feature: input.feature,
    tool_name: input.tool_name ?? null,
    tool_args: sanitizeToolArgs(input.tool_args),
    tool_status: input.tool_status ?? null,
    outcome: input.outcome,
    latency_ms: Math.round(input.latency_ms ?? 0),
    prompt_tokens: Math.round(input.prompt_tokens ?? 0),
    completion_tokens: Math.round(input.completion_tokens ?? 0),
    policy_version: POLICY_VERSION,
    provider: input.provider ?? "none",
    error_code: input.error_code ?? null,
  };
  rows.push(row);
  if (rows.length > MAX_ROWS) rows.splice(0, rows.length - MAX_ROWS);
  return row;
}

/** Admin-only read; the enforcing route must check the role before calling. */
export function listAiLogs(limit = 100): AiLogRow[] {
  return rows.slice(-Math.min(Math.max(limit, 1), 500)).reverse();
}

export function countAiLogs(): number {
  return rows.length;
}
