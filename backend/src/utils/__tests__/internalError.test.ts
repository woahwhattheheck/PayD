import { Request, Response } from 'express';
import config from '../../config/index.js';
import logger from '../logger.js';
import { sendInternalError } from '../internalError.js';

jest.mock('../../config/index.js', () => ({
  __esModule: true,
  default: { nodeEnv: 'test' },
}));

jest.mock('../logger.js', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  },
}));

describe('sendInternalError', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let statusMock: jest.Mock;
  let jsonMock: jest.Mock;

  beforeEach(() => {
    jsonMock = jest.fn().mockReturnThis();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    req = {
      method: 'GET',
      originalUrl: '/api/test',
      requestId: 'req-internal-1',
    };
    res = {
      status: statusMock,
      json: jsonMock,
    } as any;
    (config as any).nodeEnv = 'test';
    jest.clearAllMocks();
  });

  it.each<[string, () => unknown]>([
    ['null-prototype object', () => Object.create(null)],
    ['throwing toString', () => ({ toString() { throw new Error('conversion failed'); } })],
    ['throwing primitive conversion', () => ({
      [Symbol.toPrimitive]() { throw new Error('conversion failed'); },
    })],
  ])('keeps the standard 500 response when an unknown error cannot be stringified: %s', (_name, createError) => {
    for (const nodeEnv of ['production', 'development']) {
      (config as any).nodeEnv = nodeEnv;

      expect(() =>
        sendInternalError(
          res as Response,
          req as Request,
          createError(),
          'Unable to complete request'
        )
      ).not.toThrow();

      expect(logger.error).toHaveBeenLastCalledWith(
        'Request failed',
        expect.objectContaining({
          requestId: 'req-internal-1',
          path: '/api/test',
          method: 'GET',
          message: 'An error occurred',
          stack: undefined,
        })
      );
      expect(statusMock).toHaveBeenLastCalledWith(500);

      const expected = {
        error: 'Unable to complete request',
        message: 'Unable to complete request',
        code: 'INTERNAL_ERROR',
        requestId: 'req-internal-1',
        ...(nodeEnv === 'development' ? { detail: 'An error occurred' } : {}),
      };
      expect(jsonMock).toHaveBeenLastCalledWith(expected);
    }
  });
});
