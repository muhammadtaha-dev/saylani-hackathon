/**
 * GET /api/leaves/attachment?path=leave-attachments/<uid>/<reqId>/<file>
 * Returns a short-lived signed URL for a leave attachment. The signed-URL
 * request itself runs with the caller's JWT, so Supabase Storage policies
 * decide access: own folder or HR/Admin.
 */

import { requireSession } from "@/lib/session";
import { supabaseServer, supabaseConfigured } from "@/lib/supabase/server";

export async function GET(request: Request) {
  if (!supabaseConfigured()) {
    return Response.json({ error: "The database is not configured yet." }, { status: 503 });
  }
  const auth = await requireSession();
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  const path = url.searchParams.get("path") ?? "";
  const BUCKET = "leave-attachments";
  if (!path.startsWith(`${BUCKET}/`) || path.includes("..")) {
    return Response.json({ error: "Invalid attachment path." }, { status: 400 });
  }
  const objectPath = path.slice(BUCKET.length + 1);

  const supabase = await supabaseServer();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(objectPath, 120);
  if (error || !data) {
    return Response.json({ error: "Attachment not found or not accessible." }, { status: 404 });
  }
  return Response.json({ signedUrl: data.signedUrl, expiresInSeconds: 120 });
}
