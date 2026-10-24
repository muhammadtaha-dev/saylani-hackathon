/**
 * GET /api/ai/logs — Admin-only read access to the append-only ai_logs
 * audit trail (Art. IX.4). Non-Admin calls are denied with 403. Rows are
 * already sanitised at write time (salary/identifiers redacted).
 */

import { listAiLogs } from "@/lib/aiLogs";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }
  if (session.role !== "admin") {
    return Response.json(
      { error: "The audit trail is readable by Admin only." },
      { status: 403 }
    );
  }
  return Response.json({
    logs: listAiLogs(150),
    note: "Append-only. Salary values and personal identifiers are redacted or omitted from logged payloads.",
  });
}
