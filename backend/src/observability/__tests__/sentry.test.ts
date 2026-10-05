import type { Request } from 'express';
import { buildSentryRequestContext, sanitizeSentryEvent } from '../sentry.js';

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
    expect(sanitized.request.headers['x-request-id']).toBe('req-123');
    expect(sanitized.request.headers.accept).toBe('application/json');
  });
});
