import { readEnv } from '../../config/env.js';
export interface SendMailInput {
  to: string[];
  subject: string;
  text: string;
}

export class MailerService {
  static isConfigured(): boolean {
    return !!readEnv('SMTP_HOST') && !!readEnv('SMTP_USER') && !!readEnv('SMTP_PASS');
  }

  static async sendMail(input: SendMailInput): Promise<void> {
    if (!this.isConfigured()) return;

    let nodemailer: any;
    try {
      nodemailer = (await import('nodemailer')).default;
    } catch {
      return;
    }

    const transporter = nodemailer.createTransport({
      host: readEnv('SMTP_HOST'),
      port: Number(readEnv('SMTP_PORT') || '587'),
      secure: readEnv('SMTP_SECURE') === 'true',
      auth: {
        user: readEnv('SMTP_USER'),
        pass: readEnv('SMTP_PASS'),
      },
    });

    const from = readEnv('SMTP_FROM') || readEnv('SMTP_USER');

    await transporter.sendMail({
      from,
      to: input.to.join(','),
      subject: input.subject,
      text: input.text,
    });
  }
}
