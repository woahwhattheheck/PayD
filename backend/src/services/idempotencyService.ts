import { query } from '../config/database.js';
import logger from '../utils/logger.js';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_REPLAY_WAIT_MS = 5_000;
const INITIAL_REPLAY_POLL_MS = 25;
const MAX_REPLAY_POLL_MS = 100;

export class IdempotencyConflictError extends Error {
  constructor(organizationId: number, idempotencyKey: string) {
    super(
      `Concurrent duplicate for idempotency key ${idempotencyKey} (org ${organizationId})`
    );
    this.name = 'IdempotencyConflictError';
  }
}

export interface IdempotencyRecord {
  id: number;
  organizationId: number;
  idempotencyKey: string;
  status: 'in_progress' | 'completed' | 'failed';
  responseStatus: number | null;
  responseBody: unknown;
  createdAt: Date;
  expiresAt: Date;
}

export interface IdempotencyLease {
  kind: 'claimed';
  expiresAt: Date;
}

export interface IdempotencyReplay {
  kind: 'replay';
  record: IdempotencyRecord;
}

export type IdempotencyClaimResult = IdempotencyLease | IdempotencyReplay;

/**
 * Store an idempotency key with a lock (in_progress status).
 * Returns a lease when this request owns the key.
 * Returns a replay record when a completed/failed key already exists.
 * Throws IdempotencyConflictError if another request is in progress.
 */
export async function claimKey(
  organizationId: number,
  idempotencyKey: string,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<IdempotencyClaimResult> {
  const expiresAt = new Date(Date.now() + ttlMs);

  try {
    // Step 1: Atomically reserve a fresh key. The unique constraint is the
    // concurrency primitive: concurrent inserts for the same tenant/key are
    // serialized by PostgreSQL, and losers return rowCount 0 instead of
    // surfacing a unique-violation that the middleware could fail open on.
    const insertResult = await query(
      `INSERT INTO idempotency_keys (organization_id, idempotency_key, status, expires_at)
       VALUES ($1, $2, 'in_progress', $3)
       ON CONFLICT (organization_id, idempotency_key) DO NOTHING
       RETURNING id`,
      [organizationId, idempotencyKey, expiresAt]
    );

    if ((insertResult.rowCount ?? 0) > 0) {
      return { kind: 'claimed', expiresAt };
    }

    // Step 2: Recycle an expired record atomically. Expiry applies to every
    // terminal state, not only in_progress rows; otherwise an expired cached
    // success/error can never be reused because the unique row remains.
    const updateResult = await query(
      `UPDATE idempotency_keys
       SET status = 'in_progress',
           response_status = NULL,
           response_body = NULL,
           created_at = NOW(),
           expires_at = $3
       WHERE organization_id = $1
         AND idempotency_key = $2
         AND expires_at <= NOW()
       RETURNING id`,
      [organizationId, idempotencyKey, expiresAt]
    );

    if ((updateResult.rowCount ?? 0) > 0) {
      return { kind: 'claimed', expiresAt };
    }

    // Step 3: Key exists and is NOT expired. Fetch its current state to
    // distinguish between a replay (completed/failed) and a concurrent
    // duplicate (in_progress from another in-flight request).
    const existingResult = await query(
      `SELECT id, organization_id, idempotency_key, status, response_status, response_body, created_at, expires_at
       FROM idempotency_keys
       WHERE organization_id = $1 AND idempotency_key = $2 AND expires_at > NOW()`,
      [organizationId, idempotencyKey]
    );

    const row = existingResult.rows[0];
    if (!row) {
      // Row expired between step 2 and step 3 — retry from scratch.
      return claimKey(organizationId, idempotencyKey, ttlMs);
    }

    const record: IdempotencyRecord = {
      id: row.id,
      organizationId: row.organization_id,
      idempotencyKey: row.idempotency_key,
      status: row.status,
      responseStatus: row.response_status,
      responseBody: row.response_body,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };

    if (record.status === 'completed' || record.status === 'failed') {
      return { kind: 'replay', record };
    }

    // status is in_progress — another request holds the lock.
    throw new IdempotencyConflictError(organizationId, idempotencyKey);
  } catch (error) {
    if (error instanceof IdempotencyConflictError) throw error;
    logger.error('Failed to claim idempotency key', { organizationId, idempotencyKey, error });
    throw error;
  }
}

/**
 * Wait for another request holding the key to publish its terminal cached response.
 *
 * Returns the completed/failed record when it becomes available. Returns null
 * when the key disappears/expires or remains in progress past the bounded wait.
 * Polling backs off to keep duplicate bursts from hammering PostgreSQL.
 */
export async function waitForReplay(
  organizationId: number,
  idempotencyKey: string,
  timeoutMs: number = DEFAULT_REPLAY_WAIT_MS,
  initialPollMs: number = INITIAL_REPLAY_POLL_MS,
  maxPollMs: number = MAX_REPLAY_POLL_MS
): Promise<IdempotencyRecord | null> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  let pollMs = Math.max(0, initialPollMs);

  while (true) {
    const result = await query(
      `SELECT id, organization_id, idempotency_key, status, response_status, response_body, created_at, expires_at
       FROM idempotency_keys
       WHERE organization_id = $1 AND idempotency_key = $2 AND expires_at > NOW()`,
      [organizationId, idempotencyKey]
    );

    const row = result.rows[0];
    if (!row) return null;

    if (row.status === 'completed' || row.status === 'failed') {
      return {
        id: row.id,
        organizationId: row.organization_id,
        idempotencyKey: row.idempotency_key,
        status: row.status,
        responseStatus: row.response_status,
        responseBody: row.response_body,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      };
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return null;

    const sleepMs = Math.min(pollMs, remainingMs);
    if (sleepMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
    }

    if (pollMs === 0) {
      pollMs = 1;
    } else {
      pollMs = Math.min(pollMs * 2, Math.max(pollMs, maxPollMs));
    }
  }
}

/**
 * Check if a key is currently locked by another in-flight request.
 * This handles the case where two concurrent requests try to claim the same key.
 */
export async function isInFlight(organizationId: number, idempotencyKey: string): Promise<boolean> {
  const result = await query(
    `SELECT status FROM idempotency_keys
     WHERE organization_id = $1 AND idempotency_key = $2 AND expires_at > NOW()`,
    [organizationId, idempotencyKey]
  );

  if (result.rows.length === 0) return false;
  return result.rows[0].status === 'in_progress';
}

/**
 * Complete an idempotency key by storing the response for the owning lease.
 * Returns false when the lease expired or a newer request recycled the key.
 */
export async function completeKey(
  organizationId: number,
  idempotencyKey: string,
  leaseExpiresAt: Date,
  responseStatus: number,
  responseBody: unknown
): Promise<boolean> {
  const result = await query(
    `UPDATE idempotency_keys
     SET status = 'completed', response_status = $4, response_body = $5
     WHERE organization_id = $1
       AND idempotency_key = $2
       AND status = 'in_progress'
       AND expires_at = $3
       AND expires_at > NOW()`,
    [organizationId, idempotencyKey, leaseExpiresAt, responseStatus, JSON.stringify(responseBody)]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Mark an idempotency key as failed for the owning lease.
 * Returns false when the lease expired or a newer request recycled the key.
 */
export async function failKey(
  organizationId: number,
  idempotencyKey: string,
  leaseExpiresAt: Date,
  responseStatus: number,
  responseBody: unknown
): Promise<boolean> {
  const result = await query(
    `UPDATE idempotency_keys
     SET status = 'failed', response_status = $4, response_body = $5
     WHERE organization_id = $1
       AND idempotency_key = $2
       AND status = 'in_progress'
       AND expires_at = $3
       AND expires_at > NOW()`,
    [organizationId, idempotencyKey, leaseExpiresAt, responseStatus, JSON.stringify(responseBody)]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Clean up expired idempotency keys.
 * Called periodically or on startup.
 */
export async function cleanupExpired(): Promise<number> {
  const result = await query(`DELETE FROM idempotency_keys WHERE expires_at < NOW()`);
  const deleted = result.rowCount ?? 0;
  if (deleted > 0) {
    logger.info(`Cleaned up ${deleted} expired idempotency keys`);
  }
  return deleted;
}