import { Request, Response, NextFunction } from 'express';

const DEFAULT_TIMEOUT_MS = 30_000;
const BULK_TIMEOUT_MS = 120_000;

function isBulkPath(path: string): boolean {
  const p = path.toLowerCase();
  return (
    p.includes('/bulk') ||
    p.includes('/batch') ||
    p.includes('/import') ||
    p.includes('/export') ||
    p.includes('/payroll/run')
  );
}

/**
 * Abort long-running requests with HTTP 504 and clear the timer when the
 * response finishes so completed responses are never timed out.
 */
export function requestTimeoutMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const timeoutMs = isBulkPath(req.path) ? BULK_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;

  const timer = setTimeout(() => {
    if (res.headersSent) {
      try {
        res.destroy();
      } catch {
        // ignore
      }
      return;
    }
    res.status(504).json({
      error: 'Gateway Timeout',
      message: `Request exceeded the ${timeoutMs / 1000}s timeout`,
    });
  }, timeoutMs);

  const clear = () => clearTimeout(timer);
  res.on('finish', clear);
  res.on('close', clear);

  next();
}

export const __test__ = { isBulkPath, DEFAULT_TIMEOUT_MS, BULK_TIMEOUT_MS };
