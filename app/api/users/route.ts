/**
 * User management API (Admin and HR).
 *
 * GET    /api/users        — list users (Admin: all; HR: employees only).
 * POST   /api/users        — create a user with an initial password.
 *                            Admin may create HR or Employee; HR only Employee.
 * DELETE /api/users        — soft-remove a user (status -> inactive). Their
 *                            session dies immediately and login is refused.
 *
 * Rules: no one manages Admin accounts here, no one removes themselves, and
 * safe fields only are ever returned (never salary, CNIC, bank, password).
 */

import {
  addEmployee,
  DEPARTMENTS,
  EMPLOYEES,
  findEmployeeById,
  setEmployeeStatus,
  type DepartmentName,
  type Role,
} from "@/lib/hcmData";
import { canListUsers, canManageUser } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { appendAuditEvent, ipFromRequest } from "@/lib/audit";

function safeUser(e: (typeof EMPLOYEES)[number]) {
  return {
    id: e.id,
    name: e.name,
    email: e.email,
    role: e.role,
    department: e.department,
    designation: e.designation,
    status: e.status,
    hasPassword: Boolean(e.passwordHash),
  };
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }
  if (!canListUsers(session.role)) {
    return Response.json({ error: "Only Admin and HR can manage users." }, { status: 403 });
  }
  const users = EMPLOYEES.filter((e) =>
    session.role === "admin" ? e.role !== "admin" || e.id === session.userId : e.role === "employee"
  ).map(safeUser);
  return Response.json({ users, canManage: session.role });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const role = typeof body?.role === "string" ? (body.role as Role) : ("" as Role);
  const department = typeof body?.department === "string" ? body.department : "";
  const designation = typeof body?.designation === "string" ? body.designation.trim() : "";

  if (name.length < 3) {
    return Response.json({ error: "Please enter the full name (at least 3 characters)." }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Please enter a valid email address." }, { status: 400 });
  }
  if (password.length < 6) {
    return Response.json({ error: "Password must be at least 6 characters." }, { status: 400 });
  }
  if (role !== "hr" && role !== "employee") {
    return Response.json({ error: "Role must be HR or Employee." }, { status: 400 });
  }
  if (!canManageUser(session.role, role)) {
    return Response.json(
      { error: session.role === "hr" ? "HR can only add Employee accounts." : "Admins can add HR and Employee accounts." },
      { status: 403 }
    );
  }
  if (!(DEPARTMENTS as string[]).includes(department)) {
    return Response.json({ error: "Please choose a valid department." }, { status: 400 });
  }
  if (designation.length < 2) {
    return Response.json({ error: "Please enter a designation." }, { status: 400 });
  }
  if (EMPLOYEES.some((e) => e.email.toLowerCase() === email)) {
    return Response.json({ error: "An account with this email already exists." }, { status: 400 });
  }

  const created = addEmployee({
    name,
    email,
    password,
    role,
    department: department as DepartmentName,
    designation,
  });
  appendAuditEvent({
    action: "user_created",
    actor: { userId: session.userId, name: session.name, role: session.role },
    targetType: "user",
    targetId: created.id,
    ip: ipFromRequest(request),
    after: { name: created.name, email: created.email, role: created.role, department: created.department, designation: created.designation, status: created.status },
  });
  return Response.json({ user: safeUser(created) }, { status: 201 });
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const target = findEmployeeById(id);
  if (!target) {
    return Response.json({ error: "User not found." }, { status: 404 });
  }
  if (target.id === session.userId) {
    return Response.json({ error: "You cannot remove your own account." }, { status: 400 });
  }
  if (target.role === "admin") {
    return Response.json({ error: "Admin accounts cannot be removed here." }, { status: 403 });
  }
  if (!canManageUser(session.role, target.role)) {
    return Response.json(
      { error: session.role === "hr" ? "HR can only remove Employee accounts." : "Admins can remove HR and Employee accounts." },
      { status: 403 }
    );
  }

  const before = { name: target.name, email: target.email, role: target.role, status: target.status };
  setEmployeeStatus(target.id, "inactive");
  appendAuditEvent({
    action: "user_removed",
    actor: { userId: session.userId, name: session.name, role: session.role },
    targetType: "user",
    targetId: target.id,
    ip: ipFromRequest(request),
    before,
    after: { status: "inactive" },
  });
  return Response.json({ ok: true, id: target.id, status: "inactive" });
}
