/**
 * GET  /api/session — current session identity (auto-starts the Employee
 *                     demo account when no session exists, for demo UX).
 * POST /api/session — switch the active demo account. The server sets the
 *                     signed cookie; the client never dictates identity.
 */

import { findEmployeeById } from "@/lib/hcmData";
import { DEMO_USERS, getSession, sessionSetCookie } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  return Response.json({ session, users: DEMO_USERS });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { userId?: string } | null;
  const userId = body?.userId;
  const user = userId ? findEmployeeById(userId) : undefined;
  if (!user || user.status !== "active") {
    return Response.json({ error: "Unknown account." }, { status: 400 });
  }
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
