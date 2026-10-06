import dotenv from 'dotenv';
import { createServer } from 'node:http';
import app from './app.js';
import logger from './utils/logger.js';
import config from './config/index.js';
import pool from './config/database.js';
import { closeHealthDependencies } from './controllers/healthController.js';
import { closeRateLimitRedis } from './services/rateLimitService.js';
import { createGracefulShutdown } from './services/gracefulShutdown.js';
import { initializeSocket } from './services/socketService.js';
import { scheduleExecutor } from './services/scheduleExecutor.js';
import { contractEventIndexer } from './services/contractEventIndexer.js';
import { liquidityAlertChecker } from './services/forecasting/liquidityAlertChecker.js';
import { scheduleDailyUsageSnapshots, scheduleNightlyIntegrityCheck } from './jobs/part49Jobs.js';
import { auditAnalyticsService } from './services/auditAnalyticsService.js';
import { cleanupExpired as cleanupExpiredIdempotencyKeys } from './services/idempotencyService.js';

dotenv.config();

const server = createServer(app);

// Part-49 job handles — assigned on server start, cleaned up on shutdown
let usageSnapshotJob: { stop(): Promise<void> } | undefined;
let integrityCheckJob: { stop(): Promise<void> } | undefined;
let auditCacheCleanup: ReturnType<typeof setInterval> | undefined;
let idempotencyCleanup: ReturnType<typeof setInterval> | undefined;
const activeCleanupRuns = new Set<Promise<void>>();
let isShuttingDown = false;

function trackCleanupRun(run: Promise<void>): void {
  activeCleanupRuns.add(run);
  void run.then(
    () => {
      activeCleanupRuns.delete(run);
    },
    () => {
      activeCleanupRuns.delete(run);
    }
  );
}

// Initialize Socket.IO
initializeSocket(server);

const PORT = config.port || process.env.PORT || 4000;

server.listen(PORT, () => {
  if (isShuttingDown) {
    server.close();
    return;
  }

  logger.info(`Server running on port ${PORT}`);
  logger.info(`Environment: ${config.nodeEnv}`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
  logger.info(`Contract registry: http://localhost:${PORT}/api/contracts`);

  // Initialize ScheduleExecutor after server starts
  scheduleExecutor.initialize();
  logger.info('ScheduleExecutor initialized');

  liquidityAlertChecker.initialize();
  logger.info('LiquidityAlertChecker initialized');

  // Initialize ContractEventIndexer
  contractEventIndexer.initialize();
  logger.info('ContractEventIndexer initialized');

  // Part 49 — daily quota snapshots + nightly audit-chain integrity
  // (leader-elected via Postgres advisory lock; cron at midnight UTC)
  usageSnapshotJob = scheduleDailyUsageSnapshots();
  integrityCheckJob = scheduleNightlyIntegrityCheck();
  logger.info('Part-49 jobs scheduled (usage snapshots + audit integrity)');

  // Part 45 — cleanup expired audit cache every hour
  auditCacheCleanup = setInterval(
    () => {
      const run = (async () => {
        try {
          const deleted = await auditAnalyticsService.cleanupExpiredCache();
          if (deleted > 0) {
            logger.info(`Cleaned up ${deleted} expired audit cache entries`);
          }
        } catch (error) {
          logger.error('Failed to cleanup audit cache', { error });
        }
      })();
      trackCleanupRun(run);
    },
    60 * 60 * 1000
  ); // Every hour
  logger.info('Part-45 audit cache cleanup scheduled');

  // Idempotency key cleanup — every hour, remove expired keys
  idempotencyCleanup = setInterval(
    () => {
      const run = (async () => {
        try {
          await cleanupExpiredIdempotencyKeys();
        } catch (error) {
          logger.error('Failed to cleanup expired idempotency keys', { error });
        }
      })();
      trackCleanupRun(run);
    },
    60 * 60 * 1000
  );
  logger.info('Idempotency key cleanup scheduled');
});

// Stop accepting HTTP before stopping future background work. The shared
// shutdown service drains HTTP for up to 30 seconds before closing dependencies.
const gracefulShutdown = createGracefulShutdown({
  server,
  logger,
  stopBackgroundWork: async () => {
    if (auditCacheCleanup) clearInterval(auditCacheCleanup);
    if (idempotencyCleanup) clearInterval(idempotencyCleanup);

    const stops = [
      () => scheduleExecutor.stop(),
      () => liquidityAlertChecker.stop(),
      () => usageSnapshotJob?.stop(),
      () => integrityCheckJob?.stop(),
      () => contractEventIndexer.stop(),
    ];
    const results = await Promise.allSettled([
      ...stops.map((stop) => Promise.resolve().then(stop)),
      ...activeCleanupRuns,
    ]);
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason);
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Failed to stop one or more background jobs');
    }
  },
  closeDependencies: async () => {
    const results = await Promise.allSettled([
      Promise.resolve().then(() => pool.end()),
      Promise.resolve().then(closeHealthDependencies),
      Promise.resolve().then(closeRateLimitRedis),
    ]);
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason);
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Failed to close one or more backend dependencies');
    }
  },
});

const shutdown = (signal: NodeJS.Signals): void => {
  isShuttingDown = true;
  void gracefulShutdown(signal).catch((error) => {
    logger.error('Graceful shutdown failed', { error });
    process.exit(1);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
