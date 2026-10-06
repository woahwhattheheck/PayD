import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import pool from '../config/database.js';
import logger from '../utils/logger.js';
import { runFxRateIngestion } from '../services/forecasting/fxRateIngestion.js';

export const FX_RATE_INGESTION_CRON = '15 0 * * *';
export const FX_RATE_INGESTION_LOCK_ID = 84_901_458;

export interface FxRateJobLogger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export interface AdvisoryLockClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: Row[] }>;
  release(destroy?: boolean): void;
}

export interface AdvisoryLockDatabase {
  connect(): Promise<AdvisoryLockClient>;
}

export interface RunLeaderElectedFxIngestionOptions {
  database?: AdvisoryLockDatabase;
  ingest?: () => Promise<unknown>;
  log?: FxRateJobLogger;
}

interface AdvisoryLockRow extends Record<string, unknown> {
  acquired: boolean;
}

interface AdvisoryUnlockRow extends Record<string, unknown> {
  released: boolean;
}

/** Execute one ingestion while holding a session-scoped Postgres lock. */
export async function runLeaderElectedFxRateIngestion(
  options: RunLeaderElectedFxIngestionOptions = {}
): Promise<boolean> {
  const database = options.database ?? (pool as unknown as AdvisoryLockDatabase);
  const ingest = options.ingest ?? (() => runFxRateIngestion());
  const log = options.log ?? logger;
  const client = await database.connect();
  let acquired = false;
  // A session with uncertain lock state must never return to the idle pool.
  let destroyClient = true;

  try {
    const lockResult = await client.query<AdvisoryLockRow>(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [FX_RATE_INGESTION_LOCK_ID]
    );
    acquired = Boolean(lockResult.rows[0]?.acquired);
    destroyClient = acquired;

    if (!acquired) {
      log.debug('FX rate ingestion skipped: advisory lock held by another instance');
      return false;
    }

    await ingest();
    return true;
  } finally {
    if (acquired) {
      try {
        const unlockResult = await client.query<AdvisoryUnlockRow>(
          'SELECT pg_advisory_unlock($1) AS released',
          [FX_RATE_INGESTION_LOCK_ID]
        );
        if (unlockResult.rows[0]?.released === true) {
          destroyClient = false;
        } else {
          log.error('FX rate ingestion advisory lock was not released');
        }
      } catch (unlockError) {
        log.error('FX rate ingestion advisory unlock failed', unlockError);
      }
    }
    client.release(destroyClient);
  }
}

export type FxRateJobTrigger = 'startup' | 'scheduled';

export async function executeFxRateIngestionJob(
  trigger: FxRateJobTrigger,
  options: RunLeaderElectedFxIngestionOptions = {}
): Promise<void> {
  const log = options.log ?? logger;

  try {
    const executed = await runLeaderElectedFxRateIngestion(options);
    if (executed) {
      log.info(`FX rate ingestion ${trigger} run completed`);
    }
  } catch (error) {
    log.error(`FX rate ingestion ${trigger} run failed`, error);
  }
}

export interface FxRateIngestionScheduledJob {
  stop(): void;
}

export interface ScheduleFxRateIngestionOptions {
  run?: (trigger: FxRateJobTrigger) => Promise<void>;
  log?: FxRateJobLogger;
}

/** Start one catch-up run, then schedule a single daily UTC ingestion. */
export function scheduleFxRateIngestionJob(
  options: ScheduleFxRateIngestionOptions = {}
): FxRateIngestionScheduledJob {
  const log = options.log ?? logger;
  const run = options.run ?? ((trigger) => executeFxRateIngestionJob(trigger, { log }));

  void run('startup');

  const task: ScheduledTask = cron.schedule(
    FX_RATE_INGESTION_CRON,
    () => {
      void run('scheduled');
    },
    { timezone: 'UTC' }
  );

  log.info('FX rate ingestion scheduled (00:15 UTC, leader-elected)');

  return {
    stop() {
      task.stop();
      log.info('FX rate ingestion schedule stopped');
    },
  };
}
