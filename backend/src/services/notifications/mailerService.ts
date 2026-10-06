import logger from '../../utils/logger.js';

export interface SendMailInput {
  to: string[];
  subject: string;
  text: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class MailerService {
  static isConfigured(): boolean {
    return !!process.env.SMTP_HOST && !!process.env.SMTP_USER && !!process.env.SMTP_PASS;
  }

  private static async loadNodemailer(): Promise<any> {
    return (await import('nodemailer')).default;
  }

  private static logContext(input: SendMailInput) {
    return {
      recipients: input.to,
      mailType: input.subject,
    };
  }

  static async sendMail(input: SendMailInput): Promise<void> {
    const context = this.logContext(input);

    if (!this.isConfigured()) {
      logger.warn('Mailer is not configured; email was not sent.', context);
      return;
    }

    let nodemailer: any;
    try {
      nodemailer = await this.loadNodemailer();
    } catch (error) {
      logger.error('Nodemailer could not be loaded; email was not sent.', {
        ...context,
        error: errorMessage(error),
      });
      return;
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const from = process.env.SMTP_FROM || process.env.SMTP_USER;

    try {
      await transporter.sendMail({
        from,
        to: input.to.join(','),
        subject: input.subject,
        text: input.text,
      });
    } catch (error) {
      logger.error('Mailer failed to send email.', {
        ...context,
        error: errorMessage(error),
      });
      throw error;
    }
  }
}
