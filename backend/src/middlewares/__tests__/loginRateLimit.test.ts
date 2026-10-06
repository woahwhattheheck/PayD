import type { NextFunction, Request, Response } from 'express';
import { authRateLimit } from '../rateLimitMiddleware.js';
import { rateLimitService } from '../../services/rateLimitService.js';

describe('authentication login rate limiting', () => {
  const identifier = 'payd403-login-threshold-test';

  beforeEach(async () => {
    await rateLimitService.resetRateLimit(identifier, 'auth');
  });

  afterEach(async () => {
    await rateLimitService.resetRateLimit(identifier, 'auth');
  });

  function response() {
    const headers = new Map<string, unknown>();
    const res = {
      statusCode: 200,
      body: undefined as unknown,
      setHeader(name: string, value: unknown) {
        headers.set(name, value);
        return this;
      },
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
      on() {
        return this;
      },
    };

    return { res: res as unknown as Response & { statusCode: number; body: unknown }, headers };
  }

  it('allows the auth-tier threshold, then returns 429 with Retry-After', async () => {
    const middleware = authRateLimit({ identifier: () => identifier });
    const limit = rateLimitService.getTierConfig('auth').maxRequests;
    const request = {
      method: 'POST',
      path: '/login',
      headers: {},
      body: { walletAddress: 'GTEST' },
      ip: '203.0.113.40',
    } as unknown as Request;

    for (let attempt = 0; attempt < limit; attempt += 1) {
      const { res } = response();
      const next = jest.fn() as unknown as NextFunction;

      await middleware(request, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(200);
    }

    const { res, headers } = response();
    const next = jest.fn() as unknown as NextFunction;

    await middleware(request, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(headers.get('Retry-After')).toEqual(expect.any(Number));
    expect(Number(headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(res.body).toEqual(
      expect.objectContaining({
        error: 'Too Many Requests',
        retryAfter: expect.any(Number),
        limit,
      })
    );
  });
});
