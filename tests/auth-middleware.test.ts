import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { requireAuth, rateLimit, isAuthEnforced, _resetRateLimiter } from '../server/middleware/auth';

function mockReqRes(headers: Record<string, string> = {}, ip = '1.2.3.4') {
  const req: any = {
    headers,
    ip,
    socket: { remoteAddress: ip },
  };
  const res: any = {
    statusCode: 200,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
  };
  const next = vi.fn();
  return { req, res, next };
}

describe('API Auth & Rate Limiting (Jarvis Phase 2 — WS0)', () => {
  const ORIGINAL_TOKEN = process.env.JARVIS_API_TOKEN;

  beforeEach(() => {
    _resetRateLimiter();
    delete process.env.JARVIS_API_TOKEN;
  });

  afterEach(() => {
    if (ORIGINAL_TOKEN !== undefined) process.env.JARVIS_API_TOKEN = ORIGINAL_TOKEN;
    else delete process.env.JARVIS_API_TOKEN;
  });

  it('allows requests when no token is configured (open/dev mode)', () => {
    const { req, res, next } = mockReqRes();
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(isAuthEnforced()).toBe(false);
  });

  it('rejects unauthenticated requests when a token is enforced', () => {
    process.env.JARVIS_API_TOKEN = 'a-very-long-pairing-token-123456';
    const { req, res, next } = mockReqRes();
    requireAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(isAuthEnforced()).toBe(true);
  });

  it('rejects wrong bearer tokens', () => {
    process.env.JARVIS_API_TOKEN = 'a-very-long-pairing-token-123456';
    const { req, res, next } = mockReqRes({ authorization: 'Bearer wrong-token-000000000000' });
    requireAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('accepts the correct bearer token', () => {
    process.env.JARVIS_API_TOKEN = 'a-very-long-pairing-token-123456';
    const { req, res, next } = mockReqRes({
      authorization: 'Bearer a-very-long-pairing-token-123456',
    });
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('ignores tokens shorter than 16 chars (misconfiguration guard)', () => {
    process.env.JARVIS_API_TOKEN = 'short';
    expect(isAuthEnforced()).toBe(false);
  });

  it('rate-limits after the per-minute budget', () => {
    const limiter = rateLimit(5);
    let blocked = 0;
    for (let i = 0; i < 8; i++) {
      const { req, res, next } = mockReqRes({}, '9.9.9.9');
      limiter(req, res, next);
      if (res.statusCode === 429) blocked++;
    }
    expect(blocked).toBe(3);
  });

  it('tracks rate limits per client key', () => {
    const limiter = rateLimit(2);
    const a1 = mockReqRes({}, '1.1.1.1');
    const a2 = mockReqRes({}, '1.1.1.1');
    const a3 = mockReqRes({}, '1.1.1.1');
    const b1 = mockReqRes({}, '2.2.2.2');
    limiter(a1.req, a1.res, a1.next);
    limiter(a2.req, a2.res, a2.next);
    limiter(a3.req, a3.res, a3.next);
    limiter(b1.req, b1.res, b1.next);
    expect(a3.res.statusCode).toBe(429);
    expect(b1.res.statusCode).toBe(200);
    expect(b1.next).toHaveBeenCalled();
  });
});
