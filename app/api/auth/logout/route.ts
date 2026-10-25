/** POST /api/auth/logout — clears the session cookie. */

import { sessionClearCookie } from "@/lib/session";

export async function POST() {
  return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionClearCookie() } });
}
