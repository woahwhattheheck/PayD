// Modified 2026-10-05: keep unbound handlers safe; tenant-config caching lives in the service.
import { Request, Response } from 'express';
import { ForecastingService } from '../services/forecasting/forecastingService.js';
import tenantConfigService from '../services/tenantConfigService.js';

export class ForecastController {
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

      const settings = await tenantConfigService.getConfig(organizationId, 'liquidity_settings');

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

      res.status(200).json({ success: true, data: payload });
    } catch (error: any) {
      res.status(500).json({
        error: 'Failed to update liquidity settings',
        message: error?.message || 'Unknown error',
      });
    }
  }
}
