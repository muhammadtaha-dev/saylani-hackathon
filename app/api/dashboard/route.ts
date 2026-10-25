/**
 * GET /api/dashboard?department=Sales — dashboard payload, scoped by role.
 * The queries run with the caller's Supabase JWT, so Row Level Security is
 * the hard bound; the service layer additionally narrows manager queries to
 * own + direct reports. Employees receive only their own snapshot; managers
 * receive team KPIs plus their own snapshot; HR/Admin receive org KPIs
 * (payroll only when the caller can actually read compensations).
 */

import { requireSession } from "@/lib/session";
import { supabaseServer, supabaseConfigured } from "@/lib/supabase/server";
import { getDashboardKpis, getMySnapshotService } from "@/lib/services";
import { AI_ENABLED, AI_MODEL } from "@/lib/gemini";

export async function GET(request: Request) {
  if (!supabaseConfigured()) {
    return Response.json(
      { configured: false, error: "The database is not configured yet." },
      { status: 503 }
    );
  }
  const auth = await requireSession();
  if ("response" in auth) return auth.response;

  const supabase = await supabaseServer();
  const url = new URL(request.url);
  const departmentParam = url.searchParams.get("department") ?? undefined;
  const department =
    departmentParam && departmentParam !== "All" ? departmentParam : undefined;

  const my =
    auth.session.role === "employee" || auth.session.role === "manager"
      ? await getMySnapshotService(supabase, auth.session.userId)
      : null;

  const kpis =
    auth.session.role === "admin" ||
    auth.session.role === "hr" ||
    auth.session.role === "manager"
      ? await getDashboardKpis(supabase, auth.session, department)
      : null;

  return Response.json({
    configured: true,
    role: auth.session.role,
    scope: auth.session.role === "manager" ? "Team (own + direct reports)" : auth.session.department,
    kpis,
    my,
    ai: { enabled: AI_ENABLED, model: AI_ENABLED ? AI_MODEL : "grounded-mock" },
  });
}
