import { query } from '../config/database.js';
import logger from '../utils/logger.js';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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

/**
 * Store an idempotency key with a lock (in_progress status).
 * Returns the existing record if the key already exists and is not expired.
 * Returns null if the key is newly created.
 * Throws IdempotencyConflictError if the key is in_progress (concurrent duplicate).
 */
export async function claimKey(
  organizationId: number,
  idempotencyKey: string,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<IdempotencyRecord | null> {
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
      return null;
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
       RETURNING id, organization_id, idempotency_key, status, response_status, response_body, created_at, expires_at`,
      [organizationId, idempotencyKey, expiresAt]
    );

    if ((updateResult.rowCount ?? 0) > 0) {
      // Successfully recycled an expired row — treat as a fresh claim.
      return null;
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
      return record;
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
 * Complete an idempotency key by storing the response.
 */
export async function completeKey(
  organizationId: number,
  idempotencyKey: string,
  responseStatus: number,
  responseBody: unknown
): Promise<void> {
  await query(
    `UPDATE idempotency_keys
     SET status = 'completed', response_status = $3, response_body = $4
     WHERE organization_id = $1 AND idempotency_key = $2 AND expires_at > NOW()`,
    [organizationId, idempotencyKey, responseStatus, JSON.stringify(responseBody)]
  );
}

/**
 * Mark an idempotency key as failed (for error responses).
 */
export async function failKey(
  organizationId: number,
  idempotencyKey: string,
  responseStatus: number,
  responseBody: unknown
): Promise<void> {
  await query(
    `UPDATE idempotency_keys
     SET status = 'failed', response_status = $3, response_body = $4
     WHERE organization_id = $1 AND idempotency_key = $2 AND expires_at > NOW()`,
    [organizationId, idempotencyKey, responseStatus, JSON.stringify(responseBody)]
  );
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
