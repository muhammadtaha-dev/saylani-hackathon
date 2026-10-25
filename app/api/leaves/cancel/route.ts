/**
 * POST /api/leaves/cancel — an employee cancels one of their own requests
 * (Checklist D.19). Allowed while the request is PENDING, or APPROVED and
 * still in the future (start > today). Cancelling an approved future leave
 * releases its quota automatically — only approved leaves consume balance —
 * and reverts any seeded attendance records in the range back to present.
 * Admin/HR use PATCH (approve/reject) instead; they do not cancel here.
 */

import { ATTENDANCE_RECORDS, LEAVE_REQUESTS, setLeaveRequestStatus } from "@/lib/hcmData";
import { getSession } from "@/lib/session";
import { todayIso } from "@/lib/services";
import { appendAuditEvent, ipFromRequest } from "@/lib/audit";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) {
    return Response.json({ error: "Please provide the leave request id." }, { status: 400 });
  }

  const leaveRequest = LEAVE_REQUESTS.find((lr) => lr.id === id);
  if (!leaveRequest || leaveRequest.employeeId !== session.userId) {
    // Same message whether it does not exist or belongs to someone else.
    return Response.json({ error: "Leave request not found among your requests." }, { status: 404 });
  }

  if (leaveRequest.status === "cancelled") {
    return Response.json({ error: "This request is already cancelled." }, { status: 400 });
  }
  const today = todayIso();
  const cancellable =
    leaveRequest.status === "pending" ||
    (leaveRequest.status === "approved" && leaveRequest.start > today);
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
  setLeaveRequestStatus(id, "cancelled");

  // Revert seeded attendance records patched at approval time (only possible
  // when an approved leave spanned recorded working days).
  for (const record of ATTENDANCE_RECORDS) {
    if (
      record.employeeId === leaveRequest.employeeId &&
      record.date >= leaveRequest.start &&
      record.date <= leaveRequest.end &&
      record.status === "leave"
    ) {
      record.status = "present";
      record.checkIn = "09:00";
    }
  }

  appendAuditEvent({
    action: "leave_cancelled",
    actor: { userId: session.userId, name: session.name, role: session.role },
    targetType: "leave_request",
    targetId: id,
    ip: ipFromRequest(request),
    before,
    after: { ...leaveRequest },
  });

  return Response.json({
    request: { ...leaveRequest },
    note:
      before.status === "approved"
        ? "Cancelled — the approved days are returned to your balance."
        : "Cancelled — nothing was deducted while the request was pending.",
  });
}
