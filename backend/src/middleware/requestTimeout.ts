import { Request, Response, NextFunction } from 'express';

const DEFAULT_TIMEOUT_MS = 30_000;
const BULK_TIMEOUT_MS = 120_000;

// Match operation names, not unrelated segments such as "importer" or "exporters".
// Keep plural collections and compound names used by batches, exports and bulk-import.
const BULK_OPERATION_PATH = /\/(?:bulk|batch(?:es)?|imports?|exports?)(?:[/-]|$)/i;
const PAYROLL_RUN_PATH = /\/payroll\/run(?:[/-]|$)/i;

function isBulkPath(path: string): boolean {
  return BULK_OPERATION_PATH.test(path) || PAYROLL_RUN_PATH.test(path);
}

/**
 * Abort long-running requests with HTTP 504 and clear the timer when the
 * response finishes so completed responses are never timed out.
 */
export function requestTimeoutMiddleware(req: Request, res: Response, next: NextFunction): void {
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
    // Flush the 504 before closing the connection and releasing a pending body reader.
    res.setHeader('Connection', 'close');
    res.once('finish', () => req.destroy());
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
