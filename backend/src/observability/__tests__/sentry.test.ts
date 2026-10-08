import type { Request } from 'express';
import * as Sentry from '@sentry/node';
import { httpRequestToRequestData } from '@sentry/core';
import { buildSentryRequestContext, captureRequestError, sanitizeSentryEvent } from '../sentry.js';

describe('Sentry backend observability', () => {
  it('builds bounded request context with request, user and route identifiers', () => {
    const req = {
      requestId: 'req-123',
      method: 'POST',
      baseUrl: '/api/payroll',
      route: { path: '/employees/:employeeId' },
      path: '/employees/42',
      user: { id: 17, email: 'private@example.com' },
      query: { secretKey: 'S-DO-NOT-CAPTURE' },
      body: { password: 'do-not-capture' },
    } as unknown as Request;

    expect(buildSentryRequestContext(req)).toEqual({
      requestId: 'req-123',
      userId: '17',
      route: '/api/payroll/employees/:employeeId',
      method: 'POST',
    });
  });

  it('removes sensitive request payload, query, cookies and credential headers', () => {
    const event: any = {
      request: {
        data: { password: 'secret' },
        cookies: { session: 'secret' },
        query_string: 'secretKey=S-DO-NOT-CAPTURE',
        headers: {
          Authorization: 'Bearer secret',
          Cookie: 'session=secret',
          'Set-Cookie': 'session=secret',
          'X-API-Key': 'private-api-key',
          'pRoXy-AuThOrIzAtIoN': 'Basic private-proxy',
          'x-auth-token': 'private-auth-token',
          'X-CSRF-Token': 'private-csrf-token',
          'x-request-id': 'req-123',
          accept: 'application/json',
        },
      },
    };

    const sanitized = sanitizeSentryEvent(event);

    expect(sanitized.request.data).toBeUndefined();
    expect(sanitized.request.cookies).toBeUndefined();
    expect(sanitized.request.query_string).toBeUndefined();
    expect(sanitized.request.headers.Authorization).toBeUndefined();
    expect(sanitized.request.headers.Cookie).toBeUndefined();
    expect(sanitized.request.headers['Set-Cookie']).toBeUndefined();
    for (const name of ['X-API-Key', 'pRoXy-AuThOrIzAtIoN', 'x-auth-token', 'X-CSRF-Token']) {
      expect(sanitized.request.headers[name]).toBeUndefined();
    }
    expect(JSON.stringify(sanitized.request)).not.toContain('private-api-key');
    expect(JSON.stringify(sanitized.request)).not.toContain('private-proxy');
    expect(JSON.stringify(sanitized.request)).not.toContain('private-auth-token');
    expect(sanitized.request.headers['x-request-id']).toBe('req-123');
    expect(sanitized.request.headers.accept).toBe('application/json');
  });

  it('removes query and fragment details from request and case-insensitive referrer URLs', () => {
    const event = {
      request: {
        url: 'https://payd.example.invalid/api/payroll?note=private#private-fragment',
        headers: {
          Referer: 'https://payd.example.invalid/dashboard?note=private#private-fragment',
          rEfErReR: '/dashboard?note=private#private-fragment',
          accept: 'application/json',
        },
      },
    };

    expect(sanitizeSentryEvent(event).request).toEqual({
      url: 'https://payd.example.invalid/api/payroll',
      data: undefined,
      cookies: undefined,
      query_string: undefined,
      headers: {
        Referer: 'https://payd.example.invalid/dashboard',
        rEfErReR: '/dashboard',
        accept: 'application/json',
      },
    });
  });

  it.each([
    { shape: 'array', value: ['https://payd.example.invalid/?note=private'] },
    { shape: 'object', value: { url: 'https://payd.example.invalid/?note=private' } },
  ])('drops unexpected $shape URL and referrer values without losing safe headers', ({ value }) => {
    const event = {
      request: {
        url: value,
        headers: { Referer: value, referrer: value, 'x-request-id': 'req-123' },
      },
    };

    const sanitized = sanitizeSentryEvent(event);
    expect(sanitized.request.url).toBeUndefined();
    expect(sanitized.request.headers.Referer).toBeUndefined();
    expect(sanitized.request.headers.referrer).toBeUndefined();
    expect(sanitized.request.headers['x-request-id']).toBe('req-123');
  });

  it('sanitizes a real SDK event while preserving capture identifiers', async () => {
    const events: Sentry.Event[] = [];
    const req = {
      requestId: 'sdk-request-123', method: 'GET', baseUrl: '/api/payroll',
      route: { path: '/employees/:employeeId' }, path: '/employees/42',
      url: '/api/payroll/employees/42?payrollNote=DUMMY_PRIVATE_QUERY&secretKey=DUMMY_SECRET_KEY',
      protocol: 'https',
      user: { id: 17, email: 'dummy-private@example.invalid' },
      headers: {
        host: 'payd.example.invalid', authorization: 'Bearer DUMMY_AUTH',
        cookie: 'session=DUMMY_COOKIE', 'x-request-id': 'sdk-request-123',
        referer: 'https://payd.example.invalid/dashboard?payrollNote=DUMMY_REFERER_QUERY#DUMMY_FRAGMENT',
      },
      body: { password: 'DUMMY_BODY_PASSWORD' },
    } as unknown as Request;

    // The real SDK processes the request and capture scope. Its transport only
    // records events in memory; no Sentry service or Express server is contacted.
    Sentry.init({
      dsn: 'https://0123456789abcdef0123456789abcdef@sentry.example.invalid/1',
      sendDefaultPii: false,
      beforeSend: sanitizeSentryEvent,
      transport: () => ({
        send(envelope) {
          for (const [header, item] of envelope[1]) {
            if (header.type === 'event') events.push(item as Sentry.Event);
          }
          return Promise.resolve({ statusCode: 200 });
        },
        flush: async () => true,
      }),
    });

    try {
      Sentry.withIsolationScope((scope) => {
        scope.setSDKProcessingMetadata({ normalizedRequest: httpRequestToRequestData(req) });
        captureRequestError(new RangeError('controlled capture failure'), req);
      });
      await Sentry.flush(2000);

      expect(events).toHaveLength(1);
      const event = events[0]!;
      expect(event.request?.url).toBe('https://payd.example.invalid/api/payroll/employees/42');
      expect(event.request?.headers?.referer).toBe('https://payd.example.invalid/dashboard');
      expect(event.request?.headers?.['x-request-id']).toBe('sdk-request-123');
      expect(event.tags).toMatchObject({
        request_id: 'sdk-request-123', route: '/api/payroll/employees/:employeeId',
        method: 'GET', error_type: 'RangeError',
      });
      expect(event.user).toEqual({ id: '17' });
      expect(event.contexts?.payd_request).toEqual({
        requestId: 'sdk-request-123', route: '/api/payroll/employees/:employeeId', method: 'GET',
      });
      for (const marker of ['DUMMY_PRIVATE_QUERY', 'DUMMY_REFERER_QUERY', 'DUMMY_FRAGMENT',
        'DUMMY_AUTH', 'DUMMY_COOKIE', 'DUMMY_BODY_PASSWORD', 'dummy-private@example.invalid']) {
        expect(JSON.stringify(event)).not.toContain(marker);
      }
    } finally {
      await Sentry.close(2000);
    }
  });
});
