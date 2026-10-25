/**
 * HCM Lite — permission layer (Art. III.3, Art. I.4).
 *
 * ONE permission system: the same matrix guards the REST API and every AI
 * tool call. Roles: employee | manager | hr | admin.
 *   - Employee: own rows only.
 *   - Manager:  direct reports (Row Level Security scopes the data; this
 *               matrix decides which tools/questions are even attempted).
 *   - HR/Admin: everything.
 * A denied call returns a structured `forbidden` result, is appended to the
 * audit trail, and the model turns it into a polite refusal — the refusal is
 * identical whether or not the protected record exists (CHAT-07).
 */

export const TOOL_NAMES = [
  "get_headcount",
  "get_attendance_summary",
  "get_late_comers",
  "get_leave_summary",
  "get_my_leave_balance",
  "get_payroll_summary",
  "search_employees",
  "get_on_leave_today",
  "get_pending_leave_requests",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export type FeatureName = "chat" | "summary" | "smart_leave" | "policy" | "logs" | "dashboard";

export type Role = "employee" | "manager" | "hr" | "admin";

const TOOL_MATRIX: Record<ToolName, Record<Role, boolean>> = {
  // Manager sees org aggregates but RLS narrows every query to own + direct
  // reports, so a manager's "attendance this month" is their team's.
  get_headcount: { admin: true, hr: true, manager: true, employee: false },
  get_attendance_summary: { admin: true, hr: true, manager: true, employee: true }, // employee => own record only
  get_late_comers: { admin: true, hr: true, manager: true, employee: false },
  get_leave_summary: { admin: true, hr: true, manager: true, employee: false },
  get_my_leave_balance: { admin: true, hr: true, manager: true, employee: true }, // own, no user parameter
  get_payroll_summary: { admin: true, hr: true, manager: false, employee: false },
  search_employees: { admin: true, hr: true, manager: true, employee: true }, // safe fields only
  // Directory-level "who is away" — names and dates only, no personal details.
  get_on_leave_today: { admin: true, hr: true, manager: true, employee: true },
  // The approval queue is an HR/Admin/Manager surface; employees are refused
  // and the denial is audit-logged.
  get_pending_leave_requests: { admin: true, hr: true, manager: true, employee: false },
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
  restriction?: "own_record_only" | "team_scope";
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
  if (role === "manager") {
    // Every manager query is narrowed to own + direct reports by RLS; the
    // service layer also applies the scope filter explicitly.
    return { allowed: true, restriction: "team_scope" };
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
      // Managers get the AI summary; RLS scopes its numbers to their team.
      return role === "admin" || role === "hr" || role === "manager";
    case "logs":
      // The full audit trail view stays HR/Admin (E.23); others see their own
      // entries via the audit API's RLS scoping.
      return role === "admin" || role === "hr";
    case "smart_leave":
      return role === "employee" || role === "manager";
    case "dashboard":
      return true; // KPI shape is filtered per role inside the dashboard route
  }
}

export function canDecideLeave(role: Role): boolean {
  return role === "admin" || role === "hr" || role === "manager";
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
  /\b(salary|salaries|wage|wages|pay|paid|earnings|earning|compensation|cnic|bank account|bank details|account number)\b|تنخواہ|تنخواه|tanq?wa|tankhwa|tankha/i;

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
export function isLeaveType(value: string): value is "annual" | "sick" | "casual" {
  return ["annual", "sick", "casual"].includes(value);
}

// ---------------------------------------------------------------------------
// User management permissions: Admin manages HR/Manager/Employee; HR manages
// Employees. Managers do not manage accounts through this surface.
// ---------------------------------------------------------------------------

export function canManageUser(actor: Role, targetRole: Role): boolean {
  if (actor === "admin") {
    return targetRole === "hr" || targetRole === "manager" || targetRole === "employee";
  }
  if (actor === "hr") return targetRole === "employee";
  return false;
}

export function canListUsers(actor: Role): boolean {
  return actor === "admin" || actor === "hr";
}
