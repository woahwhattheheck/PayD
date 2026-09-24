import { Request, Response, NextFunction } from 'express';
import { errorHandler, notFoundHandler } from '../errorHandler.js';
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

  it('hides internal details for unknown errors outside development', () => {
    errorHandler(new Error('SELECT * FROM secrets'), req as Request, res as Response, next);

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({
      error: 'InternalServerError',
      message: 'An error occurred',
      code: 'INTERNAL_ERROR',
      requestId: 'req-abc-123',
    });
    expect(logger.error).toHaveBeenCalled();
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
