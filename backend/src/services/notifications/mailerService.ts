import logger from '../../utils/logger.js';

export interface SendMailInput {
  to: string[];
  subject: string;
  text: string;
}

export interface MailerHealthStatus {
  status: 'connected' | 'disconnected' | 'not_configured';
  error?: string;
  queuedRetries: number;
}

interface RetryItem {
  input: SendMailInput;
  attempt: number;
}

export const mailerConfig = {
  maxRetryAttempts: 3,
  retryDelayMs: 1000,
};

export class MailerService {
  private static transporter: any | null = null;
  private static retryQueue: RetryItem[] = [];
  private static retryTimer: ReturnType<typeof setTimeout> | null = null;
  private static lastError: string | undefined;
  private static serviceDown = false;

  static isConfigured(): boolean {
    return !!process.env.SMTP_HOST && !!process.env.SMTP_USER && !!process.env.SMTP_PASS;
  }

  static async sendMail(input: SendMailInput): Promise<void> {
    try {
      await this.deliver(input);
    } catch (error) {
      this.recordDeliveryFailure(input, error, 0);
      this.enqueueRetry(input, 1);
    }
  }

  static async getHealthStatus(): Promise<MailerHealthStatus> {
    if (!this.isConfigured()) {
      const error = new Error('SMTP configuration incomplete');
      this.markDown(error, { reason: 'not_configured' });
      return {
        status: 'not_configured',
        error: error.message,
        queuedRetries: this.retryQueue.length,
      };
    }

    try {
      const transporter = await this.getTransporter();
      if (typeof transporter.verify === 'function') {
        await transporter.verify();
      }
      this.markUp();
      return {
        status: 'connected',
        queuedRetries: this.retryQueue.length,
      };
    } catch (error) {
      this.markDown(error, { reason: 'health_check_failed' });
      return {
        status: 'disconnected',
        error: this.errorMessage(error),
        queuedRetries: this.retryQueue.length,
      };
    }
  }

  private static async deliver(input: SendMailInput): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('SMTP configuration incomplete');
    }

    const transporter = await this.getTransporter();
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;

    await transporter.sendMail({
      from,
      to: input.to.join(','),
      subject: input.subject,
      text: input.text,
    });

    this.markUp();
  }

  private static async getTransporter(): Promise<any> {
    if (this.transporter) {
      return this.transporter;
    }

    const nodemailer = (await import('nodemailer')).default;
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    return this.transporter;
  }

  private static enqueueRetry(input: SendMailInput, attempt: number): void {
    if (attempt > mailerConfig.maxRetryAttempts) {
      return;
    }

    this.retryQueue.push({
      input: {
        ...input,
        to: [...input.to],
      },
      attempt,
    });
    this.scheduleRetry();
  }

  private static scheduleRetry(): void {
    if (this.retryTimer || this.retryQueue.length === 0) {
      return;
    }

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.processNextRetry();
    }, mailerConfig.retryDelayMs);
    this.retryTimer.unref?.();
  }

  private static async processNextRetry(): Promise<void> {
    const item = this.retryQueue.shift();
    if (!item) {
      return;
    }

    try {
      await this.deliver(item.input);
      logger.info('Email retry succeeded', {
        recipients: item.input.to,
        subject: item.input.subject,
        attempt: item.attempt,
      });
    } catch (error) {
      this.recordDeliveryFailure(item.input, error, item.attempt);

      if (item.attempt < mailerConfig.maxRetryAttempts) {
        this.retryQueue.push({
          input: item.input,
          attempt: item.attempt + 1,
        });
      } else {
        logger.error('Email delivery abandoned after retry limit', {
          recipients: item.input.to,
          subject: item.input.subject,
          attempts: mailerConfig.maxRetryAttempts,
          error: this.errorMessage(error),
        });
      }
    } finally {
      this.scheduleRetry();
    }
  }

  private static recordDeliveryFailure(
    input: SendMailInput,
    error: unknown,
    retryAttempt: number
  ): void {
    const context = {
      recipients: input.to,
      subject: input.subject,
      smtpHost: process.env.SMTP_HOST || null,
      smtpPort: Number(process.env.SMTP_PORT || '587'),
      retryAttempt,
      error: this.errorMessage(error),
    };

    logger.error('SMTP delivery failed', context);
    this.markDown(error, context);
  }

  private static markDown(error: unknown, context: Record<string, unknown>): void {
    this.lastError = this.errorMessage(error);
    if (!this.serviceDown) {
      this.serviceDown = true;
      logger.error('Email service is down', {
        ...context,
        error: this.lastError,
      });
    }
  }

  private static markUp(): void {
    if (this.serviceDown) {
      logger.info('Email service recovered');
    }
    this.serviceDown = false;
    this.lastError = undefined;
  }

  private static errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
