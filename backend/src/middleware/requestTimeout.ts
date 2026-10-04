import { NextFunction, Request, Response } from 'express';

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const BULK_REQUEST_TIMEOUT_MS = 120_000;

const BULK_ROUTE_PATTERN = /(?:^|\/)(?:bulk|batch)(?:[-/]|$)/i;

export function isBulkRequest(req: Pick<Request, 'originalUrl' | 'path'>): boolean {
  const requestPath = (req.originalUrl || req.path || '').split('?')[0];
  return BULK_ROUTE_PATTERN.test(requestPath);
}

export function requestTimeoutMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const timeoutMs = isBulkRequest(req) ? BULK_REQUEST_TIMEOUT_MS : DEFAULT_REQUEST_TIMEOUT_MS;
  let settled = false;

  const timeout = setTimeout(() => {
    if (settled || res.writableEnded) return;

    if (res.headersSent) {
      res.end();
      return;
    }

    res.status(504).json({
      error: 'Gateway Timeout',
      message: `Request exceeded ${timeoutMs / 1000} second timeout`,
      requestId: (req as Request & { requestId?: string }).requestId,
    });
  }, timeoutMs);

  const cleanup = (): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
  };

  res.once('finish', cleanup);
  res.once('close', cleanup);

  next();
}

export default requestTimeoutMiddleware;
