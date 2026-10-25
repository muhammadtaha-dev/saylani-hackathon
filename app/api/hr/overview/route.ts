/**
 * GET /api/hr/overview?department=Sales — HR operations data for Admin/HR:
 * latecomers ranking, per-employee attendance report and the leave summary,
 * all for the current month and computed by the shared service layer.
 * Employees receive 403.
 */

import { DEPARTMENTS, type DepartmentName } from "@/lib/hcmData";
import { getSession } from "@/lib/session";
import {
  getEmployeeAttendanceReport,
  getLateComersService,
  getLeaveSummaryService,
} from "@/lib/services";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }
  if (session.role !== "admin" && session.role !== "hr") {
    return Response.json(
      { error: "Only Admin and HR can view HR operations data." },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const departmentParam = url.searchParams.get("department") ?? undefined;
  const department =
    departmentParam && (DEPARTMENTS as string[]).includes(departmentParam)
      ? (departmentParam as DepartmentName)
      : undefined;

  const lateComers = getLateComersService(department, "this_month", 10);
  const attendance = getEmployeeAttendanceReport(department, "this_month");
  const leaveSummary = getLeaveSummaryService(department, "this_month");

  return Response.json({
    period: lateComers.period,
    late_cutoff: lateComers.late_cutoff,
    timezone: lateComers.timezone,
    late_comers: lateComers.ranking,
    attendance: attendance.rows,
    leave_summary: leaveSummary.by_type_and_status,
  });
}
