import type { Request, Response } from 'express';
import { AppError, ValidationError } from '../../errors/index.js';
import config from '../../config/index.js';
import logger from '../../utils/logger.js';
import { errorHandler } from '../errorHandler.js';

jest.mock('../../config/index.js', () => ({
  __esModule: true, default: { nodeEnv: 'test' },
}));
jest.mock('../../utils/logger.js', () => ({
  __esModule: true, default: { error: jest.fn(), warn: jest.fn() },
}));

const cases = [
  new AppError('private database detail', 500, 'DATABASE_ERROR'),
  new AppError('private upstream detail', 502, 'UPSTREAM_ERROR'),
  new AppError('private invariant detail', 400, 'INVARIANT_ERROR', false),
];

function respond(err: AppError) {
  const req = { method: 'GET', originalUrl: '/api/example', requestId: 'redaction-request' } as Request;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  errorHandler(err, req, { status } as unknown as Response, jest.fn());
  expect(status).toHaveBeenCalledWith(err.statusCode);
  return json.mock.calls[0][0];
}

beforeEach(() => { jest.clearAllMocks(); });

it.each(cases)('redacts server/non-operational messages outside development: %s', (err) => {
  for (const nodeEnv of ['production', 'test', 'staging']) {
    (config as { nodeEnv: string }).nodeEnv = nodeEnv;
    expect(respond(err)).toEqual({
      error: err.name,
      message: 'An error occurred',
      code: err.code,
      requestId: 'redaction-request',
    });
    expect(logger.error).toHaveBeenLastCalledWith('Operational/server error', expect.objectContaining({ err }));
  }
});

it('preserves operational client messages and development diagnostics', () => {
  (config as { nodeEnv: string }).nodeEnv = 'production';
  expect(respond(new ValidationError('Name is required')).message).toBe('Name is required');
  (config as { nodeEnv: string }).nodeEnv = 'development';
  for (const err of cases) {
    expect(respond(err)).toMatchObject({ message: err.message, stack: err.stack });
  }
});
