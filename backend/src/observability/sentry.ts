import * as Sentry from '@sentry/node';
import type { Request } from 'express';

export interface SentryRequestContext {
  requestId?: string;
  userId?: string;
  route: string;
  method: string;
}

function normalizeUserId(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

export function buildSentryRequestContext(req: Request): SentryRequestContext {
  const routePath =
    typeof req.route?.path === 'string'
      ? `${req.baseUrl || ''}${req.route.path}`
      : req.path;

  const user = req.user as { id?: unknown } | undefined;

  const requestId = (req as Request & { requestId?: string }).requestId;

  return {
    requestId,
    userId: normalizeUserId(user?.id),
    route: routePath || '/',
    method: req.method,
  };
}

function stripUrlQueryAndFragment(value: unknown): unknown {
  if (typeof value !== 'string') return undefined;
  const detailsStart = value.search(/[?#]/);
  return detailsStart === -1 ? value : value.slice(0, detailsStart);
}

/**
 * PayD handles payroll credentials and, historically, some payment endpoints
 * accepted sensitive values in query strings. Keep those surfaces out of
 * error telemetry even when an SDK integration adds request data.
 */
export function sanitizeSentryEvent(event: any): any {
  if (!event?.request) return event;

  const sanitizedHeaders: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(event.request.headers || {})) {
    const normalized = name.toLowerCase();
    if (normalized === 'authorization' || normalized === 'cookie' || normalized === 'set-cookie') {
      continue;
    }
    sanitizedHeaders[name] = normalized === 'referer' || normalized === 'referrer'
      ? stripUrlQueryAndFragment(value)
      : value;
  }

  event.request = {
    ...event.request,
    url: stripUrlQueryAndFragment(event.request.url),
    data: undefined,
    cookies: undefined,
    query_string: undefined,
    headers: sanitizedHeaders,
  };

  return event;
}

export function captureRequestError(error: unknown, req: Request): void {
  const context = buildSentryRequestContext(req);
  const errorType = error instanceof Error ? error.name : 'NonErrorThrown';

  Sentry.withScope((scope) => {
    scope.setTag('request_id', context.requestId || 'unknown');
    scope.setTag('route', context.route);
    scope.setTag('method', context.method);
    scope.setTag('error_type', errorType);

    if (context.userId) {
      scope.setUser({ id: context.userId });
    }

    scope.setContext('payd_request', {
      requestId: context.requestId || 'unknown',
      route: context.route,
      method: context.method,
    });

    Sentry.captureException(error);
  });
}
