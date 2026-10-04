import { pool } from '../../config/database.js';
import { RedisClient } from '../rateLimitService.js';
import logger from '../../utils/logger.js';

export interface FxRatePoint {
  rateDate: string;
  rate: number;
}

export class FxRateService {
  private static readonly redis = RedisClient.getInstance();

  static async getDailyRates(
    baseCurrency: string,
    quoteCurrency: string,
    startDate: string,
    endDate: string
  ): Promise<FxRatePoint[]> {
    const normalizedBase = baseCurrency.toUpperCase();
    const normalizedQuote = quoteCurrency.toUpperCase();
    const cacheKey = `cache:fx-rates:${normalizedBase}:${normalizedQuote}:${startDate}:${endDate}`;

    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached !== null) {
          logger.info('Cache hit', { cache: 'fx-rates', baseCurrency: normalizedBase, quoteCurrency: normalizedQuote });
          return JSON.parse(cached) as FxRatePoint[];
        }
        logger.info('Cache miss', { cache: 'fx-rates', baseCurrency: normalizedBase, quoteCurrency: normalizedQuote });
      } catch (error) {
        logger.warn('FX rate cache read failed', { baseCurrency: normalizedBase, quoteCurrency: normalizedQuote, error });
      }
    } else {
      logger.info('Cache miss', {
        cache: 'fx-rates',
        baseCurrency: normalizedBase,
        quoteCurrency: normalizedQuote,
        reason: 'redis_not_configured',
      });
    }

    const result = await pool.query(
      `SELECT rate_date, rate
       FROM fx_rates
       WHERE base_currency = $1
         AND quote_currency = $2
         AND rate_date >= $3
         AND rate_date <= $4
       ORDER BY rate_date ASC`,
      [normalizedBase, normalizedQuote, startDate, endDate]
    );

    const rates = result.rows.map((r: any) => ({
      rateDate: new Date(r.rate_date).toISOString().slice(0, 10),
      rate: Number(r.rate),
    }));

    if (this.redis) {
      try {
        await this.redis.setex(cacheKey, 5 * 60, JSON.stringify(rates));
      } catch (error) {
        logger.warn('FX rate cache write failed', { baseCurrency: normalizedBase, quoteCurrency: normalizedQuote, error });
      }
    }

    return rates;
  }

  static calculateDailyReturnsVolatility(rates: FxRatePoint[]): number | null {
    if (rates.length < 2) return null;

    const returns: number[] = [];
    for (let i = 1; i < rates.length; i++) {
      const prevPoint = rates[i - 1];
      const currPoint = rates[i];
      if (!prevPoint || !currPoint) continue;
      const prev = prevPoint.rate;
      const curr = currPoint.rate;
      if (prev <= 0 || curr <= 0) continue;
      returns.push(Math.log(curr / prev));
    }

    if (returns.length < 2) return null;

    const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
    const variance =
      returns.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (returns.length - 1);

    return Math.sqrt(variance);
  }
}
