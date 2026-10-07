// Modified 2026-10-05: cache tenant configuration reads at the service boundary.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { pool } from '../config/database.js';
import { RedisClient } from './rateLimitService.js';
import logger from '../utils/logger.js';

export interface TenantConfig {
  id: number;
  organization_id: number;
  config_key: string;
  config_value: any;
  description?: string;
  created_at: string;
  updated_at: string;
}

export interface PaymentSettings {
  default_currency: string;
  auto_approve_threshold: number;
  require_dual_approval: boolean;
}

export interface NotificationSettings {
  email_notifications: boolean;
  sms_notifications: boolean;
  webhook_url?: string;
}

export interface SecuritySettings {
  session_timeout_minutes: number;
  require_2fa: boolean;
  ip_whitelist: string[];
}

export interface BrandingSettings {
  logo_url?: string;
  primary_color: string;
  company_name?: string;
}

export class TenantConfigService {
  private pool: Pool;

  constructor(dbPool: Pool = pool) {
    this.pool = dbPool;
  }

  private static readonly CONFIG_CACHE_TTL_SECONDS = 30 * 60;

  private configGenerationKey(organizationId: number, configKey: string): string {
    return `cache:organization-settings:${organizationId}:key:${configKey}:generation`;
  }

  private allConfigsGenerationKey(organizationId: number): string {
    return `cache:organization-settings:${organizationId}:all:generation`;
  }

  private async getOrCreateCacheGeneration(
    generationKey: string,
    metadata: Record<string, unknown>
  ): Promise<string | null> {
    const redis = RedisClient.getInstance();
    if (!redis) {
      logger.info('Cache miss', {
        cache: 'organization-settings',
        ...metadata,
        reason: 'redis_not_configured',
      });
      return null;
    }

    try {
      let generation = await redis.get(generationKey);
      if (generation === null) {
        const candidate = randomUUID();
        const created = await redis.set(generationKey, candidate, 'NX');
        generation = created === 'OK' ? candidate : await redis.get(generationKey);
      }
      return generation;
    } catch (error) {
      logger.warn('Organization settings cache generation read failed', {
        ...metadata,
        error,
      });
      return null;
    }
  }

  private async configCacheKey(
    organizationId: number,
    configKey: string
  ): Promise<string | null> {
    const generation = await this.getOrCreateCacheGeneration(
      this.configGenerationKey(organizationId, configKey),
      { organizationId, configKey }
    );
    return generation === null
      ? null
      : `cache:organization-settings:${organizationId}:key:${configKey}:${generation}`;
  }

  private async allConfigsCacheKey(organizationId: number): Promise<string | null> {
    const generation = await this.getOrCreateCacheGeneration(
      this.allConfigsGenerationKey(organizationId),
      { organizationId, configKey: '*' }
    );
    return generation === null
      ? null
      : `cache:organization-settings:${organizationId}:all:${generation}`;
  }

  private async readCache<T>(
    key: string,
    metadata: Record<string, unknown>
  ): Promise<{ hit: boolean; value: T | null }> {
    const redis = RedisClient.getInstance();
    if (!redis) {
      logger.info('Cache miss', {
        cache: 'organization-settings',
        ...metadata,
        reason: 'redis_not_configured',
      });
      return { hit: false, value: null };
    }

    try {
      const cached = await redis.get(key);
      if (cached !== null) {
        logger.info('Cache hit', { cache: 'organization-settings', ...metadata });
        return { hit: true, value: JSON.parse(cached) as T };
      }
      logger.info('Cache miss', { cache: 'organization-settings', ...metadata });
    } catch (error) {
      logger.warn('Organization settings cache read failed', { ...metadata, error });
    }

    return { hit: false, value: null };
  }

  private async writeCache(
    key: string,
    value: unknown,
    metadata: Record<string, unknown>
  ): Promise<void> {
    const redis = RedisClient.getInstance();
    if (!redis) return;

    try {
      await redis.setex(
        key,
        TenantConfigService.CONFIG_CACHE_TTL_SECONDS,
        JSON.stringify(value)
      );
    } catch (error) {
      logger.warn('Organization settings cache write failed', { ...metadata, error });
    }
  }

  /**
   * Get a specific configuration by key
   */
  async getConfig(organizationId: number, configKey: string): Promise<any | null> {
    const cacheKey = await this.configCacheKey(organizationId, configKey);
    if (cacheKey !== null) {
      const cached = await this.readCache<any>(cacheKey, { organizationId, configKey });
      if (cached.hit) return cached.value;
    }

    const query = `
      SELECT config_value
      FROM tenant_configurations
      WHERE organization_id = $1 AND config_key = $2
    `;

    const result = await this.pool.query(query, [organizationId, configKey]);
    const value = result.rows[0]?.config_value ?? null;
    if (value !== null && cacheKey !== null) {
      await this.writeCache(cacheKey, value, { organizationId, configKey });
    }
    return value;
  }

  /**
   * Get all configurations for a tenant
   */
  async getAllConfigs(organizationId: number): Promise<Record<string, any>> {
    const cacheKey = await this.allConfigsCacheKey(organizationId);
    if (cacheKey !== null) {
      const cached = await this.readCache<Record<string, any>>(cacheKey, {
        organizationId,
        configKey: '*',
      });
      if (cached.hit) return cached.value ?? {};
    }

    const query = `
      SELECT config_key, config_value
      FROM tenant_configurations
      WHERE organization_id = $1
      ORDER BY config_key
    `;

    const result = await this.pool.query(query, [organizationId]);

    const configs: Record<string, any> = {};
    result.rows.forEach((row) => {
      configs[row.config_key] = row.config_value;
    });

    if (cacheKey !== null) {
      await this.writeCache(cacheKey, configs, { organizationId, configKey: '*' });
    }
    return configs;
  }

  private async invalidateConfigCache(organizationId: number, configKey: string): Promise<void> {
    try {
      const redis = RedisClient.getInstance();
      if (redis) {
        await redis.mset(
          this.configGenerationKey(organizationId, configKey),
          randomUUID(),
          this.allConfigsGenerationKey(organizationId),
          randomUUID()
        );
        if (configKey === 'rate_limit_overrides') {
          await redis.del(`rate_limits:org:${organizationId}`);
        }
      }
    } catch (error) {
      // The database write has already succeeded; cache failure must not undo its result.
      logger.warn('Organization settings cache invalidation failed', { organizationId, configKey, error });
    }
  }

  /**
   * Set or update a configuration
   */
  async setConfig(
    organizationId: number,
    configKey: string,
    configValue: any,
    description?: string
  ): Promise<TenantConfig> {
    const query = `
      INSERT INTO tenant_configurations (organization_id, config_key, config_value, description)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (organization_id, config_key)
      DO UPDATE SET
        config_value = EXCLUDED.config_value,
        description = COALESCE(EXCLUDED.description, tenant_configurations.description),
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const result = await this.pool.query(query, [
      organizationId,
      configKey,
      JSON.stringify(configValue),
      description,
    ]);

    await this.invalidateConfigCache(organizationId, configKey);
    return result.rows[0];
  }

  /**
   * Delete a configuration
   */
  async deleteConfig(organizationId: number, configKey: string): Promise<boolean> {
    const query = `
      DELETE FROM tenant_configurations
      WHERE organization_id = $1 AND config_key = $2
      RETURNING id
    `;

    const result = await this.pool.query(query, [organizationId, configKey]);
    await this.invalidateConfigCache(organizationId, configKey);
    return result.rowCount !== null && result.rowCount > 0;
  }

  /**
   * Get payment settings
   */
  async getPaymentSettings(organizationId: number): Promise<PaymentSettings | null> {
    return this.getConfig(organizationId, 'payment_settings');
  }

  /**
   * Update payment settings
   */
  async updatePaymentSettings(
    organizationId: number,
    settings: Partial<PaymentSettings>
  ): Promise<TenantConfig> {
    const current = await this.getPaymentSettings(organizationId);
    const updated = { ...current, ...settings };
    return this.setConfig(organizationId, 'payment_settings', updated);
  }

  /**
   * Get notification settings
   */
  async getNotificationSettings(organizationId: number): Promise<NotificationSettings | null> {
    return this.getConfig(organizationId, 'notification_settings');
  }

  /**
   * Update notification settings
   */
  async updateNotificationSettings(
    organizationId: number,
    settings: Partial<NotificationSettings>
  ): Promise<TenantConfig> {
    const current = await this.getNotificationSettings(organizationId);
    const updated = { ...current, ...settings };
    return this.setConfig(organizationId, 'notification_settings', updated);
  }

  /**
   * Get security settings
   */
  async getSecuritySettings(organizationId: number): Promise<SecuritySettings | null> {
    return this.getConfig(organizationId, 'security_settings');
  }

  /**
   * Update security settings
   */
  async updateSecuritySettings(
    organizationId: number,
    settings: Partial<SecuritySettings>
  ): Promise<TenantConfig> {
    const current = await this.getSecuritySettings(organizationId);
    const updated = { ...current, ...settings };
    return this.setConfig(organizationId, 'security_settings', updated);
  }

  /**
   * Get branding settings
   */
  async getBrandingSettings(organizationId: number): Promise<BrandingSettings | null> {
    return this.getConfig(organizationId, 'branding');
  }

  /**
   * Update branding settings
   */
  async updateBrandingSettings(
    organizationId: number,
    settings: Partial<BrandingSettings>
  ): Promise<TenantConfig> {
    const current = await this.getBrandingSettings(organizationId);
    const updated = { ...current, ...settings };
    return this.setConfig(organizationId, 'branding', updated);
  }

  // ─── Rate limit overrides (Part 49) ─────────────────────────────────────────

  /**
   * Return the stored rate limit override config for this organisation.
   * Returns an empty object if none has been set (caller should fall back to global defaults).
   */
  async getRateLimitOverrides(organizationId: number): Promise<Record<string, { windowMs: number; maxRequests: number }>> {
    const val = await this.getConfig(organizationId, 'rate_limit_overrides');
    return val ?? {};
  }

  /**
   * Persist rate limit overrides for a specific tier (or all tiers at once).
   */
  async setRateLimitOverrides(
    organizationId: number,
    overrides: Record<string, { windowMs: number; maxRequests: number }>
  ): Promise<TenantConfig> {
    return this.setConfig(organizationId, 'rate_limit_overrides', overrides);
  }
}

export default new TenantConfigService();
