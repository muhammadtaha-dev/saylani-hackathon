/** POST /api/auth/logout — clears the session cookie and audits the event. */

import { sessionClearCookie, getSession } from "@/lib/session";
import { appendAuditEvent } from "@/lib/audit";

export async function POST(request: Request) {
  const session = await getSession();
  if (session) {
    const fwd = request.headers.get("x-forwarded-for");
    appendAuditEvent({
      action: "logout",
      actor: { userId: session.userId, name: session.name, role: session.role },
      targetType: "auth",
      targetId: session.userId,
      ip: fwd ? fwd.split(",")[0].trim() : request.headers.get("x-real-ip") ?? "local",
    });
  }
  return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionClearCookie() } });
}
