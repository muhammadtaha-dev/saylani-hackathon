/**
 * HCM Lite — permission layer (Art. III.3, Art. I.4).
 *
 * ONE permission system: the same matrix guards the REST API and every AI
 * tool call. A denied call returns a structured `forbidden` result and the
 * model turns it into a polite refusal — the refusal is identical whether or
 * not the protected record exists (CHAT-07).
 */

import type { LeaveType, Role } from "./hcmData";

export const TOOL_NAMES = [
  "get_headcount",
  "get_attendance_summary",
  "get_late_comers",
  "get_leave_summary",
  "get_my_leave_balance",
  "get_payroll_summary",
  "search_employees",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export type FeatureName = "chat" | "summary" | "smart_leave" | "policy" | "logs" | "dashboard";

const TOOL_MATRIX: Record<ToolName, Record<Role, boolean>> = {
  get_headcount: { admin: true, hr: true, employee: false },
  get_attendance_summary: { admin: true, hr: true, employee: true }, // employee => own record only
  get_late_comers: { admin: true, hr: true, employee: false },
  get_leave_summary: { admin: true, hr: true, employee: false },
  get_my_leave_balance: { admin: true, hr: true, employee: true }, // own, no user parameter
  get_payroll_summary: { admin: true, hr: true, employee: false },
  search_employees: { admin: true, hr: true, employee: true }, // safe fields only
};

export interface SessionIdentity {
  userId: string;
  name: string;
  role: Role;
  department: string;
}

export interface PermissionDecision {
  allowed: boolean;
  /** Restriction applied to the call, e.g. employee attendance is scoped to own records. */
  restriction?: "own_record_only";
  reason?: string;
}

/** role x tool x arguments check — runs BEFORE any tool executes. */
export function checkToolPermission(
  role: Role,
  tool: ToolName
): PermissionDecision {
  const allowed = TOOL_MATRIX[tool][role];
  if (!allowed) {
    return {
      allowed: false,
      reason: `Role '${role}' is not authorized to use '${tool}'.`,
    };
  }
  if (role === "employee" && tool === "get_attendance_summary") {
    return { allowed: true, restriction: "own_record_only" };
  }
  return { allowed: true };
}

/** Feature-level access (Spec 3.2). Enforced server-side on every endpoint. */
export function checkFeaturePermission(
  role: Role,
  feature: FeatureName
): boolean {
  switch (feature) {
    case "chat":
    case "policy":
      return true;
    case "summary":
    case "logs":
      return role === "admin" || role === "hr";
    case "smart_leave":
      return role === "employee";
    case "dashboard":
      return true; // KPI shape is filtered per role inside the dashboard route
  }
}

// ---------------------------------------------------------------------------
// Pre-model request guard (Art. III.6: refusal at the permission layer,
// without even reaching the model's discretion).
// ---------------------------------------------------------------------------

export const SALARY_REFUSAL =
  "I am not authorized to disclose other employees' salary information. Individual compensation details are confidential; please contact HR if you need anything specific.";
export const INJECTION_REFUSAL =
  "I can't do that. I only follow the HCM Lite assistant rules, and I can't reveal confidential records. Is there something about headcount, attendance or leave I can help with?";
export const GENERIC_REFUSAL =
  "I'm not authorized to share that information. Please check with HR.";

const AGGREGATE_HINTS =
  /\b(total|average|avg|sum|aggregate|aggregated|summary|cost|spend|spending|headcount|breakdown|overall)\b/i;

const SENSITIVE_INDIVIDUAL =
  /\b(salary|salaries|wage|wages|pay|paid|earnings|earning|compensation|cnic|bank account|bank details|account number)\b/i;

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+|your\s+|these\s+|any\s+|the\s+|previous\s+|above\s+)*(rules|instructions|prompts?|policies|restrictions|guardrails)/i,
  /disregard\s+(all\s+|your\s+|the\s+|previous\s+)*(rules|instructions|prompts?|policies)/i,
  /\b(system\s+prompt|initial\s+instructions?|developer\s+mode|god\s+mode|jailbreak)\b/i,
  /you\s+are\s+now\s+(a|an|free|unrestricted|dan)/i,
  /\bpretend\b.*\b(no|without)\b.*\brules\b/i,
  /\boverride\b.*\b(rules|instructions|policy)/i,
  /\b(act\s+as|reveal|show\s+me)\b.*\b(system\s+prompt|hidden\s+instructions?|api\s+key)\b/i,
  /\bapi\s+key\b/i,
];

export interface GuardResult {
  blocked: boolean;
  kind?: "salary" | "injection" | "sensitive_pii";
  message?: string;
}

/**
 * Classify a raw user request BEFORE it reaches the model or any tool.
 * Individual-salary requests are refused for every role; aggregate payroll
 * questions remain available to authorised roles via get_payroll_summary.
 */
export function guardRequest(text: string): GuardResult {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return { blocked: true, kind: "injection", message: INJECTION_REFUSAL };
    }
  }
  if (SENSITIVE_INDIVIDUAL.test(text) && !AGGREGATE_HINTS.test(text)) {
    return { blocked: true, kind: "salary", message: SALARY_REFUSAL };
  }
  if (/\b(cnic|national identity|bank account|bank details)\b/i.test(text)) {
    return { blocked: true, kind: "sensitive_pii", message: GENERIC_REFUSAL };
  }
  return { blocked: false };
}

/** Allowed leave types for argument validation. */
export function isLeaveType(value: string): value is LeaveType {
  return ["annual", "sick", "casual"].includes(value);
}
