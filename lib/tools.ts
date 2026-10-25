/**
 * HCM Lite — tool registry (Art. II closed list, Art. IV tool-calling rules).
 *
 * Nine tools, each with a strict typed schema. The executor validates
 * arguments (never silently "fixing" them), checks role x tool x arguments
 * via the shared permission layer, runs the shared service with the CALLER'S
 * Supabase client (their JWT — so Row Level Security bounds every query),
 * and wraps everything in the common result envelope. Every call — and every
 * denial — is appended to the append-only audit trail.
 */

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  checkToolPermission,
  type SessionIdentity,
  type ToolName,
} from "./permissions";
import {
  getAttendanceSummaryService,
  getHeadcountService,
  getLateComersService,
  getLeaveSummaryService,
  getMyAttendanceSummaryService,
  getMyLeaveBalanceService,
  getOnLeaveTodayService,
  getPayrollSummaryService,
  getPendingLeaveRequestsService,
  searchEmployeesService,
  type Scope,
} from "./services";
import { appendAuditEvent } from "./audit";

// ---------------------------------------------------------------------------
// Common result envelope (Spec 6.1)
// ---------------------------------------------------------------------------

export interface ToolEnvelope {
  status: "ok" | "forbidden" | "not_found" | "ambiguous" | "error";
  data: Record<string, unknown> | null;
  meta: { period?: string; timezone?: string; note?: string };
}

function ok(data: Record<string, unknown>, meta: ToolEnvelope["meta"] = {}): ToolEnvelope {
  return { status: "ok", data, meta };
}

function forbidden(reason: string): ToolEnvelope {
  // Identical shape for every denial; contains no hint about the record.
  return {
    status: "forbidden",
    data: null,
    meta: { note: reason },
  };
}

function notFound(note: string): ToolEnvelope {
  return { status: "not_found", data: { reason: note }, meta: {} };
}

function errorEnvelope(code: string, issues?: string[]): ToolEnvelope {
  return {
    status: "error",
    data: { reason: code, issues: issues ?? [] },
    meta: {},
  };
}

// ---------------------------------------------------------------------------
// Argument schemas (strict — invalid arguments are rejected, never corrected)
// ---------------------------------------------------------------------------

const departmentSchema = z
  .string()
  .refine((v) => ["Engineering", "Sales", "HR"].includes(v), {
    message: "department must be one of: Engineering, Sales, HR",
  });

const periodSchema = z
  .string()
  .refine(
    (v) =>
      ["this_month", "last_month", "this_year"].includes(v) ||
      /^\d{4}$/.test(v) ||
      /^\d{4}-\d{2}$/.test(v),
    { message: "period must be this_month, last_month, this_year, YYYY or YYYY-MM" }
  );

const leaveTypeSchema = z.string().refine(
  (v): v is "annual" | "sick" | "casual" => ["annual", "sick", "casual"].includes(v),
  { message: "type must be annual, sick or casual" }
);

const ToolArgs = {
  get_headcount: z.object({
    department: departmentSchema.optional(),
    status: z.enum(["active", "inactive", "all"]).default("active"),
  }),
  get_attendance_summary: z.object({
    department: departmentSchema.optional(),
    period: periodSchema.optional(),
  }),
  get_late_comers: z.object({
    department: departmentSchema.optional(),
    period: periodSchema.optional(),
    limit: z.number().int().min(1).max(10).optional(),
  }),
  get_leave_summary: z.object({
    department: departmentSchema.optional(),
    period: periodSchema.optional(),
    type: leaveTypeSchema.optional(),
  }),
  get_my_leave_balance: z.object({
    type: leaveTypeSchema.optional(),
    year: z.number().int().min(2020).max(2100).optional(),
  }),
  get_payroll_summary: z.object({
    department: departmentSchema.optional(),
    period: periodSchema.optional(),
  }),
  search_employees: z.object({
    query: z.string().min(1).max(80),
    department: departmentSchema.optional(),
    limit: z.number().int().min(1).max(10).optional(),
  }),
  get_on_leave_today: z.object({}),
  get_pending_leave_requests: z.object({}),
} satisfies Record<ToolName, z.ZodTypeAny>;

// ---------------------------------------------------------------------------
// Gemini function declarations (Spec Section 6 catalog)
// ---------------------------------------------------------------------------

function schemaObject(properties: Record<string, unknown>, required: string[] = []) {
  return { type: "OBJECT", properties, required } as const;
}
function schemaString(description: string) {
  return { type: "STRING", description } as const;
}
function schemaNumber(description: string) {
  return { type: "NUMBER", description } as const;
}
function schemaEnum(description: string, values: string[]) {
  return { type: "STRING", description, enum: values } as const;
}

const DEPTS = ["Engineering", "Sales", "HR"];
const PERIODS = ["this_month", "last_month", "this_year"];

export const GEMINI_TOOL_DECLARATIONS = [
  {
    name: "get_headcount",
    description:
      "Count employees. Returns { department, status, count, as_of }. Use for 'how many employees' questions. For a manager this is scoped to their team.",
    parameters: schemaObject({
      department: schemaEnum("Filter by department; omit for all", DEPTS),
      status: schemaEnum("Employment status, default active", ["active", "inactive", "all"]),
    }),
  },
  {
    name: "get_attendance_summary",
    description:
      "Attendance aggregates for a period: present, absent, late, on_leave, working_days and attendance_rate. For employees this always returns the caller's OWN record only; for managers their team.",
    parameters: schemaObject({
      department: schemaEnum("Filter by department; omit for all", DEPTS),
      period: schemaEnum("Period, default this_month", PERIODS),
    }),
  },
  {
    name: "get_late_comers",
    description:
      "Ranking of employees with the most late arrivals in a period, with the late cutoff stated.",
    parameters: schemaObject({
      department: schemaEnum("Filter by department; omit for all", DEPTS),
      period: schemaEnum("Period, default this_month", PERIODS),
      limit: schemaNumber("Max people to return, 1-10, default 5"),
    }),
  },
  {
    name: "get_leave_summary",
    description:
      "Leave request aggregates by type and status (approved/pending/rejected counts) for a period.",
    parameters: schemaObject({
      department: schemaEnum("Filter by department; omit for all", DEPTS),
      period: schemaEnum("Period, default this_month", PERIODS),
      type: schemaEnum("Filter by leave type", ["annual", "sick", "casual"]),
    }),
  },
  {
    name: "get_my_leave_balance",
    description:
      "The CALLER'S OWN leave balance for a year: entitled, used_approved, pending and remaining per leave type. Takes no user parameter — it always uses the authenticated session.",
    parameters: schemaObject({
      type: schemaEnum("Optional single leave type", ["annual", "sick", "casual"]),
      year: schemaNumber("Calendar year, defaults to the current year"),
    }),
  },
  {
    name: "get_payroll_summary",
    description:
      "Aggregate payroll for a period: headcount, total and average only. Individual salaries are NEVER available.",
    parameters: schemaObject({
      department: schemaEnum("Filter by department; omit for all", DEPTS),
      period: schemaEnum("Period, default this_month", PERIODS),
    }),
  },
  {
    name: "search_employees",
    description:
      "Find employees by name, designation or department. Returns only safe fields (id, name, department, designation) — never salary, CNIC or bank details. Ambiguous matches return status 'ambiguous' with the candidate list.",
    parameters: schemaObject({
      query: schemaString("Name, designation or department to search for"),
      department: schemaEnum("Optional department filter", DEPTS),
      limit: schemaNumber("Max matches, 1-10, default 10"),
    }),
  },
  {
    name: "get_on_leave_today",
    description:
      "Who is on approved leave today: names, department, leave type and date range. Use for 'who is off today' questions.",
    parameters: schemaObject({}),
  },
  {
    name: "get_pending_leave_requests",
    description:
      "The leave requests currently awaiting approval (scoped: managers see their direct reports, HR/Admin see all): employee, type, dates and reason.",
    parameters: schemaObject({}),
  },
];

// ---------------------------------------------------------------------------
// Executor: validate -> authorise -> run -> wrap -> audit-log
// ---------------------------------------------------------------------------

export interface ExecuteOptions {
  feature: "chat" | "summary" | "smart_leave" | "policy";
}

export async function executeTool(
  db: SupabaseClient,
  name: string,
  rawArgs: unknown,
  session: SessionIdentity,
  options: ExecuteOptions
): Promise<ToolEnvelope> {
  const started = Date.now();
  const toolName = name as ToolName;
  const schema = (ToolArgs as Record<string, z.ZodTypeAny | undefined>)[name];

  if (!schema) {
    const envelope = errorEnvelope("unknown_tool", [`'${name}' is not a registered tool.`]);
    logCall(session, options.feature, name, null, "error", started, "unknown_tool");
    return envelope;
  }

  const parsed = schema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`);
    const envelope = errorEnvelope("invalid_arguments", issues);
    logCall(session, options.feature, name, rawArgs, "error", started, "invalid_arguments");
    return envelope;
  }

  const args = parsed.data as Record<string, unknown>;
  const permission = checkToolPermission(session.role, toolName);
  if (!permission.allowed) {
    // Permission denials land in the append-only audit trail (Checklist E.22).
    appendAuditEvent({
      action: "ai_permission_denied",
      actor: { userId: session.userId, name: session.name, role: session.role },
      targetType: "ai_request",
      targetId: name,
      details: { feature: options.feature, args },
    });
    logCall(session, options.feature, name, args, "forbidden", started, "forbidden");
    return forbidden("This request is not permitted for your role. The assistant cannot disclose it.");
  }

  let envelope: ToolEnvelope;
  try {
    envelope = await runTool(db, toolName, args, session, permission.restriction);
  } catch (err) {
    const envelope = errorEnvelope("tool_failure", [
      err instanceof Error ? err.message : "unknown error",
    ]);
    logCall(session, options.feature, name, args, "error", started, "tool_failure");
    return envelope;
  }

  logCall(session, options.feature, name, args, "ok", started, null);
  return envelope;
}

function scopeOf(session: SessionIdentity, department?: string): Scope {
  return { userId: session.userId, role: session.role, department };
}

async function runTool(
  db: SupabaseClient,
  toolName: ToolName,
  args: Record<string, unknown>,
  session: SessionIdentity,
  restriction?: "own_record_only" | "team_scope"
): Promise<ToolEnvelope> {
  const department = args.department as string | undefined;
  const period = args.period as string | undefined;

  switch (toolName) {
    case "get_headcount": {
      const result = await getHeadcountService(
        db,
        scopeOf(session, department),
        department,
        (args.status as "active" | "inactive" | "all") ?? "active"
      );
      return ok({ ...result }, { timezone: "Asia/Karachi" });
    }
    case "get_attendance_summary": {
      // Employee calls are scoped to their own record, whatever they asked for.
      const result =
        restriction === "own_record_only"
          ? await getMyAttendanceSummaryService(db, session.userId, period)
          : await getAttendanceSummaryService(db, scopeOf(session, department), department, period);
      if (result.working_days === 0) {
        return notFound("No attendance records found for that period.");
      }
      const meta: ToolEnvelope["meta"] = {
        period: result.period.label,
        timezone: result.period.timezone,
      };
      if (restriction === "own_record_only") {
        meta.note =
          "Restricted to the caller's own attendance records. If the user asked about someone else, say you can only share their own record.";
      } else if (restriction === "team_scope") {
        meta.note =
          "Scoped by Row Level Security to the caller and their direct reports. If the user asked about the whole company, say this covers only their team.";
      }
      return ok(
        {
          period: result.period.label,
          period_key: result.period.key,
          working_days: result.working_days,
          present: result.present,
          absent: result.absent,
          late: result.late,
          on_leave: result.on_leave,
          attendance_rate: result.attendance_rate,
          definition: result.definition,
        },
        meta
      );
    }
    case "get_late_comers": {
      const result = await getLateComersService(
        db,
        scopeOf(session, department),
        department,
        period,
        (args.limit as number | undefined) ?? 5
      );
      if (result.ranking.length === 0) {
        return notFound("No late arrivals recorded for that period.");
      }
      return ok(
        {
          period: result.period.label,
          late_cutoff: `${result.late_cutoff} (${result.timezone})`,
          ranking: result.ranking,
        },
        { period: result.period.label, timezone: result.period.timezone }
      );
    }
    case "get_leave_summary": {
      const result = await getLeaveSummaryService(
        db,
        scopeOf(session, department),
        department,
        period,
        args.type as "annual" | "sick" | "casual" | undefined
      );
      return ok(
        { period: result.period.label, by_type_and_status: result.by_type_and_status },
        { period: result.period.label, timezone: result.period.timezone }
      );
    }
    case "get_my_leave_balance": {
      const result = await getMyLeaveBalanceService(
        db,
        session.userId,
        args.year as number | undefined
      );
      const type = args.type as "annual" | "sick" | "casual" | undefined;
      const balances = type ? result.balances.filter((b) => b.type === type) : result.balances;
      return ok(
        {
          year: result.year,
          balances,
          note: "Remaining counts approved leaves only; pending requests are excluded.",
        },
        { timezone: "Asia/Karachi" }
      );
    }
    case "get_payroll_summary": {
      const result = await getPayrollSummaryService(
        db,
        scopeOf(session, department),
        department,
        period
      );
      if (!result) {
        return forbidden("Payroll aggregates are restricted to HR and Admin.");
      }
      return ok(
        {
          period: result.period.label,
          headcount: result.headcount,
          total: result.total,
          average: result.average,
          note: result.note,
        },
        { period: result.period.label, timezone: result.period.timezone }
      );
    }
    case "search_employees": {
      const result = await searchEmployeesService(
        db,
        args.query as string,
        department,
        (args.limit as number | undefined) ?? 10
      );
      if (result.total === 0) {
        return notFound("No employees match that search.");
      }
      const payload: Record<string, unknown> = {
        query: result.query,
        matches: result.matches,
      };
      if (result.total > 1) {
        return {
          status: "ambiguous",
          data: {
            ...payload,
            note: "Multiple employees match. Ask the user to choose from the matches; do not guess.",
          },
          meta: {},
        };
      }
      return ok(payload, {});
    }
    case "get_on_leave_today": {
      const result = await getOnLeaveTodayService(db);
      if (result.rows.length === 0) {
        return notFound(`No one is on approved leave today (${result.date}).`);
      }
      return ok(
        {
          date: result.date,
          on_leave: result.rows,
          count: result.rows.length,
        },
        { timezone: "Asia/Karachi" }
      );
    }
    case "get_pending_leave_requests": {
      const result = await getPendingLeaveRequestsService(db);
      if (result.rows.length === 0) {
        return notFound("There are no leave requests waiting for approval.");
      }
      return ok(
        {
          date: result.date,
          pending: result.rows.map((r) => ({
            request_id: r.id,
            employee_name: r.employee_name,
            department: r.department,
            type: r.leave_type_id,
            start: r.start_date,
            end: r.end_date,
            days: r.days,
            reason: r.reason,
          })),
          count: result.rows.length,
        },
        { timezone: "Asia/Karachi" }
      );
    }
  }
}

function logCall(
  session: SessionIdentity,
  feature: "chat" | "summary" | "smart_leave" | "policy",
  name: string,
  args: unknown,
  toolStatus: "ok" | "forbidden" | "error",
  started: number,
  errorCode: string | null
): void {
  appendAuditEvent({
    action: "ai_call",
    actor: { userId: session.userId, name: session.name, role: session.role },
    targetType: "ai_request",
    targetId: name,
    details: {
      feature,
      tool_name: name,
      tool_status: toolStatus,
      latency_ms: Date.now() - started,
      error_code: errorCode,
      // Arguments are pre-sanitised: salary/PII never reaches the audit trail
      // because the pre-model guard blocks such requests before any tool runs.
      args: args ?? null,
    },
  });
}
