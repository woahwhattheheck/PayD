import { randomUUID } from 'node:crypto';
import { pool } from '../config/database.js';
import { RedisClient } from './rateLimitService.js';
import logger from '../utils/logger.js';
import {
  CreateEmployeeInput,
  UpdateEmployeeInput,
  EmployeeQueryInput,
} from '../schemas/employeeSchema.js';

export class EmployeeService {
  private readonly redis = RedisClient.getInstance();

  private listGenerationKey(organizationId: number): string {
    return `cache:employees:${organizationId}:generation`;
  }

  private async listCacheKey(
    organizationId: number,
    params: EmployeeQueryInput
  ): Promise<string | null> {
    if (!this.redis) return null;

    const generationKey = this.listGenerationKey(organizationId);
    let generation = await this.redis.get(generationKey);
    if (generation === null) {
      const candidate = randomUUID();
      const created = await this.redis.set(generationKey, candidate, 'NX');
      generation = created === 'OK' ? candidate : await this.redis.get(generationKey);
    }
    // A missing/evicted marker must never resurrect an older cached generation.
    if (generation === null) return null;

    const { page = 1, limit = 10, search, status, department } = params;
    const fingerprint = JSON.stringify([
      page,
      limit,
      search ?? '',
      status ?? '',
      department ?? '',
    ]);
    return `cache:employees:${organizationId}:${generation}:${Buffer.from(fingerprint).toString('base64url')}`;
  }

  async invalidateListCache(organizationId: number): Promise<void> {
    if (!this.redis) return;

    try {
      // One write invalidates every page/filter; in-flight fills retain the old
      // generation and expire under the existing five-minute data TTL.
      await this.redis.set(this.listGenerationKey(organizationId), randomUUID());
    } catch (error) {
      logger.warn('Employee cache invalidation failed', { organizationId, error });
    }
  }

  async create(data: CreateEmployeeInput, dbClient?: any) {
    const executor = dbClient || pool;
    const {
      organization_id,
      first_name,
      last_name,
      email,
      wallet_address,
      position,
      department,
      status,
      base_salary,
      base_currency,
    } = data;

    const query = `
      INSERT INTO employees (
        organization_id, first_name, last_name, email, wallet_address, position, department, status, base_salary, base_currency
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *;
    `;

    const values = [
      organization_id,
      first_name,
      last_name,
      email,
      wallet_address || null,
      position || null,
      department || null,
      status || 'active',
      base_salary || 0,
      base_currency || 'USDC',
    ];

    const result = await executor.query(query, values);
    if (!dbClient) {
      await this.invalidateListCache(organization_id);
    }
    return result.rows[0];
  }

  async findAll(organization_id: number, params: EmployeeQueryInput) {
    const { page = 1, limit = 10, search, status, department } = params;
    let cacheKey: string | null = null;

    if (this.redis) {
      try {
        cacheKey = await this.listCacheKey(organization_id, params);
        const cached = cacheKey === null ? null : await this.redis.get(cacheKey);
        if (cached !== null) {
          logger.info('Cache hit', { cache: 'employee-list', organizationId: organization_id });
          return JSON.parse(cached);
        }
        logger.info('Cache miss', { cache: 'employee-list', organizationId: organization_id });
      } catch (error) {
        cacheKey = null;
        logger.warn('Employee cache read failed', { organizationId: organization_id, error });
      }
    } else {
      logger.info('Cache miss', {
        cache: 'employee-list',
        organizationId: organization_id,
        reason: 'redis_not_configured',
      });
    }
    const offset = (page - 1) * limit;

    let query = `
      SELECT *, count(*) OVER() as total_count
      FROM employees
      WHERE deleted_at IS NULL
    `;
    const values: (string | number)[] = [];
    let paramIndex = 1;

    if (organization_id) {
      query += ` AND organization_id = $${paramIndex++}`;
      values.push(organization_id);
    }

    if (status) {
      query += ` AND status = $${paramIndex++}`;
      values.push(status);
    }

    if (department) {
      query += ` AND department = $${paramIndex++}`;
      values.push(department);
    }

    if (search) {
      // Use full-text search vector if possible, or ILIKE for simplicity
      query += ` AND (
        first_name ILIKE $${paramIndex} OR
        last_name ILIKE $${paramIndex} OR
        email ILIKE $${paramIndex} OR
        position ILIKE $${paramIndex}
      )`;
      values.push(`%${search}%`);
      paramIndex++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    values.push(limit, offset);

    const result = await pool.query(query, values);

    const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;
    const employees = result.rows.map((row) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { total_count, ...employee } = row;
      return employee;
    });

    const response = {
      data: employees,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };

    if (this.redis && cacheKey !== null) {
      try {
        await this.redis.setex(cacheKey, 5 * 60, JSON.stringify(response));
      } catch (error) {
        logger.warn('Employee cache write failed', { organizationId: organization_id, error });
      }
    }

    return response;
  }

  async findById(id: number, organization_id: number) {
    const query = `
      SELECT * FROM employees
      WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
    `;
    const result = await pool.query(query, [id, organization_id]);
    return result.rows[0] || null;
  }

  async update(id: number, organization_id: number, data: UpdateEmployeeInput) {
    const fields: string[] = [];
    const values: (string | number | null)[] = [];
    let paramIndex = 1;

    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) {
        fields.push(`${key} = $${paramIndex++}`);
        values.push(value);
      }
    });

    if (fields.length === 0) return null;

    values.push(id, organization_id);
    const query = `
      UPDATE employees
      SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${paramIndex++} AND organization_id = $${paramIndex} AND deleted_at IS NULL
      RETURNING *;
    `;

    const result = await pool.query(query, values);
    const updated = result.rows[0] || null;
    if (updated) {
      await this.invalidateListCache(organization_id);
    }
    return updated;
  }

  async delete(id: number, organization_id: number) {
    const query = `
      UPDATE employees
      SET deleted_at = NOW(), status = 'inactive'
      WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
      RETURNING *;
    `;
    const result = await pool.query(query, [id, organization_id]);
    const deleted = result.rows[0] || null;
    if (deleted) {
      await this.invalidateListCache(organization_id);
    }
    return deleted;
  }
}

export const employeeService = new EmployeeService();
