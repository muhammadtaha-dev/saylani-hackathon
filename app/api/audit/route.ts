/**
 * GET /api/audit — unified append-only audit trail (Supabase edition).
 *
 * Reads run with the CALLER's JWT so Row Level Security decides visibility:
 * HR/Admin see every event; any other user sees only the events they caused.
 * Admin/HR may additionally:
 *   ?format=csv   — download the filtered set as CSV
 *   ?verify=1     — call the DB's verify_audit_chain() and report breaks
 * Filters: ?user=<name substring>&action=<action>&from=YYYY-MM-DD&to=YYYY-MM-DD&limit=<n>
 *
 * The table is INSERT-only at the database level (revokes + triggers + no
 * write policies); there is no update or delete path anywhere.
 */

import { requireSession } from "@/lib/session";
import { supabaseServer, supabaseConfigured } from "@/lib/supabase/server";

const ACTIONS = [
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
  "ai_call",
];

const CSV_COLUMNS = [
  "seq", "ts", "actor_name", "actor_id", "actor_role", "action",
  "target_type", "target_id", "ip", "before", "after", "details", "prev_hash", "hash",
] as const;

interface AuditRow {
  seq: number;
  ts: string;
  actor_name: string;
  actor_id: string;
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string;
  ip: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  details: Record<string, unknown> | null;
  prev_hash: string;
  hash: string;
}

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  if (!supabaseConfigured()) {
    return Response.json({ configured: false, error: "The database is not configured yet." }, { status: 503 });
  }
  const auth = await requireSession();
  if ("response" in auth) return auth.response;
  const isPrivileged = auth.session.role === "admin" || auth.session.role === "hr";
  const supabase = await supabaseServer();

  const url = new URL(request.url);
  const actionParam = url.searchParams.get("action") ?? undefined;
  const action = ACTIONS.includes(actionParam ?? "") ? actionParam : undefined;
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 200) || 200, 1), 1000);

  if (url.searchParams.get("verify")) {
    if (!isPrivileged) {
      return Response.json({ error: "Integrity verification is restricted to Admin and HR." }, { status: 403 });
    }
    const { data, error } = await supabase.rpc("verify_audit_chain");
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    const row = (Array.isArray(data) ? data[0] : data) as {
      ok: boolean; checked: number; broken_at: number | null; reason: string | null;
    };
    return Response.json({
      verification: {
        ok: row?.ok ?? false,
        checked: row?.checked ?? 0,
        total_rows: row?.checked ?? 0,
        broken_at_seq: row?.broken_at ?? undefined,
        reason: row?.reason ?? undefined,
      },
    });
  }

  let query = supabase
    .from("audit_log")
    .select("*")
    .order("seq", { ascending: false })
    .limit(limit);
  if (action) query = query.eq("action", action);
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte("ts", `${from}T00:00:00Z`);
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lte("ts", `${to}T23:59:59Z`);
  if (isPrivileged) {
    const userName = url.searchParams.get("user");
    if (userName) query = query.ilike("actor_name", `%${userName.trim()}%`);
    const actorId = url.searchParams.get("actor_id");
    if (actorId) query = query.eq("actor_id", actorId);
  }
  // Non-privileged callers are scoped to their own rows by RLS, always.

  const { data, error } = await query;
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  const events = (data ?? []) as AuditRow[];

  if (url.searchParams.get("format") === "csv") {
    if (!isPrivileged) {
      return Response.json({ error: "CSV export is restricted to Admin and HR." }, { status: 403 });
    }
    const lines = [
      CSV_COLUMNS.join(","),
      ...events.map((e) => CSV_COLUMNS.map((c) => csvCell(e[c as keyof AuditRow])).join(",")),
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
    note: "Append-only, hash-chained (INSERT-only enforced by the database). Admin/HR can filter and export; others see their own entries.",
  });
}
