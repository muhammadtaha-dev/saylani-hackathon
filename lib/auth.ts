/**
 * HCM Lite — password hashing + login throttling.
 *
 * Passwords are stored as scrypt hashes (salt:hash) and never leave the
 * data layer. Failed logins are throttled per email to blunt brute force.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// ---------------------------------------------------------------------------
// Failed-login throttle: lock an email for 15 minutes after 8 failures.
// ---------------------------------------------------------------------------

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
