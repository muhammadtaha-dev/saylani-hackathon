/**
 * GET /api/session — current session identity (null when signed out).
 * The old demo "switch account" endpoint was removed: identity now comes
 * only from real authentication (POST /api/auth/login).
 */

import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  return Response.json({ session });
}
