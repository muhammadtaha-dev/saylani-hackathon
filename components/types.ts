/** Shared client-side types mirroring the API contracts (Spec §7). */

export type Role = "admin" | "hr" | "employee";

export interface SessionInfo {
  userId: string;
  name: string;
  role: Role;
  department: string;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  designation: string;
}

export interface DashboardKpis {
  filters: { department: string; period: string };
  as_of_date: string;
  timezone: string;
  headcount_active: number;
  headcount_by_department: Record<string, number>;
  today: { date: string; present: number; late: number; absent: number; on_leave: number };
  attendance_this_month: {
    label: string;
    attendance_rate: number;
    present: number;
    late: number;
    absent: number;
    on_leave: number;
    working_days: number;
  };
  latecomers_top: { name: string; late_count: number }[];
  leave_this_month: { label: string; approved_requests: number; pending_requests: number };
  payroll: { label: string; headcount: number; total: number; average: number };
}

export interface MySnapshot {
  as_of_date: string;
  latest_working_day: string;
  today_status: string;
  today_check_in: string | null;
  late_days_this_month: number;
  leave_balance: {
    year: number;
    balances: { type: string; entitled: number; used_approved: number; pending: number; remaining: number }[];
  };
  my_requests: {
    id: string;
    type: string;
    start: string;
    end: string;
    days: number;
    status: string;
    reason: string;
  }[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  aiGenerated?: boolean;
  toolsUsed?: string[];
  refused?: boolean;
  provider?: string;
  /** ISO-ish date label the answer was grounded in (source line). */
  answeredAt?: string;
  /** Set when the request failed — offers a Retry action. */
  failed?: boolean;
  /** The user text that produced this assistant message (for Retry). */
  retryOf?: string;
}

export interface AuditEventClient {
  seq: number;
  id: string;
  ts: string;
  actor_name: string;
  actor_id: string;
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string;
  ip: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  details: Record<string, unknown> | null;
  prev_hash: string;
  hash: string;
}

export interface ChainVerificationClient {
  ok: boolean;
  checked: number;
  total_rows: number;
  broken_at_seq?: number;
  reason?: string;
}

export interface AiLogRowClient {
  id: string;
  created_at: string;
  user_id: string;
  user_name: string;
  role: string;
  feature: string;
  tool_name: string | null;
  tool_args: Record<string, unknown> | null;
  tool_status: string | null;
  outcome: string;
  latency_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  policy_version: string;
  provider: string;
  error_code: string | null;
}

export interface LeaveSuggestionClient {
  type: string;
  start: string;
  end: string;
  reason: string;
  warnings?: string[];
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  hr: "HR Manager",
  employee: "Employee",
};

export const ROLE_BADGE_CLASSES: Record<Role, string> = {
  admin: "bg-purple-100 text-purple-700 ring-purple-200",
  hr: "bg-sky-100 text-sky-700 ring-sky-200",
  employee: "bg-emerald-100 text-emerald-700 ring-emerald-200",
};
