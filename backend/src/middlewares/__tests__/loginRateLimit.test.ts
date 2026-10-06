import type { NextFunction, Request, Response } from 'express';
import { loginRateLimit } from '../rateLimitMiddleware.js';
import { rateLimitService } from '../../services/rateLimitService.js';

describe('authentication login rate limiting', () => {
  const primaryIdentifier = 'login:GTEST';
  const alternateIdentifier = 'login:GOTHER';

  beforeEach(async () => {
    await rateLimitService.resetRateLimit(primaryIdentifier, 'auth');
    await rateLimitService.resetRateLimit(alternateIdentifier, 'auth');
  });

  afterEach(async () => {
    await rateLimitService.resetRateLimit(primaryIdentifier, 'auth');
    await rateLimitService.resetRateLimit(alternateIdentifier, 'auth');
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

  function request(walletAddress: string, ip: string): Request {
    return {
      method: 'POST',
      path: '/login',
      headers: {},
      body: { walletAddress },
      ip,
    } as unknown as Request;
  }

  it('throttles the normalized wallet across source IPs without sharing the bucket', async () => {
    const middleware = loginRateLimit();
    const limit = rateLimitService.getTierConfig('auth').maxRequests;

    for (let attempt = 0; attempt < limit; attempt += 1) {
      const { res } = response();
      const next = jest.fn() as unknown as NextFunction;

      await middleware(
        request(' gtest ', `203.0.113.${attempt + 1}`),
        res,
        next
      );

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(200);
    }

    const blockedResponse = response();
    const blockedNext = jest.fn() as unknown as NextFunction;
    await middleware(
      request('GTEST', '198.51.100.40'),
      blockedResponse.res,
      blockedNext
    );

    expect(blockedNext).not.toHaveBeenCalled();
    expect(blockedResponse.res.statusCode).toBe(429);
    expect(blockedResponse.headers.get('Retry-After')).toEqual(expect.any(Number));
    expect(Number(blockedResponse.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(blockedResponse.res.body).toEqual(
      expect.objectContaining({
        error: 'Too Many Requests',
        retryAfter: expect.any(Number),
        limit,
      })
    );

    // The same source remains usable for a different wallet because login
    // attempts no longer collapse into one reverse-proxy IP bucket.
    const alternateResponse = response();
    const alternateNext = jest.fn() as unknown as NextFunction;
    await middleware(
      request('GOTHER', '198.51.100.40'),
      alternateResponse.res,
      alternateNext
    );

    expect(alternateNext).toHaveBeenCalledTimes(1);
    expect(alternateResponse.res.statusCode).toBe(200);
  });
});
