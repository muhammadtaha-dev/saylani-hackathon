/**
 * HCM Lite — service layer. THE single source of truth for every metric.
 *
 * Supabase edition: every function receives the caller's USER-SCOPED client
 * (their JWT), so Row Level Security bounds what any query can return, and
 * the service additionally narrows queries by role scope:
 *   employee → own rows · manager → own + direct reports · hr/admin → all.
 * The dashboard UI, the REST endpoints and the AI tools all call these same
 * functions, so an AI answer and the dashboard can never disagree
 * (Constitution Art. IV.3, NFR-11).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "./permissions";

// ---------------------------------------------------------------------------
// Shared definitions (T0.3)
// ---------------------------------------------------------------------------

export const TIMEZONE = "Asia/Karachi";
/** A check-in after 09:15 PKT counts as late. */
export const LATE_CUTOFF = "09:15";
export const ATTENDANCE_RATE_DEFINITION =
  "(present + late) / (present + late + absent) x 100; days on approved leave are excluded";
export const ACTIVE_DEFINITION =
  "an employee whose employment status is 'active'";
export const POLICY_VERSION = "2026-10-25.v2";

export interface PeriodInfo {
  key: string;
  label: string; // e.g. "October 2026"
  start: string; // YYYY-MM-DD inclusive
  end: string; // YYYY-MM-DD inclusive
  timezone: string;
}

export interface Scope {
  userId: string;
  role: Role;
  department?: string;
}

/** Current date in the app timezone, as YYYY-MM-DD parts. */
export function todayInTimezone(): { year: number; month: number; day: string } {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [year, month, day] = formatted.split("-");
  return { year: Number(year), month: Number(month), day };
}

export function todayIso(): string {
  const t = todayInTimezone();
  return `${t.year}-${String(t.month).padStart(2, "0")}-${t.day}`;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Resolve a period ("this_month" | "last_month" | "this_year" | "YYYY-MM" | "YYYY"). */
export function resolvePeriod(period?: string): PeriodInfo {
  const now = todayInTimezone();
  const key = period && period.trim() ? period.trim().toLowerCase() : "this_month";

  if (/^\d{4}-\d{2}$/.test(key)) {
    const [y, m] = key.split("-").map(Number);
    return {
      key,
      label: `${MONTH_NAMES[m - 1]} ${y}`,
      start: `${key}-01`,
      end: `${key}-${String(daysInMonth(y, m)).padStart(2, "0")}`,
      timezone: TIMEZONE,
    };
  }
  if (/^\d{4}$/.test(key)) {
    return {
      key,
      label: key,
      start: `${key}-01-01`,
      end: `${key}-12-31`,
      timezone: TIMEZONE,
    };
  }
  if (key === "last_month") {
    const y = now.month === 1 ? now.year - 1 : now.year;
    const m = now.month === 1 ? 12 : now.month - 1;
    const mm = String(m).padStart(2, "0");
    return {
      key,
      label: `${MONTH_NAMES[m - 1]} ${y}`,
      start: `${y}-${mm}-01`,
      end: `${y}-${mm}-${daysInMonth(y, m)}`,
      timezone: TIMEZONE,
    };
  }
  if (key === "this_year") {
    return {
      key,
      label: String(now.year),
      start: `${now.year}-01-01`,
      end: `${now.year}-12-31`,
      timezone: TIMEZONE,
    };
  }
  const mm = String(now.month).padStart(2, "0");
  return {
    key: `${now.year}-${mm}`,
    label: `${MONTH_NAMES[now.month - 1]} ${now.year}`,
    start: `${now.year}-${mm}-01`,
    end: `${now.year}-${mm}-${daysInMonth(now.year, now.month)}`,
    timezone: TIMEZONE,
  };
}

// ---------------------------------------------------------------------------
// Row types (mirror of the SQL migrations)
// ---------------------------------------------------------------------------

export interface ProfileRow {
  id: string;
  email: string | null;
  full_name: string;
  role: Role;
  manager_id: string | null;
  department: string;
  designation: string | null;
  status: "active" | "inactive";
}

export interface AttendanceRow {
  id: string;
  employee_id: string;
  date: string;
  status: "present" | "late" | "absent" | "leave" | "half_day";
  check_in: string | null;
  check_out: string | null;
}

export interface LeaveRequestRow {
  id: string;
  employee_id: string;
  leave_type_id: "annual" | "sick" | "casual";
  start_date: string;
  end_date: string;
  days: number;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reason: string;
  decision_comment: string | null;
  decided_by: string | null;
  decided_at: string | null;
  attachment_path: string | null;
  applied_at: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Profile ids the caller may aggregate over. null = "all rows visible to the
 * caller" (HR/Admin without a department filter). RLS remains the hard
 * backstop — this just keeps manager/team semantics explicit.
 */
async function resolveScopeIds(
  db: SupabaseClient,
  scope: Scope
): Promise<string[] | null> {
  if (scope.role === "employee") return [scope.userId];

  if (scope.role === "manager") {
    const ids = [scope.userId];
    const { data: reports } = await db
      .from("profiles")
      .select("id")
      .eq("manager_id", scope.userId)
      .eq("status", "active");
    for (const r of reports ?? []) ids.push(r.id);
    if (scope.department) {
      const filtered = new Set<string>();
      for (const id of ids) {
        // keep only ids in the requested department
        const { data } = await db
          .from("profiles")
          .select("id, department")
          .eq("id", id)
          .eq("department", scope.department);
        if (data && data.length > 0) filtered.add(id);
      }
      return [...filtered];
    }
    return ids;
  }

  // HR/Admin: department filter or everything.
  if (scope.department) {
    const { data } = await db
      .from("profiles")
      .select("id")
      .eq("department", scope.department);
    return (data ?? []).map((p) => p.id);
  }
  return null;
}

async function profilesForDepartment(
  db: SupabaseClient,
  department?: string
): Promise<ProfileRow[]> {
  let query = db.from("profiles").select("*").eq("status", "active");
  if (department) query = query.eq("department", department);
  const { data } = await query;
  return (data ?? []) as ProfileRow[];
}

function summarizeAttendance(records: AttendanceRow[]) {
  let present = 0, late = 0, absent = 0, onLeave = 0;
  const dates = new Set<string>();
  for (const r of records) {
    dates.add(r.date);
    if (r.status === "present") present++;
    else if (r.status === "late") late++;
    else if (r.status === "absent") absent++;
    else onLeave++;
  }
  const attended = present + late;
  const denominator = attended + absent;
  const rate = denominator > 0 ? Math.round((attended / denominator) * 1000) / 10 : 0;
  return { present, late, absent, on_leave: onLeave, working_days: dates.size, attendance_rate: rate };
}

async function attendanceInPeriod(
  db: SupabaseClient,
  period: PeriodInfo,
  scopeIds: string[] | null
): Promise<AttendanceRow[]> {
  let query = db
    .from("attendance")
    .select("*")
    .gte("date", period.start)
    .lte("date", period.end);
  // PostgREST rejects empty in() lists; use an impossible id instead.
  if (scopeIds) query = query.in("employee_id", scopeIds.length ? scopeIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as AttendanceRow[];
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export interface HeadcountResult {
  department: string;
  status: "active" | "inactive" | "all";
  count: number;
  as_of: string;
}

export async function getHeadcountService(
  db: SupabaseClient,
  scope: Scope,
  department?: string,
  status: "active" | "inactive" | "all" = "active"
): Promise<HeadcountResult> {
  const ids = await resolveScopeIds(db, scope);
  let query = db.from("profiles").select("id, status");
  if (ids) query = query.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  if (department) query = query.eq("department", department);
  if (status !== "all") query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return {
    department: department ?? "All departments",
    status,
    count: (data ?? []).length,
    as_of: todayIso(),
  };
}

export interface AttendanceSummaryResult {
  period: PeriodInfo;
  working_days: number;
  present: number;
  absent: number;
  late: number;
  on_leave: number;
  attendance_rate: number;
  definition: string;
}

export async function getAttendanceSummaryService(
  db: SupabaseClient,
  scope: Scope,
  department?: string,
  period?: string
): Promise<AttendanceSummaryResult> {
  const p = resolvePeriod(period);
  const ids = await resolveScopeIds(db, scope);
  const records = await attendanceInPeriod(db, p, ids);
  return { period: p, ...summarizeAttendance(records), definition: ATTENDANCE_RATE_DEFINITION };
}

/** Own-record attendance summary (employee scope). */
export async function getMyAttendanceSummaryService(
  db: SupabaseClient,
  userId: string,
  period?: string
): Promise<AttendanceSummaryResult> {
  const p = resolvePeriod(period);
  const { data, error } = await db
    .from("attendance")
    .select("*")
    .eq("employee_id", userId)
    .gte("date", p.start)
    .lte("date", p.end);
  if (error) throw new Error(error.message);
  return { period: p, ...summarizeAttendance((data ?? []) as AttendanceRow[]), definition: ATTENDANCE_RATE_DEFINITION };
}

export interface LateComer {
  employee_id: string;
  name: string;
  department: string;
  late_count: number;
}

export interface LateComersResult {
  period: PeriodInfo;
  late_cutoff: string;
  timezone: string;
  ranking: LateComer[];
}

export async function getLateComersService(
  db: SupabaseClient,
  scope: Scope,
  department?: string,
  period?: string,
  limit = 5
): Promise<LateComersResult> {
  const p = resolvePeriod(period);
  const cap = Math.min(Math.max(limit, 1), 10);
  const ids = await resolveScopeIds(db, scope);
  const records = await attendanceInPeriod(db, p, ids);
  const counts = new Map<string, number>();
  for (const r of records) {
    if (r.status === "late") counts.set(r.employee_id, (counts.get(r.employee_id) ?? 0) + 1);
  }
  const names = new Map<string, { name: string; department: string }>();
  const idList = [...counts.keys()];
  if (idList.length > 0) {
    const { data } = await db
      .from("profiles")
      .select("id, full_name, department")
      .in("id", idList);
    for (const p of data ?? []) {
      names.set(p.id, { name: p.full_name, department: p.department });
    }
  }
  const ranking = [...counts.entries()]
    .map(([id, lateCount]) => ({
      employee_id: id,
      name: names.get(id)?.name ?? id,
      department: names.get(id)?.department ?? "",
      late_count: lateCount,
    }))
    .sort((a, b) => b.late_count - a.late_count || a.name.localeCompare(b.name))
    .slice(0, cap);
  return { period: p, late_cutoff: LATE_CUTOFF, timezone: TIMEZONE, ranking };
}

export interface LeaveSummaryResult {
  period: PeriodInfo;
  by_type_and_status: Record<
    "annual" | "sick" | "casual",
    Record<"approved" | "pending" | "rejected" | "cancelled", { requests: number; days: number }>
  >;
}

export async function getLeaveSummaryService(
  db: SupabaseClient,
  scope: Scope,
  department?: string,
  period?: string,
  type?: "annual" | "sick" | "casual"
): Promise<LeaveSummaryResult> {
  const p = resolvePeriod(period);
  const ids = await resolveScopeIds(db, scope);
  let query = db
    .from("leave_requests")
    .select("*")
    .gte("start_date", p.start)
    .lte("end_date", p.end);
  if (ids) query = query.in("employee_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  if (type) query = query.eq("leave_type_id", type);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const result = {} as LeaveSummaryResult["by_type_and_status"];
  for (const t of ["annual", "sick", "casual"] as const) {
    if (type && t !== type) continue;
    result[t] = {
      approved: { requests: 0, days: 0 },
      pending: { requests: 0, days: 0 },
      rejected: { requests: 0, days: 0 },
      cancelled: { requests: 0, days: 0 },
    };
  }
  for (const lr of (data ?? []) as LeaveRequestRow[]) {
    const cell = result[lr.leave_type_id]?.[lr.status];
    if (cell) {
      cell.requests += 1;
      cell.days += Number(lr.days);
    }
  }
  return { period: p, by_type_and_status: result };
}

export interface LeaveBalance {
  type: "annual" | "sick" | "casual";
  entitled: number;
  used_approved: number;
  pending: number;
  remaining: number;
}

export interface MyLeaveBalanceResult {
  year: number;
  balances: LeaveBalance[];
}

/** Pure balance arithmetic — unit-tested in tests/leave-balance.test.ts. */
export function computeLeaveBalances(
  balanceRows: { leave_type_id: string; entitled: number; carried_over: number }[],
  requests: { leave_type_id: string; days: number; status: string }[]
): LeaveBalance[] {
  return (["annual", "sick", "casual"] as const).map((t) => {
    const row = balanceRows.find((b) => b.leave_type_id === t);
    const entitled = row?.entitled ?? 0;
    const carried = Number(row?.carried_over ?? 0);
    const mine = requests.filter((r) => r.leave_type_id === t);
    const used = mine.filter((r) => r.status === "approved").reduce((s, r) => s + Number(r.days), 0);
    const pending = mine.filter((r) => r.status === "pending").reduce((s, r) => s + Number(r.days), 0);
    return {
      type: t,
      entitled,
      used_approved: used,
      pending,
      remaining: entitled + carried - used,
    };
  });
}

/**
 * Caller's own balance for a year: entitled (+ carry-over) from
 * leave_balances minus APPROVED days from leave_requests. Pending leaves are
 * NOT deducted (AT-04). No user parameter is ever taken from input.
 */
export async function getMyLeaveBalanceService(
  db: SupabaseClient,
  userId: string,
  year?: number
): Promise<MyLeaveBalanceResult> {
  const y = year ?? todayInTimezone().year;

  const [{ data: balanceRows, error: balErr }, { data: requests, error: reqErr }] = await Promise.all([
    db
      .from("leave_balances")
      .select("leave_type_id, entitled, carried_over")
      .eq("employee_id", userId)
      .eq("year", y),
    db
      .from("leave_requests")
      .select("leave_type_id, days, status, start_date")
      .eq("employee_id", userId)
      .gte("start_date", `${y}-01-01`)
      .lte("start_date", `${y}-12-31`),
  ]);
  if (balErr) throw new Error(balErr.message);
  if (reqErr) throw new Error(reqErr.message);

  const balances = computeLeaveBalances(
    (balanceRows ?? []) as { leave_type_id: string; entitled: number; carried_over: number }[],
    (requests ?? []) as { leave_type_id: string; days: number; status: string }[]
  );
  return { year: y, balances };
}

export interface PayrollSummaryResult {
  period: PeriodInfo;
  headcount: number;
  total: number;
  average: number;
  note: string;
}

/**
 * Aggregates only — never individual salaries (Art. III.6). Returns null
 * when the caller cannot read compensations (RLS), e.g. managers.
 */
export async function getPayrollSummaryService(
  db: SupabaseClient,
  scope: Scope,
  department?: string,
  period?: string
): Promise<PayrollSummaryResult | null> {
  if (scope.role !== "hr" && scope.role !== "admin") return null;
  const p = resolvePeriod(period);
  const profiles = await profilesForDepartment(db, department);
  const ids = profiles.map((p2) => p2.id);
  if (ids.length === 0) {
    return { period: p, headcount: 0, total: 0, average: 0, note: "No active employees in scope." };
  }
  const { data, error } = await db
    .from("compensations")
    .select("salary_monthly")
    .in("employee_id", ids);
  if (error) return null; // RLS denial or missing rows — no payroll figure
  const salaries = (data ?? []).map((c) => Number(c.salary_monthly));
  const total = salaries.reduce((s, v) => s + v, 0);
  return {
    period: p,
    headcount: salaries.length,
    total,
    average: salaries.length ? Math.round(total / salaries.length) : 0,
    note: "Aggregated monthly gross payroll in PKR for active employees; individual salaries are never disclosed.",
  };
}

export interface EmployeeMatch {
  id: string;
  name: string;
  department: string;
  designation: string;
}

export interface SearchEmployeesResult {
  query: string;
  matches: EmployeeMatch[];
  total: number;
}

/** Directory search. NEVER returns salary, CNIC or bank details (Art. III.5). */
export async function searchEmployeesService(
  db: SupabaseClient,
  query: string,
  department?: string,
  limit = 10
): Promise<SearchEmployeesResult> {
  const cap = Math.min(Math.max(limit, 1), 10);
  const q = query.trim();
  let builder = db
    .from("profiles")
    .select("id, full_name, department, designation")
    .eq("status", "active")
    .limit(cap);
  if (department) builder = builder.eq("department", department);
  const { data, error } = await builder.or(
    `full_name.ilike.%${q}%,designation.ilike.%${q}%,department.ilike.%${q}%`
  );
  if (error) throw new Error(error.message);
  const matches = (data ?? []).map((p) => ({
    id: p.id,
    name: p.full_name,
    department: p.department,
    designation: p.designation ?? "",
  }));
  return { query, total: matches.length, matches };
}

export interface OnLeaveTodayRow {
  full_name: string;
  department: string;
  leave_type: string;
  start_date: string;
  end_date: string;
}

export async function getOnLeaveTodayService(
  db: SupabaseClient
): Promise<{ date: string; rows: OnLeaveTodayRow[] }> {
  const { data, error } = await db.rpc("on_leave_today");
  if (error) throw new Error(error.message);
  return { date: todayIso(), rows: (data ?? []) as OnLeaveTodayRow[] };
}

export interface PendingLeaveRow {
  id: string;
  employee_id: string;
  employee_name: string;
  department: string;
  leave_type_id: "annual" | "sick" | "casual";
  start_date: string;
  end_date: string;
  days: number;
  reason: string;
  applied_at: string;
}

/** Approval queue — RLS scopes it (manager: direct reports; HR/Admin: all). */
export async function getPendingLeaveRequestsService(
  db: SupabaseClient
): Promise<{ date: string; rows: PendingLeaveRow[] }> {
  const { data, error } = await db
    .from("leave_requests")
    .select(
      "id, employee_id, leave_type_id, start_date, end_date, days, reason, applied_at, profiles!leave_requests_employee_id_fkey(full_name, department)"
    )
    .eq("status", "pending")
    .order("applied_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rows: PendingLeaveRow[] = (data ?? []).map((r: Record<string, unknown>) => {
    const profile = r.profiles as { full_name: string; department: string } | null;
    return {
      id: String(r.id),
      employee_id: String(r.employee_id),
      employee_name: profile?.full_name ?? String(r.employee_id),
      department: profile?.department ?? "",
      leave_type_id: r.leave_type_id as PendingLeaveRow["leave_type_id"],
      start_date: String(r.start_date),
      end_date: String(r.end_date),
      days: Number(r.days),
      reason: String(r.reason),
      applied_at: String(r.applied_at),
    };
  });
  return { date: todayIso(), rows };
}

/** Public holidays in an inclusive range (used by every date validation). */
export async function getHolidaysBetween(
  db: SupabaseClient,
  start: string,
  end: string
): Promise<Map<string, string>> {
  const { data, error } = await db
    .from("holidays")
    .select("date, name")
    .gte("date", start)
    .lte("date", end);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((h) => [h.date, h.name]));
}

export interface TeamOverlapResult {
  teamSize: number;
  offCount: number;
  offNames: { name: string; type: string; start: string; end: string }[];
}

export async function getTeamOverlapService(
  db: SupabaseClient,
  start: string,
  end: string
): Promise<TeamOverlapResult> {
  const { data, error } = await db.rpc("team_overlap", { p_start: start, p_end: end });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as {
    team_size: number;
    off_count: number;
    off_names: { name: string; type: string; start: string; end: string }[];
  } | null;
  return {
    teamSize: row?.team_size ?? 0,
    offCount: row?.off_count ?? 0,
    offNames: row?.off_names ?? [],
  };
}

// ---------------------------------------------------------------------------
// Dashboard KPI builder — same services, so dashboard == AI answers (parity)
// ---------------------------------------------------------------------------

export interface DashboardKpis {
  filters: { department: string; period: string };
  as_of_date: string;
  timezone: string;
  scope_note: string;
  headcount_active: number;
  headcount_by_department: Record<string, number>;
  today: {
    date: string;
    present: number;
    late: number;
    absent: number;
    on_leave: number;
  };
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
  leave_this_month: {
    label: string;
    approved_requests: number;
    pending_requests: number;
  };
  payroll: {
    label: string;
    headcount: number;
    total: number;
    average: number;
  } | null;
}

const NO_ID = "00000000-0000-0000-0000-000000000000";

export async function getDashboardKpis(
  db: SupabaseClient,
  scope: Scope,
  department?: string
): Promise<DashboardKpis> {
  const monthPeriod = resolvePeriod("this_month");
  const ids = await resolveScopeIds(db, scope);
  const idFilter = ids && ids.length === 0 ? [NO_ID] : ids;

  // "Today" = the latest working day that has attendance records.
  let latestQuery = db.from("attendance").select("date").order("date", { ascending: false }).limit(1);
  if (idFilter) latestQuery = latestQuery.in("employee_id", idFilter);
  const { data: latest } = await latestQuery;
  const latestDate = latest?.[0]?.date ?? todayIso();

  let todayQuery = db.from("attendance").select("*").eq("date", latestDate);
  if (idFilter) todayQuery = todayQuery.in("employee_id", idFilter);
  const { data: todayRows } = await todayQuery;
  let present = 0, late = 0, absent = 0, onLeave = 0;
  for (const r of (todayRows ?? []) as AttendanceRow[]) {
    if (r.status === "present") present++;
    else if (r.status === "late") late++;
    else if (r.status === "absent") absent++;
    else onLeave++;
  }

  const scopedDept = scope.role === "manager" || scope.role === "employee" ? undefined : department;
  const headcount = await getHeadcountService(db, scope, scopedDept, "active");

  const headcountByDepartment: Record<string, number> = {};
  if (scope.role === "admin" || scope.role === "hr") {
    const { data: rows } = await db
      .from("profiles")
      .select("department")
      .eq("status", "active");
    for (const row of rows ?? []) {
      headcountByDepartment[row.department] = (headcountByDepartment[row.department] ?? 0) + 1;
    }
  } else {
    const idsInScope = ids ?? [];
    if (idsInScope.length > 0) {
      const { data: rows } = await db
        .from("profiles")
        .select("id, department")
        .in("id", idsInScope);
      for (const row of rows ?? []) {
        headcountByDepartment[row.department] = (headcountByDepartment[row.department] ?? 0) + 1;
      }
    }
  }

  const attendance = await getAttendanceSummaryService(db, scope, scopedDept, "this_month");
  const latecomers = await getLateComersService(db, scope, scopedDept, "this_month", 3);
  const leaveSummary = await getLeaveSummaryService(db, scope, scopedDept, "this_month");
  const payroll = await getPayrollSummaryService(db, scope, scopedDept, "this_month");

  const scopeNote =
    scope.role === "employee"
      ? "your own records"
      : scope.role === "manager"
        ? "your own records plus your direct reports"
        : department
          ? `the ${department} department`
          : "all departments";

  return {
    filters: { department: department ?? "All departments", period: monthPeriod.key },
    as_of_date: todayIso(),
    timezone: TIMEZONE,
    scope_note: scopeNote,
    headcount_active: headcount.count,
    headcount_by_department: headcountByDepartment,
    today: { date: latestDate, present, late, absent, on_leave: onLeave },
    attendance_this_month: {
      label: attendance.period.label,
      attendance_rate: attendance.attendance_rate,
      present: attendance.present,
      late: attendance.late,
      absent: attendance.absent,
      on_leave: attendance.on_leave,
      working_days: attendance.working_days,
    },
    latecomers_top: latecomers.ranking.map((l) => ({ name: l.name, late_count: l.late_count })),
    leave_this_month: {
      label: leaveSummary.period.label,
      approved_requests:
        leaveSummary.by_type_and_status.annual.approved.requests +
        leaveSummary.by_type_and_status.sick.approved.requests +
        leaveSummary.by_type_and_status.casual.approved.requests,
      pending_requests:
        leaveSummary.by_type_and_status.annual.pending.requests +
        leaveSummary.by_type_and_status.sick.pending.requests +
        leaveSummary.by_type_and_status.casual.pending.requests,
    },
    payroll: payroll
      ? {
          label: payroll.period.label,
          headcount: payroll.headcount,
          total: payroll.total,
          average: payroll.average,
        }
      : null,
  };
}

/** Employee/Manager own dashboard snapshot (no org-wide data). */
export async function getMySnapshotService(db: SupabaseClient, userId: string) {
  const balances = await getMyLeaveBalanceService(db, userId);
  const { data: latest } = await db
    .from("attendance")
    .select("date")
    .eq("employee_id", userId)
    .order("date", { ascending: false })
    .limit(1);
  const latestDate = latest?.[0]?.date ?? "";
  const { data: todayRecord } = await db
    .from("attendance")
    .select("status, check_in")
    .eq("employee_id", userId)
    .eq("date", latestDate)
    .maybeSingle();

  const { data: myRequests } = await db
    .from("leave_requests")
    .select("id, leave_type_id, start_date, end_date, days, status, reason, attachment_path")
    .eq("employee_id", userId)
    .order("start_date", { ascending: false });

  const monthStart = resolvePeriod("this_month").start;
  const { count: lateCount } = await db
    .from("attendance")
    .select("id", { count: "exact", head: true })
    .eq("employee_id", userId)
    .eq("status", "late")
    .gte("date", monthStart);

  return {
    as_of_date: todayIso(),
    latest_working_day: latestDate,
    today_status: todayRecord?.status ?? "no_record",
    today_check_in: todayRecord?.check_in
      ? new Date(todayRecord.check_in).toLocaleTimeString("en-GB", {
          timeZone: TIMEZONE,
          hour: "2-digit",
          minute: "2-digit",
        })
      : null,
    late_days_this_month: lateCount ?? 0,
    leave_balance: balances,
    my_requests: (myRequests ?? []).map((r) => ({
      id: r.id,
      type: r.leave_type_id,
      start: r.start_date,
      end: r.end_date,
      days: Number(r.days),
      status: r.status,
      reason: r.reason,
      attachment_path: r.attachment_path,
    })),
  };
}

// ---------------------------------------------------------------------------
// HR operations — per-employee attendance report (HR/Admin/Manager surfaces)
// ---------------------------------------------------------------------------

export interface EmployeeAttendanceRow {
  employee_id: string;
  name: string;
  department: string;
  designation: string;
  present: number;
  late: number;
  absent: number;
  on_leave: number;
  attendance_rate: number;
}

export interface AttendanceReportResult {
  period: PeriodInfo;
  definition: string;
  rows: EmployeeAttendanceRow[];
}

export async function getEmployeeAttendanceReport(
  db: SupabaseClient,
  scope: Scope,
  department?: string,
  period?: string
): Promise<AttendanceReportResult> {
  const p = resolvePeriod(period);
  const ids = await resolveScopeIds(db, scope);
  let profileQuery = db.from("profiles").select("*").eq("status", "active");
  if (department) profileQuery = profileQuery.eq("department", department);
  if (ids) profileQuery = profileQuery.in("id", ids.length ? ids : [NO_ID]);
  const { data: profiles, error } = await profileQuery;
  if (error) throw new Error(error.message);

  const rows: EmployeeAttendanceRow[] = [];
  for (const e of (profiles ?? []) as ProfileRow[]) {
    const { data: recs } = await db
      .from("attendance")
      .select("status")
      .eq("employee_id", e.id)
      .gte("date", p.start)
      .lte("date", p.end);
    let present = 0, late = 0, absent = 0, onLeave = 0;
    for (const r of recs ?? []) {
      if (r.status === "present") present++;
      else if (r.status === "late") late++;
      else if (r.status === "absent") absent++;
      else onLeave++;
    }
    const attended = present + late;
    const denominator = attended + absent;
    rows.push({
      employee_id: e.id,
      name: e.full_name,
      department: e.department,
      designation: e.designation ?? "",
      present,
      late,
      absent,
      on_leave: onLeave,
      attendance_rate:
        denominator > 0 ? Math.round((attended / denominator) * 1000) / 10 : 100,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { period: p, definition: ATTENDANCE_RATE_DEFINITION, rows };
}
