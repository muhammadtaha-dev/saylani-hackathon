/**
 * GET /api/dashboard?department=Sales — dashboard payload.
 * Admin/HR receive the organisation KPIs (payroll included); employees
 * receive only their own snapshot. One service layer, one permission system.
 */

import { DEPARTMENTS, type DepartmentName } from "@/lib/hcmData";
import { getSession } from "@/lib/session";
import { getDashboardKpis, getMySnapshotService } from "@/lib/services";
import { AI_ENABLED, AI_MODEL } from "@/lib/gemini";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const url = new URL(request.url);
  const departmentParam = url.searchParams.get("department") ?? undefined;
  const department =
    departmentParam && (DEPARTMENTS as string[]).includes(departmentParam)
      ? (departmentParam as DepartmentName)
      : undefined;

  if (session.role === "employee") {
    return Response.json({
      role: session.role,
      scope: session.department,
      my: getMySnapshotService(session.userId),
      ai: { enabled: AI_ENABLED, model: AI_ENABLED ? AI_MODEL : "grounded-mock" },
    });
  }

  return Response.json({
    role: session.role,
    scope: "All departments",
    kpis: getDashboardKpis(department),
    ai: { enabled: AI_ENABLED, model: AI_ENABLED ? AI_MODEL : "grounded-mock" },
  });
}
