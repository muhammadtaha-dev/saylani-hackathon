/**
 * HCM Lite — unified append-only audit trail (Checklist E.22–E.25).
 *
 * One hash-chained JSONL row per security-relevant event: logins, logouts,
 * user creation/removal, leave submit/approve/reject/cancel and AI
 * permission denials. Every row records who, what, when, IP and
 * before/after values, and is chained to the previous row's hash, so any
 * later tampering (edit, deletion, reordering) breaks verification.
 *
 * Append-only by construction: the file is only ever opened for appending
 * (fs.appendFile) — there is no update or delete code path anywhere. The
 * in-memory cache exists for listing/verification only.
 *
 * Storage: `.data/audit.jsonl` locally, `/tmp/hcm-audit.jsonl` on Vercel
 * (per-instance, documented limitation in the README).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "path";
import { createHash, randomUUID } from "crypto";
import type { Role } from "./hcmData";

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
  | "ai_permission_denied";

export interface AuditEvent {
  seq: number;
  id: string;
  ts: string; // ISO timestamp
  actor_id: string;
  actor_name: string;
  actor_role: Role | "anonymous";
  action: AuditAction;
  target_type: "auth" | "user" | "leave_request" | "ai_request";
  target_id: string;
  ip: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  details: Record<string, unknown> | null;
  prev_hash: string;
  hash: string;
}

export interface AuditInput {
  action: AuditAction;
  actor: { userId: string; name: string; role: Role | "anonymous" };
  targetType: AuditEvent["target_type"];
  targetId: string;
  ip?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  details?: Record<string, unknown> | null;
}

const STATE_DIR = path.join(process.cwd(), ".data");
const STATE_FILE = path.join(STATE_DIR, "audit.jsonl");
const TMP_FILE = path.join("/tmp", "hcm-audit.jsonl");
const FILE =
  process.env.AUDIT_FILE ??
  (process.env.VERCEL === "1" ? TMP_FILE : STATE_FILE);

const GENESIS = "GENESIS";
/** How many recent rows are kept in memory for listing (verify streams the file). */
const MEMORY_ROWS = 2000;

const rows: AuditEvent[] = [];
let loaded = false;

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (!existsSync(FILE)) return;
    const lines = readFileSync(FILE, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        rows.push(JSON.parse(trimmed) as AuditEvent);
      } catch {
        // A malformed tail line (crash mid-write) must not break the chain read.
      }
    }
  } catch {
    // fail soft — the app must never break because the log is unreadable
  }
}

/**
 * The chain position is always read from the FILE, never trusted from
 * memory: another route bundle (dev) or serverless instance (prod) may have
 * appended since this process last wrote. Reads the last parseable line.
 */
function readLastRow(): { seq: number; hash: string } {
  try {
    if (!existsSync(FILE)) return { seq: 0, hash: GENESIS };
    const lines = readFileSync(FILE, "utf8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;
      try {
        const row = JSON.parse(trimmed) as AuditEvent;
        if (typeof row.seq === "number" && typeof row.hash === "string") {
          return { seq: row.seq, hash: row.hash };
        }
      } catch {
        // skip a truncated tail line
      }
    }
  } catch {
    // unreadable file — fall back to genesis
  }
  return { seq: 0, hash: GENESIS };
}

/** Canonical, stable serialisation of the fields the hash covers. */
function canonical(row: Omit<AuditEvent, "hash">): string {
  return [
    row.prev_hash,
    row.seq,
    row.ts,
    row.actor_id,
    row.actor_role,
    row.action,
    row.target_type,
    row.target_id,
    row.ip,
    JSON.stringify(row.before ?? null),
    JSON.stringify(row.after ?? null),
    JSON.stringify(row.details ?? null),
  ].join("|");
}

export function hashRow(row: Omit<AuditEvent, "hash">): string {
  return createHash("sha256").update(canonical(row)).digest("hex");
}

/** Append one event. Never throws to the caller — audit must not break the app. */
export function appendAuditEvent(input: AuditInput): AuditEvent | null {
  ensureLoaded();
  const previous = readLastRow();
  const row: Omit<AuditEvent, "hash"> = {
    seq: previous.seq + 1,
    id: randomUUID(),
    ts: new Date().toISOString(),
    actor_id: input.actor.userId,
    actor_name: input.actor.name,
    actor_role: input.actor.role,
    action: input.action,
    target_type: input.targetType,
    target_id: input.targetId,
    ip: input.ip ?? "unknown",
    before: input.before ?? null,
    after: input.after ?? null,
    details: input.details ?? null,
    prev_hash: previous.hash,
  };
  const event: AuditEvent = { ...row, hash: hashRow(row) };
  rows.push(event);
  if (rows.length > MEMORY_ROWS) rows.splice(0, rows.length - MEMORY_ROWS);
  try {
    if (FILE === STATE_FILE) mkdirSync(STATE_DIR, { recursive: true });
    // Synchronous append: an audit row must be durable before the action it
    // records completes — a fire-and-forget write can be lost when a
    // serverless instance freezes right after responding.
    appendFileSync(FILE, JSON.stringify(event) + "\n", "utf8");
  } catch {
    // best-effort persistence — the request must never fail because of the log
  }
  return event;
}

export interface AuditFilters {
  actorId?: string; // exact match
  userName?: string; // substring, case-insensitive
  action?: AuditAction | "all";
  from?: string; // YYYY-MM-DD inclusive
  to?: string; // YYYY-MM-DD inclusive
  limit?: number;
}

/** Read access — the enforcing route decides which rows the caller may see. */
export function listAuditEvents(filters: AuditFilters = {}): AuditEvent[] {
  ensureLoaded();
  const action = filters.action && filters.action !== "all" ? filters.action : undefined;
  const userName = filters.userName?.trim().toLowerCase();
  const from = filters.from && /^\d{4}-\d{2}-\d{2}$/.test(filters.from) ? filters.from : undefined;
  const to = filters.to && /^\d{4}-\d{2}-\d{2}$/.test(filters.to) ? filters.to : undefined;
  const filtered = rows.filter((r) => {
    if (filters.actorId && r.actor_id !== filters.actorId) return false;
    if (userName && !r.actor_name.toLowerCase().includes(userName)) return false;
    if (action && r.action !== action) return false;
    if (from && r.ts.slice(0, 10) < from) return false;
    if (to && r.ts.slice(0, 10) > to) return false;
    return true;
  });
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), MEMORY_ROWS);
  return filtered.slice(-limit).reverse();
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  total_rows: number;
  broken_at_seq?: number;
  reason?: string;
}

/**
 * Recompute the whole chain from the file on disk and report the first
 * break — tampering with any row (edit, delete, reorder) changes its hash
 * or the successor's prev_hash link.
 */
export function verifyAuditChain(): ChainVerification {
  ensureLoaded();
  let fileRows: AuditEvent[];
  try {
    if (!existsSync(FILE)) {
      return { ok: true, checked: 0, total_rows: rows.length };
    }
    fileRows = readFileSync(FILE, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((l) => {
        try {
          return JSON.parse(l) as AuditEvent;
        } catch {
          return null;
        }
      })
      .filter((r): r is AuditEvent => r !== null);
  } catch {
    return { ok: false, checked: 0, total_rows: rows.length, reason: "audit file unreadable" };
  }

  let prev = GENESIS;
  for (const row of fileRows) {
    if (row.prev_hash !== prev) {
      return {
        ok: false,
        checked: row.seq - 1,
        total_rows: fileRows.length,
        broken_at_seq: row.seq,
        reason: `row ${row.seq} does not link to the previous row's hash`,
      };
    }
    if (hashRow(row) !== row.hash) {
      return {
        ok: false,
        checked: row.seq - 1,
        total_rows: fileRows.length,
        broken_at_seq: row.seq,
        reason: `row ${row.seq} content does not match its stored hash`,
      };
    }
    prev = row.hash;
  }
  return { ok: true, checked: fileRows.length, total_rows: fileRows.length };
}

/** Helper: best-effort client IP from proxy headers. */
export function ipFromRequest(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "local";
}

/**
 * Preserve the seed audit file across local restarts together with the
 * other persisted state — nothing else ever writes to it (append-only).
 * Kept for tests; production code only appends via appendAuditEvent.
 */
export function auditFilePath(): string {
  return FILE;
}

/** Test helper: reset in-memory state (tests only). */
export function resetAuditForTests(): void {
  rows.length = 0;
  loaded = false;
  try {
    if (existsSync(FILE)) writeFileSync(FILE, "", "utf8");
  } catch {
    // ignore
  }
}
