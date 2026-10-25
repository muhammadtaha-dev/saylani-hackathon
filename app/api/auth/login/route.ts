/**
 * POST /api/auth/login — Supabase Auth (email + password).
 * The session is stored in HTTP-only cookies by @supabase/ssr; identity is
 * never accepted from the request body afterwards. Failures are generic (no
 * account enumeration) and throttled per email; successes and failures are
 * appended to the append-only audit trail with the client IP.
 */

import { loginLocked, recordLoginFailure, clearLoginFailures } from "@/lib/auth";
import { appendAuditEvent, ipFromRequest } from "@/lib/audit";
import { supabaseServer, supabaseConfigured } from "@/lib/supabase/server";

const GENERIC_FAILURE = "Invalid email or password. Please try again.";
const SETUP_FAILURE =
  "The database is not configured yet. Ask your administrator to set the Supabase environment variables.";

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
  if (!supabaseConfigured()) {
    return Response.json({ error: SETUP_FAILURE }, { status: 503 });
  }

  const lockedFor = loginLocked(email);
  if (lockedFor > 0) {
    return Response.json(
      { error: `Too many failed attempts. Please try again in ${Math.ceil(lockedFor / 60)} minute(s).` },
      { status: 429 }
    );
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    recordLoginFailure(email);
    appendAuditEvent({
      action: "login_failed",
      actor: { userId: email, name: email, role: "anonymous" },
      targetType: "auth",
      targetId: email,
      ip,
      details: { reason: "invalid_credentials" },
    });
    return Response.json({ error: GENERIC_FAILURE }, { status: 401 });
  }

  // Deactivated accounts are signed out immediately.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, department, status")
    .eq("id", data.user.id)
    .single();

  if (!profile || profile.status !== "active") {
    await supabase.auth.signOut();
    appendAuditEvent({
      action: "login_failed",
      actor: { userId: String(profile?.id ?? data.user.id), name: String(profile?.full_name ?? email), role: String(profile?.role ?? "employee") },
      targetType: "auth",
      targetId: String(profile?.id ?? data.user.id),
      ip,
      details: { reason: profile ? "account_removed" : "profile_missing" },
    });
    return Response.json({ error: GENERIC_FAILURE }, { status: 401 });
  }

  clearLoginFailures(email);
  appendAuditEvent({
    action: "login_success",
    actor: { userId: profile.id, name: profile.full_name, role: profile.role },
    targetType: "auth",
    targetId: profile.id,
    ip,
  });

  return Response.json({
    session: {
      userId: profile.id,
      name: profile.full_name,
      role: profile.role,
      department: profile.department,
    },
  });
}
