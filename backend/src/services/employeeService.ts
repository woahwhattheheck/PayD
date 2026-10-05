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

  private listCacheKey(organizationId: number, params: EmployeeQueryInput): string {
    const { page = 1, limit = 10, search, status, department } = params;
    const fingerprint = JSON.stringify([
      page,
      limit,
      search ?? '',
      status ?? '',
      department ?? '',
    ]);
    return `cache:employees:${organizationId}:${Buffer.from(fingerprint).toString('base64url')}`;
  }

  async invalidateListCache(organizationId: number): Promise<void> {
    if (!this.redis) return;

    const pattern = `cache:employees:${organizationId}:*`;
    try {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        const firstKey = keys[0];
        if (firstKey) {
          await this.redis.del(firstKey, ...keys.slice(1));
        }
      } while (cursor !== '0');
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
    const cacheKey = this.listCacheKey(organization_id, params);

    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached !== null) {
          logger.info('Cache hit', { cache: 'employee-list', organizationId: organization_id });
          return JSON.parse(cached);
        }
        logger.info('Cache miss', { cache: 'employee-list', organizationId: organization_id });
      } catch (error) {
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

    if (this.redis) {
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
