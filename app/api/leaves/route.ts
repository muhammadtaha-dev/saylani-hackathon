/**
 * Standard leave application endpoint (the "standard leave endpoint" the AI
 * must never call — LEAVE-07). Applies the same validation pipeline as the
 * Smart Leave pre-fill, plus balance and overlap checks, then records a
 * PENDING request for HR approval. The AI never writes anything.
 *
 * GET  /api/leaves — my requests (employee) or all requests (Admin/HR).
 * POST /api/leaves — { type, start, end, reason } -> pending leave request.
 */

import {
  addLeaveRequest,
  ATTENDANCE_RECORDS,
  findEmployeeById,
  LEAVE_REQUESTS,
  type LeaveStatus,
  type LeaveType,
} from "@/lib/hcmData";
import { getSession } from "@/lib/session";
import { getMyLeaveBalanceService, todayIso } from "@/lib/services";
import { isValidIsoDate, workingDaysBetween } from "@/lib/smartLeave";

const LEAVE_TYPE_SET: LeaveType[] = ["annual", "sick", "casual"];

export async function GET() {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }
  if (session.role === "employee") {
    return Response.json({
      scope: "own",
      requests: LEAVE_REQUESTS.filter((lr) => lr.employeeId === session.userId).sort((a, b) =>
        b.appliedOn.localeCompare(a.appliedOn)
      ),
    });
  }
  return Response.json({
    scope: "all",
    requests: LEAVE_REQUESTS.map((lr) => {
      const employee = findEmployeeById(lr.employeeId);
      return { ...lr, employee_name: employee?.name ?? lr.employeeId, department: employee?.department ?? "" };
    }).sort((a, b) => b.appliedOn.localeCompare(a.appliedOn)),
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { type?: unknown; start?: unknown; end?: unknown; reason?: unknown }
    | null;
  const type = body?.type;
  const start = body?.start;
  const end = body?.end;
  const reason = body?.reason;

  if (typeof type !== "string" || !LEAVE_TYPE_SET.includes(type as LeaveType)) {
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

  // Overlap with an existing pending/approved request.
  const overlaps = LEAVE_REQUESTS.some(
    (lr) =>
      lr.employeeId === session.userId &&
      (lr.status === "pending" || lr.status === "approved") &&
      lr.start <= end &&
      lr.end >= start
  );
  if (overlaps) {
    return Response.json(
      { error: "You already have a pending or approved leave overlapping those dates." },
      { status: 400 }
    );
  }

  // Balance check (working days only — weekends are not leave days).
  const days = workingDaysBetween(start, end);
  if (days <= 0) {
    return Response.json(
      { error: "That range contains no working days (weekends are not counted)." },
      { status: 400 }
    );
  }
  const year = Number(start.slice(0, 4));
  const balance = getMyLeaveBalanceService(session.userId, year).balances.find((b) => b.type === type);
  if (balance && days > balance.remaining) {
    return Response.json(
      {
        error: `Insufficient ${type} leave balance: this request needs ${days} working day(s) but only ${balance.remaining} remain after approved leaves. Pending requests are not deducted.`,
      },
      { status: 400 }
    );
  }

  const nowIso = new Date().toISOString();
  const newRequest = {
    id: `LR-${Date.now()}`,
    employeeId: session.userId,
    type: type as LeaveType,
    start,
    end,
    days,
    status: "pending" as const,
    reason: reason.trim(),
    appliedOn: nowIso.slice(0, 10),
  };
  addLeaveRequest(newRequest);

  return Response.json({ request: newRequest }, { status: 201 });
}

/**
 * PATCH /api/leaves — Admin/HR approve or reject a PENDING leave request.
 * Approval updates the employee's balance automatically (only approved
 * leaves consume quota) and marks seeded attendance days as "leave" when
 * the range overlaps recorded working days. Employees cannot access this.
 */
export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }
  if (session.role !== "admin" && session.role !== "hr") {
    return Response.json(
      { error: "Only Admin and HR can process leave requests." },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { id?: unknown; status?: unknown }
    | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const status = typeof body?.status === "string" ? (body.status as LeaveStatus) : "";
  if (!id || (status !== "approved" && status !== "rejected")) {
    return Response.json({ error: "Please provide a request id and status (approved/rejected)." }, { status: 400 });
  }

  const leaveRequest = LEAVE_REQUESTS.find((lr) => lr.id === id);
  if (!leaveRequest) {
    return Response.json({ error: "Leave request not found." }, { status: 404 });
  }
  if (leaveRequest.status !== "pending") {
    return Response.json(
      { error: `This request was already ${leaveRequest.status}.` },
      { status: 400 }
    );
  }

  leaveRequest.status = status;

  // Keep attendance consistent with the approved leave (seeded days only).
  if (status === "approved") {
    for (const record of ATTENDANCE_RECORDS) {
      if (
        record.employeeId === leaveRequest.employeeId &&
        record.date >= leaveRequest.start &&
        record.date <= leaveRequest.end
      ) {
        record.status = "leave";
        delete record.checkIn;
      }
    }
  }

  const employee = findEmployeeById(leaveRequest.employeeId);
  return Response.json({
    request: {
      ...leaveRequest,
      employee_name: employee?.name ?? leaveRequest.employeeId,
      department: employee?.department ?? "",
    },
    note:
      status === "approved"
        ? "Approved — the employee's remaining balance now reflects this leave."
        : "Rejected — the employee's balance is unaffected (pending leaves never consumed quota).",
  });
}
