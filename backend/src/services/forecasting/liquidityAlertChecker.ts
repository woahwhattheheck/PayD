import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { pool } from '../../config/database.js';
import tenantConfigService from '../tenantConfigService.js';
import { ForecastingService } from './forecastingService.js';
import { emitLiquidityAlert } from '../socketService.js';
import { MailerService } from '../notifications/mailerService.js';
import { WebhookService } from '../webhook.service.js';

interface LiquiditySettings {
  distributionAccount: string;
  assetIssuer: string;
  assetCode?: string;
  benefitsRatePct?: number;
  yellowBufferPct?: number;
  alertEmails?: string[];
}

export class LiquidityAlertChecker {
  private cronJob: ScheduledTask | null = null;
  private readonly activeRuns = new Set<Promise<void>>();

  initialize(): void {
    this.cronJob = cron.schedule('0 * * * *', () => {
      const run = (async () => {
        try {
          await this.checkAllOrganizations();
        } catch (error) {
          console.error('[LiquidityAlertChecker] Error executing check:', error);
        }
      })();
      this.trackRun(run);
    });

    console.log('[LiquidityAlertChecker] Cron job initialized - running hourly');
  }

  private trackRun(run: Promise<void>): void {
    this.activeRuns.add(run);
    void run.then(
      () => {
        this.activeRuns.delete(run);
      },
      () => {
        this.activeRuns.delete(run);
      }
    );
  }

  async stop(): Promise<void> {
    if (this.cronJob) {
      this.cronJob.stop();
    }

    const activeRuns = [...this.activeRuns];
    if (activeRuns.length > 0) {
      await Promise.allSettled(activeRuns);
    }

    console.log('[LiquidityAlertChecker] Cron job stopped and active runs drained');
  }

  async checkAllOrganizations(): Promise<void> {
    const orgs = await pool.query('SELECT id FROM organizations ORDER BY id ASC');

    for (const row of orgs.rows) {
      const organizationId = Number(row.id);
      if (!organizationId) continue;

      try {
        await this.checkOrganization(organizationId);
      } catch (error) {
        console.error(`[LiquidityAlertChecker] Failed org ${organizationId}:`, error);
      }
    }
  }

  private async checkOrganization(organizationId: number): Promise<void> {
    const liquiditySettings = (await tenantConfigService.getConfig(
      organizationId,
      'liquidity_settings'
    )) as LiquiditySettings | null;

    if (!liquiditySettings?.distributionAccount || !liquiditySettings.assetIssuer) return;

    const forecast = await ForecastingService.getForecast(organizationId, 3);
    const { liquidity } = forecast;

    if (liquidity.status === 'green') return;

    const severity = liquidity.status;
    const nextRunTimestamp = forecast.nextRuns[0]?.runTimestamp;
    if (!nextRunTimestamp) return;

    const required = liquidity.requiredNext2Runs;
    const available = liquidity.availableBalance;
    const shortfall = liquidity.shortfallNext2Runs;

    const alreadySent = await this.wasAlertSentRecently(organizationId, nextRunTimestamp, severity);
    if (alreadySent) return;

    const insert = await pool.query(
      `INSERT INTO liquidity_alerts (
        organization_id, schedule_id, alert_type, severity, required_amount, available_amount, shortfall_amount,
        next_run_timestamp, asset_code, asset_issuer, sent_at
      ) VALUES ($1, $2, 'insufficient_liquidity', $3, $4, $5, $6, $7, $8, $9, NOW())
      RETURNING id`,
      [
        organizationId,
        forecast.nextRuns[0]?.scheduleId || null,
        severity,
        required,
        available,
        shortfall,
        new Date(nextRunTimestamp),
        liquidity.assetCode,
        liquidity.assetIssuer,
      ]
    );

    const alertId = insert.rows[0]?.id;

    emitLiquidityAlert(organizationId, {
      alertId,
      severity,
      requiredAmount: required,
      availableAmount: available,
      shortfallAmount: shortfall,
      nextRunTimestamp,
      assetCode: liquidity.assetCode,
    });

    const notificationSettings = (await tenantConfigService.getNotificationSettings(organizationId)) as any;
    const webhookUrl = notificationSettings?.webhook_url;

    const payload = {
      organizationId,
      type: 'insufficient_liquidity',
      severity,
      requiredAmount: required,
      availableAmount: available,
      shortfallAmount: shortfall,
      nextRunTimestamp,
      assetCode: liquidity.assetCode,
      assetIssuer: liquidity.assetIssuer,
      distributionAccount: liquidity.distributionAccount,
    };

    if (webhookUrl) {
      await WebhookService.dispatch('liquidity.insufficient', payload);
    }

    const alertEmails = liquiditySettings.alertEmails || [];
    if (alertEmails.length > 0 && MailerService.isConfigured()) {
      await MailerService.sendMail({
        to: alertEmails,
        subject: `PayD: Liquidity ${severity.toUpperCase()} for upcoming payroll`,
        text:
          `Liquidity status is ${severity} for your next payroll runs.\n` +
          `Next run: ${nextRunTimestamp}\n` +
          `Available: ${available} ${liquidity.assetCode}\n` +
          `Required (next 2 runs): ${required} ${liquidity.assetCode}\n` +
          `Shortfall: ${shortfall} ${liquidity.assetCode}\n`,
      });
    }
  }

  private async wasAlertSentRecently(
    organizationId: number,
    nextRunTimestampIso: string,
    severity: 'yellow' | 'red'
  ): Promise<boolean> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const nextRun = new Date(nextRunTimestampIso);

    const result = await pool.query(
      `SELECT id
       FROM liquidity_alerts
       WHERE organization_id = $1
         AND severity = $2
         AND next_run_timestamp = $3
         AND sent_at IS NOT NULL
         AND sent_at >= $4
       LIMIT 1`,
      [organizationId, severity, nextRun, since]
    );

    return result.rows.length > 0;
  }
}

export const liquidityAlertChecker = new LiquidityAlertChecker();
