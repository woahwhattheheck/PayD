import { Request, Response } from 'express';
import { PaymentController, resolveClientSecret } from '../controllers/paymentController.js';
import { auditLoggerMiddleware } from '../middleware/auditLogger.js';

jest.mock('../../db/index.js', () => ({ __esModule: true, default: { query: jest.fn().mockResolvedValue({ rows: [] }) } }));
jest.mock('../../utils/logger.js', () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../services/anchorService.js', () => ({
  AnchorService: { authenticate: jest.fn(), getTransaction: jest.fn(), getSEP24Transaction: jest.fn() },
}));

import pool from '../../db/index.js';
import logger from '../../utils/logger.js';

const SEED = 'S' + 'A'.repeat(55);

function res(): any {
  const r: any = {
    statusCode: 200,
    on: jest.fn((e: string, cb: () => void) => { if (e === 'finish') (r as any)._finish = cb; return r; }),
    status: jest.fn(() => r),
    json: jest.fn(() => r),
    send: jest.fn(() => r),
  };
  return r;
}

describe('resolveClientSecret', () => {
  it('reads the secret from the Authorization Bearer header', () => {
    const req = { get: (h: string) => (h === 'authorization' ? `Bearer ${SEED}` : undefined) } as unknown as Request;
    expect(resolveClientSecret(req)).toBe(SEED);
  });
  it('falls back to X-Stellar-Secret-Key', () => {
    const req = { get: (h: string) => (h === 'x-stellar-secret-key' ? SEED : undefined) } as unknown as Request;
    expect(resolveClientSecret(req)).toBe(SEED);
  });
  it('never reads the secret from the query string', () => {
    const req = { get: () => undefined, query: { secretKey: SEED } } as unknown as Request;
    expect(resolveClientSecret(req)).toBeUndefined();
  });
});

describe('status endpoints reject query-string secrets', () => {
  it('GET sep31 status returns 400 when secretKey is in the URL', async () => {
    const req = { params: { domain: 'anchor.test', id: 'tx1' }, query: { secretKey: SEED }, get: () => undefined } as unknown as Request;
    const r = res();
    await PaymentController.getStatus(req, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(r.json.mock.calls[0][0].error).toMatch(/query string/);
  });
  it('GET sep24 status returns 400 when secretKey is in the URL', async () => {
    const req = { params: { domain: 'anchor.test', id: 'tx1' }, query: { secretKey: SEED }, get: () => undefined } as unknown as Request;
    const r = res();
    await PaymentController.getSEP24Status(req, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(r.json.mock.calls[0][0].error).toMatch(/query string/);
  });
});

describe('audit middleware redacts key-like fields in query/params', () => {
  it('redacts secretKey from query metadata', async () => {
    const mw = auditLoggerMiddleware();
    const req: any = {
      method: 'GET',
      path: '/api/payments/sep31/status/x/1',
      query: { secretKey: SEED, other: 'ok' },
      params: {},
      headers: {},
      body: {},
      socket: { remoteAddress: '127.0.0.1' },
    };
    const r = res();
    await mw(req, r as Response, jest.fn());
    await r._finish();
    const logged = (logger.info as jest.Mock).mock.calls.map((c) => c[1]).find((m) => m && m.metadata);
    expect(logged.metadata.query.secretKey).toBe('[REDACTED]');
    expect(logged.metadata.query.other).toBe('ok');
  });
});
