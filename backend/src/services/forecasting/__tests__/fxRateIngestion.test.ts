import { describe, expect, it } from '@jest/globals';
import {
  fetchUsdRate,
  type FxFetch,
  type FxHttpResponse,
} from '../fxRateFetcher.js';
import {
  runFxRateIngestion,
  type FxRateDatabase,
} from '../fxRateIngestion.js';

function response(body: unknown, ok = true): FxHttpResponse {
  return {
    ok,
    status: ok ? 200 : 503,
    statusText: ok ? 'OK' : 'Service Unavailable',
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

describe('FX rate ingestion', () => {
  it('fetches USDC and idempotently upserts the same currency/date', async () => {
    const storedRows = new Map<string, number>();
    const statements: string[] = [];
    const requestedUrls: string[] = [];
    let releaseCount = 0;

    const client = {
      async query(text: string, values: unknown[] = []) {
        statements.push(text);
        if (text.includes('INSERT INTO fx_rates')) {
          const [baseCurrency, quoteCurrency, rate, rateDate] = values as [
            string,
            string,
            number,
            string,
          ];
          storedRows.set(`${baseCurrency}:${quoteCurrency}:${rateDate}`, rate);
        }
        return { rows: [] };
      },
      release() {
        releaseCount += 1;
      },
    };

    const database = {
      async query() {
        return { rows: [{ base_currency: 'USDC' }] };
      },
      async connect() {
        return client;
      },
    } as unknown as FxRateDatabase;

    const fetchImpl: FxFetch = async (input) => {
      requestedUrls.push(String(input));
      return response({ data: { currency: 'USDC', rates: { USD: '1.0001' } } });
    };
    const fetchRate = (baseCurrency: string) =>
      fetchUsdRate(baseCurrency, { fetchImpl, timeoutMs: 100 });

    await runFxRateIngestion({ database, fetchRate, rateDate: '2026-10-06' });
    await runFxRateIngestion({ database, fetchRate, rateDate: '2026-10-06' });

    expect(requestedUrls.every((url) => url.includes('currency=USDC'))).toBe(true);
    expect(storedRows.size).toBe(1);
    expect(statements.filter((statement) => statement.includes('ON CONFLICT')).length).toBe(2);
    expect(statements.filter((statement) => statement === 'COMMIT').length).toBe(2);
    expect(releaseCount).toBe(2);
  });

  it('rejects a provider response without a positive USD rate', async () => {
    const fetchImpl: FxFetch = async () =>
      response({ data: { currency: 'EUR', rates: { USD: '0' } } });

    await expect(fetchUsdRate('EUR', { fetchImpl, timeoutMs: 100 })).rejects.toThrow(
      'missing a positive USD rate'
    );
  });

  it('does not open a write transaction when the provider fails', async () => {
    let connectCount = 0;
    const database = {
      async query() {
        return { rows: [{ base_currency: 'USDC' }] };
      },
      async connect() {
        connectCount += 1;
        throw new Error('connect should not be called');
      },
    } as unknown as FxRateDatabase;

    await expect(
      runFxRateIngestion({
        database,
        rateDate: '2026-10-06',
        fetchRate: async () => {
          throw new Error('provider unavailable');
        },
      })
    ).rejects.toThrow('provider unavailable');

    expect(connectCount).toBe(0);
  });

  it('rolls back and releases the client when a database write fails', async () => {
    const statements: string[] = [];
    let released = false;
    const database = {
      async query() {
        return { rows: [{ base_currency: 'USDC' }] };
      },
      async connect() {
        return {
          async query(text: string) {
            statements.push(text);
            if (text.includes('INSERT INTO fx_rates')) {
              throw new Error('write failed');
            }
            return { rows: [] };
          },
          release() {
            released = true;
          },
        };
      },
    } as unknown as FxRateDatabase;

    await expect(
      runFxRateIngestion({
        database,
        rateDate: '2026-10-06',
        fetchRate: async () => ({
          baseCurrency: 'USDC',
          quoteCurrency: 'USD',
          rate: 1,
          source: 'coinbase',
        }),
      })
    ).rejects.toThrow('write failed');

    expect(statements).toContain('ROLLBACK');
    expect(released).toBe(true);
  });
});
