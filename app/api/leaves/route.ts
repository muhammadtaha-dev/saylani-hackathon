/**
 * Standard leave application endpoint (the "standard leave endpoint" the AI
 * must never call — LEAVE-07). Applies the same validation pipeline as the
 * Smart Leave pre-fill — past dates, order, holidays (from public.holidays),
 * weekends, overlap and balance — then records a PENDING request. The insert
 * runs with the caller's JWT, so RLS guarantees the request can only be
 * created for the caller themselves. Decisions (PATCH) are for Admin/HR or
 * the employee's manager; every step is audit-logged and the affected people
 * get Realtime notifications.
 *
 * GET  /api/leaves — my requests (employee) or everything visible per RLS.
 * POST /api/leaves — { type, start, end, reason, attachment_path? } -> pending.
 */

import { requireSession } from "@/lib/session";
import { supabaseServer, supabaseConfigured } from "@/lib/supabase/server";
import {
  getHolidaysBetween,
  getMyLeaveBalanceService,
  getTeamOverlapService,
  todayIso,
} from "@/lib/services";
import { isValidIsoDate, workingDaysBetween, approvalRiskNote } from "@/lib/smartLeave";
import { appendAuditEventAsync, ipFromRequest } from "@/lib/audit";

const LEAVE_TYPE_SET = ["annual", "sick", "casual"] as const;
type LeaveTypeId = (typeof LEAVE_TYPE_SET)[number];

export async function GET() {
  if (!supabaseConfigured()) {
    return Response.json({ configured: false, error: "The database is not configured yet." }, { status: 503 });
  }
  const auth = await requireSession();
  if ("response" in auth) return auth.response;
  const supabase = await supabaseServer();

  // RLS scopes this automatically: employees see their own, managers their
  // own + direct reports, HR/Admin everything.
  const { data, error } = await supabase
    .from("leave_requests")
    .select(
      "*, profiles!leave_requests_employee_id_fkey(full_name, department)"
    )
    .order("applied_at", { ascending: false });
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []).map((r: Record<string, unknown>) => {
    const profile = r.profiles as { full_name: string; department: string } | null;
    return {
      id: r.id,
      employee_id: r.employee_id,
      employee_name: profile?.full_name ?? r.employee_id,
      department: profile?.department ?? "",
      type: r.leave_type_id,
      start: r.start_date,
      end: r.end_date,
      days: Number(r.days),
      status: r.status,
      reason: r.reason,
      decision_comment: r.decision_comment,
      attachment_path: r.attachment_path,
      appliedOn: (r.applied_at as string)?.slice(0, 10) ?? "",
    };
  });

  return Response.json({
    scope: auth.session.role === "employee" ? "own" : "visible",
    requests: rows,
  });
}

export async function POST(request: Request) {
  if (!supabaseConfigured()) {
    return Response.json({ configured: false, error: "The database is not configured yet." }, { status: 503 });
  }
  const auth = await requireSession();
  if ("response" in auth) return auth.response;
  const supabase = await supabaseServer();
  const session = auth.session;

  const body = (await request.json().catch(() => null)) as
    | { type?: unknown; start?: unknown; end?: unknown; reason?: unknown; attachment_path?: unknown }
    | null;
  const type = body?.type;
  const start = body?.start;
  const end = body?.end;
  const reason = body?.reason;
  const attachmentPath = typeof body?.attachment_path === "string" ? body.attachment_path : null;

  if (typeof type !== "string" || !LEAVE_TYPE_SET.includes(type as LeaveTypeId)) {
    return Response.json({ error: "Please choose a valid leave type (annual, sick or casual)." }, { status: 400 });
  }
  if (typeof start !== "string" || typeof end !== "string" || !isValidIsoDate(start) || !isValidIsoDate(end)) {
    return Response.json({ error: "Please provide valid start and end dates (YYYY-MM-DD)." }, { status: 400 });
  }
  if (start > end) {
    return Response.json({ error: "The start date must be on or before the end date." }, { status: 400 });
  }
  if (end < todayIso()) {
    return Response.json({ error: "Leave dates cannot be in the past." }, { status: 400 });
  }
  if (typeof reason !== "string" || reason.trim().length < 3 || reason.trim().length > 200) {
    return Response.json({ error: "Please add a short reason (3–200 characters)." }, { status: 400 });
  }

  // Public holidays for the range (from the database).
  const holidays = await getHolidaysBetween(supabase, start, end);

  // Overlap with an existing pending/approved request.
  const { data: overlaps } = await supabase
    .from("leave_requests")
    .select("id")
    .eq("employee_id", session.userId)
    .in("status", ["pending", "approved"])
    .lte("start_date", end)
    .gte("end_date", start);
  if ((overlaps ?? []).length > 0) {
    return Response.json(
      { error: "You already have a pending or approved leave overlapping those dates." },
      { status: 400 }
    );
  }

  // Balance check (working days only — weekends and public holidays are not leave days).
  const days = workingDaysBetween(start, end, new Set(holidays.keys()));
  if (days <= 0) {
    return Response.json(
      { error: "That range contains no working days (weekends and public holidays are not counted)." },
      { status: 400 }
    );
  }
  const year = Number(start.slice(0, 4));
  const balance = (await getMyLeaveBalanceService(supabase, session.userId, year)).balances.find(
    (b) => b.type === type
  );
  if (balance && days > balance.remaining) {
    return Response.json(
      {
        error: `Insufficient ${type} leave balance: this request needs ${days} working day(s) but only ${balance.remaining} remain after approved leaves. Pending requests are not deducted.`,
      },
      { status: 400 }
    );
  }

  const { data: inserted, error: insertError } = await supabase
    .from("leave_requests")
    .insert({
      employee_id: session.userId, // RLS with-check forces this to be the caller
      leave_type_id: type as LeaveTypeId,
      start_date: start,
      end_date: end,
      days,
      status: "pending",
      reason: reason.trim(),
      attachment_path: attachmentPath,
    })
    .select("id, employee_id, leave_type_id, start_date, end_date, days, status, reason, applied_at")
    .single();

  if (insertError || !inserted) {
    return Response.json(
      { error: insertError?.message ?? "Could not submit the leave request." },
      { status: 400 }
    );
  }

  await appendAuditEventAsync({
    action: "leave_submitted",
    actor: { userId: session.userId, name: session.name, role: session.role },
    targetType: "leave_request",
    targetId: inserted.id,
    ip: ipFromRequest(request),
    after: { ...inserted },
  });

  // Notify the approvers (the employee's manager, plus HR/Admin) — they get
  // the message over Supabase Realtime.
  const recipients = new Set<string>();
  if (session.managerId) recipients.add(session.managerId);
  const { data: hrAdmins } = await supabase
    .from("profiles")
    .select("id")
    .in("role", ["hr", "admin"])
    .eq("status", "active");
  for (const p of hrAdmins ?? []) recipients.add(p.id);
  recipients.delete(session.userId);
  if (recipients.size > 0) {
    await supabase.from("notifications").insert(
      [...recipients].map((userId) => ({
        user_id: userId,
        title: "New leave request",
        body: `${session.name} requested ${type} leave ${start} → ${end} (${days} day${days === 1 ? "" : "s"}).`,
        type: "leave_submitted",
        link: "/",
      }))
    );
  }

  // Smart suggestions (D.17): team-overlap warning + plain-language risk note.
  const overlap = await getTeamOverlapService(supabase, start, end);
  const warnings: string[] = [];
  if (overlap.offCount > 0) {
    warnings.push(
      `${overlap.offCount} of your ${overlap.teamSize} teammates are already approved off during those dates.`
    );
  }
  const riskNote = approvalRiskNote({
    type: type as LeaveTypeId,
    requestedWorkingDays: days,
    remaining: balance?.remaining ?? 0,
    pendingDays: balance?.pending ?? 0,
    offCount: overlap.offCount,
    teamSize: overlap.teamSize,
    offNames: overlap.offNames.map((o) => o.name),
  });

  return Response.json({ request: inserted, warnings, risk_note: riskNote }, { status: 201 });
}

/**
 * PATCH /api/leaves — Admin/HR (any request) or the employee's manager (their
 * reports' requests) approve or reject a PENDING request. Rejection requires
 * a comment. Approval writes 'leave' attendance rows for the working days so
 * the calendar reconciles. Both decisions are audit-logged with before/after
 * values and notified over Realtime.
 */
export async function PATCH(request: Request) {
  if (!supabaseConfigured()) {
    return Response.json({ configured: false, error: "The database is not configured yet." }, { status: 503 });
  }
  const auth = await requireSession();
  if ("response" in auth) return auth.response;
  if (!["admin", "hr", "manager"].includes(auth.session.role)) {
    return Response.json(
      { error: "Only Admin, HR and the employee's manager can process leave requests." },
      { status: 403 }
    );
  }
  const supabase = await supabaseServer();
  const session = auth.session;

  const body = (await request.json().catch(() => null)) as
    | { id?: unknown; status?: unknown; comment?: unknown }
    | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const status = typeof body?.status === "string" ? body.status : "";
  const comment = typeof body?.comment === "string" ? body.comment.trim().slice(0, 300) : "";
  if (!id || (status !== "approved" && status !== "rejected")) {
    return Response.json({ error: "Please provide a request id and status (approved/rejected)." }, { status: 400 });
  }
  if (status === "rejected" && comment.length < 3) {
    return Response.json(
      { error: "Please add a short comment so the employee knows why the request was rejected." },
      { status: 400 }
    );
  }

  const { data: leaveRequest } = await supabase
    .from("leave_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!leaveRequest) {
    // 404 both when it does not exist and when RLS hides it from this caller.
    return Response.json({ error: "Leave request not found." }, { status: 404 });
  }
  if (leaveRequest.status !== "pending") {
    return Response.json(
      { error: `This request was already ${leaveRequest.status}.` },
      { status: 400 }
    );
  }

  const before = { ...leaveRequest };
  const { data: updated, error: updateError } = await supabase
    .from("leave_requests")
    .update({
      status,
      decision_comment: comment || null,
      decided_by: session.userId, // server-side identity, never from the body
      decided_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (updateError || !updated) {
    // RLS or the guard trigger refused the decision for this caller.
    return Response.json(
      { error: updateError?.message ?? "You are not allowed to decide this request." },
      { status: 403 }
    );
  }

  if (status === "approved") {
    // Keep the attendance calendar consistent: mark the working days as leave.
    const holidays = await getHolidaysBetween(supabase, updated.start_date, updated.end_date);
    const rows: { employee_id: string; date: string; status: "leave" }[] = [];
    let cursor = updated.start_date;
    while (cursor <= updated.end_date) {
      const wd = new Date(`${cursor}T00:00:00Z`).getUTCDay();
      if (wd !== 0 && wd !== 6 && !holidays.has(cursor)) {
        rows.push({ employee_id: updated.employee_id, date: cursor, status: "leave" });
      }
      cursor = addDaysIso(cursor, 1);
    }
    if (rows.length > 0) {
      await supabase.from("attendance").upsert(rows, { onConflict: "employee_id,date" });
    }
  }

  await appendAuditEventAsync({
    action: status === "approved" ? "leave_approved" : "leave_rejected",
    actor: { userId: session.userId, name: session.name, role: session.role },
    targetType: "leave_request",
    targetId: id,
    ip: ipFromRequest(request),
    before,
    after: { ...updated },
    details: comment ? { comment } : null,
  });

  await supabase.from("notifications").insert({
    user_id: updated.employee_id,
    title: status === "approved" ? "Leave approved" : "Leave rejected",
    body:
      status === "approved"
        ? `Your ${updated.leave_type_id} leave ${updated.start_date} → ${updated.end_date} was approved by ${session.name}.`
        : `Your ${updated.leave_type_id} leave ${updated.start_date} → ${updated.end_date} was rejected by ${session.name}: ${comment}`,
    type: status === "approved" ? "leave_approved" : "leave_rejected",
    link: "/",
  });

  const { data: employee } = await supabase
    .from("profiles")
    .select("full_name, department")
    .eq("id", updated.employee_id)
    .single();

  return Response.json({
    request: {
      ...updated,
      employee_name: employee?.full_name ?? updated.employee_id,
      department: employee?.department ?? "",
    },
    note:
      status === "approved"
        ? "Approved — the employee's remaining balance now reflects this leave."
        : "Rejected — the employee's balance is unaffected (pending leaves never consumed quota).",
  });
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}
