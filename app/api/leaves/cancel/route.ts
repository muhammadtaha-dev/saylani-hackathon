/**
 * POST /api/leaves/cancel — an employee cancels one of their own requests
 * (Checklist D.19). Allowed while the request is PENDING, or APPROVED and
 * still in the future (start > today). The UPDATE runs with the caller's JWT
 * and the DB guard trigger permits ONLY a status flip to 'cancelled' by the
 * owner — nothing else can ever be edited. Cancelling an approved future
 * leave releases its quota automatically (balance is computed from approved
 * requests) and the action is audit-logged.
 */

import { requireSession } from "@/lib/session";
import { supabaseServer, supabaseConfigured } from "@/lib/supabase/server";
import { todayIso } from "@/lib/services";
import { appendAuditEventAsync, ipFromRequest } from "@/lib/audit";

export async function POST(request: Request) {
  if (!supabaseConfigured()) {
    return Response.json({ configured: false, error: "The database is not configured yet." }, { status: 503 });
  }
  const auth = await requireSession();
  if ("response" in auth) return auth.response;
  const supabase = await supabaseServer();

  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) {
    return Response.json({ error: "Please provide the leave request id." }, { status: 400 });
  }

  const { data: leaveRequest } = await supabase
    .from("leave_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!leaveRequest || leaveRequest.employee_id !== auth.session.userId) {
    // Same message whether it does not exist or belongs to someone else.
    return Response.json({ error: "Leave request not found among your requests." }, { status: 404 });
  }

  if (leaveRequest.status === "cancelled") {
    return Response.json({ error: "This request is already cancelled." }, { status: 400 });
  }
  const cancellable =
    leaveRequest.status === "pending" ||
    (leaveRequest.status === "approved" && leaveRequest.start_date > todayIso());
  if (!cancellable) {
    return Response.json(
      {
        error:
          leaveRequest.status === "approved"
            ? "Approved leave that has already started cannot be cancelled — please contact HR."
            : `A ${leaveRequest.status} request cannot be cancelled.`,
      },
      { status: 400 }
    );
  }

  const before = { ...leaveRequest };
  // decided_by stays untouched: the DB guard trigger only lets the owner
  // change status to 'cancelled'.
  const { data: updated, error: updateError } = await supabase
    .from("leave_requests")
    .update({ status: "cancelled" })
    .eq("id", id)
    .select("*")
    .single();
  if (updateError || !updated) {
    return Response.json(
      { error: updateError?.message ?? "Could not cancel the request." },
      { status: 403 }
    );
  }

  await appendAuditEventAsync({
    action: "leave_cancelled",
    actor: { userId: auth.session.userId, name: auth.session.name, role: auth.session.role },
    targetType: "leave_request",
    targetId: id,
    ip: ipFromRequest(request),
    before,
    after: { ...updated },
  });

  // Notify the manager if there is one.
  if (auth.session.managerId) {
    await supabase.from("notifications").insert({
      user_id: auth.session.managerId,
      title: "Leave cancelled",
      body: `${auth.session.name} cancelled their ${updated.leave_type_id} leave ${updated.start_date} → ${updated.end_date}.`,
      type: "leave_cancelled",
      link: "/",
    });
  }

  return Response.json({
    request: updated,
    note:
      before.status === "approved"
        ? "Cancelled — the approved days are returned to your balance."
        : "Cancelled — nothing was deducted while the request was pending.",
  });
}
