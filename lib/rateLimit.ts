/**
 * HCM Lite — per-user sliding-window rate limiter (Art. VIII, NFR-05).
 * About 20 requests per user per hour, enforced server-side per user (not
 * per IP). In-memory store: per serverless instance, which is sufficient for
 * the demo and documented in the README.
 */

const WINDOW_MS = 60 * 60 * 1000;
export const RATE_LIMIT = 20;

const hits = new Map<string, number[]>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function checkRateLimit(userId: string): RateLimitResult {
  const now = Date.now();
  const window = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (window.length >= RATE_LIMIT) {
    hits.set(userId, window);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((WINDOW_MS - (now - window[0])) / 1000)
    );
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }
  window.push(now);
  hits.set(userId, window);
  return { allowed: true, remaining: RATE_LIMIT - window.length, retryAfterSeconds: 0 };
}
