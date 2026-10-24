/**
 * HCM Lite — service layer. THE single source of truth for every metric.
 *
 * The dashboard UI, the REST endpoints and the AI tools all call these
 * functions, so an AI answer and the dashboard can never disagree
 * (Constitution Art. IV.3, NFR-11). Business definitions — "active", "late",
 * "attendance rate", "this month", "this year" — are defined exactly once,
 * here, and echoed in every result's meta so answers state their period.
 */

import {
  ATTENDANCE_RECORDS,
  DEPARTMENTS,
  EMPLOYEES,
  LEAVE_ENTITLEMENTS,
  LEAVE_REQUESTS,
  LEAVE_TYPES,
  type DepartmentName,
  type Employee,
  type EmploymentStatus,
  type LeaveStatus,
  type LeaveType,
} from "./hcmData";

// ---------------------------------------------------------------------------
// Shared definitions (T0.3) — imported by dashboard, tools and prompts alike.
// ---------------------------------------------------------------------------

export const TIMEZONE = "Asia/Karachi";
/** A check-in after 09:15 PKT counts as late. */
export const LATE_CUTOFF = "09:15";
export const ATTENDANCE_RATE_DEFINITION =
  "(present + late) / (present + late + absent) x 100; days on approved leave are excluded";
export const ACTIVE_DEFINITION =
  "an employee whose employment status is 'active'";
export const POLICY_VERSION = "2026-10-24.v1";

export interface PeriodInfo {
  key: string;
  label: string; // e.g. "October 2026"
  start: string; // YYYY-MM-DD inclusive
  end: string; // YYYY-MM-DD inclusive
  timezone: string;
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

/**
 * Resolve a period string ("this_month" | "last_month" | "this_year" |
 * "YYYY-MM" | "YYYY") into explicit start/end in the app timezone.
 */
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
  // Default: this month.
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
// Internal helpers
// ---------------------------------------------------------------------------

function employeesInScope(department?: string): Employee[] {
  return EMPLOYEES.filter(
    (e) => !department || e.department === department
  );
}

function recordsInPeriod(period: PeriodInfo, department?: string) {
  const inScope = new Set(
    employeesInScope(department).map((e) => e.id)
  );
  return ATTENDANCE_RECORDS.filter(
    (r) => r.date >= period.start && r.date <= period.end && inScope.has(r.employeeId)
  );
}

function summarizeAttendance(records: typeof ATTENDANCE_RECORDS) {
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

// ---------------------------------------------------------------------------
// Services (one function per metric — no business logic lives anywhere else)
// ---------------------------------------------------------------------------

export interface HeadcountResult {
  department: string;
  status: EmploymentStatus | "all";
  count: number;
  as_of: string;
}

export function getHeadcountService(
  department?: DepartmentName,
  status: EmploymentStatus | "all" = "active"
): HeadcountResult {
  const all = employeesInScope(department);
  const count =
    status === "all" ? all.length : all.filter((e) => e.status === status).length;
  return {
    department: department ?? "All departments",
    status,
    count,
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

export function getAttendanceSummaryService(
  department?: DepartmentName,
  period?: string
): AttendanceSummaryResult {
  const p = resolvePeriod(period);
  const summary = summarizeAttendance(recordsInPeriod(p, department));
  return {
    period: p,
    ...summary,
    definition: ATTENDANCE_RATE_DEFINITION,
  };
}

/** Own-record attendance summary for an employee (3.3: own record only). */
export function getMyAttendanceSummaryService(
  userId: string,
  period?: string
): AttendanceSummaryResult {
  const p = resolvePeriod(period);
  const records = ATTENDANCE_RECORDS.filter(
    (r) => r.employeeId === userId && r.date >= p.start && r.date <= p.end
  );
  return { period: p, ...summarizeAttendance(records), definition: ATTENDANCE_RATE_DEFINITION };
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

export function getLateComersService(
  department?: DepartmentName,
  period?: string,
  limit = 5
): LateComersResult {
  const p = resolvePeriod(period);
  const cap = Math.min(Math.max(limit, 1), 10);
  const counts = new Map<string, number>();
  for (const r of recordsInPeriod(p, department)) {
    if (r.status === "late") {
      counts.set(r.employeeId, (counts.get(r.employeeId) ?? 0) + 1);
    }
  }
  const ranking = [...counts.entries()]
    .map(([id, lateCount]) => {
      const emp = EMPLOYEES.find((e) => e.id === id)!;
      return {
        employee_id: id,
        name: emp.name,
        department: emp.department,
        late_count: lateCount,
      };
    })
    .sort((a, b) => b.late_count - a.late_count || a.name.localeCompare(b.name))
    .slice(0, cap);
  return { period: p, late_cutoff: LATE_CUTOFF, timezone: TIMEZONE, ranking };
}

export interface LeaveSummaryResult {
  period: PeriodInfo;
  by_type_and_status: Record<
    LeaveType,
    Record<LeaveStatus, { requests: number; days: number }>
  >;
}

export function getLeaveSummaryService(
  department?: DepartmentName,
  period?: string,
  type?: LeaveType
): LeaveSummaryResult {
  const p = resolvePeriod(period);
  const inScope = new Set(employeesInScope(department).map((e) => e.id));
  const result = {} as LeaveSummaryResult["by_type_and_status"];
  for (const t of LEAVE_TYPES) {
    if (type && t !== type) continue;
    result[t] = { approved: { requests: 0, days: 0 }, pending: { requests: 0, days: 0 }, rejected: { requests: 0, days: 0 } };
  }
  for (const lr of LEAVE_REQUESTS) {
    if (!inScope.has(lr.employeeId)) continue;
    if (lr.end < p.start || lr.start > p.end) continue;
    if (type && lr.type !== type) continue;
    const cell = result[lr.type]?.[lr.status];
    if (cell) {
      cell.requests += 1;
      cell.days += lr.days;
    }
  }
  return { period: p, by_type_and_status: result };
}

export interface LeaveBalance {
  type: LeaveType;
  entitled: number;
  used_approved: number;
  pending: number;
  remaining: number;
}

export interface MyLeaveBalanceResult {
  year: number;
  balances: LeaveBalance[];
}

/**
 * Caller's own balance. Pending leaves are NOT deducted: only approved
 * leaves consume quota (AT-04). No user parameter is ever taken from input.
 */
export function getMyLeaveBalanceService(
  userId: string,
  year?: number
): MyLeaveBalanceResult {
  const y = year ?? todayInTimezone().year;
  const balances = LEAVE_TYPES.map((t) => {
    const mine = LEAVE_REQUESTS.filter(
      (lr) =>
        lr.employeeId === userId &&
        lr.type === t &&
        Number(lr.start.slice(0, 4)) === y
    );
    const used = mine.filter((lr) => lr.status === "approved").reduce((s, lr) => s + lr.days, 0);
    const pending = mine.filter((lr) => lr.status === "pending").reduce((s, lr) => s + lr.days, 0);
    const entitled = LEAVE_ENTITLEMENTS[t];
    return {
      type: t,
      entitled,
      used_approved: used,
      pending,
      remaining: entitled - used,
    };
  });
  return { year: y, balances };
}

export interface PayrollSummaryResult {
  period: PeriodInfo;
  headcount: number;
  total: number;
  average: number;
  note: string;
}

/** Aggregates only — never individual salaries (Art. III.6). */
export function getPayrollSummaryService(
  department?: DepartmentName,
  period?: string
): PayrollSummaryResult {
  const p = resolvePeriod(period);
  const active = employeesInScope(department).filter((e) => e.status === "active");
  const total = active.reduce((s, e) => s + e.salaryMonthlyPkr, 0);
  return {
    period: p,
    headcount: active.length,
    total,
    average: active.length ? Math.round(total / active.length) : 0,
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

/**
 * Directory search. NEVER returns salary, CNIC or bank details
 * (Art. III.5, 6.2) — for any role.
 */
export function searchEmployeesService(
  query: string,
  department?: DepartmentName,
  limit = 10
): SearchEmployeesResult {
  const cap = Math.min(Math.max(limit, 1), 10);
  const q = query.trim().toLowerCase();
  const filtered = employeesInScope(department).filter(
    (e) =>
      e.name.toLowerCase().includes(q) ||
      e.designation.toLowerCase().includes(q) ||
      e.department.toLowerCase().includes(q)
  );
  return {
    query,
    total: filtered.length,
    matches: filtered.slice(0, cap).map((e) => ({
      id: e.id,
      name: e.name,
      department: e.department,
      designation: e.designation,
    })),
  };
}

// ---------------------------------------------------------------------------
// Dashboard KPI builder — same services, so dashboard == AI answers (parity)
// ---------------------------------------------------------------------------

export interface DashboardKpis {
  filters: { department: string; period: string };
  as_of_date: string;
  timezone: string;
  headcount_active: number;
  headcount_by_department: Record<DepartmentName, number>;
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
  };
}

export function getDashboardKpis(department?: DepartmentName): DashboardKpis {
  const monthPeriod = resolvePeriod("this_month");

  // "Today" = the latest working day that has attendance records, so weekend
  // visits still show a meaningful snapshot. Echoed in the response.
  const latestDate = ATTENDANCE_RECORDS.reduce((max, r) => (r.date > max ? r.date : max), "");
  const todayRecords = ATTENDANCE_RECORDS.filter((r) => r.date === latestDate && (!department || employeesInScope(department).some((e) => e.id === r.employeeId)));
  let present = 0, late = 0, absent = 0, onLeave = 0;
  for (const r of todayRecords) {
    if (r.status === "present") present++;
    else if (r.status === "late") late++;
    else if (r.status === "absent") absent++;
    else onLeave++;
  }

  const headcountByDept = {} as Record<DepartmentName, number>;
  for (const d of DEPARTMENTS) {
    headcountByDept[d] = EMPLOYEES.filter((e) => e.department === d && e.status === "active").length;
  }

  const attendance = getAttendanceSummaryService(department, "this_month");
  const latecomers = getLateComersService(department, "this_month", 3);
  const leaveSummary = getLeaveSummaryService(department, "this_month");
  const payroll = getPayrollSummaryService(department, "this_month");

  return {
    filters: { department: department ?? "All departments", period: monthPeriod.key },
    as_of_date: todayIso(),
    timezone: TIMEZONE,
    headcount_active: getHeadcountService(department, "active").count,
    headcount_by_department: headcountByDept,
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
    payroll: {
      label: payroll.period.label,
      headcount: payroll.headcount,
      total: payroll.total,
      average: payroll.average,
    },
  };
}

/** Employee's own dashboard snapshot (no org-wide data). */
export function getMySnapshotService(userId: string) {
  const balances = getMyLeaveBalanceService(userId);
  const latestDate = ATTENDANCE_RECORDS.reduce((max, r) => (r.date > max ? r.date : max), "");
  const todayRecord = ATTENDANCE_RECORDS.find(
    (r) => r.employeeId === userId && r.date === latestDate
  );
  const myRequests = LEAVE_REQUESTS.filter((lr) => lr.employeeId === userId).sort((a, b) =>
    b.start.localeCompare(a.start)
  );
  const myLateCount = ATTENDANCE_RECORDS.filter(
    (r) => r.employeeId === userId && r.status === "late" && r.date >= resolvePeriod("this_month").start
  ).length;
  return {
    as_of_date: todayIso(),
    latest_working_day: latestDate,
    today_status: todayRecord?.status ?? "no_record",
    today_check_in: todayRecord?.checkIn ?? null,
    late_days_this_month: myLateCount,
    leave_balance: balances,
    my_requests: myRequests.map((r) => ({
      id: r.id,
      type: r.type,
      start: r.start,
      end: r.end,
      days: r.days,
      status: r.status,
      reason: r.reason,
    })),
  };
}
