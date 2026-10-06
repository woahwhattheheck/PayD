import { describe, expect, it } from '@jest/globals';
import {
  executeFxRateIngestionJob,
  runLeaderElectedFxRateIngestion,
  type AdvisoryLockDatabase,
  type FxRateJobLogger,
} from '../fxRateIngestionJob.js';

function captureLogger() {
  const debug: string[] = [];
  const info: string[] = [];
  const error: string[] = [];
  const log: FxRateJobLogger = {
    debug(message) {
      debug.push(message);
    },
    info(message) {
      info.push(message);
    },
    error(message) {
      error.push(message);
    },
  };
  return { log, debug, info, error };
}

describe('FX rate ingestion leader election', () => {
  it('skips a busy lock and explicitly unlocks the same session after a failed run', async () => {
    let skippedIngestCount = 0;
    let skippedClientReleased = false;
    const busyDatabase = {
      async connect() {
        return {
          async query() {
            return { rows: [{ acquired: false }] };
          },
          release() {
            skippedClientReleased = true;
          },
        };
      },
    } as unknown as AdvisoryLockDatabase;
    const firstLog = captureLogger();

    await expect(
      runLeaderElectedFxRateIngestion({
        database: busyDatabase,
        log: firstLog.log,
        ingest: async () => {
          skippedIngestCount += 1;
        },
      })
    ).resolves.toBe(false);

    expect(skippedIngestCount).toBe(0);
    expect(skippedClientReleased).toBe(true);
    expect(firstLog.debug).toContain(
      'FX rate ingestion skipped: advisory lock held by another instance'
    );

    const statements: string[] = [];
    let acquiredClientReleased = false;
    const acquiredDatabase = {
      async connect() {
        return {
          async query(text: string) {
            statements.push(text);
            if (text.includes('pg_try_advisory_lock')) {
              return { rows: [{ acquired: true }] };
            }
            if (text.includes('pg_advisory_unlock')) {
              return { rows: [{ released: true }] };
            }
            return { rows: [] };
          },
          release() {
            acquiredClientReleased = true;
          },
        };
      },
    } as unknown as AdvisoryLockDatabase;
    const secondLog = captureLogger();

    await executeFxRateIngestionJob('startup', {
      database: acquiredDatabase,
      log: secondLog.log,
      ingest: async () => {
        throw new Error('provider unavailable');
      },
    });

    expect(statements.some((statement) => statement.includes('pg_advisory_unlock'))).toBe(true);
    expect(acquiredClientReleased).toBe(true);
    expect(secondLog.error).toContain('FX rate ingestion startup run failed');
  });
});
