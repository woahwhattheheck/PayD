import pool from '../../config/database.js';
import logger from '../../utils/logger.js';
import { fetchUsdRate, type FxRateQuote } from './fxRateFetcher.js';

export interface FxQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  rows: Row[];
  rowCount?: number | null;
}

export interface FxRateClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<FxQueryResult<Row>>;
  release(): void;
}

export interface FxRateDatabase {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<FxQueryResult<Row>>;
  connect(): Promise<FxRateClient>;
}

export interface FxRateIngestionResult {
  rateDate: string;
  currencies: string[];
  rowsUpserted: number;
}

export interface RunFxRateIngestionOptions {
  database?: FxRateDatabase;
  fetchRate?: (baseCurrency: string) => Promise<FxRateQuote>;
  rateDate?: string;
}

interface ConfiguredCurrencyRow extends Record<string, unknown> {
  base_currency: string;
}

function currentUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function validateRateDate(rateDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rateDate)) {
    throw new Error(`Invalid FX rate date: ${rateDate}`);
  }

  const parsed = new Date(`${rateDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== rateDate) {
    throw new Error(`Invalid FX rate date: ${rateDate}`);
  }

  return rateDate;
}

export async function loadConfiguredFxBaseCurrencies(
  database: FxRateDatabase = pool as unknown as FxRateDatabase
): Promise<string[]> {
  const result = await database.query<ConfiguredCurrencyRow>(
    `SELECT DISTINCT UPPER(TRIM(config_value ->> 'default_currency')) AS base_currency
     FROM tenant_configurations
     WHERE config_key = 'payment_settings'
       AND NULLIF(TRIM(config_value ->> 'default_currency'), '') IS NOT NULL
       AND UPPER(TRIM(config_value ->> 'default_currency')) <> 'USD'
     ORDER BY base_currency ASC`
  );

  return result.rows.map((row) => {
    const currency = String(row.base_currency ?? '').toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(currency)) {
      throw new Error(`Invalid configured FX base currency: ${currency || 'missing'}`);
    }
    return currency;
  });
}

/**
 * Fetch all configured tenant base currencies before opening a transaction,
 * then atomically upsert the daily base -> USD rows consumed by
 * ForecastingService. Provider failure therefore cannot leave a partial day.
 */
export async function runFxRateIngestion(
  options: RunFxRateIngestionOptions = {}
): Promise<FxRateIngestionResult> {
  const database = options.database ?? (pool as unknown as FxRateDatabase);
  const fetchRate = options.fetchRate ?? fetchUsdRate;
  const rateDate = validateRateDate(options.rateDate ?? currentUtcDate());
  const currencies = await loadConfiguredFxBaseCurrencies(database);

  if (currencies.length === 0) {
    logger.info('FX rate ingestion skipped: no non-USD tenant base currencies configured', {
      rateDate,
    });
    return { rateDate, currencies: [], rowsUpserted: 0 };
  }

  const quotes: FxRateQuote[] = [];
  for (const currency of currencies) {
    const quote = await fetchRate(currency);
    if (quote.baseCurrency !== currency || quote.quoteCurrency !== 'USD') {
      throw new Error(
        `FX provider returned unexpected pair ${quote.baseCurrency}/${quote.quoteCurrency}; expected ${currency}/USD`
      );
    }
    if (!Number.isFinite(quote.rate) || quote.rate <= 0) {
      throw new Error(`FX provider returned a non-positive rate for ${currency}/USD`);
    }
    quotes.push(quote);
  }

  const client = await database.connect();
  try {
    await client.query('BEGIN');

    for (const quote of quotes) {
      await client.query(
        `INSERT INTO fx_rates
           (base_currency, quote_currency, rate, rate_date, source)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (base_currency, quote_currency, rate_date)
         DO UPDATE SET
           rate = EXCLUDED.rate,
           source = EXCLUDED.source,
           updated_at = CURRENT_TIMESTAMP`,
        [quote.baseCurrency, quote.quoteCurrency, quote.rate, rateDate, quote.source]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error('FX rate ingestion rollback failed', rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }

  logger.info('FX rate ingestion completed', {
    rateDate,
    currencies,
    rowsUpserted: quotes.length,
  });

  return { rateDate, currencies, rowsUpserted: quotes.length };
}
