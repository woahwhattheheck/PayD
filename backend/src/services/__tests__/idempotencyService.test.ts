import {
  claimKey,
  completeKey,
  failKey,
  isInFlight,
  cleanupExpired,
  IdempotencyConflictError,
} from '../idempotencyService.js';
import { query } from '../../config/database.js';

jest.mock('../../config/database.js');
jest.mock('../../utils/logger.js');

describe('idempotencyService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('claimKey', () => {
    it('should insert a new key with in_progress status', async () => {
      // INSERT succeeds (rowCount 1) — no follow-up queries needed.
      (query as jest.Mock).mockResolvedValueOnce({ rowCount: 1, rows: [] });

      const result = await claimKey(1, 'key-1');

      expect(result).toBeNull();
      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO idempotency_keys'), [
        1,
        'key-1',
        expect.any(Date),
      ]);
      const claimSql = (query as jest.Mock).mock.calls[0][0] as string;
      expect(claimSql).toContain(
        'ON CONFLICT (organization_id, idempotency_key) DO NOTHING'
      );
      expect(claimSql).not.toContain('WHERE NOT EXISTS');
    });

    it('should return existing completed record for replay', async () => {
      const storedResponse = { success: true };
      // INSERT misses (row exists, not expired). UPDATE misses (not expired). SELECT returns completed.
      (query as jest.Mock)
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              organization_id: 1,
              idempotency_key: 'replay-key',
              status: 'completed',
              response_status: 201,
              response_body: storedResponse,
              created_at: new Date(),
              expires_at: new Date(Date.now() + 3600000),
            },
          ],
        });

      const result = await claimKey(1, 'replay-key');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('completed');
      expect(result!.responseStatus).toBe(201);
      expect(result!.responseBody).toEqual(storedResponse);
    });

    it('should return existing failed record for replay', async () => {
      (query as jest.Mock)
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 2,
              organization_id: 1,
              idempotency_key: 'fail-key',
              status: 'failed',
              response_status: 400,
              response_body: { error: 'Bad Request' },
              created_at: new Date(),
              expires_at: new Date(Date.now() + 3600000),
            },
          ],
        });

      const result = await claimKey(1, 'fail-key');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('failed');
    });

    it('should recycle expired cached keys and clear the previous response', async () => {
      // INSERT loses to the existing unique row. UPDATE atomically recycles it
      // regardless of whether its previous state was completed/failed/in_progress.
      (query as jest.Mock)
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] });

      const result = await claimKey(1, 'expired-key');

      expect(result).toBeNull();
      expect(query).toHaveBeenCalledTimes(2);
      const recycleSql = (query as jest.Mock).mock.calls[1][0] as string;
      expect(recycleSql).toContain("SET status = 'in_progress'");
      expect(recycleSql).toContain('response_status = NULL');
      expect(recycleSql).toContain('response_body = NULL');
      expect(recycleSql).toContain('expires_at <= NOW()');
      expect(recycleSql).not.toContain("AND status = 'in_progress'");
    });

    it('should throw IdempotencyConflictError for concurrent duplicate', async () => {
      // INSERT misses (row exists). UPDATE misses (not expired). SELECT returns in_progress.
      (query as jest.Mock)
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 5,
              organization_id: 1,
              idempotency_key: 'racing-key',
              status: 'in_progress',
              response_status: null,
              response_body: null,
              created_at: new Date(),
              expires_at: new Date(Date.now() + 3600000),
            },
          ],
        });

      await expect(claimKey(1, 'racing-key')).rejects.toThrow(IdempotencyConflictError);
    });

    it('should allow exactly one of 100 simultaneous claims to proceed', async () => {
      let insertWon = false;
      const inProgressRow = {
        id: 10,
        organization_id: 1,
        idempotency_key: 'race-key',
        status: 'in_progress',
        response_status: null,
        response_body: null,
        created_at: new Date(),
        expires_at: new Date(Date.now() + 3600000),
      };

      (query as jest.Mock).mockImplementation(async (sql: string) => {
        if (sql.includes('INSERT INTO idempotency_keys')) {
          if (!insertWon) {
            insertWon = true;
            return { rowCount: 1, rows: [{ id: 10 }] };
          }
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('UPDATE idempotency_keys')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.trim().startsWith('SELECT') && sql.includes('FROM idempotency_keys')) {
          return { rowCount: 1, rows: [inProgressRow] };
        }
        return { rowCount: 0, rows: [] };
      });

      const results = await Promise.allSettled(
        Array.from({ length: 100 }, () => claimKey(1, 'race-key'))
      );

      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const rejected = results.filter((result) => result.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(99);
      expect((fulfilled[0] as PromiseFulfilledResult<IdempotencyRecord | null>).value).toBeNull();
      for (const result of rejected) {
        expect((result as PromiseRejectedResult).reason).toBeInstanceOf(
          IdempotencyConflictError
        );
      }
    });
  });

  describe('isInFlight', () => {
    it('should return true when key is in_progress', async () => {
      (query as jest.Mock).mockResolvedValue({
        rows: [{ status: 'in_progress' }],
      });

      const result = await isInFlight(1, 'flight-key');
      expect(result).toBe(true);
    });

    it('should return false when key is completed', async () => {
      (query as jest.Mock).mockResolvedValue({
        rows: [{ status: 'completed' }],
      });

      const result = await isInFlight(1, 'done-key');
      expect(result).toBe(false);
    });

    it('should return false when key does not exist', async () => {
      (query as jest.Mock).mockResolvedValue({ rows: [] });

      const result = await isInFlight(1, 'missing-key');
      expect(result).toBe(false);
    });
  });

  describe('completeKey', () => {
    it('should update status to completed with response', async () => {
      (query as jest.Mock).mockResolvedValue({ rowCount: 1 });

      await completeKey(1, 'done-key', 201, { id: 42 });

      expect(query).toHaveBeenCalledWith(expect.stringContaining("SET status = 'completed'"), [
        1,
        'done-key',
        201,
        '{"id":42}',
      ]);
    });
  });

  describe('failKey', () => {
    it('should update status to failed with response', async () => {
      (query as jest.Mock).mockResolvedValue({ rowCount: 1 });

      await failKey(1, 'err-key', 400, { error: 'Bad Request' });

      expect(query).toHaveBeenCalledWith(expect.stringContaining("SET status = 'failed'"), [
        1,
        'err-key',
        400,
        '{"error":"Bad Request"}',
      ]);
    });
  });

  describe('cleanupExpired', () => {
    it('should delete expired keys', async () => {
      (query as jest.Mock).mockResolvedValue({ rowCount: 5 });

      const deleted = await cleanupExpired();

      expect(deleted).toBe(5);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM idempotency_keys WHERE expires_at')
      );
    });

    it('should return 0 when nothing to clean', async () => {
      (query as jest.Mock).mockResolvedValue({ rowCount: 0 });

      const deleted = await cleanupExpired();
      expect(deleted).toBe(0);
    });
  });
});
