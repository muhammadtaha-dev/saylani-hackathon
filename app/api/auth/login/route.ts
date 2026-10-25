/**
 * POST /api/auth/login — email + password authentication.
 * Failures are generic (no account enumeration) and throttled per email.
 * Success issues the signed, expiring session cookie.
 */

import { findEmployeeByEmail } from "@/lib/hcmData";
import { clearLoginFailures, loginLocked, recordLoginFailure, verifyPassword } from "@/lib/auth";
import { sessionSetCookie } from "@/lib/session";

export async function POST(request: Request) {
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
    return Response.json({ error: "Invalid email or password." }, { status: 401 });
  }
  if (user.status !== "active") {
    return Response.json(
      { error: "This account has been removed. Please contact your Administrator." },
      { status: 403 }
    );
  }
  if (!(user.passwordHash ?? "")) {
    return Response.json(
      { error: "No password has been set for this account. Please ask an Admin or HR to create your login." },
      { status: 401 }
    );
  }

  clearLoginFailures(email);
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
