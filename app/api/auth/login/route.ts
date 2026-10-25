/**
 * POST /api/auth/login — email + password authentication.
 * Failures are generic (no account enumeration — the same message for an
 * unknown email and a wrong password) and throttled per email. Success and
 * every failure are appended to the audit trail with the client IP.
 */

import { findEmployeeByEmail } from "@/lib/hcmData";
import { clearLoginFailures, loginLocked, recordLoginFailure, verifyPassword } from "@/lib/auth";
import { sessionSetCookie } from "@/lib/session";
import { appendAuditEvent, ipFromRequest } from "@/lib/audit";

const GENERIC_FAILURE = "Invalid email or password. Please try again.";

export async function POST(request: Request) {
  const ip = ipFromRequest(request);
  const body = (await request.json().catch(() => null)) as
    | { email?: unknown; password?: unknown }
    | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !password) {
    return Response.json({ error: "Please enter your email and password." }, { status: 400 });
  }

  const lockedFor = loginLocked(email);
  if (lockedFor > 0) {
    return Response.json(
      { error: `Too many failed attempts. Please try again in ${Math.ceil(lockedFor / 60)} minute(s).` },
      { status: 429 }
    );
  }

  const user = findEmployeeByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash ?? "")) {
    recordLoginFailure(email);
    appendAuditEvent({
      action: "login_failed",
      actor: { userId: email, name: email, role: "anonymous" },
      targetType: "auth",
      targetId: email,
      ip,
      details: { reason: user ? "wrong_password" : "unknown_email" },
    });
    return Response.json({ error: GENERIC_FAILURE }, { status: 401 });
  }
  if (user.status !== "active") {
    appendAuditEvent({
      action: "login_failed",
      actor: { userId: user.id, name: user.name, role: user.role },
      targetType: "auth",
      targetId: user.id,
      ip,
      details: { reason: "account_removed" },
    });
    return Response.json({ error: GENERIC_FAILURE }, { status: 401 });
  }
  if (!(user.passwordHash ?? "")) {
    appendAuditEvent({
      action: "login_failed",
      actor: { userId: user.id, name: user.name, role: user.role },
      targetType: "auth",
      targetId: user.id,
      ip,
      details: { reason: "no_password_set" },
    });
    return Response.json({ error: GENERIC_FAILURE }, { status: 401 });
  }

  clearLoginFailures(email);
  appendAuditEvent({
    action: "login_success",
    actor: { userId: user.id, name: user.name, role: user.role },
    targetType: "auth",
    targetId: user.id,
    ip,
  });
  return Response.json(
    {
      session: {
        userId: user.id,
        name: user.name,
        role: user.role,
        department: user.department,
      },
    },
    { headers: { "Set-Cookie": sessionSetCookie(user.id) } }
  );
}
