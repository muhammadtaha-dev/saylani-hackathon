/**
 * HCM Lite — audit trail writer (Checklist E.22–E.25), Supabase edition.
 *
 * Rows go into public.audit_log through the SERVICE ROLE client, server-side
 * only: the table grants no INSERT/UPDATE/DELETE to anon or authenticated at
 * all (revoked + no RLS policy + triggers), so no user — and no leaked anon
 * key — can forge or mutate history. A BEFORE INSERT trigger serialises
 * appends under an advisory lock, assigns seq, links prev_hash to the last
 * row's hash and computes the sha256 row hash; verify_audit_chain() (RPC)
 * recomputes it for the integrity button.
 */

import { supabaseAdmin } from "@/lib/supabase/server";

export type AuditAction =
  | "login_success"
  | "login_failed"
  | "logout"
  | "user_created"
  | "user_removed"
  | "leave_submitted"
  | "leave_approved"
  | "leave_rejected"
  | "leave_cancelled"
  | "ai_permission_denied"
  | "ai_call";

export interface AuditInput {
  action: AuditAction;
  actor: { userId: string; name: string; role: string };
  targetType: "auth" | "user" | "leave_request" | "ai_request" | "system";
  targetId: string;
  ip?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  details?: Record<string, unknown> | null;
}

/** Append one event. Never throws to the caller — audit must not break the app. */
export function appendAuditEvent(input: AuditInput): void {
  try {
    const admin = supabaseAdmin();
    // Fire-and-forget would risk losing rows when a serverless instance
    // freezes; await-ability is offered via the promise, but callers that
    // cannot await still get best-effort behaviour.
    void (async () => {
      const { error } = await admin.from("audit_log").insert({
        action: input.action,
        actor_id: input.actor.userId,
        actor_name: input.actor.name,
        actor_role: input.actor.role,
        target_type: input.targetType,
        target_id: input.targetId,
        ip: input.ip ?? "unknown",
        before: input.before ?? null,
        after: input.after ?? null,
        details: input.details ?? null,
      });
      if (error) console.error("[hcm] audit insert failed:", error.message);
    })();
  } catch (err) {
    console.error("[hcm] audit writer unavailable:", err instanceof Error ? err.message : err);
  }
}

/** Awaitable variant for paths where durability matters (decisions). */
export async function appendAuditEventAsync(input: AuditInput): Promise<void> {
  try {
    const admin = supabaseAdmin();
    const { error } = await admin.from("audit_log").insert({
      action: input.action,
      actor_id: input.actor.userId,
      actor_name: input.actor.name,
      actor_role: input.actor.role,
      target_type: input.targetType,
      target_id: input.targetId,
      ip: input.ip ?? "unknown",
      before: input.before ?? null,
      after: input.after ?? null,
      details: input.details ?? null,
    });
    if (error) console.error("[hcm] audit insert failed:", error.message);
  } catch (err) {
    console.error("[hcm] audit writer unavailable:", err instanceof Error ? err.message : err);
  }
}

export function ipFromRequest(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "local";
}
