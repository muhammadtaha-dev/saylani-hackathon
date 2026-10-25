/**
 * HCM Lite — login throttling.
 *
 * Passwords are verified by Supabase Auth (bcrypt server-side); this module
 * only keeps the per-email brute-force lock in front of it: 8 failures →
 * 15-minute lock.
 */

const MAX_ATTEMPTS = 8;
const LOCK_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; lockedUntil: number }>();

export function loginLocked(email: string): number {
  const entry = attempts.get(email.toLowerCase());
  if (!entry) return 0;
  if (entry.lockedUntil > Date.now()) {
    return Math.ceil((entry.lockedUntil - Date.now()) / 1000);
  }
  return 0;
}

export function recordLoginFailure(email: string): void {
  const key = email.toLowerCase();
  const entry = attempts.get(key) ?? { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCK_MS;
    entry.count = 0;
  }
  attempts.set(key, entry);
}

export function clearLoginFailures(email: string): void {
  attempts.delete(email.toLowerCase());
}
