/**
 * Tiny in-memory fixed-window rate limiter (the app runs as a single server process). Returns
 * false once `key` goes over `limit` hits in `windowMs`.
 *
 * The map is bounded: keys come from outside (e-mails, IPs), so a flood of distinct keys could
 * otherwise grow it without end. Past MAX_KEYS, expired windows are dropped first and then the
 * oldest ones — at worst a flood resets somebody's counter early, it never exhausts memory.
 */
const MAX_KEYS = 20_000;

const windows = new Map<string, { count: number; resetAt: number }>();

export function allowAttempt(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.delete(key);
    windows.set(key, { count: 1, resetAt: now + windowMs });
    if (windows.size > MAX_KEYS) prune(now);
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

function prune(now: number): void {
  for (const [key, value] of windows) {
    if (value.resetAt <= now) windows.delete(key);
  }
  // Insertion order: the first keys are the oldest windows.
  for (const key of windows.keys()) {
    if (windows.size <= MAX_KEYS * 0.9) break;
    windows.delete(key);
  }
}

/** For tests. */
export function rateLimitKeyCount(): number {
  return windows.size;
}
