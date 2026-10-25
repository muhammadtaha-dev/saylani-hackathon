/**
 * GET /api/audit — unified append-only audit trail.
 *
 * Access (E.23): Admin/HR read all events; an Employee receives only the
 * events they caused themselves. Admin/HR may additionally:
 *   ?format=csv                  — download the filtered set as CSV
 *   ?verify=1                    — recompute the hash chain and report breaks
 * Filters: ?user=<name substring>&actor_id=<id>&action=<action>&from=YYYY-MM-DD&to=YYYY-MM-DD&limit=<n>
 *
 * The underlying store is append-only JSONL; there is no update or delete
 * code path for it anywhere in the codebase.
 */

import { getSession } from "@/lib/session";
import { listAuditEvents, verifyAuditChain, type AuditAction } from "@/lib/audit";

const ACTIONS: AuditAction[] = [
  "login_success",
  "login_failed",
  "logout",
  "user_created",
  "user_removed",
  "leave_submitted",
  "leave_approved",
  "leave_rejected",
  "leave_cancelled",
  "ai_permission_denied",
];

const CSV_COLUMNS = [
  "seq",
  "ts",
  "actor_name",
  "actor_id",
  "actor_role",
  "action",
  "target_type",
  "target_id",
  "ip",
  "before",
  "after",
  "details",
  "prev_hash",
  "hash",
] as const;

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }
  const isPrivileged = session.role === "admin" || session.role === "hr";

  const url = new URL(request.url);
  const actionParam = url.searchParams.get("action") ?? undefined;
  const action = ACTIONS.includes(actionParam as AuditAction) ? (actionParam as AuditAction) : undefined;

  // Employees are always scoped to their own events, whatever they ask for.
  const filters = {
    actorId: isPrivileged ? url.searchParams.get("actor_id") ?? undefined : session.userId,
    userName: isPrivileged ? url.searchParams.get("user") ?? undefined : undefined,
    action,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
  };

  if (url.searchParams.get("verify")) {
    if (!isPrivileged) {
      return Response.json({ error: "Integrity verification is restricted to Admin and HR." }, { status: 403 });
    }
    return Response.json({ verification: verifyAuditChain() });
  }

  const events = listAuditEvents(filters);

  if (url.searchParams.get("format") === "csv") {
    if (!isPrivileged) {
      return Response.json({ error: "CSV export is restricted to Admin and HR." }, { status: 403 });
    }
    const lines = [
      CSV_COLUMNS.join(","),
      ...events.map((e) =>
        CSV_COLUMNS.map((c) => csvCell(e[c as keyof typeof e])).join(",")
      ),
    ];
    return new Response(lines.join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="hcm-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  return Response.json({
    events,
    scope: isPrivileged ? "all" : "own",
    actions: ACTIONS,
    note: "Append-only, hash-chained. Admin/HR can filter and export; employees see their own entries.",
  });
}
