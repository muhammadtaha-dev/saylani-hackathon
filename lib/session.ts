/**
 * HCM Lite — server-side session identity (Art. III.2).
 *
 * Identity is derived ONLY from the Supabase Auth session (HTTP-only
 * cookies) joined to public.profiles. No code path may read user_id/role/
 * scope from the request body or from model output. Deactivated users fail
 * session validation immediately (their profile.status flips to 'inactive').
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer, supabaseConfigured } from "@/lib/supabase/server";
import type { Role } from "@/lib/permissions";

export interface SessionIdentity {
  userId: string;
  name: string;
  role: Role;
  department: string;
  designation: string;
  managerId: string | null;
  email: string;
}

export async function getCurrentSession(): Promise<SessionIdentity | null> {
  if (!supabaseConfigured()) return null;
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, department, designation, manager_id, email, status")
    .eq("id", user.id)
    .single();
  if (error || !profile || profile.status !== "active") return null;

  return {
    userId: profile.id,
    name: profile.full_name,
    role: profile.role as Role,
    department: profile.department,
    designation: profile.designation ?? "",
    managerId: profile.manager_id,
    email: profile.email ?? "",
  };
}

/** Convenience: session or a 401 Response. */
export async function requireSession(): Promise<
  { session: SessionIdentity } | { response: Response }
> {
  const session = await getCurrentSession();
  if (!session) {
    return {
      response: Response.json(
        { error: "Not signed in." },
        { status: 401 }
      ),
    };
  }
  return { session };
}

export type { SupabaseClient };
