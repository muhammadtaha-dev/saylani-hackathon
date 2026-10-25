/**
 * HCM Lite — tool registry (Art. II closed list, Art. IV tool-calling rules).
 *
 * Seven tools, each with a strict typed schema. The executor validates
 * arguments (never silently "fixing" them), checks role x tool x arguments
 * via the shared permission layer, runs the shared service in the caller's
 * scope, and wraps everything in the common result envelope. Every call is
 * appended to ai_logs.
 */

import { z } from "zod";
import {
  DEPARTMENTS,
  type DepartmentName,
  type LeaveType,
} from "./hcmData";
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
} from "./services";
import { appendAiLog, type AiFeature } from "./aiLogs";
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
  .refine((v): v is DepartmentName => (DEPARTMENTS as string[]).includes(v), {
    message: `department must be one of: ${DEPARTMENTS.join(", ")}`,
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
  (v): v is LeaveType => ["annual", "sick", "casual"].includes(v),
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
      "Count employees. Returns { department, status, count, as_of }. Use for 'how many employees' questions.",
    parameters: schemaObject({
      department: schemaEnum("Filter by department; omit for all", DEPTS),
      status: schemaEnum("Employment status, default active", ["active", "inactive", "all"]),
    }),
  },
  {
    name: "get_attendance_summary",
    description:
      "Attendance aggregates for a period: present, absent, late, on_leave, working_days and attendance_rate. For employees this always returns the caller's OWN record only.",
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
      "The leave requests currently awaiting approval: employee, type, dates and reason. Admin/HR only.",
    parameters: schemaObject({}),
  },
];

// ---------------------------------------------------------------------------
// Executor: validate -> authorise -> run -> wrap -> log
// ---------------------------------------------------------------------------

export interface ExecuteOptions {
  feature: AiFeature;
}

export async function executeTool(
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
    logCall(session, options.feature, name, null, "error", envelope, started, "unknown_tool");
    return envelope;
  }

  const parsed = schema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`);
    const envelope = errorEnvelope("invalid_arguments", issues);
    logCall(session, options.feature, name, rawArgs, "error", envelope, started, "invalid_arguments");
    return envelope;
  }

  const args = parsed.data as Record<string, unknown>;
  const permission = checkToolPermission(session.role, toolName);
  if (!permission.allowed) {
    const envelope = forbidden(
      "This request is not permitted for your role. The assistant cannot disclose it."
    );
    logCall(session, options.feature, name, args, "forbidden", envelope, started, "forbidden");
    // Permission denials also land in the unified audit trail (Checklist E.22).
    appendAuditEvent({
      action: "ai_permission_denied",
      actor: { userId: session.userId, name: session.name, role: session.role },
      targetType: "ai_request",
      targetId: name,
      details: { feature: options.feature, args },
    });
    return envelope;
  }

  let envelope: ToolEnvelope;
  try {
    envelope = runTool(toolName, args, session, permission.restriction);
  } catch (err) {
    const envelope = errorEnvelope("tool_failure", [
      err instanceof Error ? err.message : "unknown error",
    ]);
    logCall(session, options.feature, name, args, "error", envelope, started, "tool_failure");
    return envelope;
  }

  logCall(session, options.feature, name, args, "ok", envelope, started, null);
  return envelope;
}

function runTool(
  toolName: ToolName,
  args: Record<string, unknown>,
  session: SessionIdentity,
  restriction?: "own_record_only"
): ToolEnvelope {
  const department = args.department as DepartmentName | undefined;
  const period = args.period as string | undefined;

  switch (toolName) {
    case "get_headcount": {
      const result = getHeadcountService(
        department,
        (args.status as "active" | "inactive" | "all") ?? "active"
      );
      return ok({ ...result }, { timezone: "Asia/Karachi" });
    }
    case "get_attendance_summary": {
      // Employee calls are scoped to their own record, whatever they asked for.
      const result =
        restriction === "own_record_only"
          ? getMyAttendanceSummaryService(session.userId, period)
          : getAttendanceSummaryService(department, period);
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
      const result = getLateComersService(
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
      const result = getLeaveSummaryService(
        department,
        period,
        args.type as LeaveType | undefined
      );
      return ok(
        { period: result.period.label, by_type_and_status: result.by_type_and_status },
        { period: result.period.label, timezone: result.period.timezone }
      );
    }
    case "get_my_leave_balance": {
      const result = getMyLeaveBalanceService(
        session.userId,
        args.year as number | undefined
      );
      const type = args.type as LeaveType | undefined;
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
      const result = getPayrollSummaryService(department, period);
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
      const result = searchEmployeesService(
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
      const result = getOnLeaveTodayService();
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
      const result = getPendingLeaveRequestsService();
      if (result.rows.length === 0) {
        return notFound("There are no leave requests waiting for approval.");
      }
      return ok(
        {
          date: result.date,
          pending: result.rows,
          count: result.rows.length,
        },
        { timezone: "Asia/Karachi" }
      );
    }
  }
}

function logCall(
  session: SessionIdentity,
  feature: AiFeature,
  name: string,
  args: unknown,
  toolStatus: "ok" | "forbidden" | "error",
  envelope: ToolEnvelope,
  started: number,
  errorCode: string | null
): void {
  appendAiLog(session, {
    feature,
    tool_name: name,
    tool_args: args,
    tool_status: toolStatus,
    outcome:
      toolStatus === "forbidden"
        ? "refused"
        : toolStatus === "error"
          ? "fallback"
          : envelope.status === "not_found" || envelope.status === "ambiguous"
            ? "answered"
            : "answered",
    latency_ms: Date.now() - started,
    provider: "none",
    error_code: errorCode,
  });
}
