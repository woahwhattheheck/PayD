import logger from '../../utils/logger.js';

export interface SendMailInput {
  to: string[];
  subject: string;
  text: string;
}

/** Retain useful SMTP failure diagnostics without writing configured credentials. */
function safeMailErrorMessage(error: unknown): string {
  let message: string;
  try {
    message = error instanceof Error ? error.message : String(error);
  } catch {
    message = 'Unprintable mailer error';
  }
  for (const secret of [process.env.SMTP_PASS, process.env.SMTP_USER]) {
    if (secret) message = message.split(secret).join('[REDACTED]');
  }
  return message;
}

export class MailerService {
  static isConfigured(): boolean {
    return !!process.env.SMTP_HOST && !!process.env.SMTP_USER && !!process.env.SMTP_PASS;
  }

  private static async loadNodemailer(): Promise<any> {
    return (await import('nodemailer')).default;
  }

  static async sendMail(input: SendMailInput): Promise<void> {
    const context = {
      recipients: input.to,
      mailType: input.subject,
    };

    if (!this.isConfigured()) {
      logger.warn('Mailer skipped because SMTP is not configured.', context);
      return;
    }

    let nodemailer: any;
    try {
      nodemailer = await this.loadNodemailer();
    } catch (error) {
      logger.error('Mailer failed to load nodemailer.', {
        ...context,
        error: safeMailErrorMessage(error),
      });
      return;
    }

    const from = process.env.SMTP_FROM || process.env.SMTP_USER;

    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      await transporter.sendMail({
        from,
        to: input.to.join(','),
        subject: input.subject,
        text: input.text,
      });
    } catch (error) {
      logger.error('Mailer failed to send email.', {
        ...context,
        error: safeMailErrorMessage(error),
      });
      throw error;
    }
  }
}
