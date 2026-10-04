import { Request, Response, NextFunction } from 'express';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import { AppError, NotFoundError, ValidationError } from '../errors/index.js';

/** Consistent error payload returned to clients. */
export interface ErrorResponseBody {
  error: string;
  message: string;
  code: string;
  requestId?: string;
  stack?: string;
}

function requestIdOf(req: Request): string | undefined {
  return typeof req.requestId === 'string' ? req.requestId : undefined;
}

/** Thrown values need not support JavaScript's string conversion. */
function unknownErrorMessage(err: unknown): string {
  try {
    return String(err);
  } catch {
    return 'An error occurred';
  }
}

/** Preserve known body-parser client failures without exposing their raw body. */
function normalizeBodyParserError(err: unknown): unknown {
  if (!(err instanceof Error) || err instanceof AppError) {
    return err;
  }

  const parserError = err as Error & { type?: unknown; status?: unknown };
  let normalized: AppError;

  if (parserError.type === 'entity.parse.failed' && parserError.status === 400) {
    normalized = new ValidationError('Invalid request body');
  } else if (parserError.type === 'entity.too.large' && parserError.status === 413) {
    normalized = new AppError('Request body is too large', 413, 'PAYLOAD_TOO_LARGE');
  } else if (parserError.type === 'parameters.too.many' && parserError.status === 413) {
    normalized = new AppError('Too many request body parameters', 413, 'PAYLOAD_TOO_LARGE');
  } else if (parserError.type === 'charset.unsupported' && parserError.status === 415) {
    normalized = new AppError('Unsupported request body charset', 415, 'UNSUPPORTED_MEDIA_TYPE');
  } else if (parserError.type === 'encoding.unsupported' && parserError.status === 415) {
    normalized = new AppError('Unsupported request body encoding', 415, 'UNSUPPORTED_MEDIA_TYPE');
  } else {
    return err;
  }

  normalized.stack = err.stack;
  return normalized;
}

/**
 * Express 404 fallback that uses the same response shape as the error handler.
 */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`Cannot ${req.method} ${req.path}`));
}

/**
 * Global error middleware. Maps AppError subclasses (and unknown errors) to
 * `{ error, message, code, requestId }` and only includes stack traces in
 * development.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  err = normalizeBodyParserError(err);
  const requestId = requestIdOf(req);
  const isDev = config.nodeEnv === 'development';

  if (err instanceof AppError) {
    if (!err.isOperational || err.statusCode >= 500) {
      logger.error('Operational/server error', {
        err,
        code: err.code,
        statusCode: err.statusCode,
        requestId,
        path: req.originalUrl,
        method: req.method,
      });
    } else {
      logger.warn('Client error', {
        message: err.message,
        code: err.code,
        statusCode: err.statusCode,
        requestId,
        path: req.originalUrl,
        method: req.method,
      });
    }

    const body: ErrorResponseBody = {
      error: err.name,
      message: err.message,
      code: err.code,
      requestId,
    };

    if (isDev && err.stack) {
      body.stack = err.stack;
    }

    res.status(err.statusCode).json(body);
    return;
  }

  const message = err instanceof Error ? err.message : unknownErrorMessage(err);
  const stack = err instanceof Error ? err.stack : undefined;

  logger.error('Unhandled error', {
    message,
    stack,
    requestId,
    path: req.originalUrl,
    method: req.method,
  });

  const body: ErrorResponseBody = {
    error: 'InternalServerError',
    message: isDev ? message || 'An error occurred' : 'An error occurred',
    code: 'INTERNAL_ERROR',
    requestId,
  };

  if (isDev && stack) {
    body.stack = stack;
  }

  res.status(500).json(body);
}
