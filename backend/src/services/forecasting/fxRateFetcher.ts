const COINBASE_EXCHANGE_RATES_URL = 'https://api.coinbase.com/v2/exchange-rates';
const DEFAULT_TIMEOUT_MS = 10_000;

export interface FxRateQuote {
  baseCurrency: string;
  quoteCurrency: 'USD';
  rate: number;
  source: 'coinbase';
}

interface CoinbaseExchangeRatesResponse {
  data?: {
    currency?: string;
    rates?: Record<string, string | number>;
  };
}

export interface FxHttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FxFetch = (
  input: string | URL,
  init?: { signal?: AbortSignal; headers?: Record<string, string> }
) => Promise<FxHttpResponse>;

export interface FetchUsdRateOptions {
  fetchImpl?: FxFetch;
  timeoutMs?: number;
}

/**
 * Fetch one base-currency to USD quote from Coinbase's public exchange-rate API.
 * The endpoint is unauthenticated and supports the repository's default USDC
 * base currency as well as standard fiat currencies.
 */
export async function fetchUsdRate(
  baseCurrency: string,
  options: FetchUsdRateOptions = {}
): Promise<FxRateQuote> {
  const normalizedBase = baseCurrency.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(normalizedBase)) {
    throw new Error(`Invalid FX base currency: ${baseCurrency}`);
  }

  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FxFetch);
  if (typeof fetchImpl !== 'function') {
    throw new Error('Global fetch is unavailable for FX rate ingestion');
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Invalid FX fetch timeout: ${timeoutMs}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = new URL(COINBASE_EXCHANGE_RATES_URL);
  url.searchParams.set('currency', normalizedBase);

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      let detail = '';
      try {
        detail = (await response.text()).trim().slice(0, 200);
      } catch {
        // Preserve the HTTP status even if the error body cannot be read.
      }
      const suffix = detail ? `: ${detail}` : '';
      throw new Error(
        `Coinbase FX request failed for ${normalizedBase}: ${response.status} ${response.statusText}${suffix}`
      );
    }

    const body = (await response.json()) as CoinbaseExchangeRatesResponse;
    const returnedBase = String(body.data?.currency ?? '').toUpperCase();
    if (returnedBase !== normalizedBase) {
      throw new Error(
        `Coinbase FX response currency mismatch: expected ${normalizedBase}, received ${returnedBase || 'missing'}`
      );
    }

    const rawRate = body.data?.rates?.USD;
    // Treat provider JSON as untrusted: Number(true), Number(['1']) and
    // Number('0x1') all produce 1 but are not decimal FX-rate quotes.
    // Standard decimal strings (including scientific notation) are valid.
    const decimalRate =
      typeof rawRate === 'string' &&
      /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(rawRate.trim());
    const rate =
      typeof rawRate === 'number' || decimalRate ? Number(rawRate) : NaN;
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error(`Coinbase FX response missing a positive USD rate for ${normalizedBase}`);
    }

    return {
      baseCurrency: normalizedBase,
      quoteCurrency: 'USD',
      rate,
      source: 'coinbase',
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Coinbase FX request timed out for ${normalizedBase} after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
