import { Request, Response } from 'express';
import { Redis } from 'ioredis';
import { config } from '../config/env.js';
import { pool } from '../config/database.js';
import logger from '../utils/logger.js';
import { StellarService } from '../services/stellarService.js';

export const redis: Redis | null = config.REDIS_URL
  ? new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 1,
      retryStrategy: () => null, // Fail fast for health check
    })
  : null;

export interface DependencyStatus {
  status: 'connected' | 'disconnected' | 'not_configured' | 'unknown';
  error?: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  dependencies: {
    database: DependencyStatus;
    redis: DependencyStatus;
    horizon: DependencyStatus;
  };
}

export interface LivenessReport {
  status: 'ok';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
}

export interface DatabasePoolHealthReport {
  status: 'ok' | 'warning' | 'exhausted';
  timestamp: string;
  pool: {
    active: number;
    idle: number;
    waiting: number;
    total: number;
    max: number;
    utilization: number;
  };
}

export const healthConfig = {
  timeoutMs: 5000,
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);
  });
  return Promise.race([
    promise.finally(() => {
      clearTimeout(timeoutId);
    }),
    timeoutPromise,
  ]);
}

export class HealthController {
  static getDatabaseHealth(req: Request, res: Response): void {
    const total = pool.totalCount;
    const idle = pool.idleCount;
    const waiting = pool.waitingCount;
    const active = Math.max(0, total - idle);
    const max = pool.options.max ?? 10;
    const utilization = max > 0 ? (active / max) * 100 : 0;
    const exhausted = active >= max || (waiting > 0 && total >= max);

    const report: DatabasePoolHealthReport = {
      status: exhausted ? 'exhausted' : utilization > 80 ? 'warning' : 'ok',
      timestamp: new Date().toISOString(),
      pool: {
        active,
        idle,
        waiting,
        total,
        max,
        utilization: Number(utilization.toFixed(1)),
      },
    };

    if (exhausted) {
      logger.error('Database connection pool exhausted', report.pool);
      res.status(503).json(report);
      return;
    }

    if (utilization > 80) {
      logger.warn('Database connection pool utilization above 80%', report.pool);
    }

    res.status(200).json(report);
  }

  static getLiveness(req: Request, res: Response): void {
    const timestamp = new Date().toISOString();
    const uptime = process.uptime();
    const version = process.env.npm_package_version || '1.0.0';

    const report: LivenessReport = {
      status: 'ok',
      timestamp,
      uptime,
      version,
      environment: config.NODE_ENV,
    };

    res.status(200).json(report);
  }

  static async getHealthStatus(req: Request, res: Response): Promise<void> {
    const timestamp = new Date().toISOString();
    const uptime = process.uptime();
    const version = process.env.npm_package_version || '1.0.0';

    const statusReport: HealthReport = {
      status: 'ok',
      timestamp,
      uptime,
      version,
      environment: config.NODE_ENV,
      dependencies: {
        database: { status: 'unknown' },
        redis: { status: 'unknown' },
        horizon: { status: 'unknown' },
      },
    };

    const dbPromise = withTimeout(
      pool.query('SELECT 1'),
      healthConfig.timeoutMs,
      'Database query timeout'
    );

    const redisPromise = redis
      ? withTimeout(redis.ping(), healthConfig.timeoutMs, 'Redis ping timeout')
      : Promise.resolve('not_configured');

    const horizonPromise = withTimeout(
      (async () => {
        const server = StellarService.getServer();
        await server.feeStats();
      })(),
      healthConfig.timeoutMs,
      'Horizon feeStats timeout'
    );

    const [dbResult, redisResult, horizonResult] = await Promise.allSettled([
      dbPromise,
      redisPromise,
      horizonPromise,
    ]);

    let isHealthy = true;

    // 1. Database check response
    if (dbResult.status === 'fulfilled') {
      statusReport.dependencies.database.status = 'connected';
    } else {
      isHealthy = false;
      statusReport.dependencies.database.status = 'disconnected';
      statusReport.dependencies.database.error = dbResult.reason instanceof Error ? dbResult.reason.message : String(dbResult.reason);
    }

    // 2. Redis check response
    if (redis) {
      if (redisResult.status === 'fulfilled') {
        statusReport.dependencies.redis.status = 'connected';
      } else {
        isHealthy = false;
        statusReport.dependencies.redis.status = 'disconnected';
        statusReport.dependencies.redis.error = redisResult.reason instanceof Error ? redisResult.reason.message : String(redisResult.reason);
      }
    } else {
      statusReport.dependencies.redis.status = 'not_configured';
    }

    // 3. Horizon check response
    if (horizonResult.status === 'fulfilled') {
      statusReport.dependencies.horizon.status = 'connected';
    } else {
      isHealthy = false;
      statusReport.dependencies.horizon.status = 'disconnected';
      statusReport.dependencies.horizon.error = horizonResult.reason instanceof Error ? horizonResult.reason.message : String(horizonResult.reason);
    }

    if (!isHealthy) {
      statusReport.status = 'degraded';
      res.status(503).json(statusReport);
      return;
    }

    res.status(200).json(statusReport);
  }
}
