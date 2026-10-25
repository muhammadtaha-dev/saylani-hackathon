/**
 * User management API (Admin and HR) — Supabase Auth backed.
 *
 * GET    /api/users  — list users (Admin: all non-admin; HR: employees only).
 * POST   /api/users  — create an auth user + profile (via the
 *                      on_auth_user_created trigger, role from metadata).
 * DELETE /api/users  — soft-remove: profile.status -> inactive AND the auth
 *                      user is banned, killing their session immediately.
 *
 * The auth.admin calls use the SERVICE ROLE client and happen ONLY here,
 * server-side. RLS and the canManageUser matrix decide who may call this.
 * Safe fields only are ever returned (never salary, password or PII).
 */

import { requireSession } from "@/lib/session";
import { supabaseServer, supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { canListUsers, canManageUser } from "@/lib/permissions";
import { appendAuditEventAsync, ipFromRequest } from "@/lib/audit";

function safeUser(p: Record<string, unknown>) {
  return {
    id: p.id,
    name: p.full_name,
    email: p.email,
    role: p.role,
    department: p.department,
    designation: p.designation ?? "",
    status: p.status,
    manager_id: p.manager_id,
  };
}

export async function GET() {
  if (!supabaseConfigured()) {
    return Response.json({ configured: false, error: "The database is not configured yet." }, { status: 503 });
  }
  const auth = await requireSession();
  if ("response" in auth) return auth.response;
  if (!canListUsers(auth.session.role)) {
    return Response.json({ error: "Only Admin and HR can manage users." }, { status: 403 });
  }
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("full_name");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const users = (data ?? [])
    .filter((p: Record<string, unknown>) =>
      auth.session.role === "admin" ? p.role !== "admin" || p.id === auth.session.userId : p.role === "employee"
    )
    .map(safeUser);
  return Response.json({ users, canManage: auth.session.role });
}

export async function POST(request: Request) {
  if (!supabaseConfigured()) {
    return Response.json({ configured: false, error: "The database is not configured yet." }, { status: 503 });
  }
  const auth = await requireSession();
  if ("response" in auth) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const role = typeof body?.role === "string" ? (body.role as "employee" | "manager" | "hr") : ("" as never);
  const department = typeof body?.department === "string" ? body.department : "";
  const designation = typeof body?.designation === "string" ? body.designation.trim() : "";
  const managerId = typeof body?.manager_id === "string" && body.manager_id ? body.manager_id : undefined;

  if (name.length < 3) {
    return Response.json({ error: "Please enter the full name (at least 3 characters)." }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Please enter a valid email address." }, { status: 400 });
  }
  if (password.length < 6) {
    return Response.json({ error: "Password must be at least 6 characters." }, { status: 400 });
  }
  if (role !== "hr" && role !== "manager" && role !== "employee") {
    return Response.json({ error: "Role must be Employee, Manager or HR." }, { status: 400 });
  }
  if (!canManageUser(auth.session.role, role)) {
    return Response.json(
      {
        error:
          auth.session.role === "hr"
            ? "HR can only add Employee accounts."
            : "Admins can add HR, Manager and Employee accounts.",
      },
      { status: 403 }
    );
  }
  if (!department) {
    return Response.json({ error: "Please choose a valid department." }, { status: 400 });
  }
  if (designation.length < 2) {
    return Response.json({ error: "Please enter a designation." }, { status: 400 });
  }
  if (managerId) {
    const supabase = await supabaseServer();
    const { data: manager } = await supabase
      .from("profiles")
      .select("id, role")
      .eq("id", managerId)
      .single();
    if (!manager || manager.role !== "manager") {
      return Response.json({ error: "manager_id must reference an existing Manager." }, { status: 400 });
    }
  }

  const admin = supabaseAdmin();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: name,
      role,
      department,
      designation,
      ...(managerId ? { manager_id: managerId } : {}),
    },
  });
  if (createError || !created.user) {
    const message = createError?.message ?? "Could not create the user.";
    return Response.json(
      { error: message.includes("already") ? "An account with this email already exists." : message },
      { status: 400 }
    );
  }

  // Compensation is optional at creation; the profile row is created by the
  // auth trigger.
  await appendAuditEventAsync({
    action: "user_created",
    actor: { userId: auth.session.userId, name: auth.session.name, role: auth.session.role },
    targetType: "user",
    targetId: created.user.id,
    ip: ipFromRequest(request),
    after: { name, email, role, department, designation, status: "active" },
  });

  return Response.json(
    {
      user: { id: created.user.id, name, email, role, department, designation, status: "active" },
    },
    { status: 201 }
  );
}

export async function DELETE(request: Request) {
  if (!supabaseConfigured()) {
    return Response.json({ configured: false, error: "The database is not configured yet." }, { status: 503 });
  }
  const auth = await requireSession();
  if ("response" in auth) return auth.response;

  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) {
    return Response.json({ error: "Please provide the user id." }, { status: 400 });
  }

  const supabase = await supabaseServer();
  const { data: target } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", id)
    .single();
  if (!target) {
    return Response.json({ error: "User not found." }, { status: 404 });
  }
  if (target.id === auth.session.userId) {
    return Response.json({ error: "You cannot remove your own account." }, { status: 400 });
  }
  if (target.role === "admin") {
    return Response.json({ error: "Admin accounts cannot be removed here." }, { status: 403 });
  }
  if (!canManageUser(auth.session.role, target.role as "employee" | "manager" | "hr")) {
    return Response.json(
      { error: auth.session.role === "hr" ? "HR can only remove Employee accounts." : "Admins can remove HR, Manager and Employee accounts." },
      { status: 403 }
    );
  }

  const before = { name: target.full_name, email: target.email, role: target.role, status: target.status };

  // Soft delete: inactive profile + banned auth user (kills the session now
  // and refuses future logins).
  const admin = supabaseAdmin();
  const { error: banError } = await admin.auth.admin.updateUserById(id, {
    ban_duration: "87600h", // 10 years
  });
  if (banError) {
    return Response.json({ error: banError.message }, { status: 500 });
  }
  const { error: profileError } = await admin
    .from("profiles")
    .update({ status: "inactive" })
    .eq("id", id);
  if (profileError) {
    return Response.json({ error: profileError.message }, { status: 500 });
  }

  await appendAuditEventAsync({
    action: "user_removed",
    actor: { userId: auth.session.userId, name: auth.session.name, role: auth.session.role },
    targetType: "user",
    targetId: id,
    ip: ipFromRequest(request),
    before,
    after: { status: "inactive" },
  });

  return Response.json({ ok: true, id, status: "inactive" });
}
