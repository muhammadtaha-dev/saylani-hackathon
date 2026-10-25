/** POST /api/auth/logout — clears the Supabase session and audits the event. */

import { getCurrentSession } from "@/lib/session";
import { appendAuditEvent } from "@/lib/audit";
import { supabaseServer } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const session = await getCurrentSession();
  const fwd = request.headers.get("x-forwarded-for");
  if (session) {
    appendAuditEvent({
      action: "logout",
      actor: { userId: session.userId, name: session.name, role: session.role },
      targetType: "auth",
      targetId: session.userId,
      ip: fwd ? fwd.split(",")[0].trim() : request.headers.get("x-real-ip") ?? "local",
    });
    const supabase = await supabaseServer();
    await supabase.auth.signOut();
  }
  return Response.json({ ok: true });
}
