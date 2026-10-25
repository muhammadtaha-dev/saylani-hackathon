/**
 * GET /api/hr/overview?department=Sales — HR operations data for
 * Admin/HR/Manager: latecomers ranking, per-employee attendance report and
 * the leave summary. Managers are scoped by RLS + service layer to their own
 * records plus direct reports. Employees receive 403.
 */

import { requireSession } from "@/lib/session";
import { supabaseServer, supabaseConfigured } from "@/lib/supabase/server";
import {
  getEmployeeAttendanceReport,
  getLateComersService,
  getLeaveSummaryService,
} from "@/lib/services";

export async function GET(request: Request) {
  if (!supabaseConfigured()) {
    return Response.json(
      { configured: false, error: "The database is not configured yet." },
      { status: 503 }
    );
  }
  const auth = await requireSession();
  if ("response" in auth) return auth.response;
  if (auth.session.role === "employee") {
    return Response.json(
      { error: "Only Admin, HR and managers can view HR operations data." },
      { status: 403 }
    );
  }

  const supabase = await supabaseServer();
  const url = new URL(request.url);
  const departmentParam = url.searchParams.get("department") ?? undefined;
  const department =
    departmentParam && departmentParam !== "All" ? departmentParam : undefined;
  const scope = { ...auth.session, department };

  const lateComers = await getLateComersService(supabase, scope, department, "this_month", 10);
  const attendance = await getEmployeeAttendanceReport(supabase, scope, department, "this_month");
  const leaveSummary = await getLeaveSummaryService(supabase, scope, department, "this_month");

  return Response.json({
    period: lateComers.period,
    late_cutoff: lateComers.late_cutoff,
    timezone: lateComers.timezone,
    late_comers: lateComers.ranking,
    attendance: attendance.rows,
    leave_summary: leaveSummary.by_type_and_status,
  });
}
