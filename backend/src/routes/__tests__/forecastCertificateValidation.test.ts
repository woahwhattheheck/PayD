import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import cashFlowRoutes from '../cashFlowForecastRoutes.js';
import certificateRoutes from '../certificateRoutes.js';
import { CashFlowForecastController } from '../../controllers/cashFlowForecastController.js';
import { PDFCertificateController } from '../../controllers/pdfCertificateController.js';

// Isolate route validation from authentication, databases and external services.
jest.mock('../../middlewares/auth.js', () => ({
  authenticateJWT: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
jest.mock('../../middleware/tenantContext.js', () => ({
  syncTenantFromUser: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
jest.mock('../../middleware/enhancedTenantIsolation.js', () => ({
  strictTenantBoundary: (_req: Request, _res: Response, next: NextFunction) => next(),
  logTenantAccess: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
jest.mock('../../controllers/cashFlowForecastController.js', () => {
  const reply = (req: Request, res: Response) => res.json({ query: req.query });
  return { CashFlowForecastController: {
    getForecast: jest.fn(reply), getHistorical: jest.fn(reply),
    getProjections: jest.fn(reply), getAlerts: jest.fn(reply),
  } };
});
jest.mock('../../controllers/pdfCertificateController.js', () => {
  const reply = (req: Request, res: Response) => res.json({ query: req.query });
  return { PDFCertificateController: {
    generateCertificate: jest.fn(reply), verifyCertificate: jest.fn(reply), getTransactionInfo: jest.fn(reply),
  } };
});

const app = express();
app.use('/cash-flow', cashFlowRoutes);
app.use('/certificates', certificateRoutes);
const accounts = { distributionAccount: 'G'.repeat(56), assetIssuer: 'A'.repeat(56) };
const transactionHash = 'aB01'.repeat(16);

beforeEach(() => jest.clearAllMocks());

async function accepts(path: string, query: Record<string, string>) {
  const res = await request(app).get(path).query(query);
  expect(res.status).toBe(200);
  expect(res.body.query).toEqual(query);
}
async function rejects(path: string, query: Record<string, string>, field: string) {
  const res = await request(app).get(path).query(query);
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('Validation failed');
  expect(res.body.fields).toEqual(expect.arrayContaining([
    expect.objectContaining({ location: 'query', field: `query.${field}` }),
  ]));
}

describe('Forecast and certificate request validation', () => {
  it('preserves omitted defaults and valid bounded windows without rewriting inputs', async () => {
    await accepts('/cash-flow/historical', {});
    await accepts('/cash-flow/projections', {});
    await accepts('/cash-flow/historical', { monthsBack: '24' });
    await accepts('/cash-flow/projections', { forecastDays: '365' });
    await accepts('/cash-flow/forecast', accounts);
    await accepts('/cash-flow/alerts', { ...accounts, forecastDays: '365' });
  });

  it('rejects malformed and out-of-range windows before forecast controller dispatch', async () => {
    await rejects('/cash-flow/historical', { monthsBack: 'no-number' }, 'monthsBack');
    await rejects('/cash-flow/projections', { forecastDays: '1e3' }, 'forecastDays');
    await rejects('/cash-flow/forecast', { ...accounts, forecastDays: '366' }, 'forecastDays');
    await rejects('/cash-flow/alerts', { ...accounts, forecastDays: '366' }, 'forecastDays');
    for (const handler of Object.values(CashFlowForecastController)) expect(handler).not.toHaveBeenCalled();
  });

  it('requires account filters on forecast and alert routes', async () => {
    await rejects('/cash-flow/forecast', {}, 'distributionAccount');
    await rejects('/cash-flow/alerts', { distributionAccount: accounts.distributionAccount }, 'assetIssuer');
    expect(CashFlowForecastController.getForecast).not.toHaveBeenCalled();
    expect(CashFlowForecastController.getAlerts).not.toHaveBeenCalled();
  });

  it('preserves generation auto-detection and complete verification inputs', async () => {
    await accepts('/certificates/generate', { transactionHash });
    await accepts('/certificates/generate', { transactionHash, employeeId: '1' });
    await accepts('/certificates/verify', { transactionHash, employeeId: '1', organizationId: '10' });
    await accepts('/certificates/transaction-info', { transactionHash });
  });

  it('rejects malformed hashes before any certificate controller dispatch', async () => {
    for (const route of ['generate', 'verify', 'transaction-info']) {
      await rejects(`/certificates/${route}`, {
        transactionHash: 'g'.repeat(64), employeeId: '1', organizationId: '10',
      }, 'transactionHash');
    }
    for (const handler of Object.values(PDFCertificateController)) expect(handler).not.toHaveBeenCalled();
  });

  it('rejects supplied invalid IDs and the missing IDs required for verification', async () => {
    await rejects('/certificates/generate', { transactionHash, employeeId: 'not-an-id' }, 'employeeId');
    await rejects('/certificates/generate', { transactionHash, organizationId: '0' }, 'organizationId');
    await rejects('/certificates/verify', { transactionHash, employeeId: '1' }, 'organizationId');
    await rejects('/certificates/verify', { transactionHash, employeeId: '1.5', organizationId: '10' }, 'employeeId');
    expect(PDFCertificateController.generateCertificate).not.toHaveBeenCalled();
    expect(PDFCertificateController.verifyCertificate).not.toHaveBeenCalled();
  });
});
