import { Request, Response } from 'express';
import config from '../config/index.js';
import logger from '../utils/logger.js';

/**
 * Shared 500-response helper with the common error envelope.
 *
 * Why this exists: several controllers were doing
 * `res.status(500).json({ error: error.message })`. When the failing call is a
 * database query, `error.message` carries table names, column names and chunks
 * of SQL — exactly the schema information an attacker needs to aim SQL
 * injection. It can also leak file paths and stack details from libraries.
 *
 * What it does instead:
 * - Production always returns one fixed, generic message per call site.
 *   No error text reaches the client, so nothing about internals leaks.
 * - The full error is logged server-side with the request id (when the
 *   requestId middleware has run) so operations can correlate a client report
 *   with the log entry that holds the real cause.
 * - In development the real message is included in the response so debugging
 *   stays fast where the leak cannot be exploited.
 */
export function sendInternalError(
  res: Response,
  req: Request,
  error: unknown,
  userMessage = 'Internal server error'
): void {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  const requestId = typeof (req as any).requestId === 'string' ? (req as any).requestId : undefined;
  logger.error('Request failed', {
    requestId,
    path: req.originalUrl,
    method: req.method,
    message,
    stack: error instanceof Error ? error.stack : undefined,
  });

  // Keep legacy error text while supplying the shared machine-readable fields.
  const body = {
    error: userMessage,
    message: userMessage,
    code: 'INTERNAL_ERROR',
    requestId,
  };

  if (config.nodeEnv === 'development') {
    res.status(500).json({ ...body, detail: message });
    return;
  }

  res.status(500).json(body);
}
