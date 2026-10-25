/**
 * HCM Lite — server-side session identity (Art. III.2).
 *
 * Identity is derived ONLY from the HMAC-signed, expiring session cookie and
 * looked up in the data layer. No code path may read user_id/role/scope from
 * the request body or from model output. Deactivated users fail session
 * validation immediately, so removing a user logs them out everywhere.
 */

import { createHmac } from "crypto";
import { cookies } from "next/headers";
import { findEmployeeById } from "./hcmData";
import type { SessionIdentity } from "./permissions";

export const SESSION_COOKIE = "hcm_session";
const SECRET = process.env.SESSION_SECRET ?? "hcm-lite-demo-signing-secret";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("hex").slice(0, 32);
}

export function sessionCookieValue(userId: string): string {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  return `${userId}.${expiresAt}.${sign(`${userId}.${expiresAt}`)}`;
}

export function sessionSetCookie(userId: string): string {
  return `${SESSION_COOKIE}=${sessionCookieValue(userId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

export function sessionClearCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function getSession(): Promise<SessionIdentity | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [userId, expiresAt, signature] = parts;
  if (sign(`${userId}.${expiresAt}`) !== signature) return null;
  if (!/^\d+$/.test(expiresAt) || Number(expiresAt) <= Date.now()) return null;
  const user = findEmployeeById(userId);
  if (!user || user.status !== "active") return null;
  return {
    userId: user.id,
    name: user.name,
    role: user.role,
    department: user.department,
  };
}
