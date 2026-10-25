/**
 * HCM Lite — demo persistence for locally-run servers.
 *
 * User management and leave processing mutate in-memory seed data; this
 * module persists those mutations to `.data/state.json` so a server restart
 * no longer wipes them. Only DELTAS are stored (added users, status
 * overrides, extra leaves, processed statuses) so seed changes in code
 * always win for untouched records.
 *
 * On Vercel (serverless) the filesystem is not shared between instances, so
 * persistence is disabled there — documented in the README.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

const STATE_DIR =
  process.env.HCM_STATE_DIR ?? path.join(process.cwd(), ".data");
const STATE_FILE = path.join(STATE_DIR, "state.json");
const ENABLED = process.env.VERCEL !== "1";

export interface PersistedState {
  addedEmployees?: unknown[];
  statusOverrides?: Record<string, string>;
  extraLeaves?: unknown[];
  leaveStatusOverrides?: Record<string, string>;
}

export function loadPersistedState(): PersistedState | null {
  if (!ENABLED) return null;
  try {
    if (!existsSync(STATE_FILE)) return null;
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as PersistedState;
  } catch {
    return null; // fail soft — corrupt state falls back to seed
  }
}

export function savePersistedState(state: PersistedState): void {
  if (!ENABLED) return;
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch {
    // fail soft — persistence is best-effort; the request must never break
  }
}
