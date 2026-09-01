/**
 * API auth + rate limiting.
 *
 * Pairing-token model (no accounts needed yet):
 * - If JARVIS_API_TOKEN is set in the environment, every /api/* request must
 *   carry `Authorization: Bearer <token>`. Recommended for any public deployment.
 * - If it is NOT set (typical local/dev/AI-Studio usage where the platform
 *   fronts auth), requests are allowed but still rate-limited.
 *
 * The health endpoint reports whether auth is enforced so clients can prompt
 * the user to pair.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const configuredToken = (): string | undefined => {
  const t = process.env.JARVIS_API_TOKEN;
  return t && t.trim().length >= 16 ? t.trim() : undefined;
};

export function isAuthEnforced(): boolean {
  return Boolean(configuredToken());
}

function timingSafeEquals(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = configuredToken();
  if (!token) {
    next();
    return;
  }
  const header = req.headers.authorization || '';
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (presented && timingSafeEquals(presented, token)) {
    next();
    return;
  }
  res.status(401).json({ error: 'Unauthorized. Pair this client with the Jarvis server token.' });
}

// ---------------------------------------------------------------------------
// Fixed-window rate limiter (per client key), no external dependency.
// ---------------------------------------------------------------------------

interface WindowState {
  windowStart: number;
  count: number;
}

const WINDOW_MS = 60_000;
const buckets = new Map<string, WindowState>();

function clientKey(req: Request): string {
  const auth = req.headers.authorization;
  if (auth) return `tok:${crypto.createHash('sha256').update(auth).digest('hex').slice(0, 16)}`;
  return `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`;
}

export function rateLimit(maxPerMinute = 60) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = clientKey(req);
    const now = Date.now();
    let state = buckets.get(key);
    if (!state || now - state.windowStart >= WINDOW_MS) {
      state = { windowStart: now, count: 0 };
      buckets.set(key, state);
    }
    state.count += 1;
    if (state.count > maxPerMinute) {
      res.status(429).json({ error: 'Rate limit exceeded. Please slow down.' });
      return;
    }
    // Opportunistic cleanup to bound memory
    if (buckets.size > 10_000) {
      for (const [k, s] of buckets) {
        if (now - s.windowStart >= WINDOW_MS) buckets.delete(k);
      }
    }
    next();
  };
}

/** Test hook. */
export function _resetRateLimiter(): void {
  buckets.clear();
}
