import {
  claimKey,
  completeKey,
  failKey,
  waitForReplay,
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
    it('should insert a new key and return its lease', async () => {
      (query as jest.Mock).mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1 }] });

      const result = await claimKey(1, 'key-1');

      expect(result).toEqual({ kind: 'claimed', expiresAt: expect.any(Date) });
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

    it('should return an existing completed record for replay', async () => {
      const storedResponse = { success: true };
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

      expect(result.kind).toBe('replay');
      if (result.kind === 'replay') {
        expect(result.record.status).toBe('completed');
        expect(result.record.responseStatus).toBe(201);
        expect(result.record.responseBody).toEqual(storedResponse);
      }
    });

    it('should recycle a failed server-error record so a retry can execute', async () => {
      (query as jest.Mock)
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 2 }] });

      const result = await claimKey(1, 'fail-key');

      expect(result).toEqual({ kind: 'claimed', expiresAt: expect.any(Date) });
      expect(query).toHaveBeenCalledTimes(2);
      const recycleSql = (query as jest.Mock).mock.calls[1][0] as string;
      expect(recycleSql).toContain("status = 'failed'");
      expect(recycleSql).toContain('expires_at <= NOW()');
      expect(recycleSql).toContain('response_status = NULL');
      expect(recycleSql).toContain('response_body = NULL');
    });

    it('should recycle expired cached keys and return a new lease', async () => {
      (query as jest.Mock)
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 3 }] });

      const result = await claimKey(1, 'expired-key');

      expect(result).toEqual({ kind: 'claimed', expiresAt: expect.any(Date) });
      expect(query).toHaveBeenCalledTimes(2);
      const recycleSql = (query as jest.Mock).mock.calls[1][0] as string;
      expect(recycleSql).toContain("SET status = 'in_progress'");
      expect(recycleSql).toContain('response_status = NULL');
      expect(recycleSql).toContain('response_body = NULL');
      expect(recycleSql).toContain('expires_at <= NOW()');
      expect(recycleSql).not.toContain("AND status = 'in_progress'");
    });

    it('should throw IdempotencyConflictError for concurrent duplicate', async () => {
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
      expect((fulfilled[0] as PromiseFulfilledResult<unknown>).value).toEqual({
        kind: 'claimed',
        expiresAt: expect.any(Date),
      });
      for (const result of rejected) {
        expect((result as PromiseRejectedResult).reason).toBeInstanceOf(
          IdempotencyConflictError
        );
      }
    });
  });

  describe('waitForReplay', () => {
    const inProgressRow = {
      id: 11,
      organization_id: 1,
      idempotency_key: 'race-key',
      status: 'in_progress',
      response_status: null,
      response_body: null,
      created_at: new Date(),
      expires_at: new Date(Date.now() + 60_000),
    };

    it('should return the first terminal cached response from an in-progress duplicate', async () => {
      const completedRow = {
        ...inProgressRow,
        status: 'completed',
        response_status: 201,
        response_body: { id: 42 },
      };
      (query as jest.Mock)
        .mockResolvedValueOnce({ rows: [inProgressRow] })
        .mockResolvedValueOnce({ rows: [completedRow] });

      await expect(waitForReplay(1, 'race-key', 50, 0, 0)).resolves.toMatchObject({
        status: 'completed',
        responseStatus: 201,
        responseBody: { id: 42 },
      });
      expect(query).toHaveBeenCalledTimes(2);
    });

    it('should return null when the in-progress request finishes failed', async () => {
      const failedRow = {
        ...inProgressRow,
        status: 'failed',
        response_status: 503,
        response_body: { error: 'Service Unavailable' },
      };
      (query as jest.Mock)
        .mockResolvedValueOnce({ rows: [inProgressRow] })
        .mockResolvedValueOnce({ rows: [failedRow] });

      await expect(waitForReplay(1, 'race-key', 50, 0, 0)).resolves.toBeNull();
      expect(query).toHaveBeenCalledTimes(2);
    });

    it('should return null when the duplicate stays in progress past the bounded wait', async () => {
      (query as jest.Mock).mockResolvedValue({ rows: [inProgressRow] });

      await expect(waitForReplay(1, 'race-key', 0, 0, 0)).resolves.toBeNull();
      expect(query).toHaveBeenCalledTimes(1);
    });
  });

  describe('isInFlight', () => {
    it('should return true when key is in_progress', async () => {
      (query as jest.Mock).mockResolvedValue({ rows: [{ status: 'in_progress' }] });
      await expect(isInFlight(1, 'flight-key')).resolves.toBe(true);
    });

    it('should return false when key is completed', async () => {
      (query as jest.Mock).mockResolvedValue({ rows: [{ status: 'completed' }] });
      await expect(isInFlight(1, 'done-key')).resolves.toBe(false);
    });

    it('should return false when key does not exist', async () => {
      (query as jest.Mock).mockResolvedValue({ rows: [] });
      await expect(isInFlight(1, 'missing-key')).resolves.toBe(false);
    });
  });

  describe('lease-owned completion', () => {
    const leaseExpiresAt = new Date('2026-10-06T12:00:00.000Z');

    it('should complete only the matching in-progress lease', async () => {
      (query as jest.Mock).mockResolvedValue({ rowCount: 1 });

      await expect(
        completeKey(1, 'done-key', leaseExpiresAt, 201, { id: 42 })
      ).resolves.toBe(true);

      expect(query).toHaveBeenCalledWith(expect.stringContaining("SET status = 'completed'"), [
        1,
        'done-key',
        leaseExpiresAt,
        201,
        '{"id":42}',
      ]);
      const completionSql = (query as jest.Mock).mock.calls[0][0] as string;
      expect(completionSql).toContain("status = 'in_progress'");
      expect(completionSql).toContain('expires_at = $3');
      expect(completionSql).toContain('expires_at > NOW()');
    });

    it('should report a stale completion without overwriting the recycled lease', async () => {
      (query as jest.Mock).mockResolvedValue({ rowCount: 0 });
      const staleLease = new Date('2026-10-05T12:00:00.000Z');

      await expect(
        completeKey(1, 'recycled-key', staleLease, 201, { id: 'stale' })
      ).resolves.toBe(false);

      expect((query as jest.Mock).mock.calls[0][1][2]).toBe(staleLease);
    });

    it('should fail only the matching in-progress lease', async () => {
      (query as jest.Mock).mockResolvedValue({ rowCount: 1 });

      await expect(
        failKey(1, 'err-key', leaseExpiresAt, 500, { error: 'Server Error' })
      ).resolves.toBe(true);

      expect(query).toHaveBeenCalledWith(expect.stringContaining("SET status = 'failed'"), [
        1,
        'err-key',
        leaseExpiresAt,
        500,
        '{"error":"Server Error"}',
      ]);
      const failureSql = (query as jest.Mock).mock.calls[0][0] as string;
      expect(failureSql).toContain("status = 'in_progress'");
      expect(failureSql).toContain('expires_at = $3');
      expect(failureSql).toContain('expires_at > NOW()');
    });
  });

  describe('cleanupExpired', () => {
    it('should delete expired keys', async () => {
      (query as jest.Mock).mockResolvedValue({ rowCount: 5 });
      await expect(cleanupExpired()).resolves.toBe(5);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM idempotency_keys WHERE expires_at')
      );
    });

    it('should return 0 when nothing is expired', async () => {
      (query as jest.Mock).mockResolvedValue({ rowCount: 0 });
      await expect(cleanupExpired()).resolves.toBe(0);
    });
  });
});