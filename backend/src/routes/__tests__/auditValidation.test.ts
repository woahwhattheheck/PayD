import request from 'supertest';
import express, { Request, Response } from 'express';
import auditRoutes from '../auditRoutes.js';
import { TransactionAuditController } from '../../controllers/transactionAuditController.js';

jest.mock('../../controllers/transactionAuditController.js', () => {
  const reply = (req: Request, res: Response) => res.json({ query: req.query, hash: req.params.txHash });
  return { TransactionAuditController: {
    listAuditRecords: jest.fn(reply), getAuditRecord: jest.fn(reply),
    verifyAuditRecord: jest.fn(reply), createAuditRecord: jest.fn(reply),
  } };
});

const app = express();
app.use(express.json());
app.use('/audit', auditRoutes);

beforeEach(() => jest.clearAllMocks());

describe('Audit request validation', () => {
  it('leaves omitted list parameters for the existing controller defaults', async () => {
    const res = await request(app).get('/audit');
    expect(res.status).toBe(200);
    expect(res.body.query).toEqual({});
  });

  it('preserves valid pagination and filters without changing their input types', async () => {
    const query = { page: '2', limit: '100', status: 'Completed', type: 'contract_event', asset: 'USDC' };
    const res = await request(app).get('/audit').query(query);
    expect(res.status).toBe(200);
    expect(res.body.query).toEqual(query);
  });

  it('returns shared field-level errors before dispatching invalid list queries', async () => {
    const res = await request(app).get('/audit').query({ limit: '101', status: 'Unknown' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ location: 'query', field: 'query.limit' }),
      expect.objectContaining({ location: 'query', field: 'query.status' }),
    ]));
    expect(TransactionAuditController.listAuditRecords).not.toHaveBeenCalled();
  });

  it('rejects a non-hexadecimal hash before all record, verify and create handlers', async () => {
    const path = '/audit/' + 'g'.repeat(64);
    const calls = [() => request(app).get(path), () => request(app).get(path + '/verify'), () => request(app).post(path)];
    for (const call of calls) {
      const res = await call();
      expect(res.status).toBe(400);
      expect(res.body.fields).toEqual(expect.arrayContaining([
        expect.objectContaining({ location: 'params', field: 'params.txHash' }),
      ]));
    }
    expect(TransactionAuditController.getAuditRecord).not.toHaveBeenCalled();
    expect(TransactionAuditController.verifyAuditRecord).not.toHaveBeenCalled();
    expect(TransactionAuditController.createAuditRecord).not.toHaveBeenCalled();
  });

  it('passes a valid hash unchanged to each corresponding controller', async () => {
    const hash = 'aB01'.repeat(16);
    const path = '/audit/' + hash;
    const calls = [() => request(app).get(path), () => request(app).get(path + '/verify'), () => request(app).post(path)];
    for (const call of calls) {
      const res = await call();
      expect(res.status).toBe(200);
      expect(res.body.hash).toBe(hash);
    }
    expect(TransactionAuditController.getAuditRecord).toHaveBeenCalledTimes(1);
    expect(TransactionAuditController.verifyAuditRecord).toHaveBeenCalledTimes(1);
    expect(TransactionAuditController.createAuditRecord).toHaveBeenCalledTimes(1);
  });
});
