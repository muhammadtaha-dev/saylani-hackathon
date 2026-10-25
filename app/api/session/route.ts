/**
 * GET /api/session — current session identity (null when signed out), plus
 * whether the backend is configured at all so the UI can show a setup screen
 * instead of a dead app.
 */

import { getCurrentSession } from "@/lib/session";
import { supabaseConfigured } from "@/lib/supabase/server";

export async function GET() {
  if (!supabaseConfigured()) {
    return Response.json({ configured: false, session: null });
  }
  const session = await getCurrentSession();
  return Response.json({ configured: true, session });
}
