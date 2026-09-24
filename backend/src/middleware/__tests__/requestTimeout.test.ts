import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import { requestTimeoutMiddleware } from '../requestTimeout.js';

function mount(path: string) {
  const response = Object.assign(new EventEmitter(), {
    headersSent: false,
    status: jest.fn(),
    json: jest.fn(),
    destroy: jest.fn(),
  });
  response.status.mockReturnValue(response);
  const next = jest.fn();

  requestTimeoutMiddleware(
    { path } as Request,
    response as unknown as Response,
    next as NextFunction
  );

  expect(next).toHaveBeenCalledTimes(1);
  return response;
}

describe('requestTimeoutMiddleware', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns a clear 504 after 30 seconds on a regular route', () => {
    const response = mount('/api/employees');

    jest.advanceTimersByTime(29_999);
    expect(response.status).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(response.status).toHaveBeenCalledWith(504);
    expect(response.json).toHaveBeenCalledWith({
      error: 'Gateway Timeout',
      message: 'Request exceeded the 30s timeout',
    });
  });

  it('allows 120 seconds for a bulk route', () => {
    const response = mount('/api/payroll/bulk');

    jest.advanceTimersByTime(30_000);
    expect(response.status).not.toHaveBeenCalled();
    jest.advanceTimersByTime(90_000);
    expect(response.status).toHaveBeenCalledWith(504);
    expect(response.json).toHaveBeenCalledWith({
      error: 'Gateway Timeout',
      message: 'Request exceeded the 120s timeout',
    });
  });

  it.each(['finish', 'close'])('clears the timer on %s', (event) => {
    const response = mount('/api/employees');
    response.emit(event);

    jest.advanceTimersByTime(30_000);
    expect(response.status).not.toHaveBeenCalled();
    expect(response.destroy).not.toHaveBeenCalled();
  });

  it('closes a response that already started streaming', () => {
    const response = mount('/api/export');
    response.headersSent = true;

    jest.advanceTimersByTime(120_000);
    expect(response.destroy).toHaveBeenCalledTimes(1);
    expect(response.status).not.toHaveBeenCalled();
  });
});
