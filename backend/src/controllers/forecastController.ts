// Modified 2026-10-05: use the class-owned Redis client in unbound route handlers.
import { Request, Response } from 'express';
import { ForecastingService } from '../services/forecasting/forecastingService.js';
import tenantConfigService from '../services/tenantConfigService.js';
import { RedisClient } from '../services/rateLimitService.js';
import logger from '../utils/logger.js';

export class ForecastController {
  private static readonly redis = RedisClient.getInstance();

  static async getForecast(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        res.status(403).json({ error: 'User is not associated with an organization' });
        return;
      }

      const monthsForwardRaw = req.query.monthsForward;
      const monthsForwardValue =
        typeof monthsForwardRaw === 'string'
          ? Number.parseInt(monthsForwardRaw, 10)
          : 6;
      const monthsForward = Math.min(6, Math.max(3, Number.isFinite(monthsForwardValue) ? monthsForwardValue : 6));

      const forecast = await ForecastingService.getForecast(organizationId, monthsForward);
      res.status(200).json({ success: true, data: forecast });
    } catch (error: any) {
      const status = error?.statusCode ? Number(error.statusCode) : 500;
      res.status(status).json({
        error: 'Failed to generate forecast',
        message: error?.message || 'Unknown error',
      });
    }
  }

  static async getLiquiditySettings(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        res.status(403).json({ error: 'User is not associated with an organization' });
        return;
      }

      const cacheKey = `cache:organization-settings:${organizationId}:liquidity-settings`;
      let settings: any | null = null;

      if (ForecastController.redis) {
        try {
          const cached = await ForecastController.redis.get(cacheKey);
          if (cached !== null) {
            logger.info('Cache hit', { cache: 'organization-settings', organizationId });
            settings = JSON.parse(cached);
          } else {
            logger.info('Cache miss', { cache: 'organization-settings', organizationId });
          }
        } catch (error) {
          logger.warn('Organization settings cache read failed', { organizationId, error });
        }
      } else {
        logger.info('Cache miss', {
          cache: 'organization-settings',
          organizationId,
          reason: 'redis_not_configured',
        });
      }

      if (settings === null) {
        settings = await tenantConfigService.getConfig(organizationId, 'liquidity_settings');
        if (ForecastController.redis && settings !== null) {
          try {
            await ForecastController.redis.setex(cacheKey, 30 * 60, JSON.stringify(settings));
          } catch (error) {
            logger.warn('Organization settings cache write failed', { organizationId, error });
          }
        }
      }

      res.status(200).json({ success: true, data: settings || null });
    } catch (error: any) {
      res.status(500).json({
        error: 'Failed to get liquidity settings',
        message: error?.message || 'Unknown error',
      });
    }
  }

  static async updateLiquiditySettings(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        res.status(403).json({ error: 'User is not associated with an organization' });
        return;
      }

      const {
        distributionAccount,
        assetIssuer,
        assetCode,
        benefitsRatePct,
        yellowBufferPct,
        alertEmails,
      } = req.body || {};

      if (!distributionAccount || typeof distributionAccount !== 'string' || distributionAccount.length !== 56) {
        res.status(400).json({ error: 'distributionAccount must be a 56-char Stellar public key' });
        return;
      }

      if (!assetIssuer || typeof assetIssuer !== 'string' || assetIssuer.length !== 56) {
        res.status(400).json({ error: 'assetIssuer must be a 56-char Stellar public key' });
        return;
      }

      const payload = {
        distributionAccount,
        assetIssuer,
        assetCode,
        benefitsRatePct,
        yellowBufferPct,
        alertEmails,
      };

      await tenantConfigService.setConfig(organizationId, 'liquidity_settings', payload);

      if (ForecastController.redis) {
        try {
          await ForecastController.redis.del(`cache:organization-settings:${organizationId}:liquidity-settings`);
        } catch (error) {
          logger.warn('Organization settings cache invalidation failed', { organizationId, error });
        }
      }

      res.status(200).json({ success: true, data: payload });
    } catch (error: any) {
      res.status(500).json({
        error: 'Failed to update liquidity settings',
        message: error?.message || 'Unknown error',
      });
    }
  }
}
