import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { errorHandler, notFoundHandler } from '../errorHandler.js';
import { requestIdMiddleware } from '../requestId.js';
import { NotFoundError, ValidationError, AuthError, AppError } from '../../errors/index.js';
import config from '../../config/index.js';
import logger from '../../utils/logger.js';

jest.mock('../../config/index.js', () => ({
  __esModule: true,
  default: { nodeEnv: 'test' },
}));

jest.mock('../../utils/logger.js', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  },
}));

describe('errorHandler middleware', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;
  let statusMock: jest.Mock;
  let jsonMock: jest.Mock;

  beforeEach(() => {
    jsonMock = jest.fn().mockReturnThis();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    req = {
      method: 'GET',
      path: '/api/missing',
      originalUrl: '/api/missing',
      requestId: 'req-abc-123',
    };
    res = { status: statusMock, json: jsonMock } as any;
    next = jest.fn();
    (config as any).nodeEnv = 'test';
    jest.clearAllMocks();
  });

  it('maps NotFoundError to consistent 404 payload', () => {
    errorHandler(new NotFoundError('Employee not found'), req as Request, res as Response, next);

    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith({
      error: 'NotFoundError',
      message: 'Employee not found',
      code: 'NOT_FOUND',
      requestId: 'req-abc-123',
    });
    expect(jsonMock.mock.calls[0][0].stack).toBeUndefined();
  });

  it('maps ValidationError to 400 with VALIDATION_ERROR code', () => {
    errorHandler(
      new ValidationError('email is required'),
      req as Request,
      res as Response,
      next
    );

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'ValidationError',
        message: 'email is required',
        code: 'VALIDATION_ERROR',
        requestId: 'req-abc-123',
      })
    );
  });

  it('maps AuthError to 401 by default', () => {
    errorHandler(new AuthError(), req as Request, res as Response, next);

    expect(statusMock).toHaveBeenCalledWith(401);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'AuthError',
        code: 'AUTH_ERROR',
        requestId: 'req-abc-123',
      })
    );
  });

  it('maps AuthError with 403 when forbidden', () => {
    errorHandler(
      new AuthError('Forbidden', 403, 'FORBIDDEN'),
      req as Request,
      res as Response,
      next
    );

    expect(statusMock).toHaveBeenCalledWith(403);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'FORBIDDEN',
        message: 'Forbidden',
      })
    );
  });

  it.each([
    ['Error', new Error('SELECT * FROM secrets')],
    ['SyntaxError', new SyntaxError('Internal JSON parsing failure')],
    ['unrecognized status', Object.assign(new Error('Unrecognized client error'), { status: 400 })],
  ])('hides internal details for unknown errors outside development: %s', (_name, err) => {
    errorHandler(err, req as Request, res as Response, next);

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({
      error: 'InternalServerError',
      message: 'An error occurred',
      code: 'INTERNAL_ERROR',
      requestId: 'req-abc-123',
    });
    expect(logger.error).toHaveBeenCalled();
  });

  it.each<[string, () => unknown]>([
    ['null-prototype object', () => Object.create(null)],
    ['throwing toString', () => ({ toString() { throw new Error('conversion failed'); } })],
    ['throwing primitive conversion', () => ({
      [Symbol.toPrimitive]() { throw new Error('conversion failed'); },
    })],
  ])('returns the fallback when an unknown error cannot be stringified: %s', (_name, createError) => {
    for (const nodeEnv of ['production', 'development']) {
      (config as any).nodeEnv = nodeEnv;
      errorHandler(createError(), req as Request, res as Response, next);

      expect(statusMock).toHaveBeenLastCalledWith(500);
      expect(jsonMock).toHaveBeenLastCalledWith({
        error: 'InternalServerError',
        message: 'An error occurred',
        code: 'INTERNAL_ERROR',
        requestId: 'req-abc-123',
      });
      expect(logger.error).toHaveBeenLastCalledWith('Unhandled error', expect.objectContaining({
        message: 'An error occurred',
        stack: undefined,
        requestId: 'req-abc-123',
      }));
    }
    expect(next).not.toHaveBeenCalled();
  });

  it('includes stack traces only in development', () => {
    (config as any).nodeEnv = 'development';
    const err = new AppError('boom', 500, 'BOOM');

    errorHandler(err, req as Request, res as Response, next);

    expect(statusMock).toHaveBeenCalledWith(500);
    const body = jsonMock.mock.calls[0][0];
    expect(body.stack).toEqual(expect.stringContaining('AppError'));
    expect(body.message).toBe('boom');
  });

  it('notFoundHandler forwards a NotFoundError to next', () => {
    notFoundHandler(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    const forwarded = (next as jest.Mock).mock.calls[0][0];
    expect(forwarded).toBeInstanceOf(NotFoundError);
    expect(forwarded.message).toContain('GET /api/missing');
  });
});

describe('errorHandler with the Express body parsers', () => {
  function createApp() {
    const app = express();
    app.use(requestIdMiddleware);
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.post('/body', (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler);
    return app;
  }

  beforeEach(() => {
    (config as any).nodeEnv = 'production';
    jest.clearAllMocks();
  });

  it('returns a sanitized 400 for malformed JSON with the request ID', async () => {
    const response = await request(createApp())
      .post('/body')
      .set('Content-Type', 'application/json')
      .set('X-Request-ID', 'parse-request')
      .send('private-request-body');

    expect(response.status).toBe(400);
    expect(response.headers['x-request-id']).toBe('parse-request');
    expect(response.body).toEqual({
      error: 'ValidationError',
      message: 'Invalid request body',
      code: 'VALIDATION_ERROR',
      requestId: 'parse-request',
    });
    expect(JSON.stringify(response.body)).not.toContain('private-request-body');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each(['application/json', 'application/x-www-form-urlencoded'])(
    'preserves 413 for an oversized %s body',
    async (contentType) => {
      const response = await request(createApp())
        .post('/body')
        .set('Content-Type', contentType)
        .set('X-Request-ID', 'large-request')
        .send('x'.repeat(110 * 1024));

      expect(response.status).toBe(413);
      expect(response.headers['x-request-id']).toBe('large-request');
      expect(response.body).toEqual({
        error: 'AppError',
        message: 'Request body is too large',
        code: 'PAYLOAD_TOO_LARGE',
        requestId: 'large-request',
      });
      expect(logger.error).not.toHaveBeenCalled();
    }
  );

  it.each(['application/json', 'application/x-www-form-urlencoded'])(
    'preserves a sanitized 415 for an unsupported %s charset',
    async (contentType) => {
      const response = await request(createApp())
        .post('/body')
        .set('Content-Type', `${contentType}; charset=private-unsupported-charset`)
        .set('X-Request-ID', 'charset-request')
        .send('private-request-body');

      expect(response.status).toBe(415);
      expect(response.headers['x-request-id']).toBe('charset-request');
      expect(response.body).toEqual({
        error: 'AppError',
        message: 'Unsupported request body charset',
        code: 'UNSUPPORTED_MEDIA_TYPE',
        requestId: 'charset-request',
      });
      expect(logger.error).not.toHaveBeenCalled();
    }
  );

  it.each(['application/json', 'application/x-www-form-urlencoded'])(
    'preserves a sanitized 415 for unsupported %s content encoding',
    async (contentType) => {
      const response = await request(createApp())
        .post('/body')
        .set('Content-Type', contentType)
        .set('Content-Encoding', 'private-unsupported-encoding')
        .set('X-Request-ID', 'encoding-request')
        .send('private-request-body');

      expect(response.status).toBe(415);
      expect(response.headers['x-request-id']).toBe('encoding-request');
      expect(response.body).toEqual({
        error: 'AppError',
        message: 'Unsupported request body encoding',
        code: 'UNSUPPORTED_MEDIA_TYPE',
        requestId: 'encoding-request',
      });
      expect(logger.error).not.toHaveBeenCalled();
    }
  );

  it('preserves 413 when form parameters exceed the parser limit', async () => {
    const body = Array.from({ length: 1001 }, (_, index) => `p${index}=private-value`).join('&');
    const response = await request(createApp())
      .post('/body')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .set('X-Request-ID', 'parameters-request')
      .send(body);

    expect(response.status).toBe(413);
    expect(response.headers['x-request-id']).toBe('parameters-request');
    expect(response.body).toEqual({
      error: 'AppError',
      message: 'Too many request body parameters',
      code: 'PAYLOAD_TOO_LARGE',
      requestId: 'parameters-request',
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('includes the original parser stack only in development', async () => {
    (config as any).nodeEnv = 'development';
    const response = await request(createApp())
      .post('/body')
      .set('Content-Type', 'application/json')
      .send('{');

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Invalid request body');
    expect(response.body.stack).toEqual(expect.stringContaining('SyntaxError'));
  });

  it('continues handling valid bodies normally', async () => {
    const response = await request(createApp())
      .post('/body')
      .set('X-Request-ID', 'valid-request')
      .send({ value: 'valid' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(response.headers['x-request-id']).toBe('valid-request');
  });
});
