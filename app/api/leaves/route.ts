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
  findEmployeeById,
  LEAVE_REQUESTS,
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
